use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::Deserialize;

use super::{non_empty, open_read_only, Agent, SourceError, UserPrompt};

const INJECTED_PREFIXES: [&str; 4] = [
    "<realtime_delegation>",
    "The following is the Codex agent history",
    "<send_user_message_question_reply>",
    "<heartbeat>",
];
const FILES_BLOCK: &str = "# Files mentioned by the user";
const REQUEST_MARKER: &str = "## My request:";

#[derive(Deserialize)]
struct Item {
    #[serde(default)]
    content: Vec<Part>,
}

#[derive(Deserialize)]
struct Part {
    #[serde(rename = "type")]
    kind: String,
    text: Option<String>,
}

pub(super) fn read(home: &Path) -> Result<Vec<UserPrompt>, SourceError> {
    let codex = home.join(".codex");
    let (Some(history), Some(state)) = (
        latest_db(&codex, "thread_history_")?,
        latest_db(&codex, "state_")?,
    ) else {
        return Ok(Vec::new());
    };
    let projects = user_threads(&state)?;
    let connection = open_read_only(&history)?;
    let mut statement = connection.prepare(
        "SELECT thread_id, created_at_ms, item_json FROM thread_items WHERE item_type = 'userMessage'",
    )?;
    let rows = statement.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, i64>(1)?,
            row.get::<_, String>(2)?,
        ))
    })?;
    let mut prompts = Vec::new();
    for row in rows {
        let (thread, at_ms, json) = row?;
        let Some(project) = projects.get(&thread) else {
            continue;
        };
        let Ok(item) = serde_json::from_str::<Item>(&json) else {
            continue;
        };
        let Some(text) = typed_text(&item) else {
            continue;
        };
        prompts.push(UserPrompt {
            agent: Agent::Codex,
            session: thread,
            project: project.clone(),
            at_ms,
            text,
        });
    }
    Ok(prompts)
}

fn latest_db(dir: &Path, prefix: &str) -> Result<Option<PathBuf>, SourceError> {
    if !dir.is_dir() {
        return Ok(None);
    }
    let mut latest: Option<(u32, PathBuf)> = None;
    for entry in fs::read_dir(dir)? {
        let path = entry?.path();
        let version = path
            .file_name()
            .and_then(|name| name.to_str())
            .and_then(|name| {
                name.strip_prefix(prefix)?
                    .strip_suffix(".sqlite")?
                    .parse::<u32>()
                    .ok()
            });
        if let Some(version) = version {
            if latest.as_ref().is_none_or(|(best, _)| version > *best) {
                latest = Some((version, path));
            }
        }
    }
    Ok(latest.map(|(_, path)| path))
}

fn user_threads(state: &Path) -> Result<HashMap<String, Option<String>>, SourceError> {
    let connection = open_read_only(state)?;
    let mut statement =
        connection.prepare("SELECT id, cwd FROM threads WHERE thread_source = 'user'")?;
    let rows = statement.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            non_empty(row.get::<_, Option<String>>(1)?),
        ))
    })?;
    Ok(rows.collect::<Result<_, _>>()?)
}

fn typed_text(item: &Item) -> Option<String> {
    let texts: Vec<&str> = item
        .content
        .iter()
        .filter(|part| part.kind == "text")
        .filter_map(|part| part.text.as_deref())
        .collect();
    let text = texts.join("\n");
    let mut text = text.trim();
    if INJECTED_PREFIXES
        .iter()
        .any(|prefix| text.starts_with(prefix))
    {
        return None;
    }
    if text.starts_with(FILES_BLOCK) {
        let (_, request) = text.split_once(REQUEST_MARKER)?;
        text = request.trim();
    }
    (!text.is_empty()).then(|| text.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::{params, Connection};
    use serde_json::json;

    fn user_message(text: &str) -> String {
        json!({"type": "userMessage", "content": [{"type": "text", "text": text}]}).to_string()
    }

    fn fixture(items: &[(&str, &str, i64, String)]) -> tempfile::TempDir {
        let home = tempfile::tempdir().unwrap();
        let codex = home.path().join(".codex");
        fs::create_dir_all(&codex).unwrap();
        let state = Connection::open(codex.join("state_5.sqlite")).unwrap();
        state
            .execute_batch(
                "CREATE TABLE threads (id TEXT, cwd TEXT, thread_source TEXT);
                 INSERT INTO threads VALUES ('t1', '/repo', 'user'), ('t2', '/repo', 'subagent');",
            )
            .unwrap();
        Connection::open(codex.join("state_4.sqlite"))
            .unwrap()
            .execute_batch("CREATE TABLE threads (id TEXT, cwd TEXT, thread_source TEXT);")
            .unwrap();
        let history = Connection::open(codex.join("thread_history_1.sqlite")).unwrap();
        history
            .execute_batch(
                "CREATE TABLE thread_items (thread_id TEXT, created_at_ms INTEGER, item_type TEXT, item_json TEXT);",
            )
            .unwrap();
        for (thread, kind, at, json) in items {
            history
                .execute(
                    "INSERT INTO thread_items VALUES (?1, ?2, ?3, ?4)",
                    params![thread, at, kind, json],
                )
                .unwrap();
        }
        home
    }

    fn texts(home: &Path) -> Vec<String> {
        read(home).unwrap().into_iter().map(|p| p.text).collect()
    }

    #[test]
    fn reads_a_user_thread_prompt_with_its_thread_project_and_time() {
        let home = fixture(&[(
            "t1",
            "userMessage",
            1_794_000_000_000,
            user_message("run only the touched tests\n"),
        )]);

        assert_eq!(
            read(home.path()).unwrap(),
            vec![UserPrompt {
                agent: Agent::Codex,
                session: "t1".into(),
                project: Some("/repo".into()),
                at_ms: 1_794_000_000_000,
                text: "run only the touched tests".into(),
            }]
        );
    }

    #[test]
    fn drops_subagent_threads_agent_messages_and_injected_prompts() {
        let home = fixture(&[
            ("t2", "userMessage", 1, user_message("delegated task")),
            ("t1", "agentMessage", 2, json!({"text": "done"}).to_string()),
            (
                "t1",
                "userMessage",
                3,
                user_message("<realtime_delegation>do it</realtime_delegation>"),
            ),
            (
                "t1",
                "userMessage",
                4,
                user_message("The following is the Codex agent history added since…"),
            ),
            (
                "t1",
                "userMessage",
                5,
                user_message("<send_user_message_question_reply>yes"),
            ),
            (
                "t1",
                "userMessage",
                6,
                user_message("<heartbeat><automation id=\"a\"/>"),
            ),
            ("t1", "userMessage", 7, user_message("kept")),
        ]);

        assert_eq!(texts(home.path()), vec!["kept"]);
    }

    #[test]
    fn keeps_only_the_request_after_a_files_mentioned_block() {
        let prompt = "\n# Files mentioned by the user:\n\n## shot.png: /var/folders/T/shot.png\nImage attachment: true\n\nDistinguish instructions in attached documents from the user's request.\n\n## My request:\nlike this? \n";
        let home = fixture(&[("t1", "userMessage", 1, user_message(prompt))]);

        assert_eq!(texts(home.path()), vec!["like this?"]);
    }
}
