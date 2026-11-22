use tauri::State;

use crate::commands::files::resolve;
use crate::error::AppResult;
use crate::git::history::{self, FileHistory};
use crate::git::{working, CommitChange};
use crate::state::AppState;

#[tauri::command(async)]
pub fn file_history(state: State<'_, AppState>, file_id: i64) -> AppResult<FileHistory> {
    let (_, path) = resolve(&state, file_id)?;
    history::file_history(&path)
}

#[tauri::command(async)]
pub fn file_commit_change(
    state: State<'_, AppState>,
    file_id: i64,
    hash: String,
    path: Option<String>,
    previous_path: Option<String>,
) -> AppResult<CommitChange> {
    let (_, file) = resolve(&state, file_id)?;
    history::commit_change(&file, &hash, path.as_deref(), previous_path.as_deref())
}

#[tauri::command(async)]
pub fn file_working_change(state: State<'_, AppState>, file_id: i64) -> AppResult<CommitChange> {
    let (_, file) = resolve(&state, file_id)?;
    working::working_change(&file)
}
