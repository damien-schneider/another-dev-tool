use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager as _, State};

use crate::acp::{self, Control, Listing, Prepared, SignIn, Turn};
use crate::agent::{self, AgentStatus, Prompt};
use crate::ask::{self, Editable, Pinned, Session};
use crate::commands::agent_history::{self, StoredMessage};
use crate::commands::agent_relay::{report, Relay, RunEnd};
use crate::db::agent_repo::{self, PinnedSummary};
use crate::commands::files::resolve;
use crate::db::files_repo::{self, FileRow};
use crate::fsops;
use crate::error::{AppError, AppResult};
use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStarted {
    pub run_id: u64,
    pub conversation_id: String,
}

#[derive(Debug, Deserialize)]
pub struct ConfigPick {
    pub id: String,
    pub value: String,
}

#[derive(Debug, Deserialize)]
pub struct AgentChoice {
    pub id: String,
    pub config: Vec<ConfigPick>,
}

#[tauri::command]
pub fn agent_status() -> AgentStatus {
    agent::status()
}

#[tauri::command(async)]
pub fn agent_catalog(state: State<'_, AppState>) -> AppResult<Vec<Listing>> {
    state.catalog.list()
}

#[tauri::command(async)]
pub fn agent_prepare(state: State<'_, AppState>, agent_id: String) -> AppResult<Prepared> {
    let launch = state.catalog.launch(&agent_id)?;
    acp::prepare(&launch, &state.catalog.work()?)
}

#[tauri::command(async)]
pub fn agent_sign_in(
    state: State<'_, AppState>,
    agent_id: String,
    method_id: String,
) -> AppResult<SignIn> {
    let launch = state.catalog.launch(&agent_id)?;
    acp::sign_in(&launch, &state.catalog.work()?, &method_id)
}

#[tauri::command]
pub fn agent_cancel(state: State<'_, AppState>) {
    state.agent.cancel();
}

#[tauri::command]
pub fn agent_conversations(state: State<'_, AppState>) -> AppResult<Vec<PinnedSummary>> {
    state.db.with_conn(agent_repo::list)
}

#[tauri::command(async)]
pub fn agent_conversation(
    state: State<'_, AppState>,
    conversation_id: String,
) -> AppResult<Vec<StoredMessage>> {
    agent_history::require(&state.db, &conversation_id)?;
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
    agent: AgentChoice,
) -> AppResult<AgentStarted> {
    let row = state
        .db
        .with_conn(|conn| files_repo::require(conn, file_id))?;
    let (conversation, opens_with, resume) = match conversation_id {
        Some(id) => {
            let found = agent_history::require(&state.db, &id)?;
            if found.agent_id != agent.id {
                return Err(AppError::InvalidInput(format!(
                    "this conversation belongs to {}",
                    found.agent_id
                )));
            }
            (id, None, found.agent_session_id)
        }
        None => (
            uuid::Uuid::new_v4().to_string(),
            Some(agent.id.clone()),
            None,
        ),
    };
    let pinned = Pinned {
        launch: state.catalog.launch(&agent.id)?,
        agent: agent.id,
        resume,
    };
    let session = Session::open(ask::scratch_dir(&state.agent_dir, &conversation))?;
    let editable = editable(&state, &row, content, &prompt.references)?;
    let request = (prompt.text.clone(), prompt.images.clone());
    let picks = agent
        .config
        .into_iter()
        .map(|pick| (pick.id, pick.value))
        .collect();
    let turn = ask::turn(pinned, &session, &editable, prompt, picks);
    let control = state.agent.claim(&session, editable)?;
    let run_id = agent::next_run_id();

    if let Err(error) = agent_history::remember_request(
        &state.db,
        &state.agent_dir,
        file_id,
        &conversation,
        opens_with.as_deref(),
        &request.0,
        &request.1,
    ) {
        log::error!("could not save the request to the conversation history: {error}");
    }

    let answered = conversation.clone();
    std::thread::spawn(move || answer(&app, run_id, turn, &control, &answered));

    Ok(AgentStarted {
        run_id,
        conversation_id: conversation,
    })
}

fn answer(app: &AppHandle, run_id: u64, turn: Turn, control: &Control, conversation: &str) {
    let mut relay = Relay::new(app, run_id);
    let ended = acp::run(turn, control, &mut |event| relay.apply(event));
    let answer = relay.into_answer();
    let state = app.state::<AppState>();
    let outcome = state.agent.finish();

    if let Err(error) = agent_history::remember_answer(
        &state.db,
        conversation,
        answer.parts(),
        &answer.meta(ended.requested),
        ended.session_id.as_deref(),
    ) {
        log::error!("could not save the answer to the conversation history: {error}");
    }

    let end = match ended.error {
        Some(message) if ended.sign_in => RunEnd::SignedOut(message),
        Some(message) => RunEnd::Failed(message),
        None => RunEnd::Completed,
    };
    report(app, run_id, end, outcome.cancelled, outcome.proposals);
}

/// Past this many copies the agent spends the turn reading instead of answering.
const MAX_EDITABLE: usize = 40;

/// The open document as the editor holds it, then every library file the
/// references point at, read from disk: the agent edits copies of all of them.
fn editable(
    state: &AppState,
    open: &FileRow,
    content: Option<String>,
    references: &[std::path::PathBuf],
) -> AppResult<Vec<Editable>> {
    let attached = state.db.with_conn(|conn| {
        let mut ids = Vec::new();
        for reference in references {
            ids.extend(files_repo::live_ids_at_or_under(
                conn,
                &reference.to_string_lossy(),
            )?);
        }
        Ok(ids)
    })?;
    let mut files: Vec<Editable> = content
        .map(|content| Editable {
            file_id: open.id,
            path: open.path.clone().into(),
            content,
            open: true,
        })
        .into_iter()
        .collect();
    for id in attached {
        if files.len() >= MAX_EDITABLE {
            break;
        }
        if id == open.id || files.iter().any(|file| file.file_id == id) {
            continue;
        }
        match resolve(state, id).and_then(|(row, path)| Ok((row, fsops::read_text(&path)?.0))) {
            Ok((row, content)) => files.push(Editable {
                file_id: row.id,
                path: row.path.into(),
                content,
                open: false,
            }),
            Err(error) => log::warn!("could not stage file {id} for the agent: {error}"),
        }
    }
    Ok(files)
}
