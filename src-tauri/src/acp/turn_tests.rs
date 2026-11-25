use std::collections::BTreeMap;
use std::path::Path;
use std::thread;
use std::time::{Duration, Instant};

use serde_json::{json, Value};

use super::catalog::Launch;
use super::lockdown::Scope;
use super::turn::{run, Control, Ended, Turn};
use crate::agent::{Requested, StreamEvent};

struct Reply {
    method: &'static str,
    notes: Vec<Value>,
    outcome: Value,
    awaits_cancel: bool,
}

fn reply(method: &'static str, notes: Vec<Value>, outcome: Value) -> Reply {
    Reply {
        method,
        notes,
        outcome,
        awaits_cancel: false,
    }
}

fn initialized(capabilities: Value) -> Reply {
    reply(
        "initialize",
        vec![],
        json!({ "result": { "protocolVersion": 1, "agentCapabilities": capabilities } }),
    )
}

fn chunk(text: &str) -> Value {
    json!({
        "jsonrpc": "2.0",
        "method": "session/update",
        "params": {
            "sessionId": "s",
            "update": { "sessionUpdate": "agent_message_chunk", "content": { "type": "text", "text": text } },
        },
    })
}

/// An agent in `sh`: logs every line it is sent to `sent`, answers each
/// request by method with canned lines.
fn script(replies: &[Reply]) -> String {
    let branches: String = replies
        .iter()
        .map(|reply| {
            let notes: String = reply
                .notes
                .iter()
                .map(|note| format!("printf '%s\\n' '{note}'\n"))
                .collect();
            let wait = if reply.awaits_cancel {
                "while read -r more; do printf '%s\\n' \"$more\" >> sent; case \"$more\" in *session/cancel*) break ;; esac; done\n"
            } else {
                ""
            };
            let outcome = reply.outcome.to_string();
            let outcome = &outcome[1..outcome.len() - 1];
            format!(
                "*'\"method\":\"{}\"'*)\n{notes}{wait}printf '{{\"jsonrpc\":\"2.0\",\"id\":%s,%s}}\\n' \"$n\" '{outcome}' ;;\n",
                reply.method
            )
        })
        .collect();
    format!(
        "n=0
while read -r line; do
printf '%s\\n' \"$line\" >> sent
case \"$line\" in
*'\"method\":\"session/cancel\"'*) continue ;;
*'\"method\":'*) n=$((n+1)) ;;
*) continue ;;
esac
case \"$line\" in
{branches}esac
done"
    )
}

fn turn(dir: &Path, replies: &[Reply]) -> Turn {
    Turn {
        launch: Launch {
            name: "Fake Agent".into(),
            program: "/bin/sh".into(),
            args: vec!["-c".into(), script(replies)],
            env: BTreeMap::new(),
        },
        dir: dir.to_path_buf(),
        resume: None,
        instructions: "Edit doc.md only.".into(),
        prompt: vec![json!({ "type": "text", "text": "Tighten it" })],
        config: vec![],
        meta: None,
        scope: Scope::new(dir, &[dir.join("doc.md")], &[]),
    }
}

fn drive(turn: Turn) -> (Ended, Vec<StreamEvent>) {
    let mut events = vec![];
    let ended = run(turn, &Control::default(), &mut |event| events.push(event));
    (ended, events)
}

fn sent(dir: &Path) -> Vec<Value> {
    std::fs::read_to_string(dir.join("sent"))
        .unwrap_or_default()
        .lines()
        .filter_map(|line| serde_json::from_str(line).ok())
        .collect()
}

fn sent_as(dir: &Path, method: &str) -> Vec<Value> {
    sent(dir)
        .into_iter()
        .filter(|message| message["method"] == method)
        .collect()
}

fn deltas(events: &[StreamEvent]) -> Vec<&str> {
    events
        .iter()
        .filter_map(|event| match event {
            StreamEvent::Delta(text) => Some(text.as_str()),
            _ => None,
        })
        .collect()
}

