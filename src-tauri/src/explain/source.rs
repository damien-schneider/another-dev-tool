use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::error::{AppError, AppResult};
use crate::git;

const MAX_BYTES: u64 = 2 * 1024 * 1024;
const BINARY_SNIFF: usize = 8 * 1024;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SourceFile {
    pub path: String,
    pub text: String,
}

/// The model cites paths it read; only files inside the explained project can be opened from them.
pub fn read(project: &Path, path: &str) -> AppResult<SourceFile> {
    let root = project
        .canonicalize()
        .map_err(|_| AppError::NotFound(project.display().to_string()))?;
    let cited = path.trim_start_matches("./");
    let target = root
        .join(cited)
        .canonicalize()
        .ok()
        .or_else(|| sole_file_ending_with(&root, cited))
        .ok_or_else(|| AppError::NotFound(path.to_string()))?;
    let Ok(relative) = target.strip_prefix(&root) else {
        return Err(AppError::InvalidPath(format!(
            "{path} is outside the project"
        )));
    };

    let metadata = fs::metadata(&target)?;
    if !metadata.is_file() {
        return Err(AppError::NotFound(path.to_string()));
    }
    if metadata.len() > MAX_BYTES {
        return Err(AppError::InvalidInput(format!(
            "{path} is too large to show"
        )));
    }
    let bytes = fs::read(&target)?;
    if bytes.iter().take(BINARY_SNIFF).any(|byte| *byte == 0) {
        return Err(AppError::InvalidInput(format!("{path} is a binary file")));
    }

    Ok(SourceFile {
        path: relative.to_string_lossy().replace('\\', "/"),
        text: String::from_utf8_lossy(&bytes).into_owned(),
    })
}

/// Models shorten `src/scanner/walk.rs` to `walk.rs`; the one project file ending so is meant.
fn sole_file_ending_with(root: &Path, cited: &str) -> Option<PathBuf> {
    let suffix = format!("/{cited}");
    let files = git::project_files(root).ok()?;
    let mut matches = files.iter().filter(|file| file.ends_with(&suffix));
    let found = matches.next()?;
    if matches.next().is_some() {
        return None;
    }
    root.join(found).canonicalize().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn project() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join("src")).unwrap();
        fs::write(dir.path().join("src/main.rs"), "fn main() {}\n").unwrap();
        dir
    }

    #[test]
    fn a_cited_file_reads_back_with_its_project_relative_path() {
        let dir = project();

        let file = read(dir.path(), "./src/main.rs").unwrap();

        assert_eq!(file.path, "src/main.rs");
        assert_eq!(file.text, "fn main() {}\n");
    }

    #[test]
    fn an_absolute_path_inside_the_project_is_accepted() {
        let dir = project();
        let absolute = dir.path().join("src/main.rs");

        let file = read(dir.path(), &absolute.to_string_lossy()).unwrap();

        assert_eq!(file.path, "src/main.rs");
    }

    #[test]
    fn paths_that_climb_out_of_the_project_are_refused() {
        let outer = tempfile::tempdir().unwrap();
        let inner = outer.path().join("project");
        fs::create_dir_all(&inner).unwrap();
        fs::write(outer.path().join("secret.txt"), "nope").unwrap();

        let climbed = read(&inner, "../secret.txt").unwrap_err();
        let absolute =
            read(&inner, &outer.path().join("secret.txt").to_string_lossy()).unwrap_err();

        assert_eq!(climbed.code(), "invalid_path");
        assert_eq!(absolute.code(), "invalid_path");
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_pointing_outside_the_project_is_refused() {
        let outer = tempfile::tempdir().unwrap();
        let inner = outer.path().join("project");
        fs::create_dir_all(&inner).unwrap();
        fs::write(outer.path().join("secret.txt"), "nope").unwrap();
        std::os::unix::fs::symlink(outer.path().join("secret.txt"), inner.join("link.txt"))
            .unwrap();

        let error = read(&inner, "link.txt").unwrap_err();

        assert_eq!(error.code(), "invalid_path");
    }

    #[test]
    fn binary_files_and_folders_are_not_shown() {
        let dir = project();
        fs::write(dir.path().join("logo.png"), [0x89, b'P', b'N', b'G', 0, 0]).unwrap();

        assert_eq!(
            read(dir.path(), "logo.png").unwrap_err().code(),
            "invalid_input"
        );
        assert_eq!(read(dir.path(), "src").unwrap_err().code(), "not_found");
        assert_eq!(
            read(dir.path(), "missing.rs").unwrap_err().code(),
            "not_found"
        );
    }

    #[test]
    fn a_shortened_path_opens_the_one_project_file_it_can_mean() {
        let dir = project();
        let status = std::process::Command::new("git")
            .args(["init", "-q"])
            .current_dir(dir.path())
            .status()
            .unwrap();
        assert!(status.success());
        fs::create_dir_all(dir.path().join("src/scanner")).unwrap();
        fs::write(dir.path().join("src/scanner/walk.rs"), "fn walk() {}\n").unwrap();
        fs::write(dir.path().join("src/scanner/main.rs"), "fn main() {}\n").unwrap();

        let shortened = read(dir.path(), "scanner/walk.rs").unwrap();
        let ambiguous = read(dir.path(), "main.rs").unwrap_err();

        assert_eq!(shortened.path, "src/scanner/walk.rs");
        assert_eq!(ambiguous.code(), "not_found");
    }
}
