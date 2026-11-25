mod plugin;
pub mod source;

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::Deserialize;

use crate::agent::{cli, user_message, Prompt, RunHandle, RunSettings, RunSlot};
use crate::error::{AppError, AppResult};

const SYSTEM_PROMPT: &str = include_str!("prompts/system.md");

const TOOLS: &str = "Read,Grep,Glob,Bash,Skill";
const READ_ONLY_TOOLS: [&str; 4] = ["Read", "Grep", "Glob", "Skill"];
const READ_ONLY_SHELL: [&str; 14] = [
    "git log",
    "git show",
    "git diff",
    "git blame",
    "git shortlog",
    "git ls-files",
    "git rev-list",
    "git rev-parse",
    "git status",
    "git for-each-ref",
    "wc",
    "head",
    "ls",
    "cut",
];
/// Exact forms only: with arguments, `sort -o` and `uniq in out` write files.
const PIPE_FILTERS: [&str; 7] = [
    "sort", "sort -n", "sort -r", "sort -rn", "sort -nr", "uniq", "uniq -c",
];
const DENIED: [&str; 9] = [
    "Bash(*--output*)",
    "Bash(*>*)",
    "Edit",
    "Write",
    "MultiEdit",
    "NotebookEdit",
    "WebFetch",
    "WebSearch",
    "Task",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    Gist,
    Brief,
    Standard,
    Detailed,
    Deep,
}

impl Level {
    fn tag(self) -> &'static str {
        match self {
            Self::Gist => "[Detail: Gist — 1 of 5]",
            Self::Brief => "[Detail: Brief — 2 of 5]",
            Self::Standard => "[Detail: Standard — 3 of 5]",
            Self::Detailed => "[Detail: Detailed — 4 of 5]",
            Self::Deep => "[Detail: Deep dive — 5 of 5]",
        }
    }
}

pub struct Request<'a> {
    pub project: &'a Path,
    pub conversation: &'a str,
    pub resume: bool,
    pub text: &'a str,
    pub level: Level,
    pub settings: RunSettings,
}

/// One explanation at a time, independent of the file agent.
pub struct Explainer {
    slot: RunSlot,
    plugin_dir: PathBuf,
}

impl Explainer {
    pub fn new(plugin_dir: PathBuf) -> Self {
        Self {
            slot: RunSlot::default(),
            plugin_dir,
        }
    }

    pub fn start(&self, request: &Request<'_>) -> AppResult<RunHandle> {
        self.slot.claim()?;
        let started = cli::resolve(cli::CLAUDE)
            .ok_or(AppError::AgentMissing)
            .and_then(|binary| {
                plugin::install(&self.plugin_dir)?;
                let command = command(&binary, &self.plugin_dir, request);
                self.slot.spawn(command, message(request))
            });

        if started.is_err() {
            self.slot.release();
        }
        started
    }

    /// Whether the run was cancelled.
    pub fn finish(&self) -> bool {
        self.slot.finish()
    }

    pub fn cancel(&self) {
        self.slot.cancel();
    }
}

/// Tag first: when it trails the question, smaller models echo it after their answer.
fn message(request: &Request<'_>) -> String {
    user_message(&Prompt {
        text: format!("{}\n\n{}", request.level.tag(), request.text.trim()),
        images: vec![],
        references: vec![],
        selection: None,
    })
}

fn system_prompt(project: &Path) -> String {
    let git = if project.join(".git").exists() {
        "yes"
    } else {
        "no, so git commands will fail"
    };
    format!(
        "{SYSTEM_PROMPT}\n# This session\n\n- Project root (your working directory): {}\n- Git repository: {git}\n- Shell commands, with any arguments: {}\n- Pipe filters, exactly as written: {}\n",
        project.display(),
        code_list(&READ_ONLY_SHELL),
        code_list(&PIPE_FILTERS),
    )
}

fn code_list(commands: &[&str]) -> String {
    commands
        .iter()
        .map(|command| format!("`{command}`"))
        .collect::<Vec<_>>()
        .join(", ")
}

fn allowed_tools() -> String {
    READ_ONLY_TOOLS
        .iter()
        .map(|tool| (*tool).to_string())
        .chain(
            READ_ONLY_SHELL
                .iter()
                .map(|shell| format!("Bash({shell}:*)")),
        )
        .chain(PIPE_FILTERS.iter().map(|filter| format!("Bash({filter})")))
        .collect::<Vec<_>>()
        .join(",")
}

