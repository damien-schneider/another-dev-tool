use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::json;

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

#[derive(Debug, Clone, Deserialize)]
pub struct Prompt {
    pub text: String,
    pub images: Vec<PromptImage>,
    pub references: Vec<PathBuf>,
}

/// One `--input-format stream-json` line. Images go before the text, the
/// order Anthropic recommends for image prompts.
pub fn user_message(prompt: &Prompt) -> String {
    let blocks: Vec<_> = prompt
        .images
        .iter()
        .map(|image| {
            json!({
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": image.media_type,
                    "data": image.base64,
                },
            })
        })
        .chain(references_block(&prompt.references))
        .chain([json!({ "type": "text", "text": prompt.text })])
        .collect();
    let message = json!({
        "type": "user",
        "message": { "role": "user", "content": blocks },
    });
    format!("{message}\n")
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

#[cfg(test)]
mod tests {
    use serde_json::Value;

    use super::*;

    fn parse(line: &str) -> Value {
        serde_json::from_str(line.trim_end()).unwrap()
    }

    fn content(text: &str, images: &[PromptImage], references: &[PathBuf]) -> Value {
        let line = user_message(&Prompt {
            text: text.into(),
            images: images.to_vec(),
            references: references.to_vec(),
        });
        assert!(line.ends_with('\n'));
        let message = parse(&line);
        assert_eq!(message["type"], "user");
        assert_eq!(message["message"]["role"], "user");
        message["message"]["content"].clone()
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
}
