use std::path::{Path, PathBuf};

use serde_json::json;

/// `--settings` granting Read on each reference. Allow rules instead of
/// `--add-dir`: a working directory would let `acceptEdits` write the originals.
pub fn read_only_settings(references: &[PathBuf]) -> String {
    let allow: Vec<String> = references.iter().map(|path| read_rule(path)).collect();
    json!({ "permissions": { "allow": allow } }).to_string()
}

fn read_rule(path: &Path) -> String {
    let absolute = path.to_string_lossy();
    let absolute = absolute.trim_end_matches('/');
    if path.is_dir() {
        format!("Read(/{absolute}/**)")
    } else {
        format!("Read(/{absolute})")
    }
}

/// Claude allows a read only when both the asked path and its symlink target match a rule.
pub fn real_paths(references: Vec<PathBuf>) -> Vec<PathBuf> {
    references
        .into_iter()
        .map(|path| path.canonicalize().unwrap_or(path))
        .collect()
}

#[cfg(test)]
mod tests {
    use serde_json::Value;

    use super::*;

    fn allowed(references: &[PathBuf]) -> Value {
        let settings: Value = serde_json::from_str(&read_only_settings(references)).unwrap();
        settings["permissions"]["allow"].clone()
    }

    #[test]
    fn a_folder_is_readable_all_the_way_down_and_a_file_only_itself() {
        let folder = tempfile::tempdir().unwrap();
        let file = folder.path().join("SKILL.md");
        std::fs::write(&file, "# Skill").unwrap();

        assert_eq!(
            allowed(&[folder.path().to_path_buf(), file.clone()]),
            json!([
                format!("Read(/{}/**)", folder.path().display()),
                format!("Read(/{})", file.display()),
            ])
        );
    }

    #[test]
    fn a_linked_reference_is_named_by_its_real_location() {
        let root = tempfile::tempdir().unwrap();
        let real = root.path().join("skill");
        std::fs::create_dir(&real).unwrap();
        let link = root.path().join("linked");
        std::os::unix::fs::symlink(&real, &link).unwrap();
        let gone = root.path().join("gone");

        assert_eq!(
            real_paths(vec![link, gone.clone()]),
            vec![real.canonicalize().unwrap(), gone]
        );
    }
}
