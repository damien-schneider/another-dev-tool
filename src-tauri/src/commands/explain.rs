use std::path::Path;

use tauri::{AppHandle, Manager as _, State};

use crate::agent::{Answer, Part, RunHandle, RunSettings};
use crate::commands::agent::AgentStarted;
use crate::commands::agent_history::{answer_text, title};
use crate::commands::agent_relay::{relay, report};
use crate::db::agent_repo::{ConversationSummary, Role};
use crate::db::explain_repo::{self, Conversation, RecentProject, StoredMessage};
use crate::db::{now_ms, Db};
use crate::error::{AppError, AppResult};
use crate::explain::source::{self, SourceFile};
use crate::explain::{Level, Request};
use crate::state::AppState;

#[tauri::command]
pub fn explain_cancel(state: State<'_, AppState>) {
    state.explainer.cancel();
}

#[tauri::command]
pub fn explain_conversations(
    state: State<'_, AppState>,
    project: String,
) -> AppResult<Vec<ConversationSummary>> {
    state.db.with_conn(|conn| explain_repo::list(conn, &project))
}

#[tauri::command]
pub fn explain_conversation(
    state: State<'_, AppState>,
    conversation_id: String,
) -> AppResult<Vec<StoredMessage>> {
    state
        .db
        .with_conn(|conn| explain_repo::messages(conn, &conversation_id))
}

#[tauri::command]
pub fn explain_recent_projects(state: State<'_, AppState>) -> AppResult<Vec<RecentProject>> {
    state.db.with_conn(explain_repo::recent_projects)
}

#[tauri::command(async)]
pub fn explain_read_source(project: String, path: String) -> AppResult<SourceFile> {
    source::read(Path::new(&project), &path)
}

#[tauri::command(async)]
pub fn explain_send(
    app: AppHandle,
    state: State<'_, AppState>,
    project: String,
    conversation_id: Option<String>,
    text: String,
    level: Level,
    settings: RunSettings,
) -> AppResult<AgentStarted> {
    if !Path::new(&project).is_dir() {
        return Err(AppError::NotFound(project));
    }
    let question = text.trim();
    if question.is_empty() {
        return Err(AppError::InvalidInput("ask a question first".into()));
    }
    let opens = conversation_id.is_none();
    let (conversation, resume) = match conversation_id {
        Some(id) => {
            let found = require(&state.db, &id, &project)?;
            (id, found.started)
        }
        None => (uuid::Uuid::new_v4().to_string(), false),
    };

    let handle = state.explainer.start(&Request {
        project: Path::new(&project),
        conversation: &conversation,
        resume,
        text: question,
        level,
        settings,
    })?;
    let run_id = handle.run_id;

    if let Err(error) = remember_question(&state.db, &project, &conversation, opens, question) {
        log::error!("could not save the question to the explanation history: {error}");
    }

    let streamed = conversation.clone();
    std::thread::spawn(move || stream_until_done(&app, handle, &streamed, resume, settings));

    Ok(AgentStarted {
        run_id,
        conversation_id: conversation,
    })
}

fn require(db: &Db, conversation: &str, project: &str) -> AppResult<Conversation> {
    db.with_conn(|conn| explain_repo::get(conn, conversation))?
        .filter(|found| found.project_dir == project)
        .ok_or_else(|| AppError::NotFound(format!("conversation {conversation}")))
}

fn remember_question(
    db: &Db,
    project: &str,
    conversation: &str,
    opens: bool,
    question: &str,
) -> AppResult<()> {
    let now = now_ms();
    db.with_tx(|tx| {
        if opens {
            explain_repo::insert(tx, conversation, project, &title(question, 0), now)?;
        }
        explain_repo::add_message(tx, conversation, Role::You, question, None, now)?;
        Ok(())
    })
}

fn remember_answer(
    db: &Db,
    conversation: &str,
    answer: &Answer,
    settings: RunSettings,
    started: bool,
) -> AppResult<()> {
    let now = now_ms();
    let parts = answer.parts();
    db.with_tx(|tx| {
        if parts.iter().any(Part::has_content) {
            explain_repo::add_message(
                tx,
                conversation,
                Role::Agent,
                &answer_text(parts),
                Some((parts, &answer.meta(settings.into()))),
                now,
            )?;
        }
        if started {
            explain_repo::mark_started(tx, conversation)?;
        }
        Ok(())
    })
}

fn stream_until_done(
    app: &AppHandle,
    handle: RunHandle,
    conversation: &str,
    resume: bool,
    settings: RunSettings,
) {
    let run_id = handle.run_id;
    let (answer, end) = relay(app, handle);
    let state = app.state::<AppState>();
    let cancelled = state.explainer.finish();
    let started = resume || !(end.failed() || cancelled);

    if let Err(error) = remember_answer(&state.db, conversation, &answer, settings, started) {
        log::error!("could not save the explanation to its history: {error}");
    }

    report(app, run_id, end, cancelled, Vec::new());
}
