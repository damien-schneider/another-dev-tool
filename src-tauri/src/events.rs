use serde::Serialize;
use tauri::{AppHandle, Emitter as _};

use crate::agent::Part;
use crate::capture::CaptureAccessStatus;
use crate::db::prompts_repo::PromptHistoryEntry;
use crate::patterns::Progress;
use crate::scanner::ScanStats;

pub const SCAN_PROGRESS: &str = "scan:progress";
pub const SCAN_DONE: &str = "scan:done";
pub const SCAN_ERROR: &str = "scan:error";
pub const INDEX_UPDATED: &str = "index:updated";
pub const CAPTURE_SAVED: &str = "capture:saved";
pub const CAPTURE_ERROR: &str = "capture:error";
pub const CAPTURE_ACCESS_CHANGED: &str = "capture:access-changed";
pub const CAPTURE_SHORTCUT_PROGRESS: &str = "capture:shortcut-progress";
pub const AGENT_DELTA: &str = "agent:delta";
pub const AGENT_PART: &str = "agent:part";
pub const AGENT_DONE: &str = "agent:done";
pub const AGENT_ERROR: &str = "agent:error";
pub const PATTERNS_PROGRESS: &str = "patterns:progress";
pub const PATTERNS_DONE: &str = "patterns:done";
pub const PATTERNS_ERROR: &str = "patterns:error";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    pub scan_id: i64,
    #[serde(flatten)]
    pub stats: ScanStats,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanDone {
    pub scan_id: i64,
    pub cancelled: bool,
    #[serde(flatten)]
    pub stats: ScanStats,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanError {
    pub scan_id: i64,
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexUpdated {
    pub file_ids: Vec<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureError {
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureShortcutProgress {
    pub completed_taps: u8,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDelta {
    pub run_id: u64,
    pub index: u32,
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPart {
    pub run_id: u64,
    pub index: u32,
    pub part: Part,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDone {
    pub run_id: u64,
    pub proposal: Option<String>,
    pub cancelled: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentError {
    pub run_id: u64,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PatternsDone {
    pub cancelled: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PatternsError {
    pub message: String,
}

pub fn emit_agent_delta(app: &AppHandle, payload: AgentDelta) {
    let _ = app.emit(AGENT_DELTA, payload);
}

pub fn emit_agent_part(app: &AppHandle, payload: AgentPart) {
    let _ = app.emit(AGENT_PART, payload);
}

pub fn emit_agent_done(app: &AppHandle, payload: AgentDone) {
    let _ = app.emit(AGENT_DONE, payload);
}

pub fn emit_agent_error(app: &AppHandle, payload: AgentError) {
    let _ = app.emit(AGENT_ERROR, payload);
}

pub fn emit_patterns_progress(app: &AppHandle, progress: Progress) {
    let _ = app.emit(PATTERNS_PROGRESS, progress);
}

pub fn emit_patterns_done(app: &AppHandle, cancelled: bool) {
    let _ = app.emit(PATTERNS_DONE, PatternsDone { cancelled });
}

pub fn emit_patterns_error(app: &AppHandle, message: String) {
    let _ = app.emit(PATTERNS_ERROR, PatternsError { message });
}

pub fn emit_scan_progress(app: &AppHandle, payload: ScanProgress) {
    let _ = app.emit(SCAN_PROGRESS, payload);
}

pub fn emit_scan_done(app: &AppHandle, payload: ScanDone) {
    let _ = app.emit(SCAN_DONE, payload);
}

pub fn emit_scan_error(app: &AppHandle, payload: ScanError) {
    let _ = app.emit(SCAN_ERROR, payload);
}

pub fn emit_index_updated(app: &AppHandle, file_ids: Vec<i64>) {
    if file_ids.is_empty() {
        return;
    }
    let _ = app.emit(INDEX_UPDATED, IndexUpdated { file_ids });
}

pub fn emit_capture_saved(app: &AppHandle, prompt: PromptHistoryEntry) {
    let _ = app.emit(CAPTURE_SAVED, prompt);
}

pub fn emit_capture_error(app: &AppHandle, message: String) {
    let _ = app.emit(CAPTURE_ERROR, CaptureError { message });
}

pub fn emit_capture_shortcut_progress(app: &AppHandle, completed_taps: u8) {
    let _ = app.emit(
        CAPTURE_SHORTCUT_PROGRESS,
        CaptureShortcutProgress { completed_taps },
    );
}

pub fn emit_capture_access_changed(app: &AppHandle, status: CaptureAccessStatus) {
    let _ = app.emit(CAPTURE_ACCESS_CHANGED, status);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scan_progress_flattens_its_stats_in_camel_case() {
        let json = serde_json::to_value(ScanProgress {
            scan_id: 7,
            stats: ScanStats {
                seen: 3,
                hashed: 2,
                added: 1,
                changed: 0,
                removed: 0,
            },
        })
        .unwrap();

        assert_eq!(json["scanId"], 7);
        assert_eq!(json["seen"], 3);
        assert_eq!(json["hashed"], 2);
    }

    #[test]
    fn index_updated_uses_camel_case_ids() {
        let json = serde_json::to_value(IndexUpdated {
            file_ids: vec![1, 2],
        })
        .unwrap();

        assert_eq!(json["fileIds"], serde_json::json!([1, 2]));
    }

    #[test]
    fn shortcut_progress_uses_camel_case() {
        let json = serde_json::to_value(CaptureShortcutProgress { completed_taps: 2 }).unwrap();

        assert_eq!(json["completedTaps"], 2);
    }

    #[test]
    fn agent_payloads_use_camel_case_and_carry_the_part_index() {
        let delta = serde_json::to_value(AgentDelta {
            run_id: 3,
            index: 1,
            text: "hel".into(),
        })
        .unwrap();
        let part = serde_json::to_value(AgentPart {
            run_id: 3,
            index: 0,
            part: Part::Text { text: "hi".into() },
        })
        .unwrap();

        assert_eq!(
            delta,
            serde_json::json!({"runId": 3, "index": 1, "text": "hel"})
        );
        assert_eq!(
            part,
            serde_json::json!({"runId": 3, "index": 0, "part": {"kind": "text", "text": "hi"}})
        );
    }
}