fn options(model: &str) -> Value {
    json!([
        {
            "id": "model", "name": "Model", "category": "model", "type": "select", "currentValue": model,
            "options": [{ "value": "a", "name": "Alpha" }, { "value": "b", "name": "Beta" }],
        },
        {
            "id": "effort", "name": "Effort", "category": "thought_level", "type": "select", "currentValue": "low",
            "options": [{ "value": "low", "name": "Low" }, { "value": "high", "name": "High" }],
        },
    ])
}

fn end_turn() -> Value {
    json!({ "result": { "stopReason": "end_turn" } })
}

#[test]
fn a_new_conversation_streams_the_answer_and_names_the_model_it_ran_on() {
    let dir = tempfile::tempdir().unwrap();
    let mut turn = turn(
        dir.path(),
        &[
            initialized(json!({ "sessionCapabilities": { "systemPrompt": {} } })),
            reply(
                "session/new",
                vec![],
                json!({ "result": { "sessionId": "s1", "configOptions": options("a") } }),
            ),
            reply(
                "session/set_config_option",
                vec![],
                json!({ "result": { "configOptions": options("b") } }),
            ),
            reply("session/prompt", vec![chunk("Tightened.")], end_turn()),
        ],
    );
    turn.config = vec![
        ("model".into(), "b".into()),
        ("effort".into(), "low".into()),
        ("mode".into(), "acceptEdits".into()),
    ];
    turn.meta = Some(json!({ "claudeCode": { "options": {} } }));

    let (ended, events) = drive(turn);

    assert_eq!(ended.error, None);
    assert_eq!(ended.session_id.as_deref(), Some("s1"));
    assert_eq!(
        ended.requested,
        Requested {
            model: "Beta".into(),
            effort: Some("Low".into()),
        }
    );
    assert_eq!(deltas(&events), ["Tightened."]);
    assert!(matches!(
        events.last(),
        Some(StreamEvent::Finished {
            error: None,
            duration_ms: Some(_)
        })
    ));
    let opened = &sent_as(dir.path(), "session/new")[0]["params"];
    assert_eq!(
        opened["systemPrompt"]["content"][0]["text"],
        "Edit doc.md only."
    );
    assert_eq!(opened["_meta"], json!({ "claudeCode": { "options": {} } }));
    let changes = sent_as(dir.path(), "session/set_config_option");
    assert_eq!(changes.len(), 1, "only the model differed: {changes:?}");
    assert_eq!(changes[0]["params"]["value"], "b");
    assert_eq!(
        sent_as(dir.path(), "session/prompt")[0]["params"]["prompt"],
        json!([{ "type": "text", "text": "Tighten it" }])
    );
}

