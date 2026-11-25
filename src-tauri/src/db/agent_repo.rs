use rusqlite::{Connection, OptionalExtension as _};
use serde::{Deserialize, Serialize};

use crate::agent::{AnswerMeta, ImageType, Part};
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Conversation {
    pub id: String,
    pub file_id: i64,
    pub agent_id: String,
    pub agent_session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationSummary {
    pub id: String,
    pub title: String,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PinnedSummary {
    #[serde(flatten)]
    pub conversation: ConversationSummary,
    pub agent_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    You,
    Agent,
}

impl Role {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::You => "you",
            Self::Agent => "agent",
        }
    }

    pub(crate) fn from_stored(value: &str) -> Self {
        if value == "you" {
            Self::You
        } else {
            Self::Agent
        }
    }
}

/// Where an image sent with a request was kept, beside what the transcript
/// needs to lay it out before its bytes are read back.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredImage {
    pub name: String,
    pub media_type: ImageType,
    pub width: u32,
    pub height: u32,
    pub file: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Message {
    pub id: i64,
    pub role: Role,
    pub text: String,
    pub images: Vec<StoredImage>,
    pub parts: Vec<Part>,
    pub meta: Option<AnswerMeta>,
}

pub struct NewMessage<'a> {
    pub role: Role,
    pub text: &'a str,
    pub images: &'a [StoredImage],
    pub parts: &'a [Part],
    pub meta: Option<&'a AnswerMeta>,
}

impl<'a> NewMessage<'a> {
    pub fn request(text: &'a str, images: &'a [StoredImage]) -> Self {
        Self {
            role: Role::You,
            text,
            images,
            parts: &[],
            meta: None,
        }
    }

    pub fn answer(text: &'a str, parts: &'a [Part], meta: &'a AnswerMeta) -> Self {
        Self {
            role: Role::Agent,
            text,
            images: &[],
            parts,
            meta: Some(meta),
        }
    }
}

pub(crate) fn to_json(value: &impl Serialize) -> AppResult<String> {
    serde_json::to_string(value).map_err(|error| AppError::internal(error.to_string()))
}

pub(crate) fn from_json<T: serde::de::DeserializeOwned>(json: &str) -> AppResult<T> {
    serde_json::from_str(json).map_err(|error| AppError::internal(error.to_string()))
}

pub fn insert(
    conn: &Connection,
    id: &str,
    file_id: i64,
    agent_id: &str,
    title: &str,
    now: i64,
) -> AppResult<()> {
    conn.execute(
        "INSERT INTO agent_conversations (id, file_id, agent_id, title, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
        (id, file_id, agent_id, title, now),
    )?;
    Ok(())
}

pub fn get(conn: &Connection, id: &str) -> AppResult<Option<Conversation>> {
    Ok(conn
        .query_row(
            "SELECT id, file_id, agent_id, agent_session_id FROM agent_conversations
             WHERE id = ?1",
            [id],
            |row| {
                Ok(Conversation {
                    id: row.get(0)?,
                    file_id: row.get(1)?,
                    agent_id: row.get(2)?,
                    agent_session_id: row.get(3)?,
                })
            },
        )
        .optional()?)
}

