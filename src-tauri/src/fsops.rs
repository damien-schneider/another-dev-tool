use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::UNIX_EPOCH;

use serde::Serialize;

use crate::error::{AppError, AppResult};

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Copy)]
pub struct FileStat {
    pub size: i64,
    pub mtime_ns: i64,
}

impl FileStat {
    pub fn mtime_ms(self) -> i64 {
        self.mtime_ns / 1_000_000
    }
}

pub fn stat(path: &Path) -> AppResult<FileStat> {
    let metadata = fs::metadata(path)?;
    let mtime_ns = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|elapsed| elapsed.as_nanos() as i64)
        .unwrap_or_default();

    Ok(FileStat {
        size: metadata.len() as i64,
        mtime_ns,
    })
}

pub fn read_text(path: &Path) -> AppResult<(String, Vec<u8>)> {
    let bytes = fs::read(path)?;
    let text = String::from_utf8(bytes.clone())
        .map_err(|_| AppError::InvalidPath(format!("{} is not valid UTF-8", path.display())))?;
    Ok((text, bytes))
}

fn temp_sibling(target: &Path) -> AppResult<PathBuf> {
    let dir = target
        .parent()
        .ok_or_else(|| AppError::InvalidPath(format!("{} has no parent", target.display())))?;
    let name = target
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("file");
    let unique = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    Ok(dir.join(format!(".{name}.{}.{unique}.tmp", std::process::id())))
}

/// Writes through a symlink instead of replacing it — a renamed temp file over a
/// link would silently turn a synced copy back into a standalone file.
pub fn atomic_write(path: &Path, content: &str) -> AppResult<()> {
    let target = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let temp = temp_sibling(&target)?;

    let result = (|| -> AppResult<()> {
        fs::write(&temp, content)?;
        if let Ok(metadata) = fs::metadata(&target) {
            let _ = fs::set_permissions(&temp, metadata.permissions());
        }
        fs::rename(&temp, &target)?;
        Ok(())
    })();

    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_symlink: bool,
}

const EDITOR_HIDDEN_NAMES: &[&str] = &[".git", ".hg", ".svn", ".jj", ".DS_Store"];

pub fn list_dir(dir: &Path) -> AppResult<Vec<FolderEntry>> {
    let mut entries = Vec::new();
    for entry in fs::read_dir(dir)?.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if EDITOR_HIDDEN_NAMES.contains(&name.as_str()) {
            continue;
        }
        let path = entry.path();
        let Ok(metadata) = fs::metadata(&path) else {
            continue;
        };
        entries.push(FolderEntry {
            name,
            path: path.to_string_lossy().into_owned(),
            is_dir: metadata.is_dir(),
            is_symlink: entry.file_type().is_ok_and(|kind| kind.is_symlink()),
        });
    }
    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn writes_and_reads_back_the_same_text() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("CLAUDE.md");

        atomic_write(&path, "# hello\n").unwrap();

        assert_eq!(read_text(&path).unwrap().0, "# hello\n");
    }

    #[test]
    fn leaves_no_temp_file_behind() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("CLAUDE.md");

        atomic_write(&path, "one").unwrap();
        atomic_write(&path, "two").unwrap();

        let entries: Vec<String> = fs::read_dir(dir.path())
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(entries, vec!["CLAUDE.md".to_string()]);
    }

    #[test]
    fn writing_through_a_symlink_keeps_the_link() {
        let dir = tempdir().unwrap();
        let target = dir.path().join("source.md");
        let link = dir.path().join("linked.md");
        fs::write(&target, "original").unwrap();
        std::os::unix::fs::symlink(&target, &link).unwrap();

        atomic_write(&link, "updated").unwrap();

        assert!(fs::symlink_metadata(&link).unwrap().is_symlink());
        assert_eq!(fs::read_to_string(&target).unwrap(), "updated");
    }

    #[test]
    fn preserves_the_executable_bit() {
        use std::os::unix::fs::PermissionsExt as _;
        let dir = tempdir().unwrap();
        let path = dir.path().join("hook.md");
        fs::write(&path, "one").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();

        atomic_write(&path, "two").unwrap();

        let mode = fs::metadata(&path).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o755);
    }

    #[test]
    fn reports_size_and_mtime() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("CLAUDE.md");
        fs::write(&path, "12345").unwrap();

        let stat = stat(&path).unwrap();

        assert_eq!(stat.size, 5);
        assert!(stat.mtime_ns > 0);
        let stamped = FileStat {
            size: 5,
            mtime_ns: 1_700_000_000_123_456_789,
        };
        assert_eq!(stamped.mtime_ms(), 1_700_000_000_123);
    }

    #[test]
    fn rejects_non_utf8_content() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("binary.md");
        fs::write(&path, [0xff, 0xfe, 0x00]).unwrap();

        assert_eq!(read_text(&path).unwrap_err().code(), "invalid_path");
    }

    #[test]
    fn lists_one_level_of_a_folder_without_version_control_internals() {
        let dir = tempdir().unwrap();
        fs::create_dir_all(dir.path().join("scripts/deep")).unwrap();
        fs::create_dir(dir.path().join(".git")).unwrap();
        fs::write(dir.path().join("README.md"), "").unwrap();
        fs::write(dir.path().join(".DS_Store"), "").unwrap();

        let mut listed = list_dir(dir.path()).unwrap();
        listed.sort_by(|left, right| left.name.cmp(&right.name));

        let summary: Vec<(&str, bool)> = listed
            .iter()
            .map(|entry| (entry.name.as_str(), entry.is_dir))
            .collect();
        assert_eq!(summary, vec![("README.md", false), ("scripts", true)]);
    }

    #[test]
    fn lists_a_symlinked_folder_as_a_linked_folder_under_its_own_path() {
        let dir = tempdir().unwrap();
        let source = dir.path().join("source");
        let parent = dir.path().join("interface");
        fs::create_dir(&source).unwrap();
        fs::create_dir(&parent).unwrap();
        std::os::unix::fs::symlink(&source, parent.join("ask-sonner")).unwrap();
        std::os::unix::fs::symlink(dir.path().join("gone"), parent.join("broken")).unwrap();

        let listed = list_dir(&parent).unwrap();

        assert_eq!(
            listed,
            vec![FolderEntry {
                name: "ask-sonner".to_string(),
                path: parent.join("ask-sonner").to_string_lossy().into_owned(),
                is_dir: true,
                is_symlink: true,
            }]
        );
    }
}
