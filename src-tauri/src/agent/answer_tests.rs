use serde_json::json;

use super::answer::{Answer, AnswerMeta, Emit, Part, ToolState};
use super::settings::{Effort, Model, RunSettings};
use super::stream::{PartKind, StreamEvent};

fn tool_start(id: &str, name: &str) -> StreamEvent {
    StreamEvent::PartStart(PartKind::Tool {
        id: id.into(),
        name: name.into(),
    })
}

fn result(id: &str, is_error: bool, output: &str) -> StreamEvent {
    StreamEvent::ToolResult {
        id: id.into(),
        is_error,
        output: output.into(),
    }
}

fn feed(answer: &mut Answer, events: Vec<(u64, StreamEvent)>) -> Vec<Emit> {
    events
        .into_iter()
        .flat_map(|(now, event)| answer.apply(event, now))
        .collect()
}

#[test]
fn parts_keep_their_order_across_api_messages_whose_block_indexes_restart() {
    let mut answer = Answer::default();

    let emitted = feed(
        &mut answer,
        vec![
            (0, tool_start("toolu_1", "Read")),
            (
                5,
                StreamEvent::ToolInput {
                    id: "toolu_1".into(),
                    input: json!({"file_path": "/x/a.md"}),
                },
            ),
            (6, StreamEvent::PartStop),
            (120, result("toolu_1", false, "1\t# Notes")),
            (130, StreamEvent::PartStart(PartKind::Text)),
            (131, StreamEvent::Delta("There are ".into())),
            (132, StreamEvent::Delta("17".into())),
            (140, StreamEvent::PartStop),
        ],
    );

    assert_eq!(
        answer.parts(),
        [
            Part::Tool {
                id: "toolu_1".into(),
                name: "Read".into(),
                input: Some(json!({"file_path": "/x/a.md"})),
                state: ToolState::Done,
                output: Some("1\t# Notes".into()),
                duration_ms: Some(120),
            },
            Part::Text {
                text: "There are 17".into(),
            },
        ]
    );
    let deltas: Vec<_> = emitted
        .iter()
        .filter_map(|emit| match emit {
            Emit::Delta { index, text } => Some((*index, text.as_str())),
            Emit::PartChanged { .. } => None,
        })
        .collect();
    assert_eq!(deltas, [(1, "There are "), (1, "17")]);
}

#[test]
fn every_change_is_announced_with_the_whole_part() {
    let mut answer = Answer::default();

    let emitted = feed(
        &mut answer,
        vec![
            (0, tool_start("toolu_1", "Read")),
            (
                3,
                StreamEvent::ToolInput {
                    id: "toolu_1".into(),
                    input: json!({"file_path": "/x/a.md"}),
                },
            ),
            (4, StreamEvent::PartStop),
            (9, result("toolu_1", true, "no such file")),
        ],
    );

    let changed: Vec<_> = emitted
        .iter()
        .map(|emit| match emit {
            Emit::PartChanged {
                index,
                part: Part::Tool { input, state, .. },
            } => (*index, input.is_some(), *state),
            other => panic!("unexpected {other:?}"),
        })
        .collect();
    assert_eq!(
        changed,
        [
            (0, false, ToolState::Running),
            (0, true, ToolState::Running),
            (0, true, ToolState::Error),
        ]
    );
}

#[test]
fn thinking_lasts_from_its_start_to_its_stop() {
    let mut answer = Answer::default();

    let emitted = feed(
        &mut answer,
        vec![
            (100, StreamEvent::PartStart(PartKind::Thinking)),
            (150, StreamEvent::Delta("I'm listing".into())),
            (2200, StreamEvent::PartStop),
        ],
    );

    let finished = Part::Thinking {
        text: "I'm listing".into(),
        duration_ms: Some(2100),
    };
    assert_eq!(answer.parts(), std::slice::from_ref(&finished));
    assert_eq!(
        emitted.last(),
        Some(&Emit::PartChanged {
            index: 0,
            part: finished,
        })
    );
}

