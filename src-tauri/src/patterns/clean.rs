use std::collections::HashMap;

use super::sources::{Agent, UserPrompt};

const SAME_PROMPT_WINDOW_MS: i64 = 60_000;
const IMAGE_PLACEHOLDER: &str = "[Image #";
const REMINDER_OPEN: &str = "<system-reminder>";
const REMINDER_CLOSE: &str = "</system-reminder>";

pub fn clean(prompts: Vec<UserPrompt>) -> Vec<UserPrompt> {
    let mut cleaned: Vec<UserPrompt> = prompts
        .into_iter()
        .filter_map(|mut prompt| {
            prompt.text = without_image_placeholders(&without_reminders(&prompt.text))
                .trim()
                .to_owned();
            (!prompt.text.is_empty()).then_some(prompt)
        })
        .collect();
    cleaned.sort_by_key(|prompt| prompt.at_ms);
    let mut kept_at: HashMap<(Agent, String), i64> = HashMap::new();
    cleaned.retain(|prompt| {
        let key = (prompt.agent, normalized(&prompt.text));
        match kept_at.get(&key) {
            Some(&at) if prompt.at_ms - at < SAME_PROMPT_WINDOW_MS => false,
            _ => {
                kept_at.insert(key, prompt.at_ms);
                true
            }
        }
    });
    cleaned
}

fn without_reminders(text: &str) -> String {
    let mut kept = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find(REMINDER_OPEN) {
        let Some(length) = rest[start..].find(REMINDER_CLOSE) else {
            break;
        };
        kept.push_str(&rest[..start]);
        rest = &rest[start + length + REMINDER_CLOSE.len()..];
    }
    kept.push_str(rest);
    kept
}

fn without_image_placeholders(text: &str) -> String {
    let mut kept = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find(IMAGE_PLACEHOLDER) {
        let after = &rest[start + IMAGE_PLACEHOLDER.len()..];
        match placeholder_len(after) {
            Some(len) => {
                kept.push_str(&rest[..start]);
                rest = &after[len..];
            }
            None => {
                kept.push_str(&rest[..start + IMAGE_PLACEHOLDER.len()]);
                rest = after;
            }
        }
    }
    kept.push_str(rest);
    kept
}

fn placeholder_len(after: &str) -> Option<usize> {
    let close = after.find(']')?;
    let inner = &after[..close];
    let digits = |value: &str| !value.is_empty() && value.bytes().all(|b| b.is_ascii_digit());
    let valid = match inner.split_once(", ") {
        Some((number, size)) => {
            digits(number)
                && size
                    .split_once('x')
                    .is_some_and(|(width, height)| digits(width) && digits(height))
        }
        None => digits(inner),
    };
    valid.then_some(close + 1)
}

fn normalized(text: &str) -> String {
    text.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    const MINUTE: i64 = 60_000;

    fn prompt(agent: Agent, session: &str, at_ms: i64, text: &str) -> UserPrompt {
        UserPrompt {
            agent,
            session: session.into(),
            project: Some("/repo".into()),
            at_ms,
            text: text.into(),
        }
    }

    fn texts(prompts: &[UserPrompt]) -> Vec<&str> {
        prompts.iter().map(|prompt| prompt.text.as_str()).collect()
    }

    #[test]
    fn keeps_a_long_prompt_copied_verbatim_into_many_fork_threads_once() {
        let typed = "Make sure every screen of the onboarding answers the frictions listed in the Slack thread, and remove copy that does not help the user decide.";
        let prompts: Vec<UserPrompt> = (0..5)
            .map(|fork| {
                prompt(
                    Agent::MastraCode,
                    &format!("fork-{fork}"),
                    1_000 + fork,
                    typed,
                )
            })
            .collect();

        let cleaned = clean(prompts);

        assert_eq!(texts(&cleaned), vec![typed]);
        assert_eq!(cleaned[0].session, "fork-0");
    }

    #[test]
    fn strips_image_placeholders_and_drops_prompts_left_empty() {
        let prompts = vec![
            prompt(
                Agent::Omp,
                "s1",
                0,
                "look here [Image #1, 1508x1508] and [Image #2]",
            ),
            prompt(Agent::Omp, "s1", MINUTE, "[Image #3]"),
            prompt(Agent::Omp, "s1", 2 * MINUTE, "keep [Image #x] as typed"),
        ];

        assert_eq!(
            texts(&clean(prompts)),
            vec!["look here  and", "keep [Image #x] as typed"]
        );
    }

    #[test]
    fn strips_reminders_a_harness_injected_into_the_prompt() {
        let prompts = vec![
            prompt(
                Agent::ClaudeCode,
                "s1",
                0,
                "<system-reminder>\nThe user started this session without choosing a project.\n</system-reminder>\n\nCheck my cleanup",
            ),
            prompt(
                Agent::ClaudeCode,
                "s1",
                MINUTE,
                "<system-reminder>only injected</system-reminder>",
            ),
            prompt(
                Agent::ClaudeCode,
                "s1",
                2 * MINUTE,
                "explain what <system-reminder> tags do",
            ),
        ];

        assert_eq!(
            texts(&clean(prompts)),
            vec!["Check my cleanup", "explain what <system-reminder> tags do"]
        );
    }

    #[test]
    fn keeps_the_same_short_prompt_typed_in_two_sessions_on_different_minutes() {
        let prompts = vec![
            prompt(Agent::ClaudeCode, "s2", 5 * MINUTE, "give me the PR link"),
            prompt(Agent::ClaudeCode, "s1", 0, "Give me the  PR link"),
        ];

        let cleaned = clean(prompts);

        assert_eq!(
            cleaned
                .iter()
                .map(|p| p.session.as_str())
                .collect::<Vec<_>>(),
            vec!["s1", "s2"]
        );
    }

    #[test]
    fn keeps_only_the_earliest_copy_of_the_same_prompt_within_a_minute() {
        let prompts = vec![
            prompt(Agent::MastraCode, "fork", 30_000, "push please"),
            prompt(Agent::MastraCode, "main", 0, "Push   please"),
            prompt(Agent::MastraCode, "other", 10_000, "something else"),
        ];

        assert_eq!(
            texts(&clean(prompts)),
            vec!["Push   please", "something else"]
        );
    }
}
