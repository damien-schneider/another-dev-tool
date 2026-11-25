use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use super::lockdown::Scope;
use super::protocol::{
    categorized, ConfigOption, Initialized, PermissionRequest, PromptResponse, SessionNotification,
    SessionSetup, EFFORT, MODEL,
};
use super::rpc::{Agent, Client, Failure, RpcError, Stopper};
use super::translate::Translator;
use super::{connect, Launch};
use crate::agent::{Requested, StreamEvent};

const CANCEL_GRACE: Duration = Duration::from_secs(5);
const INVALID_PARAMS: i64 = -32602;

pub struct Turn {
    pub launch: Launch,
    pub dir: PathBuf,
    pub resume: Option<String>,
    pub instructions: String,
    pub prompt: Vec<Value>,
    pub config: Vec<(String, String)>,
    pub meta: Option<Value>,
    pub scope: Scope,
}

#[derive(Debug)]
pub struct Ended {
    /// Set once the request reached a session, so the next turn can continue it.
    pub session_id: Option<String>,
    pub requested: Requested,
    pub error: Option<String>,
    pub sign_in: bool,
}

#[derive(Default)]
struct Run {
    stopper: Option<Stopper>,
    session: Option<String>,
    cancelled: bool,
    done: bool,
}

/// Stops a turn from another thread: politely through `session/cancel`, then
/// by force if the agent doesn't wind down.
#[derive(Clone, Default)]
pub struct Control(Arc<Mutex<Run>>);

impl Control {
    fn with<T>(&self, change: impl FnOnce(&mut Run) -> T) -> Option<T> {
        self.0.lock().ok().map(|mut run| change(&mut run))
    }

    fn attach(&self, stopper: Stopper) -> bool {
        self.with(|run| {
            run.stopper = Some(stopper);
            !run.cancelled
        })
        .unwrap_or(false)
    }

    fn opened(&self, session: &str) -> bool {
        self.with(|run| {
            run.session = Some(session.to_string());
            !run.cancelled
        })
        .unwrap_or(false)
    }

    fn done(&self) {
        self.with(|run| run.done = true);
    }

    pub fn cancelled(&self) -> bool {
        self.with(|run| run.cancelled).unwrap_or(false)
    }

    pub fn cancel(&self) {
        let Some((stopper, session)) = self.with(|run| {
            run.cancelled = true;
            (run.stopper.clone(), run.session.clone())
        }) else {
            return;
        };
        let Some(stopper) = stopper else {
            return;
        };
        let Some(session) = session else {
            stopper.terminate();
            return;
        };
        stopper.notify("session/cancel", json!({ "sessionId": session }));
        let control = self.clone();
        thread::spawn(move || {
            thread::sleep(CANCEL_GRACE);
            if control.with(|run| !run.done).unwrap_or(false) {
                stopper.terminate();
            }
        });
    }
}

struct Live<'a> {
    scope: &'a Scope,
    translator: Translator,
    emit: &'a mut dyn FnMut(StreamEvent),
    streaming: bool,
}

impl Client for Live<'_> {
    fn notified(&mut self, method: &str, params: Value) {
        if method != "session/update" || !self.streaming {
            return;
        }
        if let Ok(notification) = serde_json::from_value::<SessionNotification>(params) {
            for event in self.translator.update(notification.update) {
                (self.emit)(event);
            }
        }
    }

    fn requested(&mut self, method: &str, params: Value) -> Result<Value, RpcError> {
        if method != "session/request_permission" {
            return Err(RpcError::method_not_found(method));
        }
        serde_json::from_value::<PermissionRequest>(params)
            .map(|request| self.scope.answer(&request))
            .map_err(|error| RpcError {
                code: INVALID_PARAMS,
                message: error.to_string(),
            })
    }
}

