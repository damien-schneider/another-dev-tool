pub(crate) mod answer;
pub mod cli;
mod message;
mod run_slot;
pub(crate) mod settings;
mod stream;

#[cfg(test)]
mod answer_tests;
#[cfg(test)]
mod stream_tests;

pub use answer::{Answer, AnswerMeta, Emit, Part, Requested};
pub use cli::{status, AgentStatus};
pub(crate) use message::user_message;
pub use message::{prompt_blocks, ImageType, Prompt, PromptImage};
pub use run_slot::{next_run_id, RunHandle, RunSlot};
pub use settings::RunSettings;
pub use stream::{parse_line, PartKind, StreamEvent};
