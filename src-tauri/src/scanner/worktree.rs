use std::path::{Component, Path, PathBuf};

/// The repository whose `.git/worktrees/<name>` a linked worktree's `.git` file points to.
pub fn repository_of(project_dir: &Path) -> Option<String> {
    let pointer = std::fs::read_to_string(project_dir.join(".git")).ok()?;
    let gitdir = pointer.lines().next()?.strip_prefix("gitdir:")?.trim();
    let gitdir = without_dots(&project_dir.join(gitdir));
    let worktrees = gitdir.parent()?;
    let git = worktrees.parent()?;
    let repository = git.parent()?;
    let points_into_worktrees = worktrees.file_name()? == "worktrees" && git.file_name()? == ".git";
    (points_into_worktrees && git.is_dir()).then(|| repository.to_string_lossy().into_owned())
}

/// Lexical on purpose: canonicalizing would resolve symlinks the walked paths keep.
fn without_dots(path: &Path) -> PathBuf {
    let mut resolved = PathBuf::new();
    for component in path.components() {
        match component {
            Component::ParentDir => {
                resolved.pop();
            }
            Component::CurDir => {}
            other => resolved.push(other),
        }
    }
    resolved
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn write(path: &Path, contents: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, contents).unwrap();
    }

    fn repository_at(root: &Path, name: &str) -> PathBuf {
        let repository = root.join(name);
        fs::create_dir_all(repository.join(".git/worktrees")).unwrap();
        repository
    }

    fn checkout(worktree: &Path, gitdir: &str) {
        write(&worktree.join(".git"), &format!("gitdir: {gitdir}\n"));
    }

    #[test]
    fn a_worktree_checks_out_the_repository_its_gitdir_points_into() {
        let dir = tempdir().unwrap();
        let repository = repository_at(dir.path(), "mastra/mastra");
        let worktree = dir.path().join("mastra/.worktrees/fix-auth");
        checkout(
            &worktree,
            &repository.join(".git/worktrees/fix-auth").to_string_lossy(),
        );

        assert_eq!(
            repository_of(&worktree),
            Some(repository.to_string_lossy().into_owned())
        );
    }

    #[test]
    fn a_relative_gitdir_is_read_from_the_worktree() {
        let dir = tempdir().unwrap();
        let repository = repository_at(dir.path(), "mastra/mastra");
        let worktree = dir.path().join("mastra/.worktrees/fix-auth");
        checkout(&worktree, "../../mastra/.git/worktrees/fix-auth");

        assert_eq!(
            repository_of(&worktree),
            Some(repository.to_string_lossy().into_owned())
        );
    }

    #[test]
    fn a_submodule_checks_out_no_repository() {
        let dir = tempdir().unwrap();
        let repository = repository_at(dir.path(), "app");
        let submodule = repository.join("vendor/lib");
        checkout(
            &submodule,
            &repository.join(".git/modules/lib").to_string_lossy(),
        );

        assert_eq!(repository_of(&submodule), None);
    }

    #[test]
    fn a_plain_repository_checks_out_no_other() {
        let dir = tempdir().unwrap();
        let repository = repository_at(dir.path(), "app");

        assert_eq!(repository_of(&repository), None);
    }

    #[test]
    fn a_worktree_whose_repository_is_gone_checks_out_nothing() {
        let dir = tempdir().unwrap();
        let worktree = dir.path().join(".worktrees/fix-auth");
        checkout(
            &worktree,
            &dir.path()
                .join("deleted/.git/worktrees/fix-auth")
                .to_string_lossy(),
        );

        assert_eq!(repository_of(&worktree), None);
    }

    #[test]
    fn a_malformed_git_file_checks_out_nothing() {
        let dir = tempdir().unwrap();
        repository_at(dir.path(), "app");
        let worktree = dir.path().join("broken");
        write(
            &worktree.join(".git"),
            "not a pointer to ../app/.git/worktrees/x",
        );

        assert_eq!(repository_of(&worktree), None);
    }
}
