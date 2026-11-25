use std::fs;
use std::path::Path;

use super::{turn, AgentRuntime, Editable, Outcome, Pinned, Session};
use crate::acp::{self, Catalog};
use crate::agent::answer::ToolState;
use crate::agent::{Answer, Part, Prompt, Requested};

const AGENTS: [&str; 2] = ["claude-acp", "codex-acp"];

fn prompt(text: &str) -> Prompt {
    Prompt {
        text: text.into(),
        images: vec![],
        references: vec![],
        selection: None,
    }
}

fn note(root: &Path, agent: &str) -> Session {
    Session::open(root.join(agent)).unwrap()
}

fn file(file_id: i64, path: &str, content: &str, open: bool) -> Editable {
    Editable {
        file_id,
        path: path.into(),
        content: content.into(),
        open,
    }
}

fn cheapest(agent: &str) -> Vec<(String, String)> {
    match agent {
        "claude-acp" => vec![("model".into(), "haiku".into())],
        _ => vec![],
    }
}

struct Ran {
    answer: Answer,
    error: Option<String>,
    session_id: Option<String>,
    requested: Requested,
    outcome: Outcome,
}

impl Ran {
    fn text(&self) -> String {
        self.answer
            .parts()
            .iter()
            .filter_map(|part| match part {
                Part::Text { text } => Some(text.as_str()),
                _ => None,
            })
            .collect()
    }
}

fn ask(
    runtime: &AgentRuntime,
    agent: &str,
    session: Session,
    content: Option<&str>,
    prompt: Prompt,
    resume: Option<String>,
) -> Ran {
    let editable = content
        .map(|content| vec![file(1, "/library/note.md", content, true)])
        .unwrap_or_default();
    ask_editing(runtime, agent, &session, editable, prompt, resume)
}

fn ask_editing(
    runtime: &AgentRuntime,
    agent: &str,
    session: &Session,
    editable: Vec<Editable>,
    prompt: Prompt,
    resume: Option<String>,
) -> Ran {
    let catalog = Catalog::new(std::env::temp_dir().join("another-dev-tool-live-agents"));
    let pinned = Pinned {
        agent: agent.into(),
        launch: catalog.launch(agent).unwrap(),
        resume,
    };
    let turn = turn(pinned, session, &editable, prompt, cheapest(agent));
    let control = runtime.claim(session, editable).unwrap();
    let mut answer = Answer::default();
    let mut now = 0;
    let ended = acp::run(turn, &control, &mut |event| {
        now += 1;
        answer.apply(event, now);
    });
    Ran {
        answer,
        error: ended.error,
        session_id: ended.session_id,
        requested: ended.requested,
        outcome: runtime.finish(),
    }
}

#[test]
#[ignore = "spawns real ACP agents on the user's own logins"]
fn edits_the_scratch_copy_and_hands_the_result_back() {
    let root = tempfile::tempdir().unwrap();
    for agent in AGENTS {
        let ran = ask(
            &AgentRuntime::default(),
            agent,
            note(root.path(), agent),
            Some("# Titre\n\nBonjour.\n"),
            prompt("Replace Bonjour with Salut"),
            None,
        );

        assert_eq!(ran.error, None, "{agent}");
        assert!(!ran.text().is_empty(), "{agent}: no token ever streamed");
        let proposal = ran
            .outcome
            .proposals
            .first()
            .map(|proposal| proposal.after.clone())
            .unwrap_or_default();
        assert!(proposal.contains("Salut"), "{agent}: {proposal}");
    }
}

#[test]
#[ignore = "spawns real ACP agents on the user's own logins"]
fn edits_an_attached_file_beside_the_open_one_and_proposes_each() {
    let root = tempfile::tempdir().unwrap();
    for agent in AGENTS {
        let session = note(root.path(), agent);
        let ran = ask_editing(
            &AgentRuntime::default(),
            agent,
            &session,
            vec![
                file(1, "/library/AGENTS.md", "# Agents\n\n- Rule: KESTREL\n", true),
                file(2, "/library/skills/quality/SKILL.md", "# Quality\n", false),
            ],
            prompt("Move the KESTREL rule line from AGENTS.md to the end of SKILL.md"),
            None,
        );

        assert_eq!(ran.error, None, "{agent}");
        let changed: Vec<_> = ran.outcome.proposals.iter().map(|p| p.file_id).collect();
        assert_eq!(changed, [1, 2], "{agent}: {:?}", ran.outcome.proposals);
        assert!(ran.outcome.proposals[1].after.contains("KESTREL"), "{agent}");
        assert!(!ran.outcome.proposals[0].after.contains("KESTREL"), "{agent}");
    }
}

