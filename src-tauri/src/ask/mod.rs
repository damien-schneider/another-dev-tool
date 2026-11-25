#[cfg(test)]
mod live_tests;
mod staging;

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde_json::json;

use crate::acp::{self, Control, Launch, Scope, Turn};
use crate::agent::{prompt_blocks, Prompt};
use crate::error::{AppError, AppResult};

pub use staging::{Editable, Proposal, Session};
use staging::Staged;

const INSTRUCTIONS: &str = "You work in an isolated scratch directory that holds copies of the \
user's files. Each request lists the copies you may edit, if any: change those in place and \
nothing else. Never create, rename or delete a file. The user reviews every change as a diff \
before it reaches the real file. Answer in one or two sentences — the user reads the diff, not \
your prose.";

/// The agent a conversation is pinned to, and the session it holds there.
pub struct Pinned {
    pub agent: String,
    pub launch: Launch,
    pub resume: Option<String>,
}

/// One request, confined to the scratch folder: the agent may change the
/// staged copies and read the references, nothing else.
pub fn turn(
    pinned: Pinned,
    session: &Session,
    editable: &[Editable],
    mut prompt: Prompt,
    picks: Vec<(String, String)>,
) -> Turn {
    let references = acp::real_paths(std::mem::take(&mut prompt.references));
    let setup = acp::setup(&pinned.agent, !editable.is_empty(), &references);
    let copies: Vec<PathBuf> = editable.iter().map(|file| session.copy_of(file)).collect();
    let mut config = picks;
    config.extend(setup.mode_pick());
    let mut blocks = prompt_blocks(&Prompt {
        references: references.clone(),
        ..prompt
    });
    blocks.insert(0, json!({ "type": "text", "text": editable_block(session, editable) }));
    Turn {
        launch: pinned.launch,
        dir: session.dir().to_path_buf(),
        resume: pinned.resume,
        instructions: INSTRUCTIONS.to_string(),
        scope: Scope::new(session.dir(), &copies, &references),
        prompt: blocks,
        config,
        meta: setup.meta,
    }
}

fn editable_block(session: &Session, editable: &[Editable]) -> String {
    if editable.is_empty() {
        return "No file is editable for this request: answer from the conversation and any \
read-only references."
            .to_string();
    }
    let listed: Vec<String> = editable
        .iter()
        .map(|file| {
            let open = if file.open { " (open in the editor)" } else { "" };
            format!(
                "- {} — copy of {}{open}",
                session.copy_of(file).display(),
                file.path.display()
            )
        })
        .collect();
    format!("Copies you may edit for this request:\n{}", listed.join("\n"))
}

pub struct Outcome {
    pub proposals: Vec<Proposal>,
    pub cancelled: bool,
}

struct Running {
    control: Control,
    staged: Vec<Staged>,
}

/// One run at a time, whatever conversation or agent it belongs to.
#[derive(Default)]
pub struct AgentRuntime {
    current: Mutex<Option<Running>>,
}

impl AgentRuntime {
    /// Takes the run slot and lays out the copies the agent may change.
    pub fn claim(&self, session: &Session, editable: Vec<Editable>) -> AppResult<Control> {
        let mut current = self
            .current
            .lock()
            .map_err(|_| AppError::internal("agent run mutex poisoned"))?;
        if current.is_some() {
            return Err(AppError::AgentBusy);
        }
        let staged = session.stage(editable)?;
        let control = Control::default();
        *current = Some(Running {
            control: control.clone(),
            staged,
        });
        Ok(control)
    }

    /// Reads back every copy even when the run failed midway: a partial edit
    /// is still a diff the user can accept or throw away.
    pub fn finish(&self) -> Outcome {
        let running = self
            .current
            .lock()
            .ok()
            .and_then(|mut current| current.take());
        Outcome {
            cancelled: running
                .as_ref()
                .is_some_and(|running| running.control.cancelled()),
            proposals: running
                .map(|running| running.staged.into_iter().filter_map(Staged::proposal).collect())
                .unwrap_or_default(),
        }
    }

