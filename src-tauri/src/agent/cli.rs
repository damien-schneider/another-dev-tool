use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;

pub const CLAUDE: &str = "claude";
const EXTRA_PATHS: &str = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin";
const STDERR_TAIL: usize = 600;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStatus {
    pub available: bool,
    pub path: Option<String>,
    pub version: Option<String>,
}

fn install_prefixes() -> Vec<PathBuf> {
    let mut prefixes = vec![
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
    ];
    if let Some(home) = dirs::home_dir() {
        prefixes.insert(0, home.join(".bun/bin"));
        prefixes.insert(0, home.join(".claude/local"));
        prefixes.insert(0, home.join(".local/bin"));
    }
    prefixes
}

/// A bundled app inherits a bare PATH, so the login shell is the only place a
/// tool is guaranteed to be resolvable once the usual prefixes miss.
fn from_login_shell(binary: &str) -> Option<PathBuf> {
    let shell = std::env::var("SHELL").ok()?;
    let output = Command::new(shell)
        .args(["-lic", &format!("command -v {binary}")])
        .output()
        .ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let path = PathBuf::from(
        stdout
            .lines()
            .rev()
            .find(|line| !line.trim().is_empty())?
            .trim(),
    );
    path.is_file().then(|| settled(&path))
}

/// Version managers such as fnm hand each shell a throwaway symlinked bin
/// directory; its real target outlives the shell that printed it.
fn settled(path: &Path) -> PathBuf {
    match (
        path.parent().and_then(|dir| dir.canonicalize().ok()),
        path.file_name(),
    ) {
        (Some(dir), Some(name)) => dir.join(name),
        _ => path.to_path_buf(),
    }
}

pub fn resolve(binary: &str) -> Option<PathBuf> {
    install_prefixes()
        .into_iter()
        .map(|prefix| prefix.join(binary))
        .find(|candidate| candidate.is_file())
        .or_else(|| from_login_shell(binary))
}

/// The child spawns node and its own helpers, so it needs a usable PATH of its
/// own — not the stripped one a bundled app is launched with.
pub fn child_path(binary: &Path) -> String {
    let inherited = std::env::var("PATH").unwrap_or_default();
    let own = binary
        .parent()
        .map(|dir| dir.display().to_string())
        .unwrap_or_default();
    format!("{own}:{EXTRA_PATHS}:{inherited}")
}

pub fn status() -> AgentStatus {
    let Some(path) = resolve(CLAUDE) else {
        return AgentStatus {
            available: false,
            path: None,
            version: None,
        };
    };
    let version = Command::new(&path)
        .arg("--version")
        .env("PATH", child_path(&path))
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string());

    AgentStatus {
        available: version.is_some(),
        path: Some(path.display().to_string()),
        version,
    }
}

pub fn crash_reason(stderr: &str) -> String {
    let tail = stderr.trim();
    if tail.is_empty() {
        return "the agent stopped unexpectedly".to_string();
    }
    tail.chars()
        .skip(tail.chars().count().saturating_sub(STDERR_TAIL))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn child_path_leads_with_the_binary_own_directory() {
        let path = child_path(Path::new("/Users/someone/.local/bin/claude"));

        assert!(path.starts_with("/Users/someone/.local/bin:"));
        assert!(path.contains("/opt/homebrew/bin"));
    }

    #[test]
    fn a_tool_found_through_a_symlinked_directory_keeps_its_real_location() {
        let root = tempfile::tempdir().unwrap();
        let real = root.path().join("node/bin");
        std::fs::create_dir_all(&real).unwrap();
        std::fs::write(real.join("npx"), "").unwrap();
        let shell_dir = root.path().join("multishell");
        std::os::unix::fs::symlink(root.path().join("node"), &shell_dir).unwrap();

        let found = settled(&shell_dir.join("bin/npx"));

        assert_eq!(found, real.canonicalize().unwrap().join("npx"));
    }

    #[test]
    fn a_silent_crash_still_reports_something() {
        assert_eq!(crash_reason("  \n"), "the agent stopped unexpectedly");
    }

    #[test]
    fn only_the_tail_of_a_long_stderr_is_kept() {
        let noise = format!("{}Error: out of memory", "x".repeat(1_000));

        let reason = crash_reason(&noise);

        assert_eq!(reason.chars().count(), 600);
        assert!(reason.ends_with("Error: out of memory"));
    }
}
