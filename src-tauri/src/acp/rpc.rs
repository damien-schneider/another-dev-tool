use std::io::{self, BufRead as _, BufReader, Lines, Write as _};
use std::os::unix::process::CommandExt as _;
use std::path::Path;
use std::process::{Child, ChildStdin, ChildStdout, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use super::catalog::Launch;
use crate::agent::cli::crash_reason;
use crate::error::AppError;

pub const AUTH_REQUIRED: i64 = -32000;
const METHOD_NOT_FOUND: i64 = -32601;
const STDERR_KEPT: usize = 8 * 1024;
const EXIT_GRACE: Duration = Duration::from_secs(3);

#[derive(Debug, Clone, PartialEq)]
pub struct RpcError {
    pub code: i64,
    pub message: String,
}

impl RpcError {
    pub fn method_not_found(method: &str) -> Self {
        Self {
            code: METHOD_NOT_FOUND,
            message: format!("{method} is not supported"),
        }
    }
}

#[derive(Debug)]
pub enum Failure {
    Rpc(RpcError),
    Stopped(String),
    Io(io::Error),
}

impl From<io::Error> for Failure {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<serde_json::Error> for Failure {
    fn from(error: serde_json::Error) -> Self {
        Self::Io(error.into())
    }
}

impl From<Failure> for AppError {
    fn from(failure: Failure) -> Self {
        Self::Internal(failure.message())
    }
}

impl Failure {
    pub fn message(&self) -> String {
        match self {
            Self::Rpc(error) => error.message.clone(),
            Self::Stopped(reason) => reason.clone(),
            Self::Io(error) => error.to_string(),
        }
    }

    pub fn needs_sign_in(&self) -> bool {
        matches!(self, Self::Rpc(error) if error.code == AUTH_REQUIRED)
    }
}

/// What the agent asks of the client while a request is in flight.
pub trait Client {
    fn notified(&mut self, method: &str, params: Value);
    fn requested(&mut self, method: &str, params: Value) -> Result<Value, RpcError>;
}

#[derive(Clone)]
pub struct Stopper {
    stdin: Arc<Mutex<Option<ChildStdin>>>,
    group: i32,
}

impl Stopper {
    pub fn notify(&self, method: &str, params: Value) {
        if let Err(error) = write(
            &self.stdin,
            &json!({"jsonrpc": "2.0", "method": method, "params": params}),
        ) {
            log::warn!("couldn't send {method}: {error}");
        }
    }

    /// The adapter's own children (the Claude or Codex process doing the work)
    /// share its process group, so they stop with it instead of orphaning.
    pub fn terminate(&self) {
        signal(self.group, libc::SIGTERM);
    }

    fn kill(&self) {
        signal(self.group, libc::SIGKILL);
    }
}

fn signal(group: i32, signal: i32) {
    // SAFETY: killpg only sends a signal; the group is our own child's.
    unsafe {
        libc::killpg(group, signal);
    }
}

fn write(stdin: &Mutex<Option<ChildStdin>>, message: &Value) -> io::Result<()> {
    let mut line = serde_json::to_vec(message)?;
    line.push(b'\n');
    let mut held = stdin
        .lock()
        .map_err(|_| io::Error::other("agent stdin lock poisoned"))?;
    let stdin = held
        .as_mut()
        .ok_or_else(|| io::Error::new(io::ErrorKind::BrokenPipe, "agent stdin closed"))?;
    stdin.write_all(&line)?;
    stdin.flush()
}

pub struct Agent {
    child: Child,
    stopper: Stopper,
    lines: Lines<BufReader<ChildStdout>>,
    stderr: Arc<Mutex<String>>,
    next_id: u64,
}

fn drain(mut stderr: impl io::Read + Send + 'static) -> Arc<Mutex<String>> {
    let kept = Arc::new(Mutex::new(String::new()));
    let sink = Arc::clone(&kept);
    thread::spawn(move || {
        let mut chunk = [0_u8; 4096];
        while let Ok(read) = stderr.read(&mut chunk) {
            if read == 0 {
                break;
            }
            if let Ok(mut kept) = sink.lock() {
                kept.push_str(&String::from_utf8_lossy(&chunk[..read]));
                if kept.len() > STDERR_KEPT {
                    let cut = kept.ceil_char_boundary(kept.len() - STDERR_KEPT);
                    kept.drain(..cut);
                }
            }
        }
    });
    kept
}

impl Agent {
    pub fn spawn(launch: &Launch, cwd: &Path) -> io::Result<Self> {
        let mut child = launch
            .command(cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .process_group(0)
            .spawn()
            .map_err(|error| {
                io::Error::new(
                    error.kind(),
                    format!("couldn't start {}: {error}", launch.name),
                )
            })?;
        let (Some(stdin), Some(stdout), Some(stderr)) =
            (child.stdin.take(), child.stdout.take(), child.stderr.take())
        else {
            return Err(io::Error::other("agent pipes missing"));
        };
        let group = i32::try_from(child.id())
            .map_err(|_| io::Error::other("agent process id out of range"))?;
        Ok(Self {
            child,
            stopper: Stopper {
                stdin: Arc::new(Mutex::new(Some(stdin))),
                group,
            },
            lines: BufReader::new(stdout).lines(),
            stderr: drain(stderr),
            next_id: 0,
        })
    }

    pub fn stopper(&self) -> Stopper {
        self.stopper.clone()
    }

    fn exited(&self) -> Failure {
        let stderr = self
            .stderr
            .lock()
            .map(|kept| kept.clone())
            .unwrap_or_default();
        Failure::Stopped(crash_reason(&stderr))
    }

    pub fn request(
        &mut self,
        method: &str,
        params: Value,
        client: &mut dyn Client,
    ) -> Result<Value, Failure> {
        self.next_id += 1;
        let id = json!(self.next_id);
        write(
            &self.stopper.stdin,
            &json!({"jsonrpc": "2.0", "id": id, "method": method, "params": params}),
        )
        .map_err(|_| self.exited())?;
        loop {
            let Some(line) = self.lines.next() else {
                return Err(self.exited());
            };
            let Ok(message) = serde_json::from_str::<Value>(&line?) else {
                continue;
            };
            match message.get("method").and_then(Value::as_str) {
                Some(incoming) => {
                    let params = message.get("params").cloned().unwrap_or(Value::Null);
                    match message.get("id") {
                        Some(request_id) => {
                            let reply = client.requested(incoming, params);
                            write(&self.stopper.stdin, &response(request_id, reply))
                                .map_err(|_| self.exited())?;
                        }
                        None => client.notified(incoming, params),
                    }
                }
                None if message.get("id") == Some(&id) => return outcome(message),
                None => {}
            }
        }
    }

    /// Closing stdin is how an ACP agent learns to exit; whatever is left of
    /// its process group after a grace period is stopped.
    pub fn close(mut self) {
        if let Ok(mut stdin) = self.stopper.stdin.lock() {
            stdin.take();
        }
        let deadline = Instant::now() + EXIT_GRACE;
        while Instant::now() < deadline {
            if matches!(self.child.try_wait(), Ok(Some(_))) {
                break;
            }
            thread::sleep(Duration::from_millis(50));
        }
        self.stopper.terminate();
        if !matches!(self.child.try_wait(), Ok(Some(_))) {
            thread::sleep(Duration::from_millis(500));
            self.stopper.kill();
        }
        let _ = self.child.wait();
    }
}

fn response(id: &Value, reply: Result<Value, RpcError>) -> Value {
    match reply {
        Ok(result) => json!({"jsonrpc": "2.0", "id": id, "result": result}),
        Err(error) => json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": {"code": error.code, "message": error.message},
        }),
    }
}

fn outcome(message: Value) -> Result<Value, Failure> {
    if let Some(error) = message.get("error") {
        return Err(Failure::Rpc(RpcError {
            code: error
                .get("code")
                .and_then(Value::as_i64)
                .unwrap_or_default(),
            message: error
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("the agent reported an error")
                .to_string(),
        }));
    }
    Ok(message.get("result").cloned().unwrap_or(Value::Null))
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::*;

    struct Recorder {
        notes: Vec<(String, Value)>,
    }

    impl Client for Recorder {
        fn notified(&mut self, method: &str, params: Value) {
            self.notes.push((method.to_string(), params));
        }

        fn requested(&mut self, method: &str, _: Value) -> Result<Value, RpcError> {
            if method == "session/request_permission" {
                Ok(json!({"outcome": {"outcome": "cancelled"}}))
            } else {
                Err(RpcError::method_not_found(method))
            }
        }
    }

    fn script(body: &str) -> (tempfile::TempDir, Agent) {
        let dir = tempfile::tempdir().unwrap();
        let launch = Launch {
            name: "Fake".into(),
            program: "/bin/sh".into(),
            args: vec!["-c".into(), body.into()],
            env: BTreeMap::new(),
        };
        let agent = Agent::spawn(&launch, dir.path()).unwrap();
        (dir, agent)
    }

    #[test]
    fn notifications_reach_the_client_before_the_response_returns() {
        let (_dir, mut agent) = script(
            r#"read line
echo 'not json'
echo '{"jsonrpc":"2.0","method":"session/update","params":{"n":1}}'
echo '{"jsonrpc":"2.0","id":1,"result":{"ok":true}}'"#,
        );
        let mut client = Recorder { notes: vec![] };

        let result = agent.request("initialize", json!({}), &mut client).unwrap();

        assert_eq!(result, json!({"ok": true}));
        assert_eq!(
            client.notes,
            [("session/update".to_string(), json!({"n": 1}))]
        );
        agent.close();
    }

    #[test]
    fn an_agent_request_is_answered_on_its_stdin() {
        let (dir, mut agent) = script(
            r#"read line
echo '{"jsonrpc":"2.0","id":"p1","method":"session/request_permission","params":{}}'
echo '{"jsonrpc":"2.0","id":"x","method":"fs/read_text_file","params":{}}'
read answer1; read answer2
printf '%s\n%s\n' "$answer1" "$answer2" > answers
echo '{"jsonrpc":"2.0","id":1,"result":null}'"#,
        );

        agent
            .request("session/prompt", json!({}), &mut Recorder { notes: vec![] })
            .unwrap();

        let answers = std::fs::read_to_string(dir.path().join("answers")).unwrap();
        let answers: Vec<Value> = answers
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        assert_eq!(answers[0]["id"], "p1");
        assert_eq!(answers[0]["result"]["outcome"]["outcome"], "cancelled");
        assert_eq!(answers[1]["error"]["code"], METHOD_NOT_FOUND);
        agent.close();
    }

    #[test]
    fn an_error_response_carries_its_code() {
        let (_dir, mut agent) = script(
            r#"read line
echo '{"jsonrpc":"2.0","id":1,"error":{"code":-32000,"message":"Authentication required"}}'"#,
        );

        let failure = agent
            .request("session/new", json!({}), &mut Recorder { notes: vec![] })
            .unwrap_err();

        assert!(matches!(
            failure,
            Failure::Rpc(RpcError {
                code: AUTH_REQUIRED,
                ..
            })
        ));
        agent.close();
    }

    #[test]
    fn an_agent_that_dies_reports_what_it_printed_on_stderr() {
        let (_dir, mut agent) = script("read line; echo 'boom: no credentials' >&2; exit 3");

        let failure = agent
            .request("initialize", json!({}), &mut Recorder { notes: vec![] })
            .unwrap_err();

        assert!(
            failure.message().contains("boom: no credentials"),
            "{failure:?}"
        );
        agent.close();
    }

    #[test]
    fn closing_stops_children_that_ignore_end_of_input() {
        let (dir, agent) = script("sleep 30 & echo $! > child; wait");
        let child_file = dir.path().join("child");
        let deadline = Instant::now() + Duration::from_secs(5);
        let written = || std::fs::read_to_string(&child_file).unwrap_or_default();
        while written().trim().is_empty() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(20));
        }
        let child: i32 = written().trim().parse().unwrap();

        agent.close();

        // SAFETY: signal 0 only probes whether the process still exists.
        let alive = || unsafe { libc::kill(child, 0) } == 0;
        let deadline = Instant::now() + Duration::from_secs(3);
        while alive() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(50));
        }
        assert!(!alive(), "the agent's child outlived it");
    }
}