    pub fn cancel(&self) {
        let control = self
            .current
            .lock()
            .ok()
            .and_then(|current| current.as_ref().map(|running| running.control.clone()));
        if let Some(control) = control {
            control.cancel();
        }
    }
}

/// The folder a conversation keeps across restarts.
pub fn scratch_dir(agent_dir: &Path, conversation: &str) -> PathBuf {
    agent_dir.join(conversation).join("scratch")
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;

    fn editable(file_id: i64, path: &str, content: &str, open: bool) -> Editable {
        Editable {
            file_id,
            path: PathBuf::from(path),
            content: content.into(),
            open,
        }
    }

    fn doc(content: &str) -> Editable {
        editable(1, "/Users/someone/.claude/CLAUDE.md", content, true)
    }

    #[test]
    fn a_second_run_is_refused_while_one_is_in_flight() {
        let root = tempfile::tempdir().unwrap();
        let session = Session::open(root.path().join("c")).unwrap();
        let runtime = AgentRuntime::default();
        runtime.claim(&session, vec![doc("body")]).unwrap();

        let refused = runtime.claim(&session, vec![doc("body")]);

        assert_eq!(refused.err().map(|error| error.code()), Some("agent_busy"));
    }

    #[test]
    fn a_finished_run_proposes_only_the_copies_it_changed_and_frees_the_slot() {
        let root = tempfile::tempdir().unwrap();
        let session = Session::open(root.path().join("c")).unwrap();
        let runtime = AgentRuntime::default();
        let open = doc("# Before");
        let other = editable(7, "/lib/skills/code-quality/SKILL.md", "# Skill", false);
        let untouched = editable(8, "/lib/AGENTS.md", "# Agents", false);
        let copy = session.copy_of(&other);
        runtime
            .claim(&session, vec![open.clone(), other, untouched])
            .unwrap();
        fs::write(session.copy_of(&open), "# After").unwrap();
        fs::write(copy, "# Skill, sharper").unwrap();

        let outcome = runtime.finish();

        let changed: Vec<_> = outcome
            .proposals
            .iter()
            .map(|proposal| (proposal.file_id, proposal.after.as_str()))
            .collect();
        assert_eq!(changed, [(1, "# After"), (7, "# Skill, sharper")]);
        assert_eq!(outcome.proposals[1].before, "# Skill");
        assert!(!outcome.cancelled);
        assert!(runtime.claim(&session, vec![]).is_ok());
    }

    #[test]
    fn a_turn_without_files_proposes_nothing_even_after_one_that_had_them() {
        let root = tempfile::tempdir().unwrap();
        let session = Session::open(root.path().join("c")).unwrap();
        let runtime = AgentRuntime::default();
        let open = doc("# Before");
        runtime.claim(&session, vec![open.clone()]).unwrap();
        fs::write(session.copy_of(&open), "# After").unwrap();
        runtime.finish();

        runtime.claim(&session, vec![]).unwrap();
        let outcome = runtime.finish();

        assert!(outcome.proposals.is_empty());
        assert!(!session.copy_of(&open).exists());
    }

    #[test]
    fn a_cancelled_run_says_so_when_it_finishes() {
        let root = tempfile::tempdir().unwrap();
        let session = Session::open(root.path().join("c")).unwrap();
        let runtime = AgentRuntime::default();
        runtime.claim(&session, vec![doc("body")]).unwrap();

        runtime.cancel();

        assert!(runtime.finish().cancelled);
    }

    #[test]
    fn the_request_names_each_copy_and_the_file_it_stands_for() {
        let root = tempfile::tempdir().unwrap();
        let session = Session::open(root.path().join("c")).unwrap();
        let open = doc("# Doc");
        let other = editable(7, "/lib/skills/code-quality/SKILL.md", "# Skill", false);

        let block = editable_block(&session, &[open.clone(), other.clone()]);

        assert!(block.contains(&format!(
            "{} — copy of /Users/someone/.claude/CLAUDE.md (open in the editor)",
            session.copy_of(&open).display()
        )));
        assert!(block.ends_with(&format!(
            "{} — copy of /lib/skills/code-quality/SKILL.md",
            session.copy_of(&other).display()
        )));
        assert!(editable_block(&session, &[]).starts_with("No file is editable"));
    }
}
