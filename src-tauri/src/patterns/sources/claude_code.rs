use std::collections::HashSet;
use std::fs::{self, File};
use std::io::{BufRead, BufReader};
use std::path::Path;

use serde::Deserialize;

use super::{non_empty, parse_iso_ms, Agent, SourceError, UserPrompt};

const EXCLUDED_PROJECT_DIRS: [&str; 6] = [
    "-private-var-folders",
    "-private-tmp",
    "adt-ref-probe",
    "agent-conversations",
    "symprobe",
    "slackread",
];
const SCRIPTED_ENTRYPOINTS: [&str; 2] = ["sdk-ts", "sdk-cli"];

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Record {
    #[serde(rename = "type")]
    kind: String,
    uuid: Option<String>,
    session_id: Option<String>,
    cwd: Option<String>,
    timestamp: Option<String>,
    origin: Option<Origin>,
    prompt_source: Option<String>,
    entrypoint: Option<String>,
    #[serde(default)]
    is_meta: bool,
    #[serde(default)]
    is_sidechain: bool,
    #[serde(default)]
    is_compact_summary: bool,
    message: Option<Message>,
}

#[derive(Deserialize)]
struct Origin {
    kind: String,
}

#[derive(Deserialize)]
struct Message {
    content: Content,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum Content {
    Text(String),
    Blocks(Vec<Block>),
}

#[derive(Deserialize)]
struct Block {
    #[serde(rename = "type")]
    kind: String,
    text: Option<String>,
}

pub(super) fn read(home: &Path) -> Result<Vec<UserPrompt>, SourceError> {
    let projects = home.join(".claude").join("projects");
    if !projects.is_dir() {
        return Ok(Vec::new());
    }
    let mut seen = HashSet::new();
    let mut prompts = Vec::new();
    for project in fs::read_dir(projects)? {
        let project = project?.path();
        let excluded = project
            .file_name()
            .and_then(|name| name.to_str())
            .is_none_or(|name| EXCLUDED_PROJECT_DIRS.iter().any(|part| name.contains(part)));
        if excluded || !project.is_dir() {
            continue;
        }
        for entry in fs::read_dir(&project)? {
            let path = entry?.path();
            if path.is_file() && path.extension().is_some_and(|ext| ext == "jsonl") {
                read_transcript(&path, &mut seen, &mut prompts)?;
            }
        }
    }
    Ok(prompts)
}

fn read_transcript(
    path: &Path,
    seen: &mut HashSet<String>,
    prompts: &mut Vec<UserPrompt>,
) -> Result<(), SourceError> {
    let mut reader = BufReader::new(File::open(path)?);
    let mut line = Vec::new();
    loop {
        line.clear();
        if reader.read_until(b'\n', &mut line)? == 0 {
            return Ok(());
        }
        let Ok(text) = std::str::from_utf8(&line) else {
            continue;
        };
        if !may_be_human_prompt(text) {
            continue;
        }
        let Ok(record) = serde_json::from_str::<Record>(text) else {
            continue;
        };
        if let Some(uuid) = &record.uuid {
            if !seen.insert(uuid.clone()) {
                continue;
            }
        }
        if let Some(prompt) = human_prompt(record) {
            prompts.push(prompt);
        }
    }
}

fn may_be_human_prompt(line: &str) -> bool {
    line.contains(r#""type":"user""#)
        && (line.contains(r#""kind":"human""#)
            || line.contains(r#""promptSource":"typed""#)
            || line.contains(r#""promptSource":"sdk""#))
}

fn human_prompt(record: Record) -> Option<UserPrompt> {
    let typed = match &record.origin {
        Some(origin) => origin.kind == "human",
        None => matches!(record.prompt_source.as_deref(), Some("typed" | "sdk")) && !record.is_meta,
    };
    let scripted = record
        .entrypoint
        .as_deref()
        .is_some_and(|entrypoint| SCRIPTED_ENTRYPOINTS.contains(&entrypoint));
    if record.kind != "user"
        || !typed
        || scripted
        || record.is_sidechain
        || record.is_compact_summary
    {
        return None;
    }
    let text = match record.message?.content {
        Content::Text(text) => text,
        Content::Blocks(blocks) => {
            if blocks.iter().any(|block| block.kind == "tool_result") {
                return None;
            }
            let texts: Vec<String> = blocks
                .into_iter()
                .filter(|block| block.kind == "text")
                .filter_map(|block| block.text)
                .collect();
            texts.join("\n")
        }
    };
    let text = text.trim();
    if text.is_empty()
        || text.contains("<command-name>")
        || text.starts_with("<local-command-")
        || text.starts_with("[Request interrupted")
    {
        return None;
    }
    Some(UserPrompt {
        agent: Agent::ClaudeCode,
        session: record.session_id?,
        project: non_empty(record.cwd),
        at_ms: parse_iso_ms(record.timestamp.as_deref()?)?,
        text: text.to_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    fn human(uuid: &str, text: Value) -> Value {
        json!({
            "type": "user",
            "uuid": uuid,
            "sessionId": "s1",
            "cwd": "/repo",
            "timestamp": "2026-11-09T19:11:14.897Z",
            "origin": {"kind": "human"},
            "entrypoint": "claude-desktop",
            "message": {"role": "user", "content": text},
        })
    }

    fn with(mut record: Value, key: &str, value: Value) -> Value {
        record[key] = value;
        record
    }

    fn write_project(home: &Path, dir: &str, file: &str, records: &[Value]) {
        let project = home.join(".claude/projects").join(dir);
        fs::create_dir_all(&project).unwrap();
        let lines: Vec<String> = records.iter().map(Value::to_string).collect();
        fs::write(project.join(file), lines.join("\n")).unwrap();
    }

    fn texts(home: &Path) -> Vec<String> {
        let mut texts: Vec<String> = read(home).unwrap().into_iter().map(|p| p.text).collect();
        texts.sort();
        texts
    }

    #[test]
    fn reads_a_typed_prompt_with_its_session_project_and_time() {
        let home = tempfile::tempdir().unwrap();
        write_project(
            home.path(),
            "-repo",
            "s1.jsonl",
            &[human("u1", json!("  give me the PR link \n"))],
        );

        assert_eq!(
            read(home.path()).unwrap(),
            vec![UserPrompt {
                agent: Agent::ClaudeCode,
                session: "s1".into(),
                project: Some("/repo".into()),
                at_ms: 1_794_251_474_897,
                text: "give me the PR link".into(),
            }]
        );
    }

    #[test]
    fn joins_text_blocks_and_accepts_older_typed_records_without_origin() {
        let home = tempfile::tempdir().unwrap();
        let mut older = human("u2", json!("older prompt"));
        older.as_object_mut().unwrap().remove("origin");
        write_project(
            home.path(),
            "-repo",
            "s1.jsonl",
            &[
                human(
                    "u1",
                    json!([{"type": "text", "text": "look"}, {"type": "image", "source": {"data": "iVBOR"}}, {"type": "text", "text": "here"}]),
                ),
                with(older, "promptSource", json!("typed")),
            ],
        );

        assert_eq!(texts(home.path()), vec!["look\nhere", "older prompt"]);
    }

    #[test]
    fn drops_tool_results_commands_interruptions_meta_sidechain_and_compaction_records() {
        let home = tempfile::tempdir().unwrap();
        let mut meta = human("u7", json!("Base directory for this skill: /x"));
        meta.as_object_mut().unwrap().remove("origin");
        let meta = with(
            with(meta, "promptSource", json!("sdk")),
            "isMeta",
            json!(true),
        );
        write_project(
            home.path(),
            "-repo",
            "s1.jsonl",
            &[
                human("u1", json!([{"type": "tool_result", "tool_use_id": "t", "content": "ok"}])),
                human("u2", json!("<command-message>clear</command-message>\n<command-name>/clear</command-name>")),
                human("u3", json!("<local-command-stdout>done</local-command-stdout>")),
                human("u4", json!("[Request interrupted by user]")),
                with(human("u5", json!("subagent task")), "isSidechain", json!(true)),
                with(human("u6", json!("This session is being continued")), "isCompactSummary", json!(true)),
                meta,
                with(human("u8", json!("<task-notification>")), "origin", json!({"kind": "task-notification"})),
                human("u9", json!("kept")),
            ],
        );

        assert_eq!(texts(home.path()), vec!["kept"]);
    }

    #[test]
    fn drops_scripted_entrypoints_and_machine_project_dirs() {
        let home = tempfile::tempdir().unwrap();
        write_project(
            home.path(),
            "-repo",
            "s1.jsonl",
            &[
                with(
                    human("u1", json!("pencil orchestration")),
                    "entrypoint",
                    json!("sdk-ts"),
                ),
                with(
                    human("u2", json!("claude -p script")),
                    "entrypoint",
                    json!("sdk-cli"),
                ),
                human("u3", json!("kept")),
            ],
        );
        for dir in [
            "-private-var-folders-79-T-tmp1",
            "-private-tmp-x",
            "-Users-d-adt-ref-probe-1",
            "-Users-d-Library-dev-agent-conversations-3-scratch",
            "-Users-d-symprobe",
            "-Users-d-slackread",
        ] {
            write_project(
                home.path(),
                dir,
                "s2.jsonl",
                &[human(dir, json!("machine"))],
            );
        }

        assert_eq!(texts(home.path()), vec!["kept"]);
    }

    #[test]
    fn reads_the_same_record_once_when_a_session_appears_in_two_project_dirs() {
        let home = tempfile::tempdir().unwrap();
        write_project(
            home.path(),
            "-repo",
            "s1.jsonl",
            &[human("u1", json!("once"))],
        );
        write_project(
            home.path(),
            "-repo-repo",
            "s1.jsonl",
            &[human("u1", json!("once"))],
        );

        assert_eq!(texts(home.path()), vec!["once"]);
    }

    #[test]
    fn ignores_subagent_transcripts() {
        let home = tempfile::tempdir().unwrap();
        write_project(
            home.path(),
            "-repo/s1/subagents",
            "agent-a.jsonl",
            &[human("u1", json!("delegated"))],
        );

        assert!(texts(home.path()).is_empty());
    }
}