pub fn run(turn: Turn, control: &Control, emit: &mut dyn FnMut(StreamEvent)) -> Ended {
    let started = Instant::now();
    let mut ended = Ended {
        session_id: None,
        requested: Requested {
            model: turn.launch.name.clone(),
            effort: None,
        },
        error: None,
        sign_in: false,
    };
    let mut live = Live {
        scope: &turn.scope,
        translator: Translator::default(),
        emit,
        streaming: false,
    };
    let failure = match connect(&turn.launch, &turn.dir) {
        Ok(mut connection) => {
            let result = if control.attach(connection.agent.stopper()) {
                converse(
                    &mut connection.agent,
                    &connection.init,
                    &turn,
                    control,
                    &mut live,
                    &mut ended,
                )
            } else {
                Ok(())
            };
            control.done();
            connection.agent.close();
            result.err()
        }
        Err(failure) => Some(failure),
    };
    if let Some(failure) = failure {
        ended.sign_in = failure.needs_sign_in();
        ended.error = Some(failure.message());
    }
    let elapsed = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);
    for event in live.translator.finish(ended.error.clone(), elapsed) {
        (live.emit)(event);
    }
    ended
}

fn converse(
    agent: &mut Agent,
    init: &Initialized,
    turn: &Turn,
    control: &Control,
    live: &mut Live<'_>,
    ended: &mut Ended,
) -> Result<(), Failure> {
    let capabilities = &init.agent_capabilities;
    let (method, resumed) = match &turn.resume {
        Some(id) if capabilities.resumes() => ("session/resume", Some(id)),
        Some(id) if capabilities.load_session => ("session/load", Some(id)),
        _ => ("session/new", None),
    };
    let mut params = json!({ "cwd": turn.dir, "mcpServers": [] });
    if let Some(id) = resumed {
        params["sessionId"] = json!(id);
    }
    if capabilities.takes_system_prompt() {
        params["systemPrompt"] = json!({
            "mode": "append",
            "content": [{ "type": "text", "text": turn.instructions }],
        });
    }
    if let Some(meta) = &turn.meta {
        params["_meta"] = meta.clone();
    }
    let setup: SessionSetup = serde_json::from_value(agent.request(method, params, live)?)?;
    let session = setup
        .session_id
        .or_else(|| resumed.cloned())
        .ok_or_else(|| Failure::Stopped("the agent opened no session".into()))?;
    if !control.opened(&session) {
        return Ok(());
    }

    let options = configure(agent, &session, setup.config_options, &turn.config, live)?;
    ended.requested = requested(&options, &turn.launch.name);

    let mut prompt = turn.prompt.clone();
    if resumed.is_none() && !capabilities.takes_system_prompt() {
        prompt.insert(0, json!({ "type": "text", "text": turn.instructions }));
    }
    ended.session_id = Some(session.clone());
    live.streaming = true;
    let response: PromptResponse = serde_json::from_value(agent.request(
        "session/prompt",
        json!({ "sessionId": session, "prompt": prompt }),
        live,
    )?)?;
    match response.stop_reason.as_str() {
        "max_tokens" => Err(Failure::Stopped(
            "the agent ran out of room for its answer".into(),
        )),
        "max_turn_requests" => Err(Failure::Stopped(
            "the agent hit its limit of steps for one request".into(),
        )),
        "refusal" => Err(Failure::Stopped("the agent declined this request".into())),
        _ => Ok(()),
    }
}

/// Sets only what differs and what the agent still offers: a pick saved
/// against an older version of the agent falls back to its default.
fn configure(
    agent: &mut Agent,
    session: &str,
    mut options: Vec<ConfigOption>,
    wanted: &[(String, String)],
    live: &mut Live<'_>,
) -> Result<Vec<ConfigOption>, Failure> {
    for (id, value) in wanted {
        let Some(option) = options.iter().find(|option| &option.id == id) else {
            continue;
        };
        if option.current() == Some(value.as_str()) || option.choice_name(value).is_none() {
            continue;
        }
        let changed = agent.request(
            "session/set_config_option",
            json!({ "sessionId": session, "configId": id, "value": value }),
            live,
        )?;
        options = serde_json::from_value::<SessionSetup>(changed)?.config_options;
    }
    Ok(options)
}

fn requested(options: &[ConfigOption], agent: &str) -> Requested {
    let named = |category: &str| {
        categorized(options, category).and_then(|option| option.choice_name(option.current()?))
    };
    Requested {
        model: named(MODEL).unwrap_or_else(|| agent.to_string()),
        effort: named(EFFORT),
    }
}