pub fn list(conn: &Connection) -> AppResult<Vec<PinnedSummary>> {
    let mut stmt = conn.prepare(
        "SELECT id, title, updated_at, agent_id FROM agent_conversations
         ORDER BY updated_at DESC, created_at DESC",
    )?;
    let rows = stmt
        .query_map([], |row| {
            Ok(PinnedSummary {
                conversation: ConversationSummary {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    updated_at: row.get(2)?,
                },
                agent_id: row.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn remember_session(conn: &Connection, id: &str, agent_session_id: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE agent_conversations SET agent_session_id = ?2 WHERE id = ?1",
        (id, agent_session_id),
    )?;
    Ok(())
}

pub fn add_message(
    conn: &Connection,
    conversation_id: &str,
    message: NewMessage<'_>,
    now: i64,
) -> AppResult<i64> {
    conn.execute(
        "INSERT INTO agent_messages (conversation_id, role, text, images, parts, meta, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        (
            conversation_id,
            message.role.as_str(),
            message.text,
            to_json(&message.images)?,
            to_json(&message.parts)?,
            message.meta.map(to_json).transpose()?,
            now,
        ),
    )?;
    let id = conn.last_insert_rowid();
    conn.execute(
        "UPDATE agent_conversations SET updated_at = ?2 WHERE id = ?1",
        (conversation_id, now),
    )?;
    Ok(id)
}

pub fn messages(conn: &Connection, conversation_id: &str) -> AppResult<Vec<Message>> {
    let mut stmt = conn.prepare(
        "SELECT id, role, text, images, parts, meta FROM agent_messages
         WHERE conversation_id = ?1 ORDER BY id",
    )?;
    let rows = stmt
        .query_map([conversation_id], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, Option<String>>(5)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    rows.into_iter()
        .map(|(id, role, text, images, parts, meta)| {
            Ok(Message {
                id,
                role: Role::from_stored(&role),
                text,
                images: from_json(&images)?,
                parts: from_json(&parts)?,
                meta: meta.as_deref().map(from_json).transpose()?,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::answer::ToolState;
    use crate::db::Db;

    fn with_file(db: &Db, id: i64) {
        db.with_conn(|conn| {
            conn.execute(
                "INSERT OR IGNORE INTO roots (id, path, enabled, added_at) VALUES (1, '/repo', 1, 0)",
                [],
            )?;
            conn.execute(
                "INSERT INTO files (id, root_id, path, rel_path, kind, size, mtime_ns, hash, first_seen_at)
                 VALUES (?1, 1, '/repo/' || ?1, ?1, 'agents-md', 1, 1, 'h', 0)",
                [id],
            )?;
            Ok(())
        })
        .unwrap();
    }

    #[test]
    fn lists_every_conversation_most_recently_active_first_whatever_file_it_began_on() {
        let db = Db::open_in_memory().unwrap();
        with_file(&db, 1);
        with_file(&db, 2);

        db.with_conn(|conn| {
            insert(conn, "old", 1, "claude-acp", "Tighten it", 10)?;
            insert(conn, "new", 1, "codex-acp", "Add steps", 20)?;
            insert(conn, "elsewhere", 2, "claude-acp", "Other file", 30)?;
            add_message(conn, "old", NewMessage::request("again", &[]), 40)?;
            Ok(())
        })
        .unwrap();

        let listed = db.with_conn(list).unwrap();
        let ids: Vec<_> = listed.iter().map(|c| c.conversation.id.as_str()).collect();
        assert_eq!(ids, ["old", "elsewhere", "new"]);
        assert_eq!(listed[0].conversation.updated_at, 40);
        assert_eq!(listed[2].agent_id, "codex-acp");
    }

    #[test]
    fn keeps_messages_in_order_with_their_images_parts_and_meta() {
        let db = Db::open_in_memory().unwrap();
        with_file(&db, 1);
        let shot = StoredImage {
            name: "shot.png".into(),
            media_type: ImageType::Png,
            width: 1568,
            height: 980,
            file: "1-1.b64".into(),
        };
        let parts = vec![
            Part::Thinking {
                text: "Looking".into(),
                duration_ms: Some(900),
            },
            Part::Tool {
                id: "toolu_1".into(),
                name: "Read".into(),
                title: Some("Read a.md".into()),
                input: Some(serde_json::json!({"file_path": "/x/a.md"})),
                state: ToolState::Done,
                output: Some("1\t# Notes".into()),
                duration_ms: Some(120),
            },
            Part::Text {
                text: "Done.".into(),
            },
        ];
        let meta = AnswerMeta {
            model: Some("claude-opus-5-5".into()),
            requested_model: "Opus".into(),
            effort: Some("High".into()),
            duration_ms: Some(2829),
        };

        db.with_conn(|conn| {
            insert(conn, "c", 1, "claude-acp", "Look", 1)?;
            add_message(
                conn,
                "c",
                NewMessage::request("Look", std::slice::from_ref(&shot)),
                2,
            )?;
            add_message(conn, "c", NewMessage::answer("Done.", &parts, &meta), 3)?;
            Ok(())
        })
        .unwrap();

        let stored = db.with_conn(|conn| messages(conn, "c")).unwrap();
        assert_eq!(stored.len(), 2);
        assert_eq!(stored[0].role, Role::You);
        assert_eq!(stored[0].images, vec![shot]);
        assert_eq!(stored[1].role, Role::Agent);
        assert_eq!(stored[1].text, "Done.");
        assert!(stored[0].parts.is_empty());
        assert_eq!(stored[0].meta, None);
        assert_eq!(stored[1].parts, parts);
        assert_eq!(stored[1].meta, Some(meta));
    }

    #[test]
    fn a_conversation_remembers_the_session_its_agent_holds() {
        let db = Db::open_in_memory().unwrap();
        with_file(&db, 1);
        let session = || {
            db.with_conn(|conn| get(conn, "c"))
                .unwrap()
                .unwrap()
                .agent_session_id
        };

        db.with_conn(|conn| insert(conn, "c", 1, "claude-acp", "Hi", 1))
            .unwrap();
        assert_eq!(session(), None);

        db.with_conn(|conn| remember_session(conn, "c", "s1"))
            .unwrap();
        assert_eq!(session().as_deref(), Some("s1"));
    }

    #[test]
    fn a_removed_file_takes_its_conversations_along() {
        let db = Db::open_in_memory().unwrap();
        with_file(&db, 1);

        db.with_conn(|conn| {
            insert(conn, "c", 1, "claude-acp", "Hi", 1)?;
            add_message(conn, "c", NewMessage::request("Hi", &[]), 2)?;
            conn.execute("DELETE FROM files WHERE id = 1", [])?;
            Ok(())
        })
        .unwrap();

        assert!(db.with_conn(|conn| get(conn, "c")).unwrap().is_none());
        assert!(db.with_conn(|conn| messages(conn, "c")).unwrap().is_empty());
    }
}
