use std::fs;
use std::path::Path;

use serde::Serialize;

use crate::agent::{AnswerMeta, ImageType, Part, PromptImage};
use crate::db::agent_repo::{self, NewMessage, Role, StoredImage};
use crate::db::{now_ms, Db};
use crate::error::{AppError, AppResult};

const TITLE_CHARS: usize = 80;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SentImage {
    pub name: String,
    pub media_type: ImageType,
    pub width: u32,
    pub height: u32,
    pub base64: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StoredMessage {
    pub id: i64,
    pub role: Role,
    pub text: String,
    pub images: Vec<SentImage>,
    pub parts: Vec<Part>,
    pub meta: Option<AnswerMeta>,
}

pub fn title(text: &str, images: usize) -> String {
    let line = text.lines().map(str::trim).find(|line| !line.is_empty());
    match (line, images) {
        (Some(line), _) if line.chars().count() > TITLE_CHARS => {
            let cut: String = line.chars().take(TITLE_CHARS).collect();
            format!("{}…", cut.trim_end())
        }
        (Some(line), _) => line.to_string(),
        (None, 1) => "1 image".to_string(),
        (None, count) => format!("{count} images"),
    }
}

fn images_dir(dir: &Path, conversation: &str) -> std::path::PathBuf {
    dir.join(conversation).join("images")
}

pub fn remember_request(
    db: &Db,
    dir: &Path,
    file_id: i64,
    conversation: &str,
    opens: bool,
    text: &str,
    images: &[PromptImage],
) -> AppResult<()> {
    let folder = images_dir(dir, conversation);
    if !images.is_empty() {
        fs::create_dir_all(&folder)?;
    }
    let stored = images
        .iter()
        .map(|image| {
            let file = format!("{}.b64", uuid::Uuid::new_v4());
            fs::write(folder.join(&file), &image.base64)?;
            Ok(StoredImage {
                name: image.name.clone(),
                media_type: image.media_type,
                width: image.width,
                height: image.height,
                file,
            })
        })
        .collect::<AppResult<Vec<_>>>()?;

    let now = now_ms();
    db.with_tx(|tx| {
        if opens {
            agent_repo::insert(tx, conversation, file_id, &title(text, images.len()), now)?;
        }
        agent_repo::add_message(tx, conversation, NewMessage::request(text, &stored), now)?;
        Ok(())
    })
}

pub(crate) fn answer_text(answer: &[Part]) -> String {
    answer
        .iter()
        .filter_map(|part| match part {
            Part::Text { text } => Some(text.trim()),
            _ => None,
        })
        .filter(|text| !text.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n")
}

pub fn remember_answer(
    db: &Db,
    conversation: &str,
    answer: &[Part],
    meta: &AnswerMeta,
    started: bool,
) -> AppResult<()> {
    let now = now_ms();
    db.with_tx(|tx| {
        if answer.iter().any(Part::has_content) {
            let text = answer_text(answer);
            agent_repo::add_message(
                tx,
                conversation,
                NewMessage::answer(&text, answer, meta),
                now,
            )?;
        }
        if started {
            agent_repo::mark_started(tx, conversation)?;
        }
        Ok(())
    })
}

pub fn load(db: &Db, dir: &Path, conversation: &str) -> AppResult<Vec<StoredMessage>> {
    let folder = images_dir(dir, conversation);
    let messages = db.with_conn(|conn| agent_repo::messages(conn, conversation))?;
    Ok(messages
        .into_iter()
        .map(|message| StoredMessage {
            id: message.id,
            role: message.role,
            text: message.text,
            parts: message.parts,
            meta: message.meta,
            images: message
                .images
                .into_iter()
                .filter_map(|image| match fs::read_to_string(folder.join(&image.file)) {
                    Ok(base64) => Some(SentImage {
                        name: image.name,
                        media_type: image.media_type,
                        width: image.width,
                        height: image.height,
                        base64,
                    }),
                    Err(error) => {
                        log::warn!("could not read a sent image back: {error}");
                        None
                    }
                })
                .collect(),
        })
        .collect())
}

pub fn require(db: &Db, conversation: &str, file_id: i64) -> AppResult<agent_repo::Conversation> {
    db.with_conn(|conn| agent_repo::get(conn, conversation))?
        .filter(|found| found.file_id == file_id)
        .ok_or_else(|| AppError::NotFound(format!("conversation {conversation}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::answer::ToolState;
    use crate::agent::settings::{Effort, Model};

    const META: AnswerMeta = AnswerMeta {
        model: None,
        requested_model: Model::Sonnet,
        effort: Effort::Medium,
        duration_ms: Some(2523),
    };

    fn text(text: &str) -> Part {
        Part::Text { text: text.into() }
    }

    fn db_with_file() -> Db {
        let db = Db::open_in_memory().unwrap();
        db.with_conn(|conn| {
            conn.execute("INSERT INTO roots (id, path, enabled, added_at) VALUES (1, '/repo', 1, 0)", [])?;
            conn.execute(
                "INSERT INTO files (id, root_id, path, rel_path, kind, size, mtime_ns, hash, first_seen_at)
                 VALUES (1, 1, '/repo/SKILL.md', 'SKILL.md', 'skill', 1, 1, 'h', 0)",
                [],
            )?;
            Ok(())
        })
        .unwrap();
        db
    }

    #[test]
    fn a_conversation_is_named_after_its_first_line() {
        assert_eq!(
            title("\n  Tighten the intro \nand more", 0),
            "Tighten the intro"
        );
        assert_eq!(title("", 1), "1 image");
        assert_eq!(title("  ", 3), "3 images");
        let long = "word ".repeat(40);
        let named = title(&long, 0);
        assert!(named.ends_with('…'));
        assert!(named.chars().count() <= TITLE_CHARS + 1);
    }

    #[test]
    fn a_request_and_its_answer_read_back_in_order_with_the_images() {
        let db = db_with_file();
        let dir = tempfile::tempdir().unwrap();
        let shot = PromptImage {
            name: "shot.png".into(),
            media_type: ImageType::Png,
            width: 1568,
            height: 980,
            base64: "iVBORw0KGgo=".into(),
        };

        remember_request(&db, dir.path(), 1, "c", true, "Match this", &[shot]).unwrap();
        remember_answer(&db, "c", &[text("Done."), text("  ")], &META, true).unwrap();

        let messages = load(&db, dir.path(), "c").unwrap();
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].role, Role::You);
        assert_eq!(
            messages[0].images,
            vec![SentImage {
                name: "shot.png".into(),
                media_type: ImageType::Png,
                width: 1568,
                height: 980,
                base64: "iVBORw0KGgo=".into(),
            }]
        );
        assert_eq!(messages[1].text, "Done.");
        assert_eq!(messages[0].parts, []);
        assert_eq!(messages[0].meta, None);
        assert_eq!(messages[1].meta, Some(META));
        let conversation = require(&db, "c", 1).unwrap();
        assert!(conversation.started);
        let listed = db.with_conn(|conn| agent_repo::list(conn, 1)).unwrap();
        assert_eq!(listed[0].title, "Match this");
    }

    #[test]
    fn a_whole_run_is_kept_as_one_answer_with_its_text_joined() {
        let db = db_with_file();
        let dir = tempfile::tempdir().unwrap();
        let answer = vec![
            Part::Thinking {
                text: "Reading first".into(),
                duration_ms: Some(800),
            },
            text(" Let me look. "),
            Part::Tool {
                id: "toolu_1".into(),
                name: "Read".into(),
                input: Some(serde_json::json!({"file_path": "/x/a.md"})),
                state: ToolState::Done,
                output: Some("1\t# Notes".into()),
                duration_ms: Some(120),
            },
            text(""),
            text("There are 17.\n"),
        ];

        remember_request(&db, dir.path(), 1, "c", true, "Count", &[]).unwrap();
        remember_answer(&db, "c", &answer, &META, false).unwrap();

        let messages = load(&db, dir.path(), "c").unwrap();
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[1].role, Role::Agent);
        assert_eq!(messages[1].text, "Let me look.\n\nThere are 17.");
        assert_eq!(messages[1].parts, answer);
        assert!(!require(&db, "c", 1).unwrap().started);
    }

    #[test]
    fn a_tool_only_run_is_still_an_answer_but_a_blank_one_is_not() {
        let db = db_with_file();
        let dir = tempfile::tempdir().unwrap();
        let tool = Part::Tool {
            id: "toolu_1".into(),
            name: "Edit".into(),
            input: None,
            state: ToolState::Running,
            output: None,
            duration_ms: None,
        };
        let blank = Part::Thinking {
            text: " ".into(),
            duration_ms: None,
        };

        remember_request(&db, dir.path(), 1, "c", true, "Fix", &[]).unwrap();
        remember_answer(&db, "c", &[blank, text("\n")], &META, true).unwrap();
        remember_answer(&db, "c", std::slice::from_ref(&tool), &META, true).unwrap();

        let messages = load(&db, dir.path(), "c").unwrap();
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[1].text, "");
        assert_eq!(messages[1].parts, [tool]);
        assert!(require(&db, "c", 1).unwrap().started);
    }

    #[test]
    fn a_conversation_only_answers_for_its_own_file() {
        let db = db_with_file();
        db.with_conn(|conn| agent_repo::insert(conn, "c", 1, "Hi", 1))
            .unwrap();

        assert!(require(&db, "c", 1).is_ok());
        assert_eq!(require(&db, "c", 2).unwrap_err().code(), "not_found");
        assert_eq!(require(&db, "missing", 1).unwrap_err().code(), "not_found");
    }
}
