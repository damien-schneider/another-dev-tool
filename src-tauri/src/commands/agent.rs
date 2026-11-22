use serde::Serialize;
use tauri::{AppHandle, Manager as _, State};

use crate::agent::{self, AgentStatus, Prompt, RunSettings, Session};
use crate::commands::agent_history::{self, StoredMessage};
use crate::commands::agent_relay::{relay, report};
use crate::db::agent_repo::{self, ConversationSummary};
use crate::db::files_repo;
use crate::error::AppResult;
use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStarted {
    pub run_id: u64,
    pub conversation_id: String,
}

#[tauri::command]
pub fn agent_status() -> AgentStatus {
    agent::status()
}

#[tauri::command]
pub fn agent_cancel(state: State<'_, AppState>) {
    state.agent.cancel();
}

#[tauri::command]
pub fn agent_conversations(
    state: State<'_, AppState>,
    file_id: i64,
) -> AppResult<Vec<ConversationSummary>> {
    state.db.with_conn(|conn| agent_repo::list(conn, file_id))
}

#[tauri::command(async)]
pub fn agent_conversation(
    state: State<'_, AppState>,
    file_id: i64,
    conversation_id: String,
) -> AppResult<Vec<StoredMessage>> {
    agent_history::require(&state.db, &conversation_id, file_id)?;
    agent_history::load(&state.db, &state.agent_dir, &conversation_id)
}

#[tauri::command(async)]
pub fn agent_send(
    app: AppHandle,
    state: State<'_, AppState>,
    file_id: i64,
    conversation_id: Option<String>,
    content: Option<String>,
    prompt: Prompt,
    settings: RunSettings,
) -> AppResult<AgentStarted> {
    let row = state
        .db
        .with_conn(|conn| files_repo::require(conn, file_id))?;
    let (conversation, started) = match conversation_id {
        Some(id) => {
            let found = agent_history::require(&state.db, &id, file_id)?;
            (id, found.started)
        }
        None => (uuid::Uuid::new_v4().to_string(), false),
    };
    let session = Session::open(
        &conversation,
        state.agent_dir.join(&conversation).join("scratch"),
        &row.rel_path,
        started,
    )?;
    let request = (prompt.text.clone(), prompt.images.clone());
    let handle = state
        .agent
        .start(session, content.as_deref(), prompt, settings)?;
    let run_id = handle.run_id;

    if let Err(error) = agent_history::remember_request(
        &state.db,
        &state.agent_dir,
        file_id,
        &conversation,
        !started,
        &request.0,
        &request.1,
    ) {
        log::error!("could not save the request to the conversation history: {error}");
    }

    let streamed = conversation.clone();
    std::thread::spawn(move || {
        stream_until_done(app, handle, &streamed, settings);
    });

    Ok(AgentStarted {
        run_id,
        conversation_id: conversation,
    })
}

fn stream_until_done(
    app: AppHandle,
    handle: agent::RunHandle,
    conversation: &str,
    settings: RunSettings,
) {
    let run_id = handle.run_id;
    let (answer, end) = relay(&app, handle);
    let state = app.state::<AppState>();
    let outcome = state.agent.finish(end.failed());

    if let Err(error) = agent_history::remember_answer(
        &state.db,
        conversation,
        answer.parts(),
        &answer.meta(settings),
        outcome.started,
    ) {
        log::error!("could not save the answer to the conversation history: {error}");
    }

    report(&app, run_id, end, outcome.cancelled, outcome.proposal);
}
