use std::path::Path;

use super::{non_empty, open_read_only, Agent, SourceError, UserPrompt};

pub(super) fn read(home: &Path) -> Result<Vec<UserPrompt>, SourceError> {
    let path = home.join(".omp").join("agent").join("transcripts.db");
    if !path.is_file() {
        return Ok(Vec::new());
    }
    let connection = open_read_only(&path)?;
    let mut statement = connection.prepare(
        "SELECT files.session_id, files.cwd, messages.at, messages.text
         FROM messages JOIN files ON files.id = messages.file
         WHERE messages.role = 'user'",
    )?;
    let rows = statement.query_map([], |row| {
        Ok(UserPrompt {
            agent: Agent::Omp,
            session: row.get(0)?,
            project: non_empty(row.get(1)?),
            at_ms: row.get(2)?,
            text: row.get::<_, String>(3)?.trim().to_owned(),
        })
    })?;
    let prompts = rows.collect::<Result<Vec<_>, _>>()?;
    Ok(prompts
        .into_iter()
        .filter(|prompt| !prompt.text.is_empty())
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    #[test]
    fn reads_user_messages_with_their_session_project_and_time_and_skips_assistant_ones() {
        let home = tempfile::tempdir().unwrap();
        let dir = home.path().join(".omp/agent");
        std::fs::create_dir_all(&dir).unwrap();
        Connection::open(dir.join("transcripts.db"))
            .unwrap()
            .execute_batch(
                "CREATE TABLE files (id INTEGER PRIMARY KEY, session_id TEXT, cwd TEXT);
                 CREATE TABLE messages (id INTEGER PRIMARY KEY, file INTEGER, role TEXT, at INTEGER, text TEXT);
                 INSERT INTO files VALUES (1, 'sess-1', '/repo');
                 INSERT INTO messages VALUES (1, 1, 'user', 1794000000000, ' always update the dev app ');
                 INSERT INTO messages VALUES (2, 1, 'assistant', 1794000000001, 'Done.');",
            )
            .unwrap();

        assert_eq!(
            read(home.path()).unwrap(),
            vec![UserPrompt {
                agent: Agent::Omp,
                session: "sess-1".into(),
                project: Some("/repo".into()),
                at_ms: 1_794_000_000_000,
                text: "always update the dev app".into(),
            }]
        );
    }
}
