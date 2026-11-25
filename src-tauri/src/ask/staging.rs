use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::error::AppResult;
use crate::scanner::hash::hash_bytes;

const FALLBACK_FILE_NAME: &str = "document.md";

/// A library file the agent may change this turn, and the text its copy starts from.
#[derive(Debug, Clone)]
pub struct Editable {
    pub file_id: i64,
    pub path: PathBuf,
    pub content: String,
    pub open: bool,
}

/// A change the agent made to one copy, waiting for the user to apply or dismiss it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Proposal {
    pub file_id: i64,
    pub path: String,
    pub before: String,
    pub after: String,
    /// What the real file must still hash to for the change to land on it.
    pub hash: String,
}

pub(super) struct Staged {
    file: Editable,
    copy: PathBuf,
}

impl Staged {
    pub(super) fn proposal(self) -> Option<Proposal> {
        let after = fs::read_to_string(&self.copy).ok()?;
        (after != self.file.content).then(|| Proposal {
            file_id: self.file.file_id,
            path: self.file.path.to_string_lossy().into_owned(),
            hash: hash_bytes(self.file.content.as_bytes()),
            before: self.file.content,
            after,
        })
    }
}

/// Folder must outlive restarts: agents file sessions by working directory, resuming needs the same one.
pub struct Session {
    dir: PathBuf,
}

impl Session {
    pub fn open(dir: PathBuf) -> AppResult<Self> {
        fs::create_dir_all(&dir)?;
        Ok(Self { dir })
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    /// One folder per library file, so two `SKILL.md` never share a copy.
    pub fn copy_of(&self, file: &Editable) -> PathBuf {
        self.dir
            .join(file.file_id.to_string())
            .join(file_name(&file.path))
    }

    /// Clears the copies of the previous turn first: a copy left behind would
    /// look editable and never be reviewed.
    pub(super) fn stage(&self, editable: Vec<Editable>) -> AppResult<Vec<Staged>> {
        for entry in fs::read_dir(&self.dir)? {
            let entry = entry?;
            let staged_before = entry
                .file_name()
                .to_str()
                .is_some_and(|name| name.parse::<i64>().is_ok());
            if staged_before && entry.file_type()?.is_dir() {
                fs::remove_dir_all(entry.path())?;
            }
        }
        editable
            .into_iter()
            .map(|file| {
                let copy = self.copy_of(&file);
                if let Some(folder) = copy.parent() {
                    fs::create_dir_all(folder)?;
                }
                fs::write(&copy, &file.content)?;
                Ok(Staged { file, copy })
            })
            .collect()
    }
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(FALLBACK_FILE_NAME)
        .to_string()
}
