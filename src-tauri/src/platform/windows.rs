use std::collections::HashMap;
use std::os::windows::process::CommandExt;
use std::process::{Command as StdCommand, Stdio};

use tokio::process::Command;
use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
    SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};
use windows_sys::Win32::System::Threading::CREATE_NO_WINDOW;

use crate::config::StopSignal;

pub struct ProcessHandle {
    pid: u32,
    job: usize,
}

impl ProcessHandle {
    pub fn from_child(child: &mut tokio::process::Child) -> Result<Self, String> {
        let pid = child
            .id()
            .ok_or_else(|| "managed process exited before its handle was recorded".to_string())?;
        let raw = child
            .raw_handle()
            .ok_or_else(|| "could not read the managed process handle".to_string())?;
        let job = create_job(raw as HANDLE).unwrap_or(0);
        Ok(Self {
            pid,
            job,
        })
    }

    pub fn pid(&self) -> u32 {
        self.pid
    }

    pub fn group_id(&self) -> i32 {
        0
    }

    pub fn request_stop(&self, _signal: StopSignal) {
        self.terminate();
    }

    pub fn force_kill(&self) {
        self.terminate();
    }

    fn terminate(&self) {
        if self.job != 0 {
            unsafe {
                TerminateJobObject(self.job as HANDLE, 1);
            }
            return;
        }
        taskkill(self.pid);
    }
}

impl Drop for ProcessHandle {
    fn drop(&mut self) {
        if self.job != 0 {
            unsafe {
                CloseHandle(self.job as HANDLE);
            }
            self.job = 0;
        }
    }
}

pub fn shell_command() -> (String, Vec<String>) {
    let shell = std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string());
    (shell, vec!["/C".to_string()])
}

pub fn configure_command(command: &mut Command) {
    command.as_std_mut().creation_flags(CREATE_NO_WINDOW);
}

pub fn base_env() -> HashMap<String, String> {
    std::env::vars().collect()
}

pub fn terminate_orphan(_group_id: i32, _command: &str) -> bool {
    false
}

pub fn port_holder(port: u16) -> Option<String> {
    let output = StdCommand::new("netstat")
        .args(["-ano", "-p", "tcp"])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    let needle = format!(":{port}");

    for line in text.lines() {
        let fields: Vec<&str> = line.split_whitespace().collect();
        if fields.len() < 5 || fields[0].to_ascii_uppercase() != "TCP" {
            continue;
        }
        if !fields[1].ends_with(&needle) || fields[3].to_ascii_uppercase() != "LISTENING" {
            continue;
        }
        let Ok(pid) = fields[4].parse::<u32>() else {
            continue;
        };
        let name = task_name(pid).unwrap_or_else(|| "another process".to_string());
        return Some(format!("{name} (pid {pid})"));
    }

    None
}

fn create_job(process: HANDLE) -> Option<usize> {
    unsafe {
        let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
        if job.is_null() {
            return None;
        }

        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let length = std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32;
        let configured = SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const core::ffi::c_void,
            length,
        );
        if configured == 0 || AssignProcessToJobObject(job, process) == 0 {
            CloseHandle(job);
            return None;
        }
        Some(job as usize)
    }
}

fn taskkill(pid: u32) {
    let mut command = StdCommand::new("taskkill");
    command
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW);
    if let Ok(mut child) = command.spawn() {
        let _ = child.wait();
    }
}

fn task_name(pid: u32) -> Option<String> {
    let output = StdCommand::new("tasklist")
        .args(["/FI", &format!("PID eq {pid}"), "/FO", "CSV", "/NH"])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let first = text.lines().next()?.trim();
    if !first.starts_with('"') {
        return None;
    }
    let name = first.trim_matches('"').split("\",\"").next()?.to_string();
    if name.is_empty() {
        None
    } else {
        Some(name)
    }
}
