use std::fs;
use std::io;
use std::os::unix::fs::PermissionsExt as _;
use std::path::{Path, PathBuf};
use std::process::Command;

use sha2::{Digest as _, Sha256};

use super::download;
use super::registry::{Entry, Target};
use crate::error::{AppError, AppResult};

const ARCHIVES: [&str; 8] = [
    ".zip", ".tar.gz", ".tgz", ".tar.bz2", ".tbz2", ".tar.xz", ".txz", ".tar",
];

fn relative(cmd: &str) -> &str {
    cmd.trim_start_matches("./")
}

pub fn location(tools: &Path, entry: &Entry, target: &Target) -> PathBuf {
    tools
        .join(&entry.id)
        .join(&entry.version)
        .join(relative(&target.cmd))
}

pub fn ensure(tools: &Path, entry: &Entry, target: &Target) -> AppResult<PathBuf> {
    let cmd = location(tools, entry, target);
    if cmd.is_file() {
        return Ok(cmd);
    }
    let agent_dir = tools.join(&entry.id);
    fs::create_dir_all(&agent_dir)?;
    let staging = tempfile::Builder::new()
        .prefix(".staging-")
        .tempdir_in(&agent_dir)?;
    let archive = staging.path().join("download");
    download::file(&target.archive, &archive)?;
    let unpacked = staging.path().join("unpacked");
    install_from(&archive, target, &unpacked)?;

    let home = agent_dir.join(&entry.version);
    if home.exists() {
        fs::remove_dir_all(&home)?;
    }
    if let Err(error) = fs::rename(&unpacked, &home) {
        if !cmd.is_file() {
            return Err(error.into());
        }
    }
    prune(&agent_dir, &entry.version);
    Ok(cmd)
}

fn install_from(archive: &Path, target: &Target, into: &Path) -> AppResult<()> {
    verify(archive, target.sha256.as_deref())?;
    fs::create_dir_all(into)?;
    let cmd = into.join(relative(&target.cmd));
    if is_archive(&target.archive) {
        extract(archive, into)?;
    } else {
        if let Some(dir) = cmd.parent() {
            fs::create_dir_all(dir)?;
        }
        fs::copy(archive, &cmd)?;
    }
    if !cmd.is_file() {
        return Err(AppError::internal(format!(
            "the download has no {}",
            target.cmd
        )));
    }
    fs::set_permissions(&cmd, fs::Permissions::from_mode(0o755))?;
    Ok(())
}

fn is_archive(url: &str) -> bool {
    let path = url
        .split(['?', '#'])
        .next()
        .unwrap_or(url)
        .to_ascii_lowercase();
    ARCHIVES.iter().any(|extension| path.ends_with(extension))
}

fn verify(file: &Path, expected: Option<&str>) -> AppResult<()> {
    let Some(expected) = expected else {
        return Ok(());
    };
    let mut hasher = Sha256::new();
    io::copy(&mut fs::File::open(file)?, &mut hasher)?;
    let actual: String = hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    if actual.eq_ignore_ascii_case(expected) {
        Ok(())
    } else {
        Err(AppError::internal(
            "the download doesn't match the checksum the registry lists",
        ))
    }
}

/// bsdtar reads zip as well as every tarball compression the registry uses,
/// and refuses entries that would land outside the target folder.
fn extract(archive: &Path, into: &Path) -> AppResult<()> {
    let output = Command::new("/usr/bin/tar")
        .arg("-xf")
        .arg(archive)
        .arg("-C")
        .arg(into)
        .output()?;
    if output.status.success() {
        return Ok(());
    }
    Err(AppError::internal(format!(
        "couldn't unpack the download: {}",
        String::from_utf8_lossy(&output.stderr).trim()
    )))
}

fn prune(agent_dir: &Path, keep: &str) {
    let Ok(entries) = fs::read_dir(agent_dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name != keep && !name.starts_with('.') {
            if let Err(error) = fs::remove_dir_all(entry.path()) {
                log::warn!("couldn't remove {}: {error}", entry.path().display());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const WRONG_SHA256: &str = "0000000000000000000000000000000000000000000000000000000000000000";

    fn target(archive: &str, cmd: &str, sha256: Option<&str>) -> Target {
        Target {
            archive: archive.into(),
            cmd: cmd.into(),
            args: vec![],
            env: Default::default(),
            sha256: sha256.map(Into::into),
        }
    }

    fn sha256_of(path: &Path) -> String {
        Sha256::digest(fs::read(path).unwrap())
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect()
    }

    fn tarball(root: &Path) -> PathBuf {
        let content = root.join("content/bin");
        fs::create_dir_all(&content).unwrap();
        fs::write(content.join("demo"), "#!/bin/sh\necho hi\n").unwrap();
        let archive = root.join("demo.tar.gz");
        let status = Command::new("/usr/bin/tar")
            .arg("-czf")
            .arg(&archive)
            .arg("-C")
            .arg(root.join("content"))
            .arg("bin")
            .status()
            .unwrap();
        assert!(status.success());
        archive
    }

    #[test]
    fn an_archive_is_unpacked_and_its_command_made_executable() {
        let root = tempfile::tempdir().unwrap();
        let archive = tarball(root.path());
        let into = root.path().join("installed");
        let target = target(
            "https://x/demo.tar.gz",
            "./bin/demo",
            Some(&sha256_of(&archive)),
        );

        install_from(&archive, &target, &into).unwrap();

        let mode = fs::metadata(into.join("bin/demo"))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o111, 0o111);
    }

    #[test]
    fn a_download_that_fails_its_checksum_installs_nothing() {
        let root = tempfile::tempdir().unwrap();
        let archive = tarball(root.path());
        let into = root.path().join("installed");
        let target = target("https://x/demo.tar.gz", "./bin/demo", Some(WRONG_SHA256));

        let error = install_from(&archive, &target, &into).unwrap_err();

        assert!(error.to_string().contains("checksum"), "{error}");
        assert!(!into.exists());
    }

    #[test]
    fn a_url_without_an_archive_extension_is_the_binary_itself() {
        let root = tempfile::tempdir().unwrap();
        let download = root.path().join("download");
        fs::write(&download, "binary").unwrap();
        let into = root.path().join("installed");
        let target = target(
            "https://x/download/?channel=a&file=muse-aarch64-macos",
            "./muse",
            None,
        );

        install_from(&download, &target, &into).unwrap();

        assert_eq!(fs::read_to_string(into.join("muse")).unwrap(), "binary");
    }

    #[test]
    fn an_archive_missing_the_listed_command_is_refused() {
        let root = tempfile::tempdir().unwrap();
        let archive = tarball(root.path());
        let target = target("https://x/demo.tar.gz", "./demo", None);

        let error = install_from(&archive, &target, &root.path().join("installed")).unwrap_err();

        assert!(error.to_string().contains("./demo"), "{error}");
    }

    #[test]
    fn installing_a_new_version_removes_the_previous_ones() {
        let root = tempfile::tempdir().unwrap();
        for version in ["1.0.0", "2.0.0", ".staging-x"] {
            fs::create_dir_all(root.path().join(version)).unwrap();
        }

        prune(root.path(), "2.0.0");

        let mut left: Vec<_> = fs::read_dir(root.path())
            .unwrap()
            .map(|entry| entry.unwrap().file_name().into_string().unwrap())
            .collect();
        left.sort();
        assert_eq!(left, [".staging-x", "2.0.0"]);
    }
}
