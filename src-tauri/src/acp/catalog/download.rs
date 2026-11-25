use std::path::Path;
use std::process::Command;

use crate::error::{AppError, AppResult};

const CURL: &str = "/usr/bin/curl";

fn curl(url: &str, max_seconds: u32) -> Command {
    let mut command = Command::new(CURL);
    command.args([
        "--fail",
        "--silent",
        "--show-error",
        "--location",
        "--proto",
        "=https",
        "--max-time",
        &max_seconds.to_string(),
    ]);
    command.arg(url);
    command
}

fn run(mut command: Command, url: &str) -> AppResult<Vec<u8>> {
    let output = command.output()?;
    if output.status.success() {
        return Ok(output.stdout);
    }
    let reason = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(AppError::internal(format!(
        "couldn't download {url}: {reason}"
    )))
}

pub fn bytes(url: &str) -> AppResult<Vec<u8>> {
    run(curl(url, 20), url)
}

pub fn file(url: &str, path: &Path) -> AppResult<()> {
    let mut command = curl(url, 900);
    command.arg("--output").arg(path);
    run(command, url).map(drop)
}
