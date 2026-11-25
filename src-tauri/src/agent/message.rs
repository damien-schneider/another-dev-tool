use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
pub enum ImageType {
    #[serde(rename = "image/png")]
    Png,
    #[serde(rename = "image/jpeg")]
    Jpeg,
    #[serde(rename = "image/gif")]
    Gif,
    #[serde(rename = "image/webp")]
    Webp,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptImage {
    pub name: String,
    pub media_type: ImageType,
    pub width: u32,
    pub height: u32,
    pub base64: String,
}

/// Lines count from 1 in the document the user edits and include both ends.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextSelection {
    pub text: String,
    pub first_line: u32,
    pub last_line: u32,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Prompt {
    pub text: String,
    pub images: Vec<PromptImage>,
    pub references: Vec<PathBuf>,
    pub selection: Option<TextSelection>,
}

/// One `--input-format stream-json` line.
pub fn user_message(prompt: &Prompt) -> String {
    let content = blocks(prompt, |image| {
        json!({
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": image.media_type,
                "data": image.base64,
            },
        })
    });
    let message = json!({
        "type": "user",
        "message": { "role": "user", "content": content },
    });
    format!("{message}\n")
}

/// The same request as ACP `session/prompt` content blocks.
pub fn prompt_blocks(prompt: &Prompt) -> Vec<Value> {
    blocks(
        prompt,
        |image| json!({ "type": "image", "mimeType": image.media_type, "data": image.base64 }),
    )
}

/// Images go before the text, the order Anthropic recommends for image prompts.
fn blocks(prompt: &Prompt, image: fn(&PromptImage) -> Value) -> Vec<Value> {
    prompt
        .images
        .iter()
        .map(image)
        .chain(references_block(&prompt.references))
        .chain(selection_block(prompt.selection.as_ref()))
        .chain([json!({ "type": "text", "text": prompt.text })])
        .collect()
}

fn references_block(references: &[PathBuf]) -> Option<serde_json::Value> {
    if references.is_empty() {
        return None;
    }
    let listed: Vec<_> = references
        .iter()
        .map(|path| path.to_string_lossy())
        .collect();
    Some(json!({
        "type": "text",
        "text": format!("Read-only references:\n{}", listed.join("\n")),
    }))
}

fn selection_block(selection: Option<&TextSelection>) -> Option<serde_json::Value> {
    let selection = selection?;
    let lines = if selection.first_line == selection.last_line {
        format!("line {}", selection.first_line)
    } else {
        format!("lines {}-{}", selection.first_line, selection.last_line)
    };
    Some(json!({
        "type": "text",
        "text": format!(
            "The user selected {lines} of the file:\n<selection>\n{}\n</selection>",
            selection.text
        ),
    }))
}

#[cfg(test)]
mod tests {
    use serde_json::Value;

    use super::*;

    fn parse(line: &str) -> Value {
        serde_json::from_str(line.trim_end()).unwrap()
    }

    fn blocks(prompt: &Prompt) -> Value {
        let line = user_message(prompt);
        assert!(line.ends_with('\n'));
        let message = parse(&line);
        assert_eq!(message["type"], "user");
        assert_eq!(message["message"]["role"], "user");
        message["message"]["content"].clone()
    }

    fn content(text: &str, images: &[PromptImage], references: &[PathBuf]) -> Value {
        blocks(&Prompt {
            text: text.into(),
            images: images.to_vec(),
            references: references.to_vec(),
            selection: None,
        })
    }

    #[test]
    fn a_text_only_prompt_is_one_text_block() {
        assert_eq!(
            content("Tighten the intro", &[], &[]),
            json!([{ "type": "text", "text": "Tighten the intro" }])
        );
    }

    #[test]
    fn pasted_images_come_before_the_request() {
        let images = [PromptImage {
            name: "shot.png".into(),
            media_type: ImageType::Png,
            width: 1,
            height: 1,
            base64: "iVBORw0KGgo=".into(),
        }];

        assert_eq!(
            content("Match this layout", &images, &[]),
            json!([
                {
                    "type": "image",
                    "source": { "type": "base64", "media_type": "image/png", "data": "iVBORw0KGgo=" },
                },
                { "type": "text", "text": "Match this layout" },
            ])
        );
    }

    #[test]
    fn references_are_named_before_the_request_as_read_only() {
        let references = [
            PathBuf::from("/skills/interface"),
            PathBuf::from("/skills/ux-rules/SKILL.md"),
        ];

        assert_eq!(
            content("Match their structure", &[], &references),
            json!([
                {
                    "type": "text",
                    "text": "Read-only references:\n/skills/interface\n/skills/ux-rules/SKILL.md",
                },
                { "type": "text", "text": "Match their structure" },
            ])
        );
    }

    #[test]
    fn the_selected_text_is_quoted_with_its_lines_right_before_the_request() {
        let selected = |first_line, last_line| {
            blocks(&Prompt {
                text: "Shorten this".into(),
                images: vec![],
                references: vec![PathBuf::from("/skills/ux-rules/SKILL.md")],
                selection: Some(TextSelection {
                    text: "Never claude-in-chrome\nunless I name it.".into(),
                    first_line,
                    last_line,
                }),
            })
        };

        assert_eq!(
            selected(12, 13),
            json!([
                { "type": "text", "text": "Read-only references:\n/skills/ux-rules/SKILL.md" },
                {
                    "type": "text",
                    "text": "The user selected lines 12-13 of the file:\n<selection>\nNever claude-in-chrome\nunless I name it.\n</selection>",
                },
                { "type": "text", "text": "Shorten this" },
            ])
        );
        assert_eq!(
            selected(7, 7)[1]["text"],
            "The user selected line 7 of the file:\n<selection>\nNever claude-in-chrome\nunless I name it.\n</selection>"
        );
    }

    #[test]
    fn a_media_type_claude_cannot_read_is_refused_at_the_boundary() {
        let image = |media_type: &str| {
            serde_json::from_value::<PromptImage>(json!({
                "name": "scan",
                "mediaType": media_type,
                "width": 1,
                "height": 1,
                "base64": "AAAA",
            }))
        };

        assert!(image("image/png").is_ok());
        assert!(image("image/tiff").is_err());
    }

    #[test]
    fn an_acp_prompt_sends_images_inline_before_the_request() {
        let prompt = Prompt {
            text: "Match this layout".into(),
            images: vec![PromptImage {
                name: "shot.png".into(),
                media_type: ImageType::Png,
                width: 1,
                height: 1,
                base64: "iVBORw0KGgo=".into(),
            }],
            references: vec![],
            selection: None,
        };

        assert_eq!(
            prompt_blocks(&prompt),
            [
                json!({ "type": "image", "mimeType": "image/png", "data": "iVBORw0KGgo=" }),
                json!({ "type": "text", "text": "Match this layout" }),
            ]
        );
    }
}
