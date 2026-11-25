use std::collections::HashSet;

use serde_json::Value;

use super::protocol::{Content, SessionUpdate, ToolCall, ToolContent};
use crate::agent::{PartKind, StreamEvent};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Open {
    Text,
    Thinking,
}

/// Turns ACP session updates into the part events an `Answer` is built from.
#[derive(Debug, Default)]
pub struct Translator {
    open: Option<Open>,
    tools: HashSet<String>,
}

impl Translator {
    pub fn update(&mut self, update: SessionUpdate) -> Vec<StreamEvent> {
        let mut events = Vec::new();
        match update {
            SessionUpdate::AgentMessageChunk {
                content: Content::Text { text },
            } => self.chunk(Open::Text, text, &mut events),
            SessionUpdate::AgentThoughtChunk {
                content: Content::Text { text },
            } => self.chunk(Open::Thinking, text, &mut events),
            SessionUpdate::ToolCall(call) | SessionUpdate::ToolCallUpdate(call) => {
                self.tool(call, &mut events)
            }
            _ => {}
        }
        events
    }

    pub fn finish(&mut self, error: Option<String>, duration_ms: u64) -> Vec<StreamEvent> {
        let mut events = Vec::new();
        self.close(&mut events);
        events.push(StreamEvent::Finished {
            error,
            duration_ms: Some(duration_ms),
        });
        events
    }

    fn close(&mut self, events: &mut Vec<StreamEvent>) {
        if self.open.take().is_some() {
            events.push(StreamEvent::PartStop);
        }
    }

    fn chunk(&mut self, kind: Open, text: String, events: &mut Vec<StreamEvent>) {
        if self.open != Some(kind) {
            self.close(events);
            events.push(StreamEvent::PartStart(match kind {
                Open::Text => PartKind::Text,
                Open::Thinking => PartKind::Thinking,
            }));
            self.open = Some(kind);
        }
        events.push(StreamEvent::Delta(text));
    }

    fn tool(&mut self, call: ToolCall, events: &mut Vec<StreamEvent>) {
        let id = call.tool_call_id.clone();
        if self.tools.insert(id.clone()) {
            self.close(events);
            events.push(StreamEvent::PartStart(PartKind::Tool {
                id: id.clone(),
                name: call
                    .name
                    .clone()
                    .or_else(|| call.kind.clone())
                    .unwrap_or_else(|| "tool".to_string()),
                title: call.title.clone(),
            }));
            events.push(StreamEvent::PartStop);
        } else if let Some(title) = call.title.clone() {
            events.push(StreamEvent::ToolTitle {
                id: id.clone(),
                title,
            });
        }
        if let Some(input) = call.raw_input.clone().filter(has_fields) {
            events.push(StreamEvent::ToolInput {
                id: id.clone(),
                input,
            });
        }
        let is_error = match call.status.as_deref() {
            Some("completed") => false,
            Some("failed") => true,
            _ => return,
        };
        events.push(StreamEvent::ToolResult {
            id,
            is_error,
            output: output(&call),
        });
    }
}

fn has_fields(input: &Value) -> bool {
    match input {
        Value::Object(fields) => !fields.is_empty(),
        Value::Null => false,
        _ => true,
    }
}

