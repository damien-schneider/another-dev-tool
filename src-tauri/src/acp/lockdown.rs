use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use super::protocol::{PermissionOption, PermissionRequest, ToolCall, ToolContent};

pub const CLAUDE: &str = "claude-acp";
pub const CODEX: &str = "codex-acp";

const DISALLOWED_TOOLS: [&str; 6] = [
    "Bash",
    "WebFetch",
    "WebSearch",
    "Task",
    "Skill",
    "NotebookEdit",
];
const EDIT_TOOLS: [&str; 3] = ["Edit", "Write", "MultiEdit"];

/// Agents this app knows how to confine beyond the permission prompts every
/// ACP agent answers to.
pub fn hardened(agent: &str) -> bool {
    matches!(agent, CLAUDE | CODEX)
}

#[derive(Debug, Default, PartialEq)]
pub struct Setup {
    pub meta: Option<Value>,
    pub mode: Option<&'static str>,
}

impl Setup {
    /// The lockdown mode goes through the agent's own `mode` option, last so no pick overrides it.
    pub fn mode_pick(&self) -> Option<(String, String)> {
        self.mode.map(|mode| ("mode".to_string(), mode.to_string()))
    }
}

pub fn setup(agent: &str, editable: bool, references: &[PathBuf]) -> Setup {
    match agent {
        CLAUDE => Setup {
            meta: Some(claude_options(editable, references)),
            mode: Some("acceptEdits"),
        },
        CODEX => Setup {
            meta: None,
            mode: Some(if editable {
                "workspace-write"
            } else {
                "read-only"
            }),
        },
        _ => Setup::default(),
    }
}

fn claude_options(editable: bool, references: &[PathBuf]) -> Value {
    let disallowed: Vec<&str> = if editable {
        DISALLOWED_TOOLS.to_vec()
    } else {
        [DISALLOWED_TOOLS.as_slice(), EDIT_TOOLS.as_slice()].concat()
    };
    let mut options = json!({
        "disallowedTools": disallowed,
        "settingSources": [],
        "strictMcpConfig": true,
    });
    if !references.is_empty() {
        options["extraArgs"] = json!({ "settings": read_only_settings(references) });
    }
    json!({ "claudeCode": { "options": options } })
}

/// Allow rules instead of an added directory: a working directory would let
/// `acceptEdits` write the originals.
fn read_only_settings(references: &[PathBuf]) -> String {
    let allow: Vec<String> = references.iter().map(|path| read_rule(path)).collect();
    json!({ "permissions": { "allow": allow } }).to_string()
}

fn read_rule(path: &Path) -> String {
    let absolute = path.to_string_lossy();
    let absolute = absolute.trim_end_matches('/');
    if path.is_dir() {
        format!("Read(/{absolute}/**)")
    } else {
        format!("Read(/{absolute})")
    }
}

/// Claude allows a read only when both the asked path and its symlink target match a rule.
pub fn real_paths(references: Vec<PathBuf>) -> Vec<PathBuf> {
    references
        .into_iter()
        .map(|path| path.canonicalize().unwrap_or(path))
        .collect()
}

/// What a turn may touch when the agent asks: the staged copies to change,
/// the scratch folder and the references to read.
#[derive(Debug)]
pub struct Scope {
    editable: Vec<PathBuf>,
    readable: Vec<PathBuf>,
}

impl Scope {
    pub fn new(dir: &Path, editable: &[PathBuf], references: &[PathBuf]) -> Self {
        Self {
            editable: editable.iter().map(|path| real(path)).collect(),
            readable: std::iter::once(dir)
                .chain(references.iter().map(PathBuf::as_path))
                .map(real)
                .collect(),
        }
    }

    fn allows(&self, call: &ToolCall) -> bool {
        let touched = touched(call);
        if touched.is_empty() || !touched.iter().all(|path| path.is_absolute()) {
            return false;
        }
        match call.kind.as_deref() {
            Some("edit" | "delete" | "move") => touched
                .iter()
                .all(|path| self.editable.contains(&real(path))),
            Some("read" | "search") => touched.iter().all(|path| {
                let path = real(path);
                self.readable.iter().any(|root| path.starts_with(root))
            }),
            _ => false,
        }
    }

    pub fn answer(&self, request: &PermissionRequest) -> Value {
        let kinds = if self.allows(&request.tool_call) {
            ["allow_once", "allow_always"]
        } else {
            ["reject_once", "reject_always"]
        };
        kinds
            .iter()
            .find_map(|kind| pick(&request.options, kind))
            .map_or_else(
                || json!({ "outcome": { "outcome": "cancelled" } }),
                |option| json!({ "outcome": { "outcome": "selected", "optionId": option.option_id } }),
            )
    }
}

