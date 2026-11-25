use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::stream::{PartKind, StreamEvent};

const OUTPUT_CHARS: usize = 4000;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Part {
    Text {
        text: String,
    },
    Thinking {
        text: String,
        duration_ms: Option<u64>,
    },
    Tool {
        id: String,
        name: String,
        #[serde(default)]
        title: Option<String>,
        input: Option<Value>,
        state: ToolState,
        output: Option<String>,
        duration_ms: Option<u64>,
    },
}

impl Part {
    pub fn has_content(&self) -> bool {
        match self {
            Self::Text { text } | Self::Thinking { text, .. } => !text.trim().is_empty(),
            Self::Tool { .. } => true,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ToolState {
    Running,
    Done,
    Error,
}

/// What the user asked for, in the words the picker showed them; `model` is
/// what actually answered, when the agent reports it.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AnswerMeta {
    pub model: Option<String>,
    pub requested_model: String,
    pub effort: Option<String>,
    pub duration_ms: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Requested {
    pub model: String,
    pub effort: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Emit {
    PartChanged { index: u32, part: Part },
    Delta { index: u32, text: String },
}

#[derive(Debug, Default)]
pub struct Answer {
    parts: Vec<Part>,
    started_at: Vec<u64>,
    open: Option<usize>,
    tools: HashMap<String, usize>,
    model: Option<String>,
    duration_ms: Option<u64>,
}

impl Answer {
    pub fn parts(&self) -> &[Part] {
        &self.parts
    }

    pub fn meta(&self, requested: Requested) -> AnswerMeta {
        AnswerMeta {
            model: self.model.clone(),
            requested_model: requested.model,
            effort: requested.effort,
            duration_ms: self.duration_ms,
        }
    }

    pub fn apply(&mut self, event: StreamEvent, now: u64) -> Vec<Emit> {
        match event {
            StreamEvent::PartStart(kind) => {
                let index = self.start(kind, now);
                self.open = Some(index);
                self.changed(index).into_iter().collect()
            }
            StreamEvent::Delta(chunk) => self.append(chunk).into_iter().collect(),
            StreamEvent::PartStop => self.stop(now).into_iter().collect(),
            StreamEvent::ToolInput { id, input } => {
                self.set_input(&id, input).into_iter().collect()
            }
            StreamEvent::ToolTitle { id, title } => {
                self.set_title(&id, title).into_iter().collect()
            }
            StreamEvent::ToolResult {
                id,
                is_error,
                output,
            } => self
                .finish_tool(&id, is_error, output, now)
                .into_iter()
                .collect(),
            StreamEvent::Model(model) => {
                self.model = Some(model);
                Vec::new()
            }
            StreamEvent::Finished { duration_ms, .. } => {
                self.duration_ms = duration_ms;
                Vec::new()
            }
        }
    }

    fn start(&mut self, kind: PartKind, now: u64) -> usize {
        let part = match kind {
            PartKind::Text => Part::Text {
                text: String::new(),
            },
            PartKind::Thinking => Part::Thinking {
                text: String::new(),
                duration_ms: None,
            },
            PartKind::Tool { id, name, title } => {
                self.tools.insert(id.clone(), self.parts.len());
                Part::Tool {
                    id,
                    name,
                    title,
                    input: None,
                    state: ToolState::Running,
                    output: None,
                    duration_ms: None,
                }
            }
        };
        self.parts.push(part);
        self.started_at.push(now);
        self.parts.len() - 1
    }

    fn append(&mut self, chunk: String) -> Option<Emit> {
        let index = self.open?;
        match self.parts.get_mut(index)? {
            Part::Text { text } | Part::Thinking { text, .. } => text.push_str(&chunk),
            Part::Tool { .. } => return None,
        }
        Some(Emit::Delta {
            index: wire_index(index),
            text: chunk,
        })
    }

    fn stop(&mut self, now: u64) -> Option<Emit> {
        let index = self.open.take()?;
        let since = self.elapsed(index, now);
        match self.parts.get_mut(index)? {
            Part::Thinking { duration_ms, .. } => *duration_ms = Some(since),
            Part::Text { .. } => (),
            Part::Tool { .. } => return None,
        }
        self.changed(index)
    }

    fn set_input(&mut self, id: &str, value: Value) -> Option<Emit> {
        let index = *self.tools.get(id)?;
        if let Part::Tool { input, .. } = self.parts.get_mut(index)? {
            *input = Some(value);
        }
        self.changed(index)
    }

    fn set_title(&mut self, id: &str, value: String) -> Option<Emit> {
        let index = *self.tools.get(id)?;
        if let Part::Tool { title, .. } = self.parts.get_mut(index)? {
            *title = Some(value);
        }
        self.changed(index)
    }

    fn finish_tool(&mut self, id: &str, is_error: bool, result: String, now: u64) -> Option<Emit> {
        let index = *self.tools.get(id)?;
        let since = self.elapsed(index, now);
        if let Part::Tool {
            state,
            output,
            duration_ms,
            ..
        } = self.parts.get_mut(index)?
        {
            *state = if is_error {
                ToolState::Error
            } else {
                ToolState::Done
            };
            *output = Some(truncate(result));
            *duration_ms = Some(since);
        }
        self.changed(index)
    }

    fn elapsed(&self, index: usize, now: u64) -> u64 {
        self.started_at
            .get(index)
            .map_or(0, |start| now.saturating_sub(*start))
    }

    fn changed(&self, index: usize) -> Option<Emit> {
        Some(Emit::PartChanged {
            index: wire_index(index),
            part: self.parts.get(index)?.clone(),
        })
    }
}

fn wire_index(index: usize) -> u32 {
    u32::try_from(index).unwrap_or(u32::MAX)
}

fn truncate(output: String) -> String {
    match output.char_indices().nth(OUTPUT_CHARS) {
        Some((cut, _)) => format!("{}…", &output[..cut]),
        None => output,
    }
}
