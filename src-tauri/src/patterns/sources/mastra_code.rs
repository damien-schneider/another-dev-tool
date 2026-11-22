use std::path::Path;

use super::{non_empty, open_read_only, parse_iso_ms, Agent, SourceError, UserPrompt};

const PROMPTS: &str = "
SELECT m.thread_id, m.createdAt,
  CASE WHEN json_valid(t.metadata, 9) THEN json_extract(t.metadata, '$.projectPath') END,
  (SELECT group_concat(json_extract(part.value, '$.text'), char(10))
     FROM json_each(m.content, '$.parts') AS part
     WHERE json_extract(part.value, '$.type') = 'text')
FROM mastra_messages AS m
LEFT JOIN mastra_threads AS t ON t.id = m.thread_id
WHERE m.role = 'signal' AND m.type = 'user' AND json_valid(m.content)";

pub(super) fn read(home: &Path) -> Result<Vec<UserPrompt>, SourceError> {
    let path = home.join("Library/Application Support/mastracode/mastra.db");
    if !path.is_file() {
        return Ok(Vec::new());
    }
    let connection = open_read_only(&path)?;
    let mut statement = connection.prepare(PROMPTS)?;
    let rows = statement.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, Option<String>>(2)?,
            row.get::<_, Option<String>>(3)?,
        ))
    })?;
    let mut prompts = Vec::new();
    for row in rows {
        let (thread, created_at, project, text) = row?;
        let (Some(at_ms), Some(text)) = (parse_iso_ms(&created_at), text) else {
            continue;
        };
        let text = text.trim();
        if text.is_empty() {
            continue;
        }
        prompts.push(UserPrompt {
            agent: Agent::MastraCode,
            session: thread,
            project: non_empty(project),
            at_ms,
            text: text.to_owned(),
        });
    }
    Ok(prompts)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::{params, Connection};
    use serde_json::json;

    fn fixture(messages: &[(&str, &str, String)]) -> tempfile::TempDir {
        let home = tempfile::tempdir().unwrap();
        let dir = home.path().join("Library/Application Support/mastracode");
        std::fs::create_dir_all(&dir).unwrap();
        let db = Connection::open(dir.join("mastra.db")).unwrap();
        db.execute_batch(
            r#"CREATE TABLE mastra_threads (id TEXT, metadata TEXT);
               CREATE TABLE mastra_messages (thread_id TEXT, content TEXT, role TEXT, type TEXT, createdAt TEXT);
               INSERT INTO mastra_threads VALUES ('th1', jsonb('{"projectPath":"/repo"}'));"#,
        )
        .unwrap();
        for (role, kind, content) in messages {
            db.execute(
                "INSERT INTO mastra_messages VALUES ('th1', ?1, ?2, ?3, '2026-11-12T06:44:25.576Z')",
                params![content, role, kind],
            )
            .unwrap();
        }
        home
    }

    fn content(parts: serde_json::Value) -> String {
        json!({"format": 2, "parts": parts, "metadata": {"signal": {"type": "user"}}}).to_string()
    }

    #[test]
    fn reads_a_user_signal_with_its_thread_project_and_time_joining_text_parts() {
        let home = fixture(&[(
            "signal",
            "user",
            content(json!([
                {"type": "text", "text": "push"},
                {"type": "file", "data": "iVBORw0", "mimeType": "image/png"},
                {"type": "text", "text": "please"}
            ])),
        )]);

        assert_eq!(
            read(home.path()).unwrap(),
            vec![UserPrompt {
                agent: Agent::MastraCode,
                session: "th1".into(),
                project: Some("/repo".into()),
                at_ms: 1_794_465_865_576,
                text: "push\nplease".into(),
            }]
        );
    }

    #[test]
    fn drops_reminder_signals_subagent_task_prompts_assistant_replies_and_image_only_prompts() {
        let home = fixture(&[
            (
                "signal",
                "system-reminder",
                content(json!([{"type": "text", "text": "10 minutes later"}])),
            ),
            (
                "signal",
                "task-list-update",
                content(json!([{"type": "text", "text": "tasks"}])),
            ),
            (
                "user",
                "v2",
                content(json!([{"type": "text", "text": "You are building PART A only"}])),
            ),
            (
                "assistant",
                "v2",
                content(json!([{"type": "text", "text": "Done"}])),
            ),
            (
                "signal",
                "user",
                content(json!([{"type": "file", "data": "iVBORw0", "mimeType": "image/png"}])),
            ),
        ]);

        assert!(read(home.path()).unwrap().is_empty());
    }
}
