use std::path::Path;

use serde::Serialize;

use super::{git, locate, run, CommitChange, Located};
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum WorkingState {
    Clean,
    Modified,
    Untracked,
    Ignored {
        source: String,
        line: u32,
        pattern: String,
    },
}

pub fn working_change(path: &Path) -> AppResult<CommitChange> {
    let located = locate(path)?;
    let committed = format!("HEAD:{}", located.relative);
    let in_head = run(&located.root, &["cat-file", "-e", &committed])?
        .status
        .success();
    let before = if in_head {
        String::from_utf8_lossy(&git(&located.root, &["cat-file", "blob", &committed])?)
            .into_owned()
    } else {
        String::new()
    };
    Ok(CommitChange {
        before,
        after: String::from_utf8_lossy(&std::fs::read(path)?).into_owned(),
    })
}

pub(super) fn working_state(located: &Located) -> AppResult<WorkingState> {
    let status = git(
        &located.root,
        &[
            "status",
            "--porcelain=v1",
            "--ignored=matching",
            "-z",
            "--",
            &located.relative,
        ],
    )?;
    Ok(match status.get(..2) {
        None => WorkingState::Clean,
        Some(b"??") => WorkingState::Untracked,
        Some(b"!!") => ignore_rule(located)?,
        Some(_) => WorkingState::Modified,
    })
}

fn ignore_rule(located: &Located) -> AppResult<WorkingState> {
    let output = git(
        &located.root,
        &["check-ignore", "--verbose", "--", &located.relative],
    )?;
    let output = String::from_utf8_lossy(&output);
    let rule = output.split('\t').next().unwrap_or_default();
    let parsed = rule.split_once(':').and_then(|(source, rest)| {
        let (line, pattern) = rest.split_once(':')?;
        Some(WorkingState::Ignored {
            source: source.to_string(),
            line: line.parse().ok()?,
            pattern: pattern.to_string(),
        })
    });
    parsed
        .ok_or_else(|| AppError::internal(format!("Unexpected git check-ignore output: {output}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::history::file_history;
    use crate::git::test_repo::{git_ok, renamed_repo};
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn a_saved_edit_shows_as_uncommitted_changes() {
        let dir = renamed_repo();
        let file = dir.path().join("b.md");
        fs::write(
            &file,
            "first line\nsecond line\nthird line\nfourth\nfifth\n",
        )
        .unwrap();

        assert_eq!(file_history(&file).unwrap().working, WorkingState::Modified);
        let change = working_change(&file).unwrap();
        assert_eq!(
            change.before,
            "first line\nsecond line\nthird line\nfourth\n"
        );
        assert_eq!(
            change.after,
            "first line\nsecond line\nthird line\nfourth\nfifth\n"
        );
    }

    #[test]
    fn an_untracked_file_has_no_commits_and_starts_from_nothing() {
        let dir = renamed_repo();
        let file = dir.path().join("untracked.md");
        fs::write(&file, "x").unwrap();

        let history = file_history(&file).unwrap();

        assert!(history.commits.is_empty());
        assert_eq!(history.working, WorkingState::Untracked);
        let change = working_change(&file).unwrap();
        assert_eq!((change.before.as_str(), change.after.as_str()), ("", "x"));
    }

    #[test]
    fn an_ignored_file_names_the_rule_that_ignores_it() {
        let dir = renamed_repo();
        fs::write(dir.path().join(".gitignore"), "# drafts\nnotes/\n").unwrap();
        fs::create_dir(dir.path().join("notes")).unwrap();
        let file = dir.path().join("notes/idea.md");
        fs::write(&file, "x").unwrap();

        assert_eq!(
            file_history(&file).unwrap().working,
            WorkingState::Ignored {
                source: ".gitignore".into(),
                line: 2,
                pattern: "notes/".into(),
            }
        );
    }

    #[test]
    fn a_file_in_a_repository_without_commits_is_untracked() {
        let dir = tempdir().unwrap();
        git_ok(dir.path(), &["init", "-q"]);
        let file = dir.path().join("new.md");
        fs::write(&file, "x").unwrap();

        let history = file_history(&file).unwrap();

        assert!(history.commits.is_empty());
        assert_eq!(history.working, WorkingState::Untracked);
    }
}
