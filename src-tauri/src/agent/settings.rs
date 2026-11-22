use serde::{Deserialize, Serialize};

/// Claude Code aliases: each tracks the latest model of its family.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Model {
    Fable,
    Opus,
    Sonnet,
    Haiku,
}

impl Model {
    fn arg(self) -> &'static str {
        match self {
            Self::Fable => "fable",
            Self::Opus => "opus",
            Self::Sonnet => "sonnet",
            Self::Haiku => "haiku",
        }
    }
}

/// The CLI silently lowers a level the chosen model does not support.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Effort {
    Low,
    Medium,
    High,
    Xhigh,
    Max,
}

impl Effort {
    fn arg(self) -> &'static str {
        match self {
            Self::Low => "low",
            Self::Medium => "medium",
            Self::High => "high",
            Self::Xhigh => "xhigh",
            Self::Max => "max",
        }
    }
}

#[derive(Debug, Clone, Copy, Deserialize)]
pub struct RunSettings {
    pub model: Model,
    pub effort: Effort,
}

impl RunSettings {
    pub fn args(self) -> [&'static str; 4] {
        ["--model", self.model.arg(), "--effort", self.effort.arg()]
    }
}
