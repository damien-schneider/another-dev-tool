use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use serde::Deserialize;

use super::download;
use crate::error::{AppError, AppResult};

const URL: &str = "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";

#[derive(Debug, Clone, Deserialize)]
pub struct Registry {
    pub agents: Vec<Entry>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Entry {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub description: String,
    pub icon: Option<String>,
    #[serde(default)]
    pub distribution: Distribution,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct Distribution {
    #[serde(default)]
    pub binary: BTreeMap<String, Target>,
    pub npx: Option<Package>,
    pub uvx: Option<Package>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Target {
    pub archive: String,
    pub cmd: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    pub sha256: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Package {
    pub package: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Copy)]
pub enum Source<'a> {
    Binary(&'a Target),
    Npx(&'a Package),
    Uvx(&'a Package),
}

impl Entry {
    /// A prebuilt binary needs nothing else on the Mac, so it wins over a
    /// package that needs Node.js or uv.
    pub fn source(&self, platform: &str) -> Option<Source<'_>> {
        self.distribution
            .binary
            .get(platform)
            .map(Source::Binary)
            .or_else(|| self.distribution.npx.as_ref().map(Source::Npx))
            .or_else(|| self.distribution.uvx.as_ref().map(Source::Uvx))
    }
}

pub fn platform() -> String {
    let os = match std::env::consts::OS {
        "macos" => "darwin",
        other => other,
    };
    format!("{os}-{}", std::env::consts::ARCH)
}

pub fn parse(bytes: &[u8]) -> AppResult<Registry> {
    serde_json::from_slice(bytes)
        .map_err(|error| AppError::internal(format!("the agent registry is unreadable: {error}")))
}

/// Offline, the copy saved by the last successful fetch keeps installed agents usable.
pub fn fetch(cache: &Path) -> AppResult<Registry> {
    match download::bytes(URL).and_then(|bytes| Ok((parse(&bytes)?, bytes))) {
        Ok((registry, bytes)) => {
            if let Err(error) = save(cache, &bytes) {
                log::warn!("couldn't cache the agent registry: {error}");
            }
            Ok(registry)
        }
        Err(error) => fs::read(cache)
            .ok()
            .and_then(|bytes| parse(&bytes).ok())
            .ok_or(error),
    }
}

fn save(cache: &Path, bytes: &[u8]) -> std::io::Result<()> {
    if let Some(dir) = cache.parent() {
        fs::create_dir_all(dir)?;
    }
    fs::write(cache, bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(distribution: serde_json::Value) -> Entry {
        serde_json::from_value(serde_json::json!({
            "id": "demo",
            "name": "Demo",
            "version": "1.0.0",
            "distribution": distribution,
        }))
        .unwrap()
    }

    fn target(archive: &str) -> serde_json::Value {
        serde_json::json!({ "archive": archive, "cmd": "./demo" })
    }

    #[test]
    fn a_binary_for_this_mac_is_preferred_over_a_node_package() {
        let entry = entry(serde_json::json!({
            "binary": { "darwin-aarch64": target("https://x/demo.zip") },
            "npx": { "package": "demo@1.0.0" },
        }));

        assert!(matches!(
            entry.source("darwin-aarch64"),
            Some(Source::Binary(target)) if target.archive == "https://x/demo.zip"
        ));
    }

    #[test]
    fn a_binary_built_for_another_platform_falls_back_to_the_package() {
        let entry = entry(serde_json::json!({
            "binary": { "linux-x86_64": target("https://x/demo.tar.gz") },
            "npx": { "package": "demo@1.0.0" },
        }));

        assert!(matches!(
            entry.source("darwin-aarch64"),
            Some(Source::Npx(package)) if package.package == "demo@1.0.0"
        ));
    }

    #[test]
    fn an_agent_with_nothing_runnable_here_has_no_source() {
        let entry = entry(serde_json::json!({
            "binary": { "windows-x86_64": target("https://x/demo.zip") },
        }));

        assert!(entry.source("darwin-aarch64").is_none());
    }

    #[test]
    fn unknown_registry_fields_are_ignored() {
        let registry = parse(
            br#"{"version":"1.0.0","extensions":[],"agents":[{"id":"a","name":"A","version":"1","license":"MIT","authors":["x"],"distribution":{"uvx":{"package":"a==1","args":["-x"],"env":{"K":"V"}}}}]}"#,
        )
        .unwrap();

        let Some(Source::Uvx(package)) = registry.agents[0].source("darwin-aarch64") else {
            panic!("no uvx source");
        };
        assert_eq!(package.args, ["-x"]);
        assert_eq!(package.env["K"], "V");
    }

    #[test]
    fn this_mac_is_named_like_the_registry_names_it() {
        assert!(["darwin-aarch64", "darwin-x86_64"].contains(&platform().as_str()));
    }
}