#[test]
#[ignore = "spawns real ACP agents on the user's own logins"]
fn answers_without_the_file_and_proposes_nothing() {
    let root = tempfile::tempdir().unwrap();
    for agent in AGENTS {
        let runtime = AgentRuntime::default();
        let first = ask(
            &runtime,
            agent,
            note(root.path(), agent),
            Some("# Note\n"),
            prompt("Reply with only OK"),
            None,
        );

        let ran = ask(
            &runtime,
            agent,
            note(root.path(), agent),
            None,
            prompt("Create a file named note.md containing hello, then reply with only DONE"),
            first.session_id,
        );

        assert_eq!(ran.error, None, "{agent}");
        assert!(!ran.text().is_empty(), "{agent}: no answer streamed");
        assert!(ran.outcome.proposals.is_empty(), "{agent}");
    }
}

#[test]
#[ignore = "spawns real ACP agents on the user's own logins"]
fn reads_a_reference_reached_through_a_symlink() {
    let root = tempfile::tempdir().unwrap();
    let skill = root.path().join("skill");
    fs::create_dir(&skill).unwrap();
    fs::write(skill.join("SKILL.md"), "Secret word: PELICAN-42\n").unwrap();
    let linked = root.path().join("linked");
    std::os::unix::fs::symlink(&skill, &linked).unwrap();
    for agent in AGENTS {
        let ran = ask(
            &AgentRuntime::default(),
            agent,
            note(root.path(), agent),
            Some("# Note\n"),
            Prompt {
                references: vec![linked.clone()],
                ..prompt("Read SKILL.md in the reference and reply with only its secret word")
            },
            None,
        );

        assert!(ran.text().contains("PELICAN-42"), "{agent}: {}", ran.text());
    }
}

#[test]
#[ignore = "spawns real ACP agents on the user's own logins"]
fn picks_a_conversation_back_up_after_a_restart() {
    let root = tempfile::tempdir().unwrap();
    for agent in AGENTS {
        let before = ask(
            &AgentRuntime::default(),
            agent,
            note(root.path(), agent),
            Some("# Note\n"),
            prompt("Remember the word HERON-7. Reply with only OK"),
            None,
        );
        assert!(before.session_id.is_some(), "{agent}");

        let after = ask(
            &AgentRuntime::default(),
            agent,
            note(root.path(), agent),
            Some("# Note\n"),
            prompt("Which word did I ask you to remember? Reply with only that word"),
            before.session_id,
        );

        assert!(
            after.text().contains("HERON-7"),
            "{agent}: {}",
            after.text()
        );
    }
}

#[test]
#[ignore = "spawns real ACP agents on the user's own logins"]
fn carries_on_a_conversation_the_claude_cli_started() {
    let root = tempfile::tempdir().unwrap();
    let session = note(root.path(), "claude-cli");
    let id = uuid::Uuid::new_v4().to_string();
    let started = std::process::Command::new(crate::agent::cli::resolve("claude").unwrap())
        .current_dir(session.dir())
        .args(["-p", "--model", "haiku", "--session-id", &id])
        .arg("Remember the word HERON-7. Reply with only OK")
        .output()
        .unwrap();
    assert!(
        started.status.success(),
        "{}",
        String::from_utf8_lossy(&started.stderr)
    );

    let after = ask(
        &AgentRuntime::default(),
        "claude-acp",
        session,
        Some("# Note\n"),
        prompt("Which word did I ask you to remember? Reply with only that word"),
        Some(id),
    );

    assert!(after.text().contains("HERON-7"), "{}", after.text());
}

#[test]
#[ignore = "spawns real ACP agents on the user's own logins"]
fn reading_the_file_streams_a_finished_tool_step_and_names_the_model() {
    let root = tempfile::tempdir().unwrap();
    for agent in AGENTS {
        let ran = ask(
            &AgentRuntime::default(),
            agent,
            note(root.path(), agent),
            Some("# Note\n\nSecret: OSPREY-9\n"),
            prompt("Read note.md with a tool, then reply with only its secret"),
            None,
        );

        let finished = ran.answer.parts().iter().any(|part| {
            matches!(
                part,
                Part::Tool {
                    state: ToolState::Done,
                    title: Some(_),
                    ..
                }
            )
        });
        assert!(finished, "{agent}: {:?}", ran.answer.parts());
        assert!(ran.text().contains("OSPREY-9"), "{agent}: {}", ran.text());
        let meta = ran.answer.meta(ran.requested);
        assert_ne!(meta.requested_model, "", "{agent}");
        assert!(meta.duration_ms.is_some(), "{agent}");
    }
}
