pub(crate) mod answer;
pub mod cli;
mod message;
mod references;
mod run_slot;
pub(crate) mod settings;
mod stream;

#[cfg(test)]
mod answer_tests;
#[cfg(test)]
mod live_tests;
#[cfg(test)]
mod stream_tests;

pub use answer::{Answer, AnswerMeta, Emit, Part};
pub use cli::{status, AgentStatus};
pub use message::{ImageType, Prompt, PromptImage};
pub(crate) use message::user_message;
pub use run_slot::{RunHandle, RunSlot};
pub use settings::RunSettings;
pub use stream::{parse_line, StreamEvent};

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;

use crate::error::{AppError, AppResult};

const SYSTEM_PROMPT: &str = "You are editing a single Markdown file in an isolated scratch \
directory. Apply the request by editing that file in place with the Edit tool. Never create, \
rename or delete any other file. Answer in one or two sentences — the user reads the diff, not \
your prose.";

const NO_FILE_PROMPT: &str = "No document is attached to this request, so there is nothing to \
edit. Answer the question in a few sentences from the conversation and any read-only references.";

const DISALLOWED_TOOLS: &str = "Bash,WebFetch,WebSearch,Task,Skill,NotebookEdit";
const EDIT_TOOLS: &str = "Edit,Write,MultiEdit";

const FALLBACK_FILE_NAME: &str = "document.md";

/// Folder must outlive restarts: Claude Code files sessions by working directory, `--resume` needs the same one.
pub struct Session {
    id: String,
    dir: PathBuf,
    file_name: String,
    started: bool,
}

impl Session {
    pub fn open(id: &str, dir: PathBuf, file_name: &str, started: bool) -> AppResult<Self> {
        fs::create_dir_all(&dir)?;
        Ok(Self {
            id: id.to_string(),
            dir,
            file_name: sanitize(file_name),
            started,
        })
    }

    fn document(&self) -> PathBuf {
        self.dir.join(&self.file_name)
    }
}

pub struct Outcome {
    pub proposal: Option<String>,
    pub cancelled: bool,
    pub started: bool,
}

/// One run at a time, whatever conversation it belongs to.
#[derive(Default)]
pub struct AgentRuntime {
    session: Mutex<Option<Session>>,
    slot: RunSlot,
}

fn sanitize(file_name: &str) -> String {
    Path::new(file_name)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(FALLBACK_FILE_NAME)
        .to_string()
}

impl AgentRuntime {
    pub fn start(
        &self,
        session: Session,
        content: Option<&str>,
        prompt: Prompt,
        settings: RunSettings,
    ) -> AppResult<RunHandle> {
        self.slot.claim()?;
        let started = cli::resolve()
            .ok_or(AppError::AgentMissing)
            .and_then(|binary| self.spawn(&binary, session, content, prompt, settings));

        if started.is_err() {
            self.slot.release();
        }
        started
    }

    fn spawn(
        &self,
        binary: &Path,
        session: Session,
        content: Option<&str>,
        prompt: Prompt,
        settings: RunSettings,
    ) -> AppResult<RunHandle> {
        let mut slot = self
            .session
            .lock()
            .map_err(|_| AppError::internal("agent session mutex poisoned"))?;
        stage(&session, content)?;
        let prompt = Prompt {
            references: references::real_paths(prompt.references),
            ..prompt
        };

        let command = command(
            binary,
            &session,
            settings,
            &prompt.references,
            content.is_some(),
        );
        let handle = self.slot.spawn(command, message::user_message(&prompt))?;
        *slot = Some(session);
        Ok(handle)
    }

    /// Reads back the scratch document even when the run failed midway: a
    /// partial edit is still a diff the user can accept or throw away.
    pub fn finish(&self, failed: bool) -> Outcome {
        let session = self.session.lock().ok().and_then(|mut slot| slot.take());
        let cancelled = self.slot.finish();
        let started = session
            .as_ref()
            .is_some_and(|session| session.started || !(failed || cancelled));

        Outcome {
            proposal: session.and_then(|session| fs::read_to_string(session.document()).ok()),
            cancelled,
            started,
        }
    }

    pub fn cancel(&self) {
        self.slot.cancel();
    }
}

fn stage(session: &Session, content: Option<&str>) -> std::io::Result<()> {
    match content {
        Some(content) => fs::write(session.document(), content),
        None => match fs::remove_file(session.document()) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            removed => removed,
        },
    }
}

fn command(
    binary: &Path,
    session: &Session,
    settings: RunSettings,
    references: &[PathBuf],
    editable: bool,
) -> Command {
    let (disallowed, instructions) = if editable {
        (DISALLOWED_TOOLS.to_string(), SYSTEM_PROMPT)
    } else {
        (format!("{DISALLOWED_TOOLS},{EDIT_TOOLS}"), NO_FILE_PROMPT)
    };
    let mut command = Command::new(binary);
    command
        .current_dir(&session.dir)
        .env("PATH", cli::child_path(binary))
        .arg("-p")
        .args(["--input-format", "stream-json"])
        .args(["--output-format", "stream-json", "--verbose"])
        .args(settings.args())
        .arg("--include-partial-messages")
        .args(["--thinking-display", "summarized"])
        .args(["--setting-sources", ""])
        .arg("--strict-mcp-config")
        .args(["--disallowed-tools", &disallowed])
        .args(["--permission-mode", "acceptEdits"])
        .arg("--append-system-prompt")
        .arg(instructions)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if !references.is_empty() {
        command.args(["--settings", &references::read_only_settings(references)]);
    }

    if session.started {
        command.args(["--resume", &session.id]);
    } else {
        command.args(["--session-id", &session.id]);
    }
    command
}

