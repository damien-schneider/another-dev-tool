mod download;
mod install;
mod launch;
mod registry;

use std::cell::LazyCell;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde::Serialize;

pub use launch::Launch;
use registry::{Entry, Registry, Source};

use super::lockdown;
use crate::agent::cli;
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Readiness {
    Installed,
    Download,
    Package,
    NeedsNode,
    NeedsUv,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Listing {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub icon: Option<String>,
    pub readiness: Readiness,
    pub hardened: bool,
}

pub struct Catalog {
    tools: PathBuf,
    cache: PathBuf,
    work: PathBuf,
    registry: Mutex<Option<Arc<Registry>>>,
}

fn needs(entry: &Entry, runtime: &str) -> AppError {
    AppError::NotFound(format!(
        "{} needs {runtime}, which wasn't found on this Mac",
        entry.name
    ))
}

impl Catalog {
    pub fn new(dir: PathBuf) -> Self {
        Self {
            tools: dir.join("tools"),
            cache: dir.join("registry.json"),
            work: dir.join("work"),
            registry: Mutex::new(None),
        }
    }

    /// An empty folder to start agents in when no conversation is involved.
    pub fn work(&self) -> AppResult<PathBuf> {
        std::fs::create_dir_all(&self.work)?;
        Ok(self.work.clone())
    }

    fn registry(&self) -> AppResult<Arc<Registry>> {
        let mut held = self
            .registry
            .lock()
            .map_err(|_| AppError::internal("agent registry lock poisoned"))?;
        if let Some(registry) = held.as_ref() {
            return Ok(Arc::clone(registry));
        }
        let fetched = Arc::new(registry::fetch(&self.cache)?);
        *held = Some(Arc::clone(&fetched));
        Ok(fetched)
    }

    pub fn list(&self) -> AppResult<Vec<Listing>> {
        let registry = self.registry()?;
        let platform = registry::platform();
        let npx = LazyCell::new(|| cli::resolve("npx").is_some());
        let uvx = LazyCell::new(|| cli::resolve("uvx").is_some());
        Ok(registry
            .agents
            .iter()
            .filter_map(|entry| {
                let readiness = match entry.source(&platform)? {
                    Source::Binary(target)
                        if install::location(&self.tools, entry, target).is_file() =>
                    {
                        Readiness::Installed
                    }
                    Source::Binary(_) => Readiness::Download,
                    Source::Npx(_) if *npx => Readiness::Package,
                    Source::Npx(_) => Readiness::NeedsNode,
                    Source::Uvx(_) if *uvx => Readiness::Package,
                    Source::Uvx(_) => Readiness::NeedsUv,
                };
                Some(Listing {
                    id: entry.id.clone(),
                    name: entry.name.clone(),
                    version: entry.version.clone(),
                    description: entry.description.clone(),
                    icon: entry.icon.clone(),
                    readiness,
                    hardened: lockdown::hardened(&entry.id),
                })
            })
            .collect())
    }

    /// Downloads a binary agent the first time it is launched.
    pub fn launch(&self, id: &str) -> AppResult<Launch> {
        let registry = self.registry()?;
        let entry = registry
            .agents
            .iter()
            .find(|entry| entry.id == id)
            .ok_or_else(|| AppError::NotFound(format!("{id} is no longer in the ACP registry")))?;
        match entry.source(&registry::platform()) {
            Some(Source::Binary(target)) => Ok(Launch::binary(
                &entry.name,
                install::ensure(&self.tools, entry, target)?,
                target,
            )),
            Some(Source::Npx(package)) => cli::resolve("npx")
                .map(|npx| Launch::npx(&entry.name, npx, package))
                .ok_or_else(|| needs(entry, "Node.js")),
            Some(Source::Uvx(package)) => cli::resolve("uvx")
                .map(|uvx| Launch::uvx(&entry.name, uvx, package))
                .ok_or_else(|| needs(entry, "uv")),
            None => Err(AppError::NotFound(format!(
                "{} has no build for this Mac",
                entry.name
            ))),
        }
    }
}
