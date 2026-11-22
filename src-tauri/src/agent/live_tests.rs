use std::fs;
use std::io::{BufRead as _, BufReader};
use std::path::Path;

use super::answer::ToolState;
use super::settings::{Effort, Model};
use super::{
    parse_line, AgentRuntime, Answer, Part, Prompt, RunHandle, RunSettings, Session, StreamEvent,
};

const SETTINGS: RunSettings = RunSettings {
    model: Model::Haiku,
    effort: Effort::Low,
};

fn prompt(text: &str) -> Prompt {
    Prompt {
        text: text.into(),
        images: vec![],
        references: vec![],
    }
}

fn note(id: &str, root: &Path, started: bool) -> Session {
    Session::open(id, root.join(id), "note.md", started).unwrap()
}

#[test]
#[ignore = "spawns the real Claude Code CLI"]
fn edits_the_scratch_copy_and_hands_the_result_back() {
    let root = tempfile::tempdir().unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    let runtime = AgentRuntime::default();

    let handle = runtime
        .start(
            note(&id, root.path(), false),
            Some("# Titre\n\nBonjour.\n"),
            prompt("Replace Bonjour with Salut"),
            SETTINGS,
        )
        .unwrap();
    let (streamed, finished) = streamed(handle);

    assert!(finished);
    assert!(!streamed.is_empty(), "no token ever streamed");
    assert!(runtime.finish(false).proposal.unwrap().contains("Salut"));
}

#[test]
#[ignore = "spawns the real Claude Code CLI"]
fn answers_without_the_file_and_proposes_nothing() {
    let root = tempfile::tempdir().unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    let runtime = AgentRuntime::default();
    runtime
        .start(
            note(&id, root.path(), false),
            Some("# Note\n"),
            prompt("Reply with only OK"),
            SETTINGS,
        )
        .map(streamed)
        .unwrap();
    let started = runtime.finish(false).started;

    let handle = runtime
        .start(
            note(&id, root.path(), started),
            None,
            prompt("Create a file named note.md containing hello, then reply with only DONE"),
            SETTINGS,
        )
        .unwrap();
    let (streamed, finished) = streamed(handle);

    assert!(finished);
    assert!(!streamed.is_empty(), "no answer streamed");
    assert!(runtime.finish(false).proposal.is_none());
}

#[test]
#[ignore = "spawns the real Claude Code CLI"]
fn reads_a_reference_reached_through_a_symlink() {
    let root = tempfile::tempdir().unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    let skill = root.path().join("skill");
    fs::create_dir(&skill).unwrap();
    fs::write(skill.join("SKILL.md"), "Secret word: PELICAN-42\n").unwrap();
    let linked = root.path().join("linked");
    std::os::unix::fs::symlink(&skill, &linked).unwrap();
    let runtime = AgentRuntime::default();

    let handle = runtime
        .start(
            note(&id, root.path(), false),
            Some("# Note\n"),
            Prompt {
                references: vec![linked],
                ..prompt("Read SKILL.md in the reference and reply with only its secret word")
            },
            SETTINGS,
        )
        .unwrap();
    let (streamed, _) = streamed(handle);
    runtime.finish(false);

    assert!(streamed.contains("PELICAN-42"), "streamed: {streamed}");
}

#[test]
#[ignore = "spawns the real Claude Code CLI"]
fn picks_a_conversation_back_up_after_a_restart() {
    let root = tempfile::tempdir().unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    let before = AgentRuntime::default();
    before
        .start(
            note(&id, root.path(), false),
            Some("# Note\n"),
            prompt("Remember the word HERON-7. Reply with only OK"),
            SETTINGS,
        )
        .map(streamed)
        .unwrap();
    assert!(before.finish(false).started);

    let after = AgentRuntime::default();
    let (streamed, _) = after
        .start(
            note(&id, root.path(), true),
            Some("# Note\n"),
            prompt("Which word did I ask you to remember? Reply with only that word"),
            SETTINGS,
        )
        .map(streamed)
        .unwrap();
    after.finish(false);

    assert!(streamed.contains("HERON-7"), "streamed: {streamed}");
}

#[test]
#[ignore = "spawns the real Claude Code CLI"]
fn reading_the_file_streams_a_finished_read_tool_part() {
    let root = tempfile::tempdir().unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    let runtime = AgentRuntime::default();

    let handle = runtime
        .start(
            note(&id, root.path(), false),
            Some("# Note\n\nSecret: OSPREY-9\n"),
            prompt("Use the Read tool to read note.md, then reply with only its secret"),
            SETTINGS,
        )
        .unwrap();
    let (answer, finished) = run(handle);
    runtime.finish(false);

    assert!(finished);
    let read = answer.parts().iter().find_map(|part| match part {
        Part::Tool {
            name, input, state, ..
        } if name == "Read" => Some((input.clone(), *state)),
        _ => None,
    });
    let (input, state) = read.unwrap_or_else(|| panic!("no Read part: {:?}", answer.parts()));
    assert_eq!(state, ToolState::Done);
    let path = input
        .as_ref()
        .and_then(|input| input["file_path"].as_str())
        .unwrap_or_default();
    assert!(path.ends_with("note.md"), "input: {input:?}");
    assert!(answer.meta(SETTINGS).model.is_some());
    assert!(answer.meta(SETTINGS).duration_ms.is_some());
}

fn run(handle: RunHandle) -> (Answer, bool) {
    let mut answer = Answer::default();
    let mut finished = false;
    for (now, event) in BufReader::new(handle.stdout)
        .lines()
        .map_while(Result::ok)
        .flat_map(|line| parse_line(&line))
        .enumerate()
    {
        if let StreamEvent::Finished { error, .. } = &event {
            finished = error.is_none();
        }
        answer.apply(event, now as u64);
    }
    (answer, finished)
}

fn streamed(handle: RunHandle) -> (String, bool) {
    let (answer, finished) = run(handle);
    let text = answer
        .parts()
        .iter()
        .filter_map(|part| match part {
            Part::Text { text } => Some(text.as_str()),
            _ => None,
        })
        .collect::<String>();
    (text, finished)
}
