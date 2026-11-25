use std::io::Write as _;
use std::process::{Child, ChildStderr, ChildStdout, Command};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;

use crate::error::{AppError, AppResult};

/// Shared by every run, CLI or ACP: they stream on the same events, told apart by id.
static RUNS: AtomicU64 = AtomicU64::new(0);

pub fn next_run_id() -> u64 {
    RUNS.fetch_add(1, Ordering::Relaxed)
}

#[derive(Debug)]
pub struct RunHandle {
    pub run_id: u64,
    pub stdout: ChildStdout,
    pub stderr: ChildStderr,
}

/// One Claude Code child at a time.
#[derive(Default)]
pub struct RunSlot {
    child: Mutex<Option<Child>>,
    cancelled: AtomicBool,
    running: AtomicBool,
}

impl RunSlot {
    pub fn claim(&self) -> AppResult<()> {
        if self.running.swap(true, Ordering::SeqCst) {
            return Err(AppError::AgentBusy);
        }
        self.cancelled.store(false, Ordering::SeqCst);
        Ok(())
    }

    /// Gives the slot back when the run never started.
    pub fn release(&self) {
        self.running.store(false, Ordering::SeqCst);
    }

    pub fn spawn(&self, mut command: Command, request: String) -> AppResult<RunHandle> {
        let mut child = command.spawn()?;
        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| AppError::internal("agent stdin was not captured"))?;
        // A failed write means the CLI already exited; its stderr says why.
        std::thread::spawn(move || stdin.write_all(request.as_bytes()));
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| AppError::internal("agent stdout was not captured"))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| AppError::internal("agent stderr was not captured"))?;

        *self
            .child
            .lock()
            .map_err(|_| AppError::internal("agent child mutex poisoned"))? = Some(child);

        Ok(RunHandle {
            run_id: next_run_id(),
            stdout,
            stderr,
        })
    }

    /// Waits the child out and frees the slot; says whether the run was cancelled.
    pub fn finish(&self) -> bool {
        let cancelled = self.cancelled.load(Ordering::SeqCst);
        if let Ok(mut slot) = self.child.lock() {
            if let Some(mut child) = slot.take() {
                let _ = child.wait();
            }
        }
        self.running.store(false, Ordering::SeqCst);
        cancelled
    }

    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
        if let Ok(mut slot) = self.child.lock() {
            if let Some(child) = slot.as_mut() {
                let _ = child.kill();
            }
        }
    }
}
