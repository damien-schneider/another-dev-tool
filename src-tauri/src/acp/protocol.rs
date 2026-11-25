use std::collections::BTreeMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const VERSION: u32 = 1;
pub const MODEL: &str = "model";
pub const EFFORT: &str = "thought_level";

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Initialized {
    #[serde(default)]
    pub agent_capabilities: AgentCapabilities,
    #[serde(default)]
    pub auth_methods: Vec<AuthMethod>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCapabilities {
    #[serde(default)]
    pub load_session: bool,
    #[serde(default)]
    pub prompt_capabilities: PromptCapabilities,
    #[serde(default)]
    pub session_capabilities: SessionCapabilities,
}

#[derive(Debug, Default, Deserialize)]
pub struct PromptCapabilities {
    #[serde(default)]
    pub image: bool,
}

/// Each capability is an object when supported; absent or null when not.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionCapabilities {
    pub resume: Option<Value>,
    pub options: Option<Value>,
    pub system_prompt: Option<Value>,
}

impl AgentCapabilities {
    pub fn resumes(&self) -> bool {
        self.session_capabilities.resume.is_some()
    }

    pub fn previews_options(&self) -> bool {
        self.session_capabilities.options.is_some()
    }

    pub fn takes_system_prompt(&self) -> bool {
        self.session_capabilities.system_prompt.is_some()
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthMethod {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default, rename = "type")]
    pub kind: Option<String>,
    #[serde(default, skip_serializing)]
    pub args: Vec<String>,
    #[serde(default, skip_serializing)]
    pub env: BTreeMap<String, String>,
}

impl AuthMethod {
    /// A method without a type is handled by the agent through `authenticate`.
    pub fn in_terminal(&self) -> bool {
        self.kind.as_deref() == Some("terminal")
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct Choice {
    pub value: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
enum SelectEntry {
    Group { options: Vec<Choice> },
    Choice(Choice),
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigOption {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    current_value: Value,
    #[serde(default)]
    options: Vec<SelectEntry>,
}

impl ConfigOption {
    pub fn current(&self) -> Option<&str> {
        self.current_value.as_str()
    }

    pub fn choices(&self) -> Vec<Choice> {
        self.options
            .iter()
            .flat_map(|entry| match entry {
                SelectEntry::Group { options } => options.clone(),
                SelectEntry::Choice(choice) => vec![choice.clone()],
            })
            .collect()
    }

    pub fn choice_name(&self, value: &str) -> Option<String> {
        self.choices()
            .into_iter()
            .find(|choice| choice.value == value)
            .map(|choice| choice.name)
    }
}

pub fn categorized<'a>(options: &'a [ConfigOption], category: &str) -> Option<&'a ConfigOption> {
    options
        .iter()
        .find(|option| option.category.as_deref() == Some(category))
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSetup {
    pub session_id: Option<String>,
    #[serde(default)]
    pub config_options: Vec<ConfigOption>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptResponse {
    pub stop_reason: String,
}

#[derive(Debug, Deserialize)]
pub struct SessionNotification {
    pub update: SessionUpdate,
}

#[derive(Debug, Deserialize)]
#[serde(
    tag = "sessionUpdate",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum SessionUpdate {
    AgentMessageChunk {
        content: Content,
    },
    AgentThoughtChunk {
        content: Content,
    },
    ToolCall(ToolCall),
    ToolCallUpdate(ToolCall),
    #[serde(other)]
    Other,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Content {
    Text {
        text: String,
    },
    #[serde(other)]
    Other,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCall {
    pub tool_call_id: String,
    pub name: Option<String>,
    pub title: Option<String>,
    pub kind: Option<String>,
    pub status: Option<String>,
    pub raw_input: Option<Value>,
    pub raw_output: Option<Value>,
    pub content: Option<Vec<ToolContent>>,
    pub locations: Option<Vec<Location>>,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ToolContent {
    Content {
        content: Content,
    },
    Diff {
        path: PathBuf,
    },
    #[serde(other)]
    Other,
}

#[derive(Debug, Deserialize)]
pub struct Location {
    pub path: PathBuf,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionRequest {
    pub tool_call: ToolCall,
    pub options: Vec<PermissionOption>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionOption {
    pub option_id: String,
    pub kind: String,
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn grouped_and_flat_choices_read_the_same() {
        let option: ConfigOption = serde_json::from_value(json!({
            "id": "model",
            "name": "Model",
            "category": "model",
            "type": "select",
            "currentValue": "b",
            "options": [
                { "value": "a", "name": "A" },
                { "group": "g", "name": "Group", "options": [{ "value": "b", "name": "B" }] },
            ],
        }))
        .unwrap();

        let values: Vec<_> = option
            .choices()
            .into_iter()
            .map(|choice| choice.value)
            .collect();
        assert_eq!(values, ["a", "b"]);
        assert_eq!(option.current(), Some("b"));
        assert_eq!(option.choice_name("b").as_deref(), Some("B"));
    }

    #[test]
    fn an_update_kind_this_client_ignores_still_parses() {
        let notification: SessionNotification = serde_json::from_value(json!({
            "sessionId": "s",
            "update": { "sessionUpdate": "usage_update", "used": 1, "size": 2 },
        }))
        .unwrap();

        assert!(matches!(notification.update, SessionUpdate::Other));
    }

    #[test]
    fn a_tool_call_update_carries_only_what_changed() {
        let notification: SessionNotification = serde_json::from_value(json!({
            "sessionId": "s",
            "update": {
                "sessionUpdate": "tool_call_update",
                "toolCallId": "t1",
                "status": "completed",
                "content": [{ "type": "content", "content": { "type": "text", "text": "ok" } }],
            },
        }))
        .unwrap();

        let SessionUpdate::ToolCallUpdate(call) = notification.update else {
            panic!("not a tool call update");
        };
        assert_eq!(call.tool_call_id, "t1");
        assert_eq!(call.status.as_deref(), Some("completed"));
        assert!(call.raw_input.is_none());
    }

    #[test]
    fn an_auth_method_without_a_type_is_handled_by_the_agent() {
        let method: AuthMethod =
            serde_json::from_value(json!({ "id": "chat-gpt", "name": "ChatGPT" })).unwrap();
        let terminal: AuthMethod = serde_json::from_value(json!({
            "id": "claude-ai-login",
            "name": "Claude Subscription",
            "type": "terminal",
            "args": ["--cli", "auth", "login"],
        }))
        .unwrap();

        assert!(!method.in_terminal());
        assert!(terminal.in_terminal());
        assert_eq!(terminal.args, ["--cli", "auth", "login"]);
    }
}
