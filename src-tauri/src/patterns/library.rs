use std::collections::BTreeSet;
use std::fmt::Write as _;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::db::files_repo::FileRow;
use crate::scanner::targets::FileKind;

const FILE_CHARS: usize = 12_000;
const INSTRUCTION_CHARS: usize = 60_000;
const DESCRIPTION_CHARS: usize = 300;
const SKILL_CHARS: usize = 30_000;

pub const KINDS: [FileKind; 4] = [
    FileKind::AgentsMd,
    FileKind::ClaudeMd,
    FileKind::GeminiMd,
    FileKind::Skill,
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Rejected {
    pub title: String,
    pub statement: String,
}

struct Entry {
    path: String,
    aliases: Vec<String>,
}

impl Entry {
    fn reaches(&self, path: &str) -> bool {
        self.path == path || self.aliases.iter().any(|alias| alias == path)
    }
}

struct Instruction {
    entry: Entry,
    content: String,
}

struct Skill {
    entry: Entry,
    name: String,
    description: String,
}

pub struct Library {
    instructions: Vec<Instruction>,
    skills: Vec<Skill>,
}

impl Library {
    pub fn select(files: Vec<FileRow>, home: &Path, projects: &BTreeSet<&str>) -> Self {
        let mut instructions = Vec::new();
        let mut skills = Vec::new();
        let mut instruction_chars = 0;
        let mut skill_chars = 0;
        let mut files: Vec<FileRow> = files
            .into_iter()
            .filter(|file| is_global(file, home) || in_projects(file, projects))
            .collect();
        files.sort_by_key(|file| (!is_global(file, home), file.path.clone()));

        for file in files {
            let entry = Entry {
                path: file.path.clone(),
                aliases: file.aliases.clone(),
            };
            if file.kind == FileKind::Skill {
                let name = file
                    .name
                    .clone()
                    .unwrap_or_else(|| skill_folder(&file.path));
                let description =
                    clip(file.description.as_deref().unwrap_or(""), DESCRIPTION_CHARS);
                skill_chars += file.path.len() + name.len() + description.len();
                if skill_chars <= SKILL_CHARS {
                    skills.push(Skill {
                        entry,
                        name,
                        description,
                    });
                }
                continue;
            }
            let Ok(content) = std::fs::read_to_string(&file.path) else {
                continue;
            };
            let content = clip(&content, FILE_CHARS);
            instruction_chars += content.len();
            if instruction_chars <= INSTRUCTION_CHARS {
                instructions.push(Instruction { entry, content });
            }
        }
        Self {
            instructions,
            skills,
        }
    }

    pub fn render(&self, rejected: &[Rejected]) -> String {
        let mut out = String::from("<instruction-files>\n");
        for instruction in &self.instructions {
            let _ = writeln!(
                out,
                "### {}{}",
                instruction.entry.path,
                also_at(&instruction.entry)
            );
            let _ = writeln!(out, "{}\n", instruction.content.trim_end());
        }
        out.push_str("</instruction-files>\n\n<skills>\n");
        for skill in &self.skills {
            let _ = writeln!(
                out,
                "- {} — {}{}: {}",
                skill.name,
                skill.entry.path,
                also_at(&skill.entry),
                skill.description
            );
        }
        out.push_str("</skills>\n\n<rejected>\n");
        for item in rejected {
            let _ = writeln!(out, "- {}: {}", item.title, item.statement);
        }
        out.push_str("</rejected>\n");
        out
    }

    pub fn resolve(&self, target: &str, home: &Path) -> Option<String> {
        let target = target.trim();
        let expanded = match target.strip_prefix("~/") {
            Some(rest) => home.join(rest).to_string_lossy().into_owned(),
            None => target.to_string(),
        };
        self.instructions
            .iter()
            .map(|instruction| &instruction.entry)
            .chain(self.skills.iter().map(|skill| &skill.entry))
            .find(|entry| entry.reaches(&expanded))
            .map(|entry| entry.path.clone())
    }
}

fn is_global(file: &FileRow, home: &Path) -> bool {
    std::iter::once(&file.path)
        .chain(&file.aliases)
        .any(|path| {
            Path::new(path)
                .strip_prefix(home)
                .ok()
                .and_then(|rest| rest.to_str())
                .is_some_and(|rest| rest.starts_with('.'))
        })
}

fn in_projects(file: &FileRow, projects: &BTreeSet<&str>) -> bool {
    let Some(folder) = Path::new(&file.path).parent() else {
        return false;
    };
    projects.iter().any(|project| {
        let project = Path::new(project);
        if file.kind == FileKind::Skill {
            folder.starts_with(project)
        } else {
            project.starts_with(folder)
        }
    })
}

fn also_at(entry: &Entry) -> String {
    if entry.aliases.is_empty() {
        String::new()
    } else {
        format!(" (also at {})", entry.aliases.join(", "))
    }
}

fn skill_folder(path: &str) -> String {
    Path::new(path)
        .parent()
        .and_then(|folder| folder.file_name())
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn clip(text: &str, limit: usize) -> String {
    if text.len() <= limit {
        return text.to_string();
    }
    let mut end = limit;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    format!("{} …", &text[..end])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(path: &str, kind: FileKind, aliases: &[&str]) -> FileRow {
        FileRow {
            id: 1,
            root_id: 1,
            path: path.to_string(),
            rel_path: path.to_string(),
            kind,
            name: Some("deploy".to_string()),
            description: Some("Use when shipping".to_string()),
            project_dir: None,
            repository_dir: None,
            size: 0,
            mtime_ns: 0,
            hash: String::new(),
            is_symlink: false,
            symlink_target: None,
            first_seen_at: 0,
            last_seen_scan_id: None,
            deleted_at: None,
            aliases: aliases.iter().map(|alias| (*alias).to_string()).collect(),
        }
    }

    fn written(dir: &Path, rel: &str, content: &str) -> String {
        let path = dir.join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, content).unwrap();
        path.to_string_lossy().into_owned()
    }

    #[test]
    fn shows_global_files_and_those_of_prompted_projects_only() {
        let home = tempfile::tempdir().unwrap();
        let global = written(home.path(), ".agents/AGENTS.md", "Never commit.");
        let prompted = written(home.path(), "code/app/AGENTS.md", "Use bun.");
        let unrelated = written(home.path(), "code/other/AGENTS.md", "Use npm.");
        let skill = home.path().join("code/app/.claude/skills/deploy/SKILL.md");
        let project = home.path().join("code/app");
        let projects = BTreeSet::from([project.to_str().unwrap()]);
        let library = Library::select(
            vec![
                row(&unrelated, FileKind::AgentsMd, &[]),
                row(&prompted, FileKind::AgentsMd, &[]),
                row(&global, FileKind::AgentsMd, &[]),
                row(skill.to_str().unwrap(), FileKind::Skill, &[]),
            ],
            home.path(),
            &projects,
        );

        let shown = library.render(&[]);

        assert!(shown.find("Never commit.").unwrap() < shown.find("Use bun.").unwrap());
        assert!(!shown.contains("Use npm."));
        assert!(shown.contains("- deploy — "));
        assert!(shown.contains("Use when shipping"));
    }

    #[test]
    fn resolves_an_alias_or_a_tilde_path_to_the_indexed_path() {
        let home = tempfile::tempdir().unwrap();
        let real = written(home.path(), ".agents/AGENTS.md", "Never commit.");
        let alias = home.path().join(".claude/CLAUDE.md");
        let library = Library::select(
            vec![row(&real, FileKind::AgentsMd, &[alias.to_str().unwrap()])],
            home.path(),
            &BTreeSet::new(),
        );

        assert_eq!(
            library.resolve(alias.to_str().unwrap(), home.path()),
            Some(real.clone())
        );
        assert_eq!(
            library.resolve("~/.agents/AGENTS.md", home.path()),
            Some(real)
        );
        assert_eq!(library.resolve("/elsewhere/AGENTS.md", home.path()), None);
    }

    #[test]
    fn tells_the_model_what_the_user_rejected() {
        let library = Library::select(Vec::new(), Path::new("/home"), &BTreeSet::new());

        let shown = library.render(&[Rejected {
            title: "Stop asking".to_string(),
            statement: "Never ask before acting.".to_string(),
        }]);

        assert!(shown.contains("<rejected>\n- Stop asking: Never ask before acting.\n</rejected>"));
    }
}
