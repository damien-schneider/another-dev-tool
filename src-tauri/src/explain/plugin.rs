use std::fs;
use std::path::Path;

const MANIFEST: &str = r#"{
  "name": "explainer",
  "version": "1.0.0",
  "description": "Playbooks for explaining a codebase: tours, flows, code, history, changes, data models."
}
"#;

const SKILLS: [(&str, &str); 6] = [
    ("tour", include_str!("skills/tour.md")),
    ("flow", include_str!("skills/flow.md")),
    ("code", include_str!("skills/code.md")),
    ("history", include_str!("skills/history.md")),
    ("change", include_str!("skills/change.md")),
    ("data-model", include_str!("skills/data-model.md")),
];

/// Claude Code loads `--plugin-dir` from disk, so the bundled playbooks are written out on every
/// run; unchanged files are left alone.
pub fn install(dir: &Path) -> std::io::Result<()> {
    write_if_changed(&dir.join(".claude-plugin").join("plugin.json"), MANIFEST)?;
    for (name, body) in SKILLS {
        write_if_changed(&dir.join("skills").join(name).join("SKILL.md"), body)?;
    }
    Ok(())
}

fn write_if_changed(path: &Path, content: &str) -> std::io::Result<()> {
    if fs::read_to_string(path).is_ok_and(|current| current == content) {
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, content)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_playbook_lands_where_claude_code_looks_for_skills() {
        let dir = tempfile::tempdir().unwrap();

        install(dir.path()).unwrap();

        let manifest = fs::read_to_string(dir.path().join(".claude-plugin/plugin.json")).unwrap();
        assert!(manifest.contains("\"name\": \"explainer\""));
        for (name, _) in SKILLS {
            let skill =
                fs::read_to_string(dir.path().join("skills").join(name).join("SKILL.md")).unwrap();
            assert!(skill.starts_with(&format!("---\nname: {name}\n")));
        }
    }

    #[test]
    fn a_stale_playbook_is_replaced_by_the_bundled_one() {
        let dir = tempfile::tempdir().unwrap();
        let tour = dir.path().join("skills/tour/SKILL.md");
        fs::create_dir_all(tour.parent().unwrap()).unwrap();
        fs::write(&tour, "old").unwrap();

        install(dir.path()).unwrap();

        assert_eq!(fs::read_to_string(&tour).unwrap(), SKILLS[0].1);
    }
}