#[cfg(test)]
mod tests {
    use super::settings::{Effort, Model};
    use super::*;

    const SETTINGS: RunSettings = RunSettings {
        model: Model::Haiku,
        effort: Effort::Low,
    };

    fn args_of(command: &Command) -> Vec<String> {
        command
            .get_args()
            .map(|arg| arg.to_string_lossy().to_string())
            .collect()
    }

    fn scratch(id: &str, root: &Path, started: bool) -> Session {
        Session::open(id, root.join(id), "CLAUDE.md", started).unwrap()
    }

    fn prompt(text: &str) -> Prompt {
        Prompt {
            text: text.into(),
            images: vec![],
            references: vec![],
        }
    }

    #[test]
    fn a_fresh_session_pins_its_id_and_a_started_one_resumes_it() {
        let root = tempfile::tempdir().unwrap();
        let mut session = scratch("c", root.path(), false);

        let fresh = args_of(&command(Path::new("claude"), &session, SETTINGS, &[], true));
        session.started = true;
        let resumed = args_of(&command(Path::new("claude"), &session, SETTINGS, &[], true));

        assert!(fresh.contains(&"--session-id".to_string()));
        assert!(resumed.contains(&"--resume".to_string()));
        assert!(!resumed.contains(&"--session-id".to_string()));
    }

    #[test]
    fn the_request_travels_on_stdin_so_it_can_carry_images() {
        let root = tempfile::tempdir().unwrap();
        let session = scratch("c", root.path(), false);

        let args = args_of(&command(Path::new("claude"), &session, SETTINGS, &[], true));

        assert!(args
            .windows(2)
            .any(|pair| pair == ["--input-format", "stream-json"]));
    }

    #[test]
    fn thinking_is_asked_for_as_a_summary_so_its_deltas_carry_text() {
        let root = tempfile::tempdir().unwrap();
        let session = scratch("c", root.path(), false);

        let args = args_of(&command(Path::new("claude"), &session, SETTINGS, &[], true));

        assert!(args
            .windows(2)
            .any(|pair| pair == ["--thinking-display", "summarized"]));
        assert!(args.contains(&"--include-partial-messages".to_string()));
    }

    #[test]
    fn a_reference_is_readable_but_never_a_working_directory_edits_could_land_in() {
        let root = tempfile::tempdir().unwrap();
        let session = scratch("c", root.path(), false);
        let reference = tempfile::tempdir().unwrap();

        let args = args_of(&command(
            Path::new("claude"),
            &session,
            SETTINGS,
            &[reference.path().to_path_buf()],
            true,
        ));

        let settings = args
            .windows(2)
            .find(|pair| pair[0] == "--settings")
            .map(|pair| pair[1].clone())
            .unwrap();
        assert!(settings.contains(&format!("Read(/{}/**)", reference.path().display())));
        assert!(!args.contains(&"--add-dir".to_string()));
    }

    #[test]
    fn a_turn_without_the_file_can_neither_read_nor_edit_it() {
        let root = tempfile::tempdir().unwrap();
        let session = scratch("c", root.path(), false);
        stage(&session, Some("# Before")).unwrap();

        stage(&session, None).unwrap();
        let args = args_of(&command(
            Path::new("claude"),
            &session,
            SETTINGS,
            &[],
            false,
        ));

        assert!(!session.document().exists());
        let disallowed = args
            .windows(2)
            .find(|pair| pair[0] == "--disallowed-tools")
            .map(|pair| pair[1].clone())
            .unwrap();
        assert!(disallowed.split(',').any(|tool| tool == "Edit"));
        assert!(disallowed.split(',').any(|tool| tool == "Write"));
        assert!(!args.contains(&SYSTEM_PROMPT.to_string()));
    }

    #[test]
    fn the_scratch_document_keeps_only_the_file_name() {
        let root = tempfile::tempdir().unwrap();
        let session = Session::open(
            "c",
            root.path().join("c"),
            "/Users/someone/.claude/CLAUDE.md",
            false,
        )
        .unwrap();

        assert_eq!(session.document().file_name().unwrap(), "CLAUDE.md");
        assert!(session.document().starts_with(root.path().join("c")));
    }

    #[test]
    fn a_second_run_is_refused_while_one_is_in_flight() {
        let root = tempfile::tempdir().unwrap();
        let runtime = AgentRuntime::default();
        runtime.slot.claim().unwrap();

        let error = runtime
            .start(
                scratch("c", root.path(), false),
                Some("body"),
                prompt("prompt"),
                SETTINGS,
            )
            .unwrap_err();

        assert_eq!(error.code(), "agent_busy");
    }

    #[test]
    fn a_session_counts_as_started_once_a_run_succeeds_in_it() {
        let root = tempfile::tempdir().unwrap();
        let runtime = AgentRuntime::default();

        *runtime.session.lock().unwrap() = Some(scratch("c", root.path(), false));
        assert!(!runtime.finish(true).started);

        *runtime.session.lock().unwrap() = Some(scratch("c", root.path(), false));
        assert!(runtime.finish(false).started);

        *runtime.session.lock().unwrap() = Some(scratch("c", root.path(), true));
        assert!(runtime.finish(true).started);
    }
}
