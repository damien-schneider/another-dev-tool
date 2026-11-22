use std::io::{Read as _, Write as _};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::thread;

use serde::{Deserialize, Serialize};

use crate::agent::cli;
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Stage {
    Reading,
    Analyzing,
    Checking,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub stage: Stage,
    pub prompts: usize,
    pub sessions: usize,
}

pub struct Reply {
    pub text: String,
    pub cost_usd: Option<f64>,
}

#[derive(Default)]
pub struct Runner {
    progress: Mutex<Option<Progress>>,
    child: Mutex<Option<Child>>,
    cancelled: AtomicBool,
}

impl Runner {
    pub fn begin(&self) -> AppResult<()> {
        let mut progress = lock(&self.progress);
        if progress.is_some() {
            return Err(AppError::AnalysisBusy);
        }
        self.cancelled.store(false, Ordering::SeqCst);
        *progress = Some(Progress {
            stage: Stage::Reading,
            prompts: 0,
            sessions: 0,
        });
        Ok(())
    }

    pub fn progress(&self) -> Option<Progress> {
        *lock(&self.progress)
    }

    pub fn advance(&self, progress: Progress) {
        *lock(&self.progress) = Some(progress);
    }

    pub fn finish(&self) {
        *lock(&self.progress) = None;
    }

    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
        if let Some(child) = lock(&self.child).as_mut() {
            let _ = child.kill();
        }
    }

    pub fn cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }

    /// `Ok(None)` once cancelled, whether before or during the call.
    pub fn ask(&self, binary: &Path, request: &str) -> AppResult<Option<Reply>> {
        if self.cancelled() {
            return Ok(None);
        }
        let folder = tempfile::tempdir()?;
        let mut child = command(binary, folder.path()).spawn()?;
        let stdin = child.stdin.take();
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        {
            let mut slot = lock(&self.child);
            if self.cancelled() {
                let _ = child.kill();
                let _ = child.wait();
                return Ok(None);
            }
            *slot = Some(child);
        }

        let request = request.to_owned();
        let writer = thread::spawn(move || {
            if let Some(mut stdin) = stdin {
                let _ = stdin.write_all(request.as_bytes());
            }
        });
        let noise = thread::spawn(move || {
            let mut text = String::new();
            if let Some(mut stderr) = stderr {
                let _ = stderr.read_to_string(&mut text);
            }
            text
        });
        let mut out = String::new();
        if let Some(mut stdout) = stdout {
            let _ = stdout.read_to_string(&mut out);
        }
        let _ = writer.join();
        let noise = noise.join().unwrap_or_default();
        if let Some(mut child) = lock(&self.child).take() {
            let _ = child.wait();
        }

        if self.cancelled() {
            return Ok(None);
        }
        reply(&out, &noise).map(Some)
    }
}

/// No session persistence: a saved transcript would be read back as typed prompts next run.
fn command(binary: &Path, folder: &Path) -> Command {
    let mut command = Command::new(binary);
    command
        .current_dir(folder)
        .env("PATH", cli::child_path(binary))
        .args([
            "-p",
            "--model",
            "opus",
            "--tools",
            "",
            "--setting-sources",
            "",
            "--strict-mcp-config",
            "--no-session-persistence",
            "--output-format",
            "json",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    command
}

#[derive(Deserialize)]
struct Envelope {
    #[serde(default)]
    is_error: bool,
    #[serde(default)]
    result: String,
    total_cost_usd: Option<f64>,
}

fn reply(stdout: &str, stderr: &str) -> AppResult<Reply> {
    let envelope: Envelope = serde_json::from_str(stdout.trim())
        .map_err(|_| AppError::internal(cli::crash_reason(stderr)))?;
    if envelope.is_error {
        return Err(AppError::internal(cli::crash_reason(&envelope.result)));
    }
    Ok(Reply {
        text: envelope.result,
        cost_usd: envelope.total_cost_usd,
    })
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_second_analysis_is_refused_while_one_runs() {
        let runner = Runner::default();
        runner.begin().unwrap();

        assert!(matches!(runner.begin(), Err(AppError::AnalysisBusy)));

        runner.finish();
        assert!(runner.begin().is_ok());
    }

    #[test]
    fn a_cancelled_analysis_never_starts_claude() {
        let runner = Runner::default();
        runner.begin().unwrap();
        runner.cancel();

        let reply = runner.ask(Path::new("/bin/cat"), "ignored").unwrap();

        assert!(reply.is_none());
    }

    #[test]
    fn reads_the_answer_and_its_cost() {
        let read = reply(
            r#"{"type":"result","is_error":false,"result":"[]","total_cost_usd":1.5}"#,
            "",
        )
        .unwrap();

        assert_eq!(read.text, "[]");
        assert_eq!(read.cost_usd, Some(1.5));
    }

    #[test]
    fn reports_claude_errors_and_crashes() {
        let refused = reply(
            r#"{"is_error":true,"result":"Credit balance is too low"}"#,
            "",
        );
        let crashed = reply("", "boom\n");

        assert_eq!(
            refused.err().unwrap().to_string(),
            "Credit balance is too low"
        );
        assert_eq!(crashed.err().unwrap().to_string(), "boom");
    }
}
