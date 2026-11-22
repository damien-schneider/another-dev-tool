use std::path::Path;

use serde::Serialize;

use super::working::{working_state, WorkingState};
use super::{git, locate, run, CommitChange, Located};
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileCommit {
    pub hash: String,
    pub short_hash: String,
    pub author: String,
    pub time_ms: i64,
    pub subject: String,
    pub path: Option<String>,
    pub previous_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileHistory {
    pub commits: Vec<FileCommit>,
    pub working: WorkingState,
}

pub fn file_history(path: &Path) -> AppResult<FileHistory> {
    let located = locate(path)?;
    Ok(FileHistory {
        commits: commits_of(&located)?,
        working: working_state(&located)?,
    })
}

fn commits_of(located: &Located) -> AppResult<Vec<FileCommit>> {
    if !has_commits(&located.root)? {
        return Ok(Vec::new());
    }
    let output = git(
        &located.root,
        &[
            "log",
            "--follow",
            "--no-merges",
            "-M",
            "--format=%x1e%H%x1f%h%x1f%an%x1f%at%x1f%s",
            "--name-status",
            "--",
            &located.relative,
        ],
    )?;
    Ok(parse_log(&String::from_utf8_lossy(&output)))
}

pub fn commit_change(
    path: &Path,
    hash: &str,
    after_path: Option<&str>,
    before_path: Option<&str>,
) -> AppResult<CommitChange> {
    if !is_hex_hash(hash) {
        return Err(AppError::InvalidInput(format!(
            "{hash} is not a commit hash."
        )));
    }
    let root = locate(path)?.root;
    let blob = |object: Option<String>| -> AppResult<String> {
        match object {
            Some(object) => Ok(String::from_utf8_lossy(&git(
                &root,
                &["cat-file", "blob", &object],
            )?)
            .into_owned()),
            None => Ok(String::new()),
        }
    };
    Ok(CommitChange {
        before: blob(before_path.map(|p| format!("{hash}^:{p}")))?,
        after: blob(after_path.map(|p| format!("{hash}:{p}")))?,
    })
}

pub fn parse_log(output: &str) -> Vec<FileCommit> {
    output.split('\x1e').filter_map(parse_record).collect()
}

fn parse_record(record: &str) -> Option<FileCommit> {
    let mut lines = record.lines();
    let mut fields = lines.next()?.splitn(5, '\x1f');
    let hash = fields.next()?.to_string();
    let short_hash = fields.next()?.to_string();
    let author = fields.next()?.to_string();
    let time_ms = fields.next()?.trim().parse::<i64>().ok()? * 1000;
    let subject = fields.next()?.to_string();

    let status = lines.find(|line| !line.trim().is_empty())?;
    let mut parts = status.split('\t');
    let kind = parts.next()?.chars().next()?;
    let first = parts.next()?.to_string();
    let second = parts.next().map(str::to_string);
    let (path, previous_path) = match (kind, second) {
        ('M' | 'T', _) => (Some(first.clone()), Some(first)),
        ('A', _) => (Some(first), None),
        ('D', _) => (None, Some(first)),
        ('R', Some(new)) => (Some(new), Some(first)),
        ('C', Some(new)) => (Some(new), None),
        _ => return None,
    };

    Some(FileCommit {
        hash,
        short_hash,
        author,
        time_ms,
        subject,
        path,
        previous_path,
    })
}

fn is_hex_hash(hash: &str) -> bool {
    (4..=64).contains(&hash.len()) && hash.chars().all(|c| c.is_ascii_hexdigit())
}

fn has_commits(root: &Path) -> AppResult<bool> {
    Ok(run(root, &["rev-parse", "--verify", "--quiet", "HEAD"])?
        .status
        .success())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::test_repo::renamed_repo;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn history_lists_commits_newest_first_and_follows_a_rename() {
        let dir = renamed_repo();

        let history = file_history(&dir.path().join("b.md")).unwrap();
        let commits = history.commits;

        assert_eq!(history.working, WorkingState::Clean);
        let summary: Vec<_> = commits
            .iter()
            .map(|c| {
                (
                    c.subject.as_str(),
                    c.path.as_deref(),
                    c.previous_path.as_deref(),
                )
            })
            .collect();
        assert_eq!(
            summary,
            vec![
                ("edit", Some("b.md"), Some("b.md")),
                ("rename", Some("b.md"), Some("a.md")),
                ("add", Some("a.md"), None),
            ]
        );
        for commit in &commits {
            assert_eq!(commit.hash.len(), 40);
            assert!(commit.hash.starts_with(&commit.short_hash));
            assert!(!commit.short_hash.is_empty());
            assert_eq!(commit.author, "t");
            assert!(commit.time_ms > 0);
        }
    }

    #[test]
    fn change_returns_the_text_before_and_after_a_commit() {
        let dir = renamed_repo();
        let file = dir.path().join("b.md");
        let commits = file_history(&file).unwrap().commits;
        let change_of = |commit: &FileCommit| {
            commit_change(
                &file,
                &commit.hash,
                commit.path.as_deref(),
                commit.previous_path.as_deref(),
            )
            .unwrap()
        };

        let edit = change_of(&commits[0]);
        assert_eq!(edit.before, "first line\nsecond line\nthird line\n");
        assert_eq!(edit.after, "first line\nsecond line\nthird line\nfourth\n");

        let add = change_of(&commits[2]);
        assert_eq!(add.before, "");
        assert_eq!(add.after, "first line\nsecond line\nthird line\n");
    }

    #[test]
    fn a_file_outside_any_repository_is_not_found() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("loose.md");
        fs::write(&file, "x").unwrap();

        let err = file_history(&file).unwrap_err();

        assert!(matches!(err, AppError::NotFound(_)), "{err:?}");
    }

    #[test]
    fn a_non_hex_hash_is_rejected() {
        let dir = renamed_repo();
        let file = dir.path().join("b.md");

        for hash in ["--output=x", "HEAD", "abc", "zzzz"] {
            let err = commit_change(&file, hash, Some("b.md"), None).unwrap_err();
            assert!(matches!(err, AppError::InvalidInput(_)), "{hash}: {err:?}");
        }
    }

    #[test]
    fn parses_every_name_status_kind() {
        let record = |status: &str| format!("\x1eh\x1fs\x1fa\x1f2\x1fsubj\n\n{status}\n");
        let output = [
            record("M\tm.md"),
            record("T\tt.md"),
            record("A\tn.md"),
            record("D\tgone.md"),
            record("R087\told.md\tnew.md"),
            record("C100\tsrc.md\tcopy.md"),
        ]
        .concat();

        let paths: Vec<_> = parse_log(&output)
            .into_iter()
            .map(|c| (c.path, c.previous_path))
            .collect();

        let some = |s: &str| Some(s.to_string());
        assert_eq!(
            paths,
            vec![
                (some("m.md"), some("m.md")),
                (some("t.md"), some("t.md")),
                (some("n.md"), None),
                (None, some("gone.md")),
                (some("new.md"), some("old.md")),
                (some("copy.md"), None),
            ]
        );
        assert_eq!(parse_log(&record("M\tm.md"))[0].time_ms, 2000);
    }
}
