use serde::de::IgnoredAny;
use serde::Deserialize;
use serde_json::Value;

const IMAGE_PLACEHOLDER: &str = "[image]";

#[derive(Debug, Clone, PartialEq)]
pub enum PartKind {
    Text,
    Thinking,
    Tool { id: String, name: String },
}

#[derive(Debug, Clone, PartialEq)]
pub enum StreamEvent {
    PartStart(PartKind),
    Delta(String),
    ToolInput {
        id: String,
        input: Value,
    },
    PartStop,
    ToolResult {
        id: String,
        is_error: bool,
        output: String,
    },
    Model(String),
    Finished {
        error: Option<String>,
        duration_ms: Option<u64>,
    },
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum Line {
    System {
        #[serde(default)]
        subtype: Option<String>,
        #[serde(default)]
        model: Option<String>,
    },
    StreamEvent {
        event: Event,
    },
    Assistant {
        message: Message<AssistantBlock>,
    },
    User {
        message: Message<UserBlock>,
    },
    Result {
        #[serde(default)]
        is_error: bool,
        #[serde(default)]
        result: Option<String>,
        #[serde(default)]
        duration_ms: Option<u64>,
    },
    #[serde(other)]
    Ignored,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum Event {
    ContentBlockStart {
        content_block: Block,
    },
    ContentBlockDelta {
        delta: Delta,
    },
    ContentBlockStop,
    #[serde(other)]
    Ignored,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum Block {
    Text,
    Thinking,
    RedactedThinking,
    ToolUse {
        id: String,
        name: String,
    },
    #[serde(other)]
    Ignored,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum Delta {
    #[serde(rename = "text_delta")]
    Text { text: String },
    #[serde(rename = "thinking_delta")]
    Thinking { thinking: String },
    #[serde(other)]
    Ignored,
}

#[derive(Deserialize)]
struct Message<B> {
    content: Content<B>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum Content<B> {
    Blocks(Vec<B>),
    Other(IgnoredAny),
}

impl<B> Content<B> {
    fn into_blocks(self) -> Vec<B> {
        match self {
            Self::Blocks(blocks) => blocks,
            Self::Other(_) => Vec::new(),
        }
    }
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum AssistantBlock {
    ToolUse {
        id: String,
        #[serde(default)]
        input: Value,
    },
    #[serde(other)]
    Ignored,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum UserBlock {
    ToolResult {
        tool_use_id: String,
        #[serde(default)]
        content: Option<ResultContent>,
        #[serde(default)]
        is_error: Option<bool>,
    },
    #[serde(other)]
    Ignored,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum ResultContent {
    Text(String),
    Blocks(Vec<ResultBlock>),
    Other(IgnoredAny),
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ResultBlock {
    Text {
        text: String,
    },
    Image,
    #[serde(other)]
    Ignored,
}

impl ResultContent {
    fn into_output(self) -> String {
        match self {
            Self::Text(text) => text,
            Self::Blocks(blocks) => blocks
                .into_iter()
                .filter_map(|block| match block {
                    ResultBlock::Text { text } => Some(text),
                    ResultBlock::Image => Some(IMAGE_PLACEHOLDER.to_string()),
                    ResultBlock::Ignored => None,
                })
                .collect::<Vec<_>>()
                .join("\n"),
            Self::Other(_) => String::new(),
        }
    }
}

pub fn parse_line(line: &str) -> Vec<StreamEvent> {
    let Ok(line) = serde_json::from_str::<Line>(line) else {
        return Vec::new();
    };
    match line {
        Line::System { subtype, model } => match (subtype.as_deref(), model) {
            (Some("init"), Some(model)) => vec![StreamEvent::Model(model)],
            _ => Vec::new(),
        },
        Line::StreamEvent { event } => stream_event(event).into_iter().collect(),
        Line::Assistant { message } => message
            .content
            .into_blocks()
            .into_iter()
            .filter_map(|block| match block {
                AssistantBlock::ToolUse { id, input } => Some(StreamEvent::ToolInput { id, input }),
                AssistantBlock::Ignored => None,
            })
            .collect(),
        Line::User { message } => message
            .content
            .into_blocks()
            .into_iter()
            .filter_map(|block| match block {
                UserBlock::ToolResult {
                    tool_use_id,
                    content,
                    is_error,
                } => Some(StreamEvent::ToolResult {
                    id: tool_use_id,
                    is_error: is_error.unwrap_or(false),
                    output: content.map(ResultContent::into_output).unwrap_or_default(),
                }),
                UserBlock::Ignored => None,
            })
            .collect(),
        Line::Result {
            is_error,
            result,
            duration_ms,
        } => vec![StreamEvent::Finished {
            error: is_error.then(|| result.unwrap_or_else(|| "the agent run failed".to_string())),
            duration_ms,
        }],
        Line::Ignored => Vec::new(),
    }
}

fn stream_event(event: Event) -> Option<StreamEvent> {
    match event {
        Event::ContentBlockStart { content_block } => match content_block {
            Block::Text => Some(StreamEvent::PartStart(PartKind::Text)),
            Block::Thinking | Block::RedactedThinking => {
                Some(StreamEvent::PartStart(PartKind::Thinking))
            }
            Block::ToolUse { id, name } => {
                Some(StreamEvent::PartStart(PartKind::Tool { id, name }))
            }
            Block::Ignored => None,
        },
        Event::ContentBlockDelta { delta } => match delta {
            Delta::Text { text } | Delta::Thinking { thinking: text } => {
                (!text.is_empty()).then_some(StreamEvent::Delta(text))
            }
            Delta::Ignored => None,
        },
        Event::ContentBlockStop => Some(StreamEvent::PartStop),
        Event::Ignored => None,
    }
}
