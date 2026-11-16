use std::collections::HashMap;

use tokio::process::Command;

use crate::config::StopSignal;

#[cfg(unix)]
mod unix;
#[cfg(unix)]
use unix as imp;

#[cfg(windows)]
mod windows;
#[cfg(windows)]
use windows as imp;

/// Program and arguments used to run a managed app command.
pub fn shell_command() -> (String, Vec<String>) {
    imp::shell_command()
}

/// Apply platform-specific spawn options to a command.
pub fn configure_command(command: &mut Command) {
    imp::configure_command(command);
}

/// Base environment for managed apps and helper tools.
pub fn base_env() -> HashMap<String, String> {
    imp::base_env()
}

pub struct ProcessHandle {
    inner: imp::ProcessHandle,
}

impl ProcessHandle {
    pub fn from_child(child: &mut tokio::process::Child) -> Result<Self, String> {
        Ok(Self {
            inner: imp::ProcessHandle::from_child(child)?,
        })
    }

    pub fn pid(&self) -> u32 {
        self.inner.pid()
    }

    pub fn group_id(&self) -> i32 {
        self.inner.group_id()
    }

    pub fn request_stop(&self, signal: StopSignal) {
        self.inner.request_stop(signal);
    }

    pub fn force_kill(&self) {
        self.inner.force_kill();
    }
}

pub fn terminate_orphan(group_id: i32, command: &str) -> bool {
    imp::terminate_orphan(group_id, command)
}

pub fn port_holder(port: u16) -> Option<String> {
    imp::port_holder(port)
}
