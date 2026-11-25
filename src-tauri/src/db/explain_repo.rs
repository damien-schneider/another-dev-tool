use rusqlite::{Connection, OptionalExtension as _};
use serde::Serialize;

use crate::agent::{AnswerMeta, Part};
use crate::db::agent_repo::{from_json, to_json, ConversationSummary, Role};
use crate::error::AppResult;

const RECENT_PROJECTS: i64 = 12;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Conversation {
    pub project_dir: String,
    pub started: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StoredMessage {
    pub id: i64,
    pub role: Role,
    pub text: String,
    pub parts: Vec<Part>,
    pub meta: Option<AnswerMeta>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecentProject {
    pub path: String,
    pub updated_at: i64,
}

pub fn insert(
    conn: &Connection,
    id: &str,
    project_dir: &str,
    title: &str,
    now: i64,
) -> AppResult<()> {
    conn.execute(
        "INSERT INTO explain_conversations (id, project_dir, title, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?4)",
        (id, project_dir, title, now),
    )?;
    Ok(())
}

pub fn get(conn: &Connection, id: &str) -> AppResult<Option<Conversation>> {
    Ok(conn
        .query_row(
            "SELECT project_dir, started FROM explain_conversations WHERE id = ?1",
            [id],
            |row| {
                Ok(Conversation {
                    project_dir: row.get(0)?,
                    started: row.get(1)?,
                })
            },
        )
        .optional()?)
}

pub fn list(conn: &Connection, project_dir: &str) -> AppResult<Vec<ConversationSummary>> {
    let mut stmt = conn.prepare(
        "SELECT id, title, updated_at FROM explain_conversations
         WHERE project_dir = ?1 ORDER BY updated_at DESC, created_at DESC",
    )?;
    let rows = stmt
        .query_map([project_dir], |row| {
            Ok(ConversationSummary {
                id: row.get(0)?,
                title: row.get(1)?,
                updated_at: row.get(2)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn recent_projects(conn: &Connection) -> AppResult<Vec<RecentProject>> {
    let mut stmt = conn.prepare(
        "SELECT project_dir, MAX(updated_at) AS last FROM explain_conversations
         GROUP BY project_dir ORDER BY last DESC LIMIT ?1",
    )?;
    let rows = stmt
        .query_map([RECENT_PROJECTS], |row| {
            Ok(RecentProject {
                path: row.get(0)?,
                updated_at: row.get(1)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn mark_started(conn: &Connection, id: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE explain_conversations SET started = 1 WHERE id = ?1",
        [id],
    )?;
    Ok(())
}

pub fn add_message(
    conn: &Connection,
    conversation_id: &str,
    role: Role,
    text: &str,
    answer: Option<(&[Part], &AnswerMeta)>,
    now: i64,
) -> AppResult<i64> {
    let parts = answer.map_or(Ok("[]".to_string()), |(parts, _)| to_json(&parts))?;
    let meta = answer.map(|(_, meta)| to_json(meta)).transpose()?;
    conn.execute(
        "INSERT INTO explain_messages (conversation_id, role, text, parts, meta, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        (conversation_id, role.as_str(), text, parts, meta, now),
    )?;
    let id = conn.last_insert_rowid();
    conn.execute(
        "UPDATE explain_conversations SET updated_at = ?2 WHERE id = ?1",
        (conversation_id, now),
    )?;
    Ok(id)
}

pub fn messages(conn: &Connection, conversation_id: &str) -> AppResult<Vec<StoredMessage>> {
    let mut stmt = conn.prepare(
        "SELECT id, role, text, parts, meta FROM explain_messages
         WHERE conversation_id = ?1 ORDER BY id",
    )?;
    let rows = stmt
        .query_map([conversation_id], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    rows.into_iter()
        .map(|(id, role, text, parts, meta)| {
            Ok(StoredMessage {
                id,
                role: Role::from_stored(&role),
                text,
                parts: from_json(&parts)?,
                meta: meta.as_deref().map(from_json).transpose()?,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    fn meta() -> AnswerMeta {
        AnswerMeta {
            model: None,
            requested_model: "sonnet".into(),
            effort: Some("medium".into()),
            duration_ms: Some(1200),
        }
    }

    #[test]
    fn a_conversation_reads_back_its_question_and_answer_in_order() {
        let db = Db::open_in_memory().unwrap();
        let parts = [Part::Text {
            text: "It walks the roots.".into(),
        }];

        let stored = db
            .with_conn(|conn| {
                insert(conn, "c", "/p", "How does scanning work?", 1)?;
                add_message(conn, "c", Role::You, "How does scanning work?", None, 2)?;
                add_message(
                    conn,
                    "c",
                    Role::Agent,
                    "It walks the roots.",
                    Some((&parts, &meta())),
                    3,
                )?;
                messages(conn, "c")
            })
            .unwrap();

        assert_eq!(stored.len(), 2);
        assert_eq!(stored[0].role, Role::You);
        assert!(stored[0].parts.is_empty());
        assert_eq!(stored[1].parts, parts);
        assert_eq!(stored[1].meta, Some(meta()));
    }

    #[test]
    fn a_project_lists_only_its_own_conversations_latest_first() {
        let db = Db::open_in_memory().unwrap();

        let listed = db
            .with_conn(|conn| {
                insert(conn, "old", "/p", "Old", 1)?;
                insert(conn, "new", "/p", "New", 5)?;
                insert(conn, "other", "/q", "Other", 9)?;
                list(conn, "/p")
            })
            .unwrap();

        let ids: Vec<_> = listed.iter().map(|summary| summary.id.as_str()).collect();
        assert_eq!(ids, ["new", "old"]);
    }

    #[test]
    fn recent_projects_are_ordered_by_their_latest_conversation() {
        let db = Db::open_in_memory().unwrap();

        let recent = db
            .with_conn(|conn| {
                insert(conn, "a", "/p", "A", 1)?;
                insert(conn, "b", "/q", "B", 2)?;
                add_message(conn, "a", Role::You, "Again", None, 7)?;
                recent_projects(conn)
            })
            .unwrap();

        let paths: Vec<_> = recent.iter().map(|project| project.path.as_str()).collect();
        assert_eq!(paths, ["/p", "/q"]);
        assert_eq!(recent[0].updated_at, 7);
    }
}
