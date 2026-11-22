use std::collections::{HashMap, HashSet};
use std::fmt::Write as _;

use serde::{Deserialize, Serialize};

use super::corpus::{self, Corpus};
use super::sources::{Agent, UserPrompt};
use crate::error::{AppError, AppResult};

const MIN_SESSIONS: usize = 3;
const MIN_DAYS: usize = 2;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Strengthen,
    Automate,
    Rule,
    Skill,
    Memory,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Candidate {
    pub kind: Kind,
    pub title: String,
    pub statement: String,
    #[serde(default)]
    pub scope: String,
    #[serde(default)]
    pub target: Option<String>,
    pub change: String,
    #[serde(default)]
    pub evidence: Vec<String>,
    #[serde(default)]
    pub why: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Evidence {
    pub agent: Agent,
    pub project: Option<String>,
    pub at: i64,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    pub kind: Kind,
    pub title: String,
    pub statement: String,
    pub scope: String,
    pub target: Option<String>,
    pub change: String,
    pub why: String,
    pub evidence: Vec<Evidence>,
    pub sessions: usize,
    pub days: usize,
}

pub fn candidates(reply: &str) -> AppResult<Vec<Candidate>> {
    let items: Vec<serde_json::Value> =
        serde_json::from_str(enclosed(reply, '[', ']')?).map_err(|_| unreadable())?;
    Ok(items
        .into_iter()
        .filter_map(|item| serde_json::from_value(item).ok())
        .collect())
}

pub fn judge_request(instructions: &str, candidates: &[Candidate], corpus: &Corpus) -> String {
    let mut out = format!("{instructions}\n");
    for (index, candidate) in candidates.iter().enumerate() {
        let _ = writeln!(out, "\n### c{index}: {}", candidate.statement);
        for id in cited(candidate, corpus) {
            if let Some(line) = corpus.line(&id) {
                let _ = writeln!(out, "{id} {line}");
            }
        }
    }
    out
}

/// Cluster key (`c0`) → ids of the prompts that do not support it.
pub fn rejections(reply: &str) -> AppResult<HashMap<String, HashSet<String>>> {
    let raw: HashMap<String, Vec<String>> =
        serde_json::from_str(enclosed(reply, '{', '}')?).map_err(|_| unreadable())?;
    Ok(raw
        .into_iter()
        .map(|(cluster, ids)| {
            (
                cluster.to_lowercase(),
                ids.into_iter().map(|id| id.trim().to_string()).collect(),
            )
        })
        .collect())
}

pub fn findings(
    candidates: Vec<Candidate>,
    rejections: &HashMap<String, HashSet<String>>,
    corpus: &Corpus,
    resolve: impl Fn(&str) -> Option<String>,
) -> Vec<Finding> {
    let none = HashSet::new();
    candidates
        .into_iter()
        .enumerate()
        .filter_map(|(index, candidate)| {
            let rejected = rejections.get(&format!("c{index}")).unwrap_or(&none);
            let mut kept: Vec<&UserPrompt> = cited(&candidate, corpus)
                .iter()
                .filter(|id| !rejected.contains(*id))
                .filter_map(|id| corpus.get(id))
                .collect();
            kept.sort_by_key(|prompt| prompt.at_ms);
            let sessions: HashSet<(Agent, &str)> = kept
                .iter()
                .map(|prompt| (prompt.agent, prompt.session.as_str()))
                .collect();
            let days: HashSet<i64> = kept
                .iter()
                .map(|prompt| corpus::day(prompt.at_ms))
                .collect();
            if sessions.len() < MIN_SESSIONS || days.len() < MIN_DAYS {
                return None;
            }
            Some(Finding {
                target: candidate.target.as_deref().and_then(&resolve),
                kind: candidate.kind,
                title: candidate.title,
                statement: candidate.statement,
                scope: candidate.scope,
                change: candidate.change,
                why: candidate.why,
                sessions: sessions.len(),
                days: days.len(),
                evidence: kept
                    .into_iter()
                    .map(|prompt| Evidence {
                        agent: prompt.agent,
                        project: prompt.project.clone(),
                        at: prompt.at_ms,
                        text: prompt.text.clone(),
                    })
                    .collect(),
            })
        })
        .collect()
}

fn cited(candidate: &Candidate, corpus: &Corpus) -> Vec<String> {
    let mut seen = HashSet::new();
    candidate
        .evidence
        .iter()
        .map(|id| id.trim().to_string())
        .filter(|id| corpus.get(id).is_some() && seen.insert(id.clone()))
        .collect()
}

fn enclosed(reply: &str, open: char, close: char) -> AppResult<&str> {
    match (reply.find(open), reply.rfind(close)) {
        (Some(start), Some(end)) if start < end => Ok(&reply[start..=end]),
        _ => Err(unreadable()),
    }
}

fn unreadable() -> AppError {
    AppError::internal("Claude's answer could not be read; run the analysis again")
}

#[cfg(test)]
mod tests {
    use super::*;

    const DAY: i64 = 86_400_000;

    fn corpus(prompts: &[(&str, i64, &str)]) -> Corpus {
        corpus::build(
            prompts
                .iter()
                .map(|(session, at_ms, text)| UserPrompt {
                    agent: Agent::Codex,
                    session: (*session).to_string(),
                    project: None,
                    at_ms: *at_ms,
                    text: (*text).to_string(),
                })
                .collect(),
            100_000,
        )
    }

    fn candidate(evidence: &[&str]) -> Candidate {
        Candidate {
            kind: Kind::Rule,
            title: "Small runs".to_string(),
            statement: "Never run the whole test suite.".to_string(),
            scope: "global".to_string(),
            target: Some("~/.agents/AGENTS.md".to_string()),
            change: "- Run only the touched tests.".to_string(),
            evidence: evidence.iter().map(|id| (*id).to_string()).collect(),
            why: "The machine freezes.".to_string(),
        }
    }

    fn rejecting(ids: &[&str]) -> HashMap<String, HashSet<String>> {
        HashMap::from([(
            "c0".to_string(),
            ids.iter().map(|id| (*id).to_string()).collect(),
        )])
    }

    fn three_sessions() -> Corpus {
        corpus(&[
            ("a", 0, "don't run every test"),
            ("b", DAY, "only the touched tests please"),
            ("c", 2 * DAY, "my laptop froze, run fewer tests"),
            ("c", 2 * DAY + 1, "please do then"),
        ])
    }

    #[test]
    fn keeps_a_pattern_seen_in_three_sessions_on_two_days_with_counts_from_its_evidence() {
        let corpus = three_sessions();

        let found = findings(
            vec![candidate(&["p0", "p1", "p2", "p2", "p99"])],
            &HashMap::new(),
            &corpus,
            |_| Some("/home/.agents/AGENTS.md".to_string()),
        );

        assert_eq!(found.len(), 1);
        assert_eq!(found[0].sessions, 3);
        assert_eq!(found[0].days, 3);
        assert_eq!(found[0].evidence.len(), 3);
        assert_eq!(found[0].target.as_deref(), Some("/home/.agents/AGENTS.md"));
    }

    #[test]
    fn drops_a_pattern_once_rejected_citations_leave_it_under_the_bar() {
        let corpus = three_sessions();

        let found = findings(
            vec![candidate(&["p0", "p1", "p3"])],
            &rejecting(&["p3"]),
            &corpus,
            |_| None,
        );

        assert!(found.is_empty());
    }

    #[test]
    fn drops_a_pattern_repeated_on_a_single_day() {
        let corpus = corpus(&[("a", 0, "x"), ("b", 1, "x again"), ("c", 2, "x once more")]);

        let found = findings(
            vec![candidate(&["p0", "p1", "p2"])],
            &HashMap::new(),
            &corpus,
            |_| None,
        );

        assert!(found.is_empty());
    }

    #[test]
    fn reads_the_list_inside_a_chatty_reply_and_skips_malformed_items() {
        let reply = r#"Here you go:
[{"kind":"rule","title":"T","statement":"S","target":null,"change":"C","evidence":["p1"]},
 {"kind":"drop","title":"T","statement":"S","change":"C"}]
Done."#;

        let read = candidates(reply).unwrap();

        assert_eq!(read.len(), 1);
        assert_eq!(read[0].kind, Kind::Rule);
        assert!(candidates("no list here").is_err());
    }

    #[test]
    fn reads_the_rejected_ids_per_cluster() {
        let read = rejections("```json\n{\"C0\": [\"p3 \"], \"c1\": []}\n```").unwrap();

        assert_eq!(read["c0"], HashSet::from(["p3".to_string()]));
        assert!(read["c1"].is_empty());
    }

    #[test]
    fn asks_the_judge_about_each_cited_prompt_once() {
        let corpus = three_sessions();

        let request = judge_request("Check these.", &[candidate(&["p1", "p1", "p42"])], &corpus);

        assert_eq!(
            request,
            "Check these.\n\n### c0: Never run the whole test suite.\np1 only the touched tests please\n"
        );
    }
}
