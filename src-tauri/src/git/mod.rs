pub mod history;
#[cfg(test)]
mod test_repo;
pub mod working;

use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CommitChange {
    pub before: String,
    pub after: String,
}

struct Located {
    root: PathBuf,
    relative: String,
}

fn locate(path: &Path) -> AppResult<Located> {
    let real = std::fs::canonicalize(path)?;
    let parent = real
        .parent()
        .ok_or_else(|| AppError::InvalidPath(real.display().to_string()))?;
    let output = run(parent, &["rev-parse", "--show-toplevel"])?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("not a git repository") {
            return Err(AppError::NotFound(
                "This file isn't in a git repository.".into(),
            ));
        }
        return Err(AppError::internal(stderr.trim()));
    }
    let top = String::from_utf8_lossy(&output.stdout);
    let root = std::fs::canonicalize(top.trim())?;
    let relative = real
        .strip_prefix(&root)
        .map_err(|_| AppError::InvalidPath(real.display().to_string()))?
        .to_string_lossy()
        .into_owned();
    Ok(Located { root, relative })
}

/// Tracked and untracked-but-not-ignored files under `dir`, relative to it.
pub fn project_files(dir: &Path) -> AppResult<Vec<String>> {
    let listed = git(
        dir,
        &["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    )?;
    Ok(listed
        .split(|byte| *byte == 0)
        .filter(|entry| !entry.is_empty())
        .map(|entry| String::from_utf8_lossy(entry).into_owned())
        .collect())
}

fn git(dir: &Path, args: &[&str]) -> AppResult<Vec<u8>> {
    let output = run(dir, args)?;
    if !output.status.success() {
        return Err(AppError::internal(
            String::from_utf8_lossy(&output.stderr).trim(),
        ));
    }
    Ok(output.stdout)
}

fn run(dir: &Path, args: &[&str]) -> AppResult<std::process::Output> {
    Command::new("git")
        .env("LC_ALL", "C")
        .args(["--no-optional-locks", "-c", "core.quotepath=off", "-C"])
        .arg(dir)
        .args(args)
        .output()
        .map_err(|err| AppError::internal(format!("git could not run: {err}")))
}
