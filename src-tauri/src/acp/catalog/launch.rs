use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Command;

use super::registry::{Package, Target};
use crate::agent::cli;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Launch {
    pub name: String,
    pub program: PathBuf,
    pub args: Vec<String>,
    pub env: BTreeMap<String, String>,
}

impl Launch {
    pub fn binary(name: &str, program: PathBuf, target: &Target) -> Self {
        Self {
            name: name.into(),
            program,
            args: target.args.clone(),
            env: target.env.clone(),
        }
    }

    pub fn npx(name: &str, npx: PathBuf, package: &Package) -> Self {
        Self {
            name: name.into(),
            program: npx,
            args: ["-y".to_string(), package.package.clone()]
                .into_iter()
                .chain(package.args.iter().cloned())
                .collect(),
            env: package.env.clone(),
        }
    }

    pub fn uvx(name: &str, uvx: PathBuf, package: &Package) -> Self {
        Self {
            name: name.into(),
            program: uvx,
            args: std::iter::once(package.package.clone())
                .chain(package.args.iter().cloned())
                .collect(),
            env: package.env.clone(),
        }
    }

    pub fn path(&self) -> String {
        cli::child_path(&self.program)
    }

    pub fn command(&self, cwd: &Path) -> Command {
        let mut command = Command::new(&self.program);
        command
            .args(&self.args)
            .envs(&self.env)
            .env("PATH", self.path())
            .current_dir(cwd);
        command
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn package(args: &[&str]) -> Package {
        Package {
            package: "@scope/agent@1.2.3".into(),
            args: args.iter().map(|arg| arg.to_string()).collect(),
            env: BTreeMap::from([("MODE".into(), "acp".into())]),
        }
    }

    #[test]
    fn npx_runs_the_pinned_package_without_asking_to_install_it() {
        let launch = Launch::npx("Agent", "/bin/npx".into(), &package(&["--acp"]));

        assert_eq!(launch.args, ["-y", "@scope/agent@1.2.3", "--acp"]);
        assert_eq!(launch.env["MODE"], "acp");
    }

    #[test]
    fn uvx_runs_the_pinned_package_with_its_arguments() {
        let launch = Launch::uvx("Agent", "/bin/uvx".into(), &package(&["-x"]));

        assert_eq!(launch.args, ["@scope/agent@1.2.3", "-x"]);
    }
}