fn pick<'a>(options: &'a [PermissionOption], kind: &str) -> Option<&'a PermissionOption> {
    options.iter().find(|option| option.kind == kind)
}

fn touched(call: &ToolCall) -> Vec<&Path> {
    let located = call
        .locations
        .iter()
        .flatten()
        .map(|location| location.path.as_path());
    let diffed = call
        .content
        .iter()
        .flatten()
        .filter_map(|content| match content {
            ToolContent::Diff { path } => Some(path.as_path()),
            _ => None,
        });
    located.chain(diffed).collect()
}

/// A file about to be created has no real path yet; its folder does.
fn real(path: &Path) -> PathBuf {
    path.canonicalize()
        .ok()
        .or_else(|| {
            let parent = path.parent()?.canonicalize().ok()?;
            Some(parent.join(path.file_name()?))
        })
        .unwrap_or_else(|| path.to_path_buf())
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;

    struct Fixture {
        _root: tempfile::TempDir,
        scratch: PathBuf,
        document: PathBuf,
        reference: PathBuf,
        outside: PathBuf,
    }

    fn fixture() -> Fixture {
        let root = tempfile::tempdir().unwrap();
        let scratch = root.path().join("scratch");
        let reference = root.path().join("skill");
        fs::create_dir_all(&scratch).unwrap();
        fs::create_dir_all(&reference).unwrap();
        fs::write(reference.join("SKILL.md"), "# Skill").unwrap();
        let document = scratch.join("CLAUDE.md");
        fs::write(&document, "# Doc").unwrap();
        let outside = root.path().join("original.md");
        fs::write(&outside, "# Original").unwrap();
        Fixture {
            scratch,
            document,
            reference,
            outside,
            _root: root,
        }
    }

    fn request(kind: &str, paths: &[&Path]) -> PermissionRequest {
        let locations: Vec<_> = paths.iter().map(|path| json!({ "path": path })).collect();
        serde_json::from_value(json!({
            "sessionId": "s",
            "toolCall": { "toolCallId": "t", "kind": kind, "locations": locations },
            "options": [
                { "optionId": "always", "name": "Always", "kind": "allow_always" },
                { "optionId": "once", "name": "Allow", "kind": "allow_once" },
                { "optionId": "no", "name": "Reject", "kind": "reject_once" },
            ],
        }))
        .unwrap()
    }

    fn chosen(scope: &Scope, request: &PermissionRequest) -> String {
        scope.answer(request)["outcome"]["optionId"]
            .as_str()
            .unwrap_or("cancelled")
            .to_string()
    }

    #[test]
    fn only_the_scratch_document_may_change() {
        let at = fixture();
        let scope = Scope::new(&at.scratch, std::slice::from_ref(&at.document), &[]);
        let sibling = at.scratch.join("notes.md");

        assert_eq!(chosen(&scope, &request("edit", &[&at.document])), "once");
        assert_eq!(chosen(&scope, &request("edit", &[&at.outside])), "no");
        assert_eq!(chosen(&scope, &request("edit", &[&sibling])), "no");
        assert_eq!(
            chosen(&scope, &request("delete", &[&at.document, &at.outside])),
            "no"
        );
    }

    #[test]
    fn every_staged_copy_may_change_and_nothing_beside_them() {
        let at = fixture();
        let other = at.scratch.join("7");
        fs::create_dir_all(&other).unwrap();
        let copy = other.join("SKILL.md");
        fs::write(&copy, "# Skill").unwrap();
        let scope = Scope::new(&at.scratch, &[at.document.clone(), copy.clone()], &[]);

        assert_eq!(
            chosen(&scope, &request("edit", &[&at.document, &copy])),
            "once"
        );
        assert_eq!(chosen(&scope, &request("edit", &[&other.join("x.md")])), "no");
    }

    #[test]
    fn a_turn_without_the_file_may_change_nothing() {
        let at = fixture();
        let scope = Scope::new(&at.scratch, &[], &[]);

        assert_eq!(chosen(&scope, &request("edit", &[&at.document])), "no");
    }

    #[test]
    fn reads_stay_inside_the_scratch_folder_and_the_references() {
        let at = fixture();
        let scope = Scope::new(
            &at.scratch,
            std::slice::from_ref(&at.document),
            std::slice::from_ref(&at.reference),
        );

        assert_eq!(chosen(&scope, &request("read", &[&at.document])), "once");
        assert_eq!(
            chosen(
                &scope,
                &request("search", &[&at.reference.join("SKILL.md")])
            ),
            "once"
        );
        assert_eq!(chosen(&scope, &request("read", &[&at.outside])), "no");
        assert_eq!(
            chosen(
                &scope,
                &request("read", &[&at.scratch.join("../original.md")])
            ),
            "no"
        );
    }

    #[test]
    fn commands_fetches_and_calls_without_a_location_are_refused() {
        let at = fixture();
        let scope = Scope::new(&at.scratch, std::slice::from_ref(&at.document), &[]);

        assert_eq!(chosen(&scope, &request("execute", &[&at.document])), "no");
        assert_eq!(chosen(&scope, &request("fetch", &[])), "no");
        assert_eq!(chosen(&scope, &request("read", &[])), "no");
        assert_eq!(
            chosen(&scope, &request("read", &[Path::new("CLAUDE.md")])),
            "no"
        );
    }

    #[test]
    fn an_edit_shown_only_as_a_diff_is_judged_by_the_diffs_path() {
        let at = fixture();
        let scope = Scope::new(&at.scratch, std::slice::from_ref(&at.document), &[]);
        let request: PermissionRequest = serde_json::from_value(json!({
            "toolCall": {
                "toolCallId": "t",
                "kind": "edit",
                "content": [{ "type": "diff", "path": at.outside, "newText": "x" }],
            },
            "options": [{ "optionId": "no", "kind": "reject_once" }],
        }))
        .unwrap();

        assert_eq!(chosen(&scope, &request), "no");
    }

    #[test]
    fn with_no_matching_choice_the_request_is_cancelled() {
        let at = fixture();
        let scope = Scope::new(&at.scratch, std::slice::from_ref(&at.document), &[]);
        let request: PermissionRequest = serde_json::from_value(json!({
            "toolCall": { "toolCallId": "t", "kind": "execute" },
            "options": [{ "optionId": "yes", "kind": "allow_once" }],
        }))
        .unwrap();

        assert_eq!(
            scope.answer(&request),
            json!({ "outcome": { "outcome": "cancelled" } })
        );
    }

    #[test]
    fn claude_is_kept_to_the_file_and_reads_its_references_without_a_working_directory() {
        let at = fixture();

        let editing = setup(CLAUDE, true, std::slice::from_ref(&at.reference));
        let asking = setup(CLAUDE, false, &[]);

        let options = &editing.meta.unwrap()["claudeCode"]["options"];
        assert_eq!(options["settingSources"], json!([]));
        assert!(!options["disallowedTools"]
            .as_array()
            .unwrap()
            .contains(&json!("Edit")));
        let settings = options["extraArgs"]["settings"].as_str().unwrap();
        assert!(settings.contains(&format!("Read(/{}/**)", at.reference.display())));
        let options = &asking.meta.unwrap()["claudeCode"]["options"];
        assert!(options["disallowedTools"]
            .as_array()
            .unwrap()
            .contains(&json!("Write")));
        assert!(options.get("extraArgs").is_none());
        assert_eq!(editing.mode, Some("acceptEdits"));
    }

    #[test]
    fn codex_writes_only_in_its_workspace_and_reads_when_there_is_no_file() {
        assert_eq!(setup(CODEX, true, &[]).mode, Some("workspace-write"));
        assert_eq!(setup(CODEX, false, &[]).mode, Some("read-only"));
        assert_eq!(setup("gemini", true, &[]), Setup::default());
        assert!(hardened(CODEX) && !hardened("gemini"));
    }

    #[test]
    fn a_folder_reference_is_readable_all_the_way_down_and_a_file_only_itself() {
        let at = fixture();
        let file = at.reference.join("SKILL.md");

        let settings: Value =
            serde_json::from_str(&read_only_settings(&[at.reference.clone(), file.clone()]))
                .unwrap();

        assert_eq!(
            settings["permissions"]["allow"],
            json!([
                format!("Read(/{}/**)", at.reference.display()),
                format!("Read(/{})", file.display()),
            ])
        );
    }

    #[test]
    fn a_linked_reference_is_named_by_its_real_location() {
        let root = tempfile::tempdir().unwrap();
        let real = root.path().join("skill");
        fs::create_dir(&real).unwrap();
        let link = root.path().join("linked");
        std::os::unix::fs::symlink(&real, &link).unwrap();
        let gone = root.path().join("gone");

        assert_eq!(
            real_paths(vec![link, gone.clone()]),
            vec![real.canonicalize().unwrap(), gone]
        );
    }
}
