use serde_json::json;

use super::stream::{parse_line, PartKind, StreamEvent};

fn stream(event: &str) -> String {
    format!(
        r#"{{"type":"stream_event","event":{event},"session_id":"20e087dd","parent_tool_use_id":null,"uuid":"f859d4de"}}"#
    )
}

#[test]
fn the_init_line_names_the_resolved_model() {
    let line = r#"{"type":"system","subtype":"init","cwd":"/tmp/x","session_id":"7897015e","tools":["Read","Edit"],"model":"claude-opus-5-5","permissionMode":"acceptEdits"}"#;

    assert_eq!(
        parse_line(line),
        [StreamEvent::Model("claude-opus-5-5".into())]
    );
}

#[test]
fn other_system_lines_are_ignored() {
    let status =
        r#"{"type":"system","subtype":"status","status":"requesting","session_id":"7897015e"}"#;
    let thinking = r#"{"type":"system","subtype":"thinking_tokens","session_id":"7897015e"}"#;

    assert!(parse_line(status).is_empty());
    assert!(parse_line(thinking).is_empty());
}

#[test]
fn a_text_block_opens_then_streams_its_chunks_then_stops() {
    let start = stream(
        r#"{"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}"#,
    );
    let delta = stream(
        r#"{"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"There are **17"}}"#,
    );
    let stop = stream(r#"{"type":"content_block_stop","index":1}"#);

    assert_eq!(parse_line(&start), [StreamEvent::PartStart(PartKind::Text)]);
    assert_eq!(
        parse_line(&delta),
        [StreamEvent::Delta("There are **17".into())]
    );
    assert_eq!(parse_line(&stop), [StreamEvent::PartStop]);
}

#[test]
fn a_thinking_block_streams_its_summary_and_skips_empty_deltas() {
    let start = stream(
        r#"{"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"","signature":""}}"#,
    );
    let empty = stream(
        r#"{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"","estimated_tokens":50}}"#,
    );
    let delta = stream(
        r#"{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"I'm listing"}}"#,
    );
    let signature = stream(
        r#"{"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"CAQSuQUKEAgU"}}"#,
    );

    assert_eq!(
        parse_line(&start),
        [StreamEvent::PartStart(PartKind::Thinking)]
    );
    assert!(parse_line(&empty).is_empty());
    assert_eq!(
        parse_line(&delta),
        [StreamEvent::Delta("I'm listing".into())]
    );
    assert!(parse_line(&signature).is_empty());
}

#[test]
fn redacted_thinking_still_opens_a_thinking_part() {
    let start = stream(
        r#"{"type":"content_block_start","index":0,"content_block":{"type":"redacted_thinking","data":"EmwKAhgB"}}"#,
    );

    assert_eq!(
        parse_line(&start),
        [StreamEvent::PartStart(PartKind::Thinking)]
    );
}

#[test]
fn a_tool_block_is_named_as_it_opens_and_its_partial_input_is_ignored() {
    let start = stream(
        r#"{"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_01QxiMJqa6LSY5o3NVWmKB2E","name":"Read","input":{},"caller":{"type":"direct"}}}"#,
    );
    let partial = stream(
        r#"{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\"file_path\": \"/pri"}}"#,
    );

    assert_eq!(
        parse_line(&start),
        [StreamEvent::PartStart(PartKind::Tool {
            id: "toolu_01QxiMJqa6LSY5o3NVWmKB2E".into(),
            name: "Read".into(),
        })]
    );
    assert!(parse_line(&partial).is_empty());
}

#[test]
fn the_assistant_message_gives_every_tool_input_but_never_its_text() {
    let line = r#"{"type":"assistant","message":{"model":"claude-sonnet-5-5","id":"msg_011","type":"message","role":"assistant","content":[{"type":"text","text":"hello"},{"type":"tool_use","id":"toolu_1","name":"Read","input":{"file_path":"/x/a.md"},"caller":{"type":"direct"}},{"type":"tool_use","id":"toolu_2","name":"Read","input":{"file_path":"/x/b.md"}}],"stop_reason":null},"parent_tool_use_id":null,"session_id":"20e087dd"}"#;

    assert_eq!(
        parse_line(line),
        [
            StreamEvent::ToolInput {
                id: "toolu_1".into(),
                input: json!({"file_path": "/x/a.md"}),
            },
            StreamEvent::ToolInput {
                id: "toolu_2".into(),
                input: json!({"file_path": "/x/b.md"}),
            },
        ]
    );
}

#[test]
fn a_thinking_only_assistant_message_yields_nothing() {
    let line = r#"{"type":"assistant","message":{"model":"claude-opus-5-5","content":[{"type":"thinking","thinking":"","signature":"CAQS"}]}}"#;

    assert!(parse_line(line).is_empty());
}

#[test]
fn a_tool_result_given_as_a_string_is_kept_as_is() {
    let line = r#"{"type":"user","message":{"role":"user","content":[{"tool_use_id":"toolu_01QxiMJqa6LSY5o3NVWmKB2E","type":"tool_result","content":"1\t# Notes\n2\t\n3\tFirst word is banana.\n4\t"}]},"parent_tool_use_id":null,"session_id":"7897015e"}"#;

    assert_eq!(
        parse_line(line),
        [StreamEvent::ToolResult {
            id: "toolu_01QxiMJqa6LSY5o3NVWmKB2E".into(),
            is_error: false,
            output: "1\t# Notes\n2\t\n3\tFirst word is banana.\n4\t".into(),
        }]
    );
}

#[test]
fn a_tool_result_given_as_blocks_joins_text_and_marks_images() {
    let line = r#"{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_2","content":[{"type":"text","text":"first"},{"type":"image","source":{"type":"base64","media_type":"image/png","data":"iVBO"}},{"type":"text","text":"last"}],"is_error":true}]}}"#;

    assert_eq!(
        parse_line(line),
        [StreamEvent::ToolResult {
            id: "toolu_2".into(),
            is_error: true,
            output: "first\n[image]\nlast".into(),
        }]
    );
}

#[test]
fn a_user_message_without_tool_results_yields_nothing() {
    let line = r#"{"type":"user","message":{"role":"user","content":"hello"}}"#;

    assert!(parse_line(line).is_empty());
}

#[test]
fn a_successful_result_finishes_with_its_duration() {
    let line = r#"{"type":"result","subtype":"success","is_error":false,"duration_ms":2523,"duration_api_ms":2614,"num_turns":2,"result":"ok","session_id":"7897015e"}"#;

    assert_eq!(
        parse_line(line),
        [StreamEvent::Finished {
            error: None,
            duration_ms: Some(2523),
        }]
    );
}

#[test]
fn a_failed_result_carries_its_message_or_a_fallback() {
    let with_message = r#"{"type":"result","is_error":true,"result":"boom"}"#;
    let without = r#"{"type":"result","subtype":"error_during_execution","is_error":true}"#;

    assert_eq!(
        parse_line(with_message),
        [StreamEvent::Finished {
            error: Some("boom".into()),
            duration_ms: None,
        }]
    );
    assert_eq!(
        parse_line(without),
        [StreamEvent::Finished {
            error: Some("the agent run failed".into()),
            duration_ms: None,
        }]
    );
}

#[test]
fn bookkeeping_unknown_and_malformed_lines_are_dropped() {
    let message_start = stream(
        r#"{"type":"message_start","message":{"model":"claude-sonnet-5-5","id":"msg_011","content":[]}}"#,
    );
    let message_delta =
        stream(r#"{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{}}"#);
    let message_stop = stream(r#"{"type":"message_stop"}"#);
    let rate_limit = r#"{"type":"rate_limit_event","rate_limit_info":{"status":"allowed_warning","utilization":0.77}}"#;

    for line in [
        message_start.as_str(),
        message_delta.as_str(),
        message_stop.as_str(),
        rate_limit,
        "not json",
    ] {
        assert!(parse_line(line).is_empty(), "{line}");
    }
}