fn output(call: &ToolCall) -> String {
    let shown: Vec<&str> = call
        .content
        .iter()
        .flatten()
        .filter_map(|content| match content {
            ToolContent::Content {
                content: Content::Text { text },
            } => Some(text.as_str()),
            _ => None,
        })
        .collect();
    if !shown.is_empty() {
        return shown.join("\n");
    }
    call.raw_output
        .as_ref()
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::acp::protocol::SessionNotification;
    use crate::agent::answer::ToolState;
    use crate::agent::{Answer, Part, Requested};

    fn update(value: Value) -> SessionUpdate {
        serde_json::from_value::<SessionNotification>(json!({ "sessionId": "s", "update": value }))
            .unwrap()
            .update
    }

    fn answer(updates: Vec<Value>) -> Answer {
        let mut translator = Translator::default();
        let mut events: Vec<StreamEvent> = updates
            .into_iter()
            .flat_map(|value| translator.update(update(value)))
            .collect();
        events.extend(translator.finish(None, 1200));
        let mut answer = Answer::default();
        for (now, event) in (0_u64..).zip(events) {
            answer.apply(event, now);
        }
        answer
    }

    fn text(chunk: &str) -> Value {
        json!({ "sessionUpdate": "agent_message_chunk", "content": { "type": "text", "text": chunk } })
    }

    fn thought(chunk: &str) -> Value {
        json!({ "sessionUpdate": "agent_thought_chunk", "content": { "type": "text", "text": chunk } })
    }

    #[test]
    fn consecutive_chunks_of_one_kind_build_a_single_part() {
        let answer = answer(vec![
            thought("Let me "),
            thought("think."),
            text("Done"),
            text("."),
        ]);

        assert!(matches!(
            answer.parts(),
            [
                Part::Thinking { text: thinking, duration_ms: Some(_) },
                Part::Text { text },
            ] if thinking == "Let me think." && text == "Done."
        ));
    }

    #[test]
    fn a_claude_read_keeps_its_tool_name_and_the_input_sent_after_it_started() {
        let answer = answer(vec![
            json!({
                "sessionUpdate": "tool_call", "toolCallId": "t1", "name": "Read",
                "title": "Read File", "kind": "read", "status": "pending", "rawInput": {},
            }),
            json!({
                "sessionUpdate": "tool_call_update", "toolCallId": "t1",
                "rawInput": { "file_path": "/ref/REF.md" }, "title": "Read /ref/REF.md",
            }),
            json!({
                "sessionUpdate": "tool_call_update", "toolCallId": "t1", "status": "completed",
                "rawOutput": "1\tline",
                "content": [{ "type": "content", "content": { "type": "text", "text": "line" } }],
            }),
        ]);

        let [Part::Tool {
            name,
            title,
            input,
            state,
            output,
            ..
        }] = answer.parts()
        else {
            panic!("{:?}", answer.parts());
        };
        assert_eq!(name, "Read");
        assert_eq!(title.as_deref(), Some("Read /ref/REF.md"));
        assert_eq!(input.as_ref().unwrap()["file_path"], "/ref/REF.md");
        assert_eq!(*state, ToolState::Done);
        assert_eq!(output.as_deref(), Some("line"));
    }

    #[test]
    fn a_codex_command_is_named_by_its_title_and_ends_with_its_status() {
        let answer = answer(vec![
            text("Checking."),
            json!({
                "sessionUpdate": "tool_call", "toolCallId": "e1", "name": "exec_command",
                "kind": "read", "title": "List files", "status": "in_progress",
            }),
            json!({
                "sessionUpdate": "tool_call_update", "toolCallId": "e1", "status": "failed",
                "rawOutput": { "exit_code": 1 },
            }),
            text("Done."),
        ]);

        let [Part::Text { .. }, Part::Tool {
            name,
            title,
            state,
            output,
            ..
        }, Part::Text { text }] = answer.parts()
        else {
            panic!("{:?}", answer.parts());
        };
        assert_eq!(name, "exec_command");
        assert_eq!(title.as_deref(), Some("List files"));
        assert_eq!(*state, ToolState::Error);
        assert_eq!(output.as_deref(), Some(""));
        assert_eq!(text, "Done.");
    }

    #[test]
    fn a_tool_without_a_name_is_named_by_its_kind() {
        let answer = answer(vec![json!({
            "sessionUpdate": "tool_call", "toolCallId": "k1", "kind": "edit", "title": "Edit doc.md",
        })]);

        assert!(matches!(answer.parts(), [Part::Tool { name, .. }] if name == "edit"));
    }

    #[test]
    fn the_turn_duration_is_recorded_when_it_finishes() {
        let answer = answer(vec![text("Hi")]);

        let meta = answer.meta(Requested {
            model: "Opus".into(),
            effort: None,
        });
        assert_eq!(meta.duration_ms, Some(1200));
    }
}
