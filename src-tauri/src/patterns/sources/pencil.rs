use std::path::Path;

use serde_json::Value;

use super::{non_empty, open_read_only, Agent, SourceError, UserPrompt};

const GENERATED_PREFIXES: [&str; 2] = ["You are coordinating ", "Iterating more on the design"];
const NODE_REFERENCE: &str = "@{";

const PROMPTS: &str = "
SELECT m.conversation_id, c.starting_file,
  json_extract(m.data, '$.createdAt'), json_extract(m.data, '$.displayText'), json_extract(m.data, '$.text')
FROM messages AS m
LEFT JOIN conversations AS c ON c.id = m.conversation_id
WHERE json_valid(m.data) AND json_extract(m.data, '$.role') = 'user'";

pub(super) fn read(home: &Path) -> Result<Vec<UserPrompt>, SourceError> {
    let path = home.join(".pencil").join("conversations.db");
    if !path.is_file() {
        return Ok(Vec::new());
    }
    let connection = open_read_only(&path)?;
    let mut statement = connection.prepare(PROMPTS)?;
    let rows = statement.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, Option<String>>(1)?,
            row.get::<_, Option<i64>>(2)?,
            non_empty(row.get(3)?).or(row.get(4)?),
        ))
    })?;
    let mut prompts = Vec::new();
    for row in rows {
        let (conversation, starting_file, at_ms, text) = row?;
        let (Some(at_ms), Some(text)) = (at_ms, text) else {
            continue;
        };
        let text = without_node_references(&text);
        let text = text.trim();
        if text.is_empty()
            || GENERATED_PREFIXES
                .iter()
                .any(|prefix| text.starts_with(prefix))
        {
            continue;
        }
        prompts.push(UserPrompt {
            agent: Agent::Pencil,
            session: conversation,
            project: starting_file.as_deref().and_then(project_dir),
            at_ms,
            text: text.to_owned(),
        });
    }
    Ok(prompts)
}

fn project_dir(starting_file: &str) -> Option<String> {
    let path = Path::new(
        starting_file
            .strip_prefix("file://")
            .unwrap_or(starting_file),
    );
    non_empty(path.parent()?.to_str().map(str::to_owned))
}

fn without_node_references(text: &str) -> String {
    let mut kept = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find(NODE_REFERENCE) {
        let candidate = &rest[start + 1..];
        let mut values = serde_json::Deserializer::from_str(candidate).into_iter::<Value>();
        let is_nodes = matches!(values.next(), Some(Ok(value)) if value["type"] == "nodes");
        if is_nodes {
            kept.push_str(&rest[..start]);
            rest = &candidate[values.byte_offset()..];
        } else {
            kept.push_str(&rest[..start + NODE_REFERENCE.len()]);
            rest = &rest[start + NODE_REFERENCE.len()..];
        }
    }
    kept.push_str(rest);
    kept
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::{params, Connection};
    use serde_json::json;

    fn fixture(messages: &[Value]) -> tempfile::TempDir {
        let home = tempfile::tempdir().unwrap();
        let dir = home.path().join(".pencil");
        std::fs::create_dir_all(&dir).unwrap();
        let db = Connection::open(dir.join("conversations.db")).unwrap();
        db.execute_batch(
            "CREATE TABLE conversations (id TEXT, starting_file TEXT);
             CREATE TABLE messages (conversation_id TEXT, data TEXT);
             INSERT INTO conversations VALUES ('c1', 'file:///Users/d/Designs/app.pen');",
        )
        .unwrap();
        for message in messages {
            db.execute(
                "INSERT INTO messages VALUES ('c1', ?1)",
                params![message.to_string()],
            )
            .unwrap();
        }
        home
    }

    fn texts(home: &Path) -> Vec<String> {
        read(home).unwrap().into_iter().map(|p| p.text).collect()
    }

    #[test]
    fn reads_a_user_message_with_its_conversation_design_folder_and_time() {
        let home = fixture(&[
            json!({"role": "user", "text": "make it less boxy", "createdAt": 1_794_256_895_202_i64}),
        ]);

        assert_eq!(
            read(home.path()).unwrap(),
            vec![UserPrompt {
                agent: Agent::Pencil,
                session: "c1".into(),
                project: Some("/Users/d/Designs".into()),
                at_ms: 1_794_256_895_202,
                text: "make it less boxy".into(),
            }]
        );
    }

    #[test]
    fn prefers_the_display_text_over_the_generated_orchestration_prompt() {
        let home = fixture(&[json!({
            "role": "user",
            "displayText": "a concept with a fake UI",
            "text": "You are coordinating 3 independent side-by-side designs\n\nTask:\na concept with a fake UI",
            "createdAt": 1,
        })]);

        assert_eq!(texts(home.path()), vec!["a concept with a fake UI"]);
    }

    #[test]
    fn removes_inline_design_node_references() {
        let home = fixture(&[json!({
            "role": "user",
            "text": "@{\"type\":\"nodes\",\"nodes\":[{\"path\":\"OyLKd\",\"label\":\"Form {x}\",\"icon\":\"frame\"}]}same here, and @{\"type\":\"nodes\",\"nodes\":[]} too; mail me@{home}",
            "createdAt": 1,
        })]);

        assert_eq!(
            texts(home.path()),
            vec!["same here, and  too; mail me@{home}"]
        );
    }

    #[test]
    fn drops_assistant_tool_system_generated_and_reference_only_messages() {
        let home = fixture(&[
            json!({"role": "assistant", "text": "Done", "createdAt": 1}),
            json!({"role": "tool", "toolUse": {}, "createdAt": 1}),
            json!({"role": "system", "text": "", "createdAt": 1}),
            json!({"role": "user", "text": "You are coordinating 2 independent side-by-side designs", "createdAt": 1}),
            json!({"role": "user", "displayText": "Iterating more on the design…", "text": "Now design another variation", "createdAt": 1}),
            json!({"role": "user", "text": "@{\"type\":\"nodes\",\"nodes\":[]}", "createdAt": 1}),
        ]);

        assert!(texts(home.path()).is_empty());
    }
}
