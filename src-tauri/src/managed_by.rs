use std::collections::HashMap;
use std::io::ErrorKind;
use std::path::Path;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "tool", rename_all = "camelCase")]
pub enum ManagedBy {
    NpxSkills { source: String },
    Claude,
    Codex,
}

pub fn managed_by(real_path: &Path, home: Option<&Path>) -> Option<ManagedBy> {
    if let Some(home) = home {
        if real_path.starts_with(home.join(".claude/skills/synced")) {
            return Some(ManagedBy::Claude);
        }
        if real_path.starts_with(home.join(".codex/skills/.system")) {
            return Some(ManagedBy::Codex);
        }
    }
    installed_by_npx_skills(real_path)
}

#[derive(Deserialize)]
struct SkillsLock {
    skills: HashMap<String, LockedSkill>,
}

#[derive(Deserialize)]
struct LockedSkill {
    source: String,
}

/// npx skills installs to `<project>/<agent dir>/skills/<name>/` and locks it by folder name in `<project>/skills-lock.json`.
fn installed_by_npx_skills(real_path: &Path) -> Option<ManagedBy> {
    let skill_dir = real_path.parent()?;
    let skills_dir = skill_dir.parent()?;
    if skills_dir.file_name()? != "skills" {
        return None;
    }
    let lock_path = skills_dir.parent()?.parent()?.join("skills-lock.json");
    let raw = match std::fs::read_to_string(&lock_path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == ErrorKind::NotFound => return None,
        Err(error) => {
            log::warn!("cannot read {}: {error}", lock_path.display());
            return None;
        }
    };
    let mut lock: SkillsLock = match serde_json::from_str(&raw) {
        Ok(lock) => lock,
        Err(error) => {
            log::warn!("cannot parse {}: {error}", lock_path.display());
            return None;
        }
    };
    let name = skill_dir.file_name()?.to_str()?;
    lock.skills.remove(name).map(|skill| ManagedBy::NpxSkills {
        source: skill.source,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use tempfile::tempdir;

    fn write_skill(project: &Path, name: &str) -> PathBuf {
        let skill = project.join(".agents/skills").join(name).join("SKILL.md");
        fs::create_dir_all(skill.parent().unwrap()).unwrap();
        fs::write(&skill, "---\nname: x\n---\n").unwrap();
        skill
    }

    #[test]
    fn names_the_source_of_a_skill_npx_skills_installed() {
        let project = tempdir().unwrap();
        let skill = write_skill(project.path(), "animate");
        fs::write(
            project.path().join("skills-lock.json"),
            r#"{"version":1,"skills":{"animate":{"source":"emilkowalski/skills","sourceType":"github"}}}"#,
        )
        .unwrap();

        assert_eq!(
            managed_by(&skill, None),
            Some(ManagedBy::NpxSkills {
                source: "emilkowalski/skills".to_string()
            })
        );
    }

    #[test]
    fn leaves_a_hand_written_skill_beside_installed_ones_to_its_author() {
        let project = tempdir().unwrap();
        let skill = write_skill(project.path(), "my-skill");
        fs::write(
            project.path().join("skills-lock.json"),
            r#"{"version":1,"skills":{"animate":{"source":"emilkowalski/skills"}}}"#,
        )
        .unwrap();

        assert_eq!(managed_by(&skill, None), None);
    }
}
