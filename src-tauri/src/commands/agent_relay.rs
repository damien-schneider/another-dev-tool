use std::io::{BufRead as _, BufReader, Read as _};
use std::sync::{Arc, Mutex};

use tauri::AppHandle;

use crate::agent::cli::crash_reason;
use crate::ask::Proposal;
use crate::agent::{self, Answer, Emit, RunHandle, StreamEvent};
use crate::db::now_ms;
use crate::events::{self, AgentDelta, AgentDone, AgentError, AgentPart};

pub enum RunEnd {
    Completed,
    Failed(String),
    SignedOut(String),
}

impl RunEnd {
    pub fn failed(&self) -> bool {
        !matches!(self, Self::Completed)
    }
}

/// Streams an answer to the window as it grows.
pub struct Relay<'a> {
    app: &'a AppHandle,
    run_id: u64,
    answer: Answer,
}

impl<'a> Relay<'a> {
    pub fn new(app: &'a AppHandle, run_id: u64) -> Self {
        Self {
            app,
            run_id,
            answer: Answer::default(),
        }
    }

    pub fn apply(&mut self, event: StreamEvent) {
        let run_id = self.run_id;
        for emit in self.answer.apply(event, now()) {
            match emit {
                Emit::Delta { index, text } => {
                    events::emit_agent_delta(
                        self.app,
                        AgentDelta {
                            run_id,
                            index,
                            text,
                        },
                    );
                }
                Emit::PartChanged { index, part } => {
                    events::emit_agent_part(
                        self.app,
                        AgentPart {
                            run_id,
                            index,
                            part,
                        },
                    );
                }
            }
        }
    }

    pub fn into_answer(self) -> Answer {
        self.answer
    }
}

/// Relays a Claude Code CLI run; hands the answer back once the CLI exits.
pub fn relay(app: &AppHandle, handle: RunHandle) -> (Answer, RunEnd) {
    let RunHandle {
        run_id,
        stdout,
        mut stderr,
    } = handle;

    // Drained concurrently: a full stderr pipe would block the child forever.
    let noise = Arc::new(Mutex::new(String::new()));
    let collector = {
        let sink = Arc::clone(&noise);
        std::thread::spawn(move || {
            let mut buffer = String::new();
            let _ = stderr.read_to_string(&mut buffer);
            if let Ok(mut slot) = sink.lock() {
                *slot = buffer;
            }
        })
    };

    let mut end: Option<RunEnd> = None;
    let mut relay = Relay::new(app, run_id);
    for line in BufReader::new(stdout).lines().map_while(Result::ok) {
        for event in agent::parse_line(&line) {
            if let StreamEvent::Finished { error, .. } = &event {
                end = Some(match error {
                    Some(message) => RunEnd::Failed(message.clone()),
                    None => RunEnd::Completed,
                });
            }
            relay.apply(event);
        }
    }
    let _ = collector.join();

    let end = end.unwrap_or_else(|| {
        let tail = noise.lock().map(|slot| slot.clone()).unwrap_or_default();
        RunEnd::Failed(crash_reason(&tail))
    });
    (relay.into_answer(), end)
}

/// A cancelled run ends quietly: its failure is the user's own doing.
pub fn report(
    app: &AppHandle,
    run_id: u64,
    end: RunEnd,
    cancelled: bool,
    proposals: Vec<Proposal>,
) {
    let failure = match end {
        RunEnd::Failed(message) => Some((message, false)),
        RunEnd::SignedOut(message) => Some((message, true)),
        RunEnd::Completed => None,
    };
    match failure {
        Some((message, sign_in)) if !cancelled => {
            events::emit_agent_error(
                app,
                AgentError {
                    run_id,
                    message,
                    sign_in,
                },
            );
        }
        _ => events::emit_agent_done(
            app,
            AgentDone {
                run_id,
                proposals,
                cancelled,
            },
        ),
    }
}

fn now() -> u64 {
    u64::try_from(now_ms()).unwrap_or_default()
}