#[test]
fn a_stored_conversation_is_reloaded_without_streaming_its_history_again() {
    let dir = tempfile::tempdir().unwrap();
    let mut turn = turn(
        dir.path(),
        &[
            initialized(json!({ "loadSession": true })),
            reply(
                "session/load",
                vec![chunk("Old answer")],
                json!({ "result": {} }),
            ),
            reply("session/prompt", vec![chunk("New answer")], end_turn()),
        ],
    );
    turn.resume = Some("s0".into());

    let (ended, events) = drive(turn);

    assert_eq!(ended.session_id.as_deref(), Some("s0"));
    assert_eq!(deltas(&events), ["New answer"]);
    assert_eq!(
        sent_as(dir.path(), "session/load")[0]["params"]["sessionId"],
        "s0"
    );
    assert_eq!(
        sent_as(dir.path(), "session/prompt")[0]["params"]["prompt"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn an_agent_that_can_resume_is_resumed_rather_than_reloaded() {
    let dir = tempfile::tempdir().unwrap();
    let mut turn = turn(
        dir.path(),
        &[
            initialized(json!({ "loadSession": true, "sessionCapabilities": { "resume": {} } })),
            reply("session/resume", vec![], json!({ "result": {} })),
            reply("session/prompt", vec![], end_turn()),
        ],
    );
    turn.resume = Some("s0".into());

    let (ended, _) = drive(turn);

    assert_eq!(ended.error, None);
    assert!(sent_as(dir.path(), "session/load").is_empty());
    assert_eq!(sent_as(dir.path(), "session/resume").len(), 1);
}

#[test]
fn without_system_prompt_support_the_instructions_lead_a_new_conversation() {
    let dir = tempfile::tempdir().unwrap();
    let turn = turn(
        dir.path(),
        &[
            initialized(json!({})),
            reply(
                "session/new",
                vec![],
                json!({ "result": { "sessionId": "s1" } }),
            ),
            reply("session/prompt", vec![], end_turn()),
        ],
    );

    drive(turn);

    assert!(sent_as(dir.path(), "session/new")[0]["params"]
        .get("systemPrompt")
        .is_none());
    assert_eq!(
        sent_as(dir.path(), "session/prompt")[0]["params"]["prompt"],
        json!([
            { "type": "text", "text": "Edit doc.md only." },
            { "type": "text", "text": "Tighten it" },
        ])
    );
}

#[test]
fn a_permission_the_scope_does_not_cover_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    let asked = json!({
        "jsonrpc": "2.0",
        "id": "perm",
        "method": "session/request_permission",
        "params": {
            "sessionId": "s1",
            "toolCall": { "toolCallId": "t1", "kind": "execute", "title": "ls /" },
            "options": [
                { "optionId": "yes", "name": "Allow", "kind": "allow_once" },
                { "optionId": "no", "name": "Reject", "kind": "reject_once" },
            ],
        },
    });
    let turn = turn(
        dir.path(),
        &[
            initialized(json!({})),
            reply(
                "session/new",
                vec![],
                json!({ "result": { "sessionId": "s1" } }),
            ),
            reply("session/prompt", vec![asked], end_turn()),
        ],
    );

    drive(turn);

    let answer = sent(dir.path())
        .into_iter()
        .find(|message| message["id"] == "perm")
        .unwrap();
    assert_eq!(answer["result"]["outcome"]["optionId"], "no");
}

#[test]
fn an_agent_that_needs_a_login_asks_for_a_sign_in() {
    let dir = tempfile::tempdir().unwrap();
    let turn = turn(
        dir.path(),
        &[
            initialized(json!({})),
            reply(
                "session/new",
                vec![],
                json!({ "error": { "code": -32000, "message": "Authentication required" } }),
            ),
        ],
    );

    let (ended, events) = drive(turn);

    assert!(ended.sign_in);
    assert_eq!(ended.session_id, None);
    assert_eq!(ended.error.as_deref(), Some("Authentication required"));
    assert!(matches!(
        events.last(),
        Some(StreamEvent::Finished { error: Some(_), .. })
    ));
}

#[test]
fn cancelling_asks_the_agent_to_stop_and_ends_the_turn_quietly() {
    let dir = tempfile::tempdir().unwrap();
    let mut waiting = reply(
        "session/prompt",
        vec![chunk("Start")],
        json!({ "result": { "stopReason": "cancelled" } }),
    );
    waiting.awaits_cancel = true;
    let turn = turn(
        dir.path(),
        &[
            initialized(json!({})),
            reply(
                "session/new",
                vec![],
                json!({ "result": { "sessionId": "s1" } }),
            ),
            waiting,
        ],
    );
    let control = Control::default();
    let running = {
        let control = control.clone();
        thread::spawn(move || run(turn, &control, &mut |_| {}))
    };
    let deadline = Instant::now() + Duration::from_secs(5);
    while sent_as(dir.path(), "session/prompt").is_empty() && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(20));
    }

    control.cancel();
    let ended = running.join().unwrap();

    assert_eq!(ended.error, None);
    assert_eq!(
        sent_as(dir.path(), "session/cancel")[0]["params"]["sessionId"],
        "s1"
    );
}