fn command(binary: &Path, plugin_dir: &Path, request: &Request<'_>) -> Command {
    let mut command = Command::new(binary);
    command
        .current_dir(request.project)
        .env("PATH", cli::child_path(binary))
        .env("GIT_OPTIONAL_LOCKS", "0")
        .arg("-p")
        .args(["--input-format", "stream-json"])
        .args(["--output-format", "stream-json", "--verbose"])
        .args(request.settings.args())
        .arg("--include-partial-messages")
        .args(["--thinking-display", "summarized"])
        .args(["--setting-sources", ""])
        .arg("--strict-mcp-config")
        .args(["--tools", TOOLS])
        .args(["--allowed-tools", &allowed_tools()])
        .args(["--disallowed-tools", &DENIED.join(",")])
        .args(["--permission-mode", "dontAsk"])
        .arg("--plugin-dir")
        .arg(plugin_dir)
        .arg("--system-prompt")
        .arg(system_prompt(request.project))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if request.resume {
        command.args(["--resume", request.conversation]);
    } else {
        command.args(["--session-id", request.conversation]);
    }
    command
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::settings::{Effort, Model};

    fn request(project: &Path, resume: bool) -> Request<'_> {
        Request {
            project,
            conversation: "c-1",
            resume,
            text: "  How does scanning work?  ",
            level: Level::Brief,
            settings: RunSettings {
                model: Model::Haiku,
                effort: Effort::Low,
            },
        }
    }

    fn args_of(command: &Command) -> Vec<String> {
        command
            .get_args()
            .map(|arg| arg.to_string_lossy().to_string())
            .collect()
    }

    fn value_after(args: &[String], flag: &str) -> String {
        let at = args.iter().position(|arg| arg == flag).unwrap();
        args[at + 1].clone()
    }

    #[test]
    fn the_explainer_runs_inside_the_project_with_read_only_tools_and_its_playbooks() {
        let project = tempfile::tempdir().unwrap();
        let command = command(
            Path::new("claude"),
            Path::new("/plugins/explainer"),
            &request(project.path(), false),
        );
        let args = args_of(&command);

        assert_eq!(command.get_current_dir(), Some(project.path()));
        assert_eq!(value_after(&args, "--permission-mode"), "dontAsk");
        assert_eq!(value_after(&args, "--plugin-dir"), "/plugins/explainer");
        assert_eq!(value_after(&args, "--tools"), TOOLS);
        let allowed = value_after(&args, "--allowed-tools");
        assert!(allowed.contains("Bash(git log:*)"));
        assert!(allowed.contains("Bash(sort -rn),"));
        assert!(!allowed.contains("Bash(sort:*)"));
        assert!(!allowed.contains("Edit"));
        let denied = value_after(&args, "--disallowed-tools");
        for tool in ["Edit", "Write", "Bash(*>*)", "Bash(*--output*)"] {
            assert!(
                denied.split(',').any(|rule| rule == tool),
                "{tool} not denied"
            );
        }
        assert!(command
            .get_envs()
            .any(|(key, value)| key == "GIT_OPTIONAL_LOCKS" && value == Some("0".as_ref())));
    }

    #[test]
    fn a_new_conversation_pins_its_id_and_a_later_turn_resumes_it() {
        let project = tempfile::tempdir().unwrap();
        let plugin = Path::new("/p");

        let fresh = args_of(&command(
            Path::new("claude"),
            plugin,
            &request(project.path(), false),
        ));
        let resumed = args_of(&command(
            Path::new("claude"),
            plugin,
            &request(project.path(), true),
        ));

        assert_eq!(value_after(&fresh, "--session-id"), "c-1");
        assert_eq!(value_after(&resumed, "--resume"), "c-1");
        assert!(!resumed.contains(&"--session-id".to_string()));
    }

    #[test]
    fn the_system_prompt_names_the_project_and_whether_git_can_be_used() {
        let project = tempfile::tempdir().unwrap();

        let plain = system_prompt(project.path());
        std::fs::create_dir(project.path().join(".git")).unwrap();
        let repository = system_prompt(project.path());

        assert!(plain.contains(&project.path().display().to_string()));
        assert!(plain.contains("Git repository: no"));
        assert!(repository.contains("Git repository: yes"));
        assert!(plain.contains("`git blame`"));
        assert!(plain.contains("exactly as written: `sort`, `sort -n`"));
    }

    #[test]
    fn each_message_opens_with_its_detail_level() {
        let project = tempfile::tempdir().unwrap();

        let line: serde_json::Value =
            serde_json::from_str(&message(&request(project.path(), false))).unwrap();

        assert_eq!(
            line["message"]["content"][0]["text"],
            "[Detail: Brief — 2 of 5]\n\nHow does scanning work?"
        );
    }

    #[test]
    fn levels_arrive_from_the_window_by_name() {
        let level: Level = serde_json::from_str("\"deep\"").unwrap();

        assert_eq!(level, Level::Deep);
    }
}
