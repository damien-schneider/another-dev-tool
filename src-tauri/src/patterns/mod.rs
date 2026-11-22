mod clean;
mod corpus;
mod library;
mod runner;
pub mod sources;
mod verify;

use std::collections::{BTreeMap, HashMap};
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::db::files_repo::FileRow;
use crate::db::now_ms;
use crate::error::{AppError, AppResult};
use library::Library;
use sources::{Agent, Collected, Unreadable};

pub use library::{Rejected, KINDS as LIBRARY_KINDS};
pub use runner::{Progress, Runner, Stage};
pub use verify::Finding;

const ANALYZE: &str = include_str!("prompts/analyze.md");
const JUDGE: &str = include_str!("prompts/judge.md");
/// ≈135k tokens at the ≈2.7 chars per token measured on real prompt history: one Opus call with room for the library.
const CORPUS_CHARS: usize = 360_000;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCount {
    pub agent: Agent,
    pub prompts: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Run {
    pub finished_at: i64,
    pub prompts: usize,
    pub sessions: usize,
    pub first_at: i64,
    pub last_at: i64,
    pub agents: Vec<AgentCount>,
    pub cost_usd: Option<f64>,
    pub unreadable: Vec<Unreadable>,
}

pub struct Analysis {
    pub run: Run,
    pub findings: Vec<Finding>,
}

pub struct Inputs<'a> {
    pub binary: &'a Path,
    pub home: &'a Path,
    pub collected: Collected,
    pub files: Vec<FileRow>,
    pub rejected: &'a [Rejected],
}

/// `Ok(None)` = cancelled.
pub fn analyze(
    runner: &Runner,
    inputs: Inputs<'_>,
    report: impl Fn(Progress),
) -> AppResult<Option<Analysis>> {
    let Collected {
        prompts,
        unreadable,
    } = inputs.collected;
    let corpus = corpus::build(prompts, CORPUS_CHARS);
    if corpus.prompts.is_empty() {
        let failures: String = unreadable
            .iter()
            .map(|store| {
                format!(
                    "; {} couldn't be read: {}",
                    store.agent.name(),
                    store.reason
                )
            })
            .collect();
        let supported: Vec<&str> = sources::supported().map(Agent::name).collect();
        return Err(AppError::NotFound(format!(
            "no prompts were found in {}{failures}",
            supported.join(", ")
        )));
    }
    let step = |stage| {
        let progress = Progress {
            stage,
            prompts: corpus.prompts.len(),
            sessions: corpus.sessions(),
        };
        runner.advance(progress);
        report(progress);
    };

    step(Stage::Analyzing);
    let library = Library::select(inputs.files, inputs.home, &corpus.projects());
    let request = format!(
        "{ANALYZE}\n{}\n<prompts>\n{}</prompts>\n",
        library.render(inputs.rejected),
        corpus.text
    );
    let Some(proposed) = runner.ask(inputs.binary, &request)? else {
        return Ok(None);
    };
    let candidates = verify::candidates(&proposed.text)?;

    step(Stage::Checking);
    let mut costs = vec![proposed.cost_usd];
    let rejections = if candidates.is_empty() {
        HashMap::new()
    } else {
        let request = verify::judge_request(JUDGE, &candidates, &corpus);
        let Some(checked) = runner.ask(inputs.binary, &request)? else {
            return Ok(None);
        };
        costs.push(checked.cost_usd);
        verify::rejections(&checked.text)?
    };
    let findings = verify::findings(candidates, &rejections, &corpus, |target| {
        library.resolve(target, inputs.home)
    });

    let mut agents: BTreeMap<Agent, usize> = BTreeMap::new();
    for prompt in &corpus.prompts {
        *agents.entry(prompt.agent).or_default() += 1;
    }
    let times = corpus.prompts.iter().map(|prompt| prompt.at_ms);
    Ok(Some(Analysis {
        run: Run {
            finished_at: now_ms(),
            prompts: corpus.prompts.len(),
            sessions: corpus.sessions(),
            first_at: times.clone().min().unwrap_or_default(),
            last_at: times.max().unwrap_or_default(),
            agents: agents
                .into_iter()
                .map(|(agent, prompts)| AgentCount { agent, prompts })
                .collect(),
            cost_usd: costs.into_iter().flatten().reduce(|sum, cost| sum + cost),
            unreadable,
        },
        findings,
    }))
}

#[cfg(test)]
mod tests {
    use std::os::unix::fs::PermissionsExt as _;

    use super::sources::UserPrompt;
    use super::*;

    const DAY: i64 = 86_400_000;

    fn fake_claude(dir: &Path, proposal: &str, check: &str) -> std::path::PathBuf {
        let envelope = |result: &str, cost: f64| {
            serde_json::json!({ "is_error": false, "result": result, "total_cost_usd": cost })
                .to_string()
        };
        std::fs::write(dir.join("proposal.json"), envelope(proposal, 1.5)).unwrap();
        std::fs::write(dir.join("check.json"), envelope(check, 0.25)).unwrap();
        let script = dir.join("claude");
        std::fs::write(
            &script,
            format!(
                "#!/bin/sh\ncase \"$(cat)\" in\n  *\"Each cluster below\"*) cat '{0}/check.json' ;;\n  *) cat '{0}/proposal.json' ;;\nesac\n",
                dir.display()
            ),
        )
        .unwrap();
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
        script
    }

    fn prompt(session: &str, at_ms: i64, text: &str) -> UserPrompt {
        UserPrompt {
            agent: Agent::ClaudeCode,
            session: session.to_string(),
            project: None,
            at_ms,
            text: text.to_string(),
        }
    }

    #[test]
    fn keeps_what_the_check_accepts_and_totals_both_calls() {
        let dir = tempfile::tempdir().unwrap();
        let proposal = r#"[{"kind":"rule","title":"Small runs","statement":"Run only the touched tests.","scope":"global","target":null,"change":"- Run only the touched tests.","evidence":["p0","p1","p2","p3"],"why":"The machine freezes."}]"#;
        let claude = fake_claude(dir.path(), proposal, r#"{"c0":["p3"]}"#);
        let runner = Runner::default();
        runner.begin().unwrap();
        let stages = std::sync::Mutex::new(Vec::new());

        let analysis = analyze(
            &runner,
            Inputs {
                binary: &claude,
                home: dir.path(),
                collected: Collected {
                    prompts: vec![
                        prompt("a", 0, "only run the tests you touched"),
                        prompt("b", DAY, "don't run the whole suite"),
                        prompt("c", 2 * DAY, "my laptop froze, fewer tests"),
                        prompt("d", 3 * DAY, "please do then"),
                    ],
                    unreadable: Vec::new(),
                },
                files: Vec::new(),
                rejected: &[],
            },
            |progress| stages.lock().unwrap().push(progress.stage),
        )
        .unwrap()
        .unwrap();

        assert_eq!(analysis.findings.len(), 1);
        assert_eq!(analysis.findings[0].sessions, 3);
        assert_eq!(analysis.findings[0].evidence.len(), 3);
        assert_eq!(analysis.run.prompts, 4);
        assert_eq!(analysis.run.cost_usd, Some(1.75));
        assert_eq!(*stages.lock().unwrap(), [Stage::Analyzing, Stage::Checking]);
    }
}
