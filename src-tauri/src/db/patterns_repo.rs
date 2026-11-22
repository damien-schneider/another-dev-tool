use rusqlite::Connection;
use serde::de::DeserializeOwned;
use serde::Serialize;

use super::{get_meta, set_meta};
use crate::error::{AppError, AppResult};
use crate::patterns::{Finding, Rejected, Run};

const META_LAST_RUN: &str = "patterns_last_run";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Pattern {
    pub id: i64,
    #[serde(flatten)]
    pub finding: Finding,
    pub found_at: i64,
}

pub fn open(conn: &Connection) -> AppResult<Vec<Pattern>> {
    let mut stmt = conn.prepare(
        "SELECT id, finding, found_at FROM patterns WHERE dismissed_at IS NULL ORDER BY rank",
    )?;
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?, row.get(2)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    rows.into_iter()
        .map(|(id, finding, found_at)| {
            Ok(Pattern {
                id,
                finding: parse(&finding)?,
                found_at,
            })
        })
        .collect()
}

pub fn rejected(conn: &Connection) -> AppResult<Vec<Rejected>> {
    let mut stmt = conn.prepare(
        "SELECT finding FROM patterns WHERE dismissed_at IS NOT NULL ORDER BY dismissed_at",
    )?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    rows.iter().map(|finding| parse(finding)).collect()
}

pub fn replace(conn: &Connection, findings: &[Finding], run: &Run) -> AppResult<()> {
    conn.execute("DELETE FROM patterns WHERE dismissed_at IS NULL", [])?;
    let mut insert =
        conn.prepare("INSERT INTO patterns (finding, rank, found_at) VALUES (?1, ?2, ?3)")?;
    for (rank, finding) in findings.iter().enumerate() {
        insert.execute((json(finding)?, rank as i64, run.finished_at))?;
    }
    set_meta(conn, META_LAST_RUN, &json(run)?)
}

pub fn last_run(conn: &Connection) -> AppResult<Option<Run>> {
    get_meta(conn, META_LAST_RUN)?
        .map(|run| parse(&run))
        .transpose()
}

pub fn dismiss(conn: &Connection, id: i64, at: i64) -> AppResult<()> {
    let changed = conn.execute(
        "UPDATE patterns SET dismissed_at = ?2 WHERE id = ?1 AND dismissed_at IS NULL",
        (id, at),
    )?;
    if changed == 0 {
        return Err(AppError::NotFound(format!("pattern {id}")));
    }
    Ok(())
}

fn json(value: &impl Serialize) -> AppResult<String> {
    serde_json::to_string(value).map_err(|error| AppError::internal(error.to_string()))
}

fn parse<T: DeserializeOwned>(text: &str) -> AppResult<T> {
    serde_json::from_str(text).map_err(|error| AppError::internal(error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    fn finding(title: &str) -> Finding {
        serde_json::from_value(serde_json::json!({
            "kind": "rule",
            "title": title,
            "statement": format!("{title} always."),
            "scope": "global",
            "target": null,
            "change": "- line",
            "why": "repeated",
            "evidence": [{ "agent": "omp", "project": null, "at": 1, "text": "do it" }],
            "sessions": 3,
            "days": 2
        }))
        .unwrap()
    }

    fn run(finished_at: i64) -> Run {
        Run {
            finished_at,
            prompts: 10,
            sessions: 4,
            first_at: 1,
            last_at: 2,
            agents: Vec::new(),
            cost_usd: Some(2.0),
            unreadable: Vec::new(),
        }
    }

    #[test]
    fn a_new_run_replaces_open_patterns_and_remembers_dismissed_ones() {
        let db = Db::open_in_memory().unwrap();

        let (open, rejected, last) = db
            .with_conn(|conn| {
                replace(conn, &[finding("Small runs"), finding("PR link")], &run(1))?;
                let first = open(conn)?;
                dismiss(conn, first[1].id, 5)?;
                replace(conn, &[finding("No mono")], &run(9))?;
                Ok((open(conn)?, rejected(conn)?, last_run(conn)?))
            })
            .unwrap();

        let titles: Vec<&str> = open
            .iter()
            .map(|pattern| pattern.finding.title.as_str())
            .collect();
        assert_eq!(titles, ["No mono"]);
        assert_eq!(open[0].found_at, 9);
        assert_eq!(
            rejected,
            [Rejected {
                title: "PR link".to_string(),
                statement: "PR link always.".to_string(),
            }]
        );
        assert_eq!(last, Some(run(9)));
    }

    #[test]
    fn dismissing_twice_reports_the_pattern_as_gone() {
        let db = Db::open_in_memory().unwrap();

        let second = db
            .with_conn(|conn| {
                replace(conn, &[finding("Small runs")], &run(1))?;
                let id = open(conn)?[0].id;
                dismiss(conn, id, 2)?;
                Ok(dismiss(conn, id, 3))
            })
            .unwrap();

        assert!(matches!(second, Err(AppError::NotFound(_))));
    }

    #[test]
    fn serializes_a_pattern_flat_for_the_view() {
        let pattern = Pattern {
            id: 7,
            finding: finding("Small runs"),
            found_at: 3,
        };

        let json = serde_json::to_value(pattern).unwrap();

        assert_eq!(json["id"], 7);
        assert_eq!(json["title"], "Small runs");
        assert_eq!(json["foundAt"], 3);
        assert_eq!(json["evidence"][0]["agent"], "omp");
    }
}
