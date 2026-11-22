use std::fs;
use std::path::Path;
use std::process::Command;

use tempfile::tempdir;

pub fn git_ok(repo: &Path, args: &[&str]) {
    let status = Command::new("git")
        .args(["-c", "user.name=t", "-c", "user.email=t@t", "-C"])
        .arg(repo)
        .args(args)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .unwrap();
    assert!(status.success(), "git {args:?} failed");
}

pub fn renamed_repo() -> tempfile::TempDir {
    let dir = tempdir().unwrap();
    let repo = dir.path();
    git_ok(repo, &["init", "-q"]);
    fs::write(repo.join("a.md"), "first line\nsecond line\nthird line\n").unwrap();
    git_ok(repo, &["add", "a.md"]);
    git_ok(repo, &["commit", "-q", "-m", "add"]);
    git_ok(repo, &["mv", "a.md", "b.md"]);
    git_ok(repo, &["commit", "-q", "-m", "rename"]);
    fs::write(
        repo.join("b.md"),
        "first line\nsecond line\nthird line\nfourth\n",
    )
    .unwrap();
    git_ok(repo, &["commit", "-q", "-am", "edit"]);
    dir
}
