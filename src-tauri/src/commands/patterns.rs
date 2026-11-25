use std::path::Path;

use serde::Serialize;
use tauri::{AppHandle, Manager as _, State};

use crate::agent::cli;
use crate::db::files_repo::{self, FileFilter};
use crate::db::now_ms;
use crate::db::patterns_repo::{self, Pattern};
use crate::error::{AppError, AppResult};
use crate::events;
use crate::patterns::{self, sources, Inputs, Progress, Run, LIBRARY_KINDS};
use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PatternsState {
    pub patterns: Vec<Pattern>,
    pub last_run: Option<Run>,
    pub running: Option<Progress>,
}

#[tauri::command]
pub fn patterns_state(state: State<'_, AppState>) -> AppResult<PatternsState> {
    let (patterns, last_run) = state
        .db
        .with_conn(|conn| Ok((patterns_repo::open(conn)?, patterns_repo::last_run(conn)?)))?;
    Ok(PatternsState {
        patterns,
        last_run,
        running: state.patterns.progress(),
    })
}

#[tauri::command]
pub fn patterns_analyze(app: AppHandle, state: State<'_, AppState>) -> AppResult<()> {
    let binary = cli::resolve(cli::CLAUDE).ok_or(AppError::AgentMissing)?;
    let home = dirs::home_dir().ok_or_else(|| AppError::internal("no home folder"))?;
    state.patterns.begin()?;
    std::thread::spawn(move || run(&app, &binary, &home));
    Ok(())
}

#[tauri::command]
pub fn patterns_cancel(state: State<'_, AppState>) {
    state.patterns.cancel();
}

#[tauri::command]
pub fn patterns_dismiss(state: State<'_, AppState>, id: i64) -> AppResult<()> {
    state
        .db
        .with_conn(|conn| patterns_repo::dismiss(conn, id, now_ms()))
}

fn run(app: &AppHandle, binary: &Path, home: &Path) {
    let state = app.state::<AppState>();
    if let Some(progress) = state.patterns.progress() {
        events::emit_patterns_progress(app, progress);
    }
    let outcome = analyze(app, &state, binary, home);
    state.patterns.finish();
    match outcome {
        Ok(cancelled) => events::emit_patterns_done(app, cancelled),
        Err(error) => events::emit_patterns_error(app, error.to_string()),
    }
}

/// `Ok(true)` = cancelled.
fn analyze(app: &AppHandle, state: &AppState, binary: &Path, home: &Path) -> AppResult<bool> {
    let collected = sources::collect(home);
    if state.patterns.cancelled() {
        return Ok(true);
    }
    let (files, rejected) = state.db.with_conn(|conn| {
        let filter = FileFilter {
            kinds: Some(LIBRARY_KINDS.to_vec()),
            ..FileFilter::default()
        };
        Ok((
            files_repo::list(conn, &filter)?,
            patterns_repo::rejected(conn)?,
        ))
    })?;
    let inputs = Inputs {
        binary,
        home,
        collected,
        files,
        rejected: &rejected,
    };
    let Some(analysis) = patterns::analyze(&state.patterns, inputs, |progress| {
        events::emit_patterns_progress(app, progress);
    })?
    else {
        return Ok(true);
    };
    state
        .db
        .with_tx(|tx| patterns_repo::replace(tx, &analysis.findings, &analysis.run))?;
    Ok(false)
}