#[test]
fn a_long_tool_output_is_cut_on_a_char_boundary() {
    let mut answer = Answer::default();
    let long = "é".repeat(4100);

    feed(
        &mut answer,
        vec![
            (0, tool_start("toolu_1", "Read")),
            (1, result("toolu_1", false, &long)),
        ],
    );

    let Part::Tool {
        output: Some(output),
        ..
    } = &answer.parts()[0]
    else {
        panic!("no output");
    };
    assert_eq!(output.chars().count(), 4001);
    assert!(output.ends_with("é…"));
}

#[test]
fn a_short_tool_output_is_kept_whole() {
    let mut answer = Answer::default();
    let exact = "a".repeat(4000);

    feed(
        &mut answer,
        vec![
            (0, tool_start("toolu_1", "Read")),
            (1, result("toolu_1", false, &exact)),
        ],
    );

    assert!(matches!(
        &answer.parts()[0],
        Part::Tool { output: Some(output), .. } if *output == exact
    ));
}

#[test]
fn results_and_inputs_for_an_unknown_tool_are_ignored() {
    let mut answer = Answer::default();

    let emitted = feed(
        &mut answer,
        vec![
            (0, result("toolu_missing", false, "x")),
            (
                1,
                StreamEvent::ToolInput {
                    id: "toolu_missing".into(),
                    input: json!({}),
                },
            ),
        ],
    );

    assert!(emitted.is_empty());
    assert!(answer.parts().is_empty());
}

#[test]
fn deltas_and_stops_without_an_open_part_are_ignored() {
    let mut answer = Answer::default();

    let emitted = feed(
        &mut answer,
        vec![
            (0, StreamEvent::Delta("stray".into())),
            (1, StreamEvent::PartStop),
        ],
    );

    assert!(emitted.is_empty());
}

#[test]
fn the_meta_carries_the_resolved_model_and_the_run_duration() {
    let mut answer = Answer::default();

    feed(
        &mut answer,
        vec![
            (0, StreamEvent::Model("claude-opus-5-5".into())),
            (
                9,
                StreamEvent::Finished {
                    error: None,
                    duration_ms: Some(2829),
                },
            ),
        ],
    );

    let meta = answer.meta(RunSettings {
        model: Model::Opus,
        effort: Effort::High,
    });
    assert_eq!(
        meta,
        AnswerMeta {
            model: Some("claude-opus-5-5".into()),
            requested_model: Model::Opus,
            effort: Effort::High,
            duration_ms: Some(2829),
        }
    );
    assert_eq!(
        serde_json::to_value(&meta).unwrap(),
        json!({"model": "claude-opus-5-5", "requestedModel": "opus", "effort": "high", "durationMs": 2829})
    );
}

#[test]
fn parts_serialize_in_the_shape_the_panel_reads() {
    let tool = Part::Tool {
        id: "toolu_1".into(),
        name: "Read".into(),
        input: Some(json!({"file_path": "/x/a.md"})),
        state: ToolState::Done,
        output: Some("1\t# Notes".into()),
        duration_ms: Some(120),
    };
    let thinking = Part::Thinking {
        text: "I'm listing…".into(),
        duration_ms: Some(2100),
    };
    let text = Part::Text {
        text: "There are 17…".into(),
    };

    assert_eq!(
        serde_json::to_value(&tool).unwrap(),
        json!({"kind": "tool", "id": "toolu_1", "name": "Read", "input": {"file_path": "/x/a.md"}, "state": "done", "output": "1\t# Notes", "durationMs": 120})
    );
    assert_eq!(
        serde_json::to_value(&thinking).unwrap(),
        json!({"kind": "thinking", "text": "I'm listing…", "durationMs": 2100})
    );
    assert_eq!(
        serde_json::to_value(&text).unwrap(),
        json!({"kind": "text", "text": "There are 17…"})
    );
    let back: Part = serde_json::from_value(serde_json::to_value(&tool).unwrap()).unwrap();
    assert_eq!(back, tool);
}
