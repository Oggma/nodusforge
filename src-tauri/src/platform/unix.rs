use std::collections::HashMap;
use std::io::Read;
#[cfg(target_os = "macos")]
use std::path::Path;
use std::process::{Command as StdCommand, Stdio};
use std::time::{Duration, Instant};

use std::os::unix::process::CommandExt;

use nix::sys::signal::{killpg, Signal};
use nix::unistd::Pid;
use tokio::process::Command;

use crate::config::StopSignal;

pub struct ProcessHandle {
    pgid: i32,
}

impl ProcessHandle {
    pub fn from_child(child: &mut tokio::process::Child) -> Result<Self, String> {
        let pid = child
            .id()
            .ok_or_else(|| "managed process exited before its handle was recorded".to_string())?;
        Ok(Self { pgid: pid as i32 })
    }

    pub fn pid(&self) -> u32 {
        self.pgid.max(0) as u32
    }

    pub fn group_id(&self) -> i32 {
        self.pgid
    }

    pub fn request_stop(&self, signal: StopSignal) {
        signal_group(self.pgid, signal_of(signal));
    }

    pub fn force_kill(&self) {
        signal_group(self.pgid, Signal::SIGKILL);
    }
}

pub fn shell_command() -> (String, Vec<String>) {
    #[cfg(target_os = "macos")]
    {
        let shell = std::env::var("SHELL")
            .ok()
            .filter(|value| Path::new(value).is_absolute() && Path::new(value).exists())
            .unwrap_or_else(|| "/bin/bash".to_string());
        (shell, vec!["-lc".to_string()])
    }

    #[cfg(not(target_os = "macos"))]
    {
        ("/bin/bash".to_string(), vec!["-lc".to_string()])
    }
}

pub fn configure_command(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    command.as_std_mut().process_group(0);
}

pub fn base_env() -> HashMap<String, String> {
    let shell = env_shell();
    let nul_script = "printf '__NODUSFORGE_ENV__\\0'; /usr/bin/env -0";

    if let Some((success, output)) = run_shell(&shell, nul_script) {
        if success {
            if let Some(env) = parse_nul_env(&output) {
                return env;
            }
        }
    }

    let line_script = "printf '__NODUSFORGE_ENV__\\n'; /usr/bin/env";
    if let Some((success, output)) = run_shell(&shell, line_script) {
        if success {
            return parse_line_env(&output);
        }
    }

    HashMap::new()
}

fn process_command(pid: u32) -> Option<String> {
    #[cfg(target_os = "linux")]
    {
        let cmdline = std::fs::read(format!("/proc/{pid}/cmdline")).ok()?;
        let text = String::from_utf8_lossy(&cmdline).replace('\0', " ");
        let text = text.trim().to_string();
        if text.is_empty() {
            None
        } else {
            Some(text)
        }
    }

    #[cfg(target_os = "macos")]
    {
        let output = StdCommand::new("/bin/ps")
            .args(["-p", &pid.to_string(), "-o", "command="])
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if text.is_empty() {
            None
        } else {
            Some(text)
        }
    }

    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    {
        let _ = pid;
        None
    }
}

pub fn terminate_orphan(group_id: i32, command: &str) -> bool {
    if group_id <= 0 {
        return false;
    }
    let Some(current) = process_command(group_id as u32) else {
        return false;
    };
    let command = command.trim();
    if command.is_empty() || !current.contains(command) {
        return false;
    }
    signal_group(group_id, Signal::SIGTERM);
    true
}

pub fn port_holder(port: u16) -> Option<String> {
    #[cfg(target_os = "linux")]
    {
        linux_port_holder(port)
    }

    #[cfg(target_os = "macos")]
    {
        macos_port_holder(port)
    }

    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    {
        let _ = port;
        None
    }
}

fn signal_of(signal: StopSignal) -> Signal {
    match signal {
        StopSignal::Sigint => Signal::SIGINT,
        StopSignal::Sigterm => Signal::SIGTERM,
    }
}

fn signal_group(pgid: i32, signal: Signal) {
    if pgid > 0 {
        let _ = killpg(Pid::from_raw(pgid), signal);
    }
}

fn env_shell() -> String {
    #[cfg(target_os = "macos")]
    {
        return std::env::var("SHELL")
            .ok()
            .filter(|value| Path::new(value).is_absolute() && Path::new(value).exists())
            .unwrap_or_else(|| "/bin/bash".to_string());
    }

    #[cfg(not(target_os = "macos"))]
    {
        "/bin/bash".to_string()
    }
}

fn run_shell(shell: &str, script: &str) -> Option<(bool, Vec<u8>)> {
    let mut command = StdCommand::new(shell);
    command
        .args(["-lic", script])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    run_with_timeout(command, Duration::from_secs(5))
}

fn run_with_timeout(mut command: StdCommand, timeout: Duration) -> Option<(bool, Vec<u8>)> {
    // Run the shell in its own process group so a timeout also stops children
    // that keep stdout open. Without this, joining the reader thread can hang
    // for as long as a background child lives.
    command.process_group(0);
    let mut child = command.spawn().ok()?;
    let pid = child.id();
    let mut stdout = child.stdout.take()?;
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut buffer = Vec::new();
        let _ = stdout.read_to_end(&mut buffer);
        let _ = tx.send(buffer);
    });

    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let output = match rx.recv_timeout(Duration::from_secs(1)) {
                    Ok(output) => output,
                    Err(_) => {
                        kill_process_group(pid);
                        return None;
                    }
                };
                return Some((status.success(), output));
            }
            Ok(None) => {
                if Instant::now() >= deadline {
                    kill_process_group(pid);
                    let _ = child.kill();
                    let _ = child.wait();
                    return None;
                }
                std::thread::sleep(Duration::from_millis(20));
            }
            Err(_) => {
                kill_process_group(pid);
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
}

fn kill_process_group(pid: u32) {
    let _ = killpg(Pid::from_raw(pid as i32), Signal::SIGKILL);
}

fn parse_nul_env(output: &[u8]) -> Option<HashMap<String, String>> {
    const MARKER: &[u8] = b"__NODUSFORGE_ENV__\0";
    let index = output
        .windows(MARKER.len())
        .position(|window| window == MARKER)?;
    let env = output[index + MARKER.len()..]
        .split(|byte| *byte == 0)
        .filter_map(parse_env_entry)
        .collect();
    Some(env)
}

fn parse_line_env(output: &[u8]) -> HashMap<String, String> {
    const MARKER: &str = "__NODUSFORGE_ENV__";
    let text = String::from_utf8_lossy(output);
    let mut lines = text.lines();
    let found = lines.by_ref().any(|line| line.trim() == MARKER);
    if !found {
        return HashMap::new();
    }
    lines
        .filter_map(|line| parse_env_entry(line.as_bytes()))
        .collect()
}

fn parse_env_entry(entry: &[u8]) -> Option<(String, String)> {
    let text = String::from_utf8_lossy(entry);
    let (key, value) = text.split_once('=')?;
    if !keep_shell_var(key) {
        return None;
    }
    Some((key.to_string(), value.to_string()))
}

fn keep_shell_var(key: &str) -> bool {
    if key.is_empty() || key.contains("%%") || key.starts_with("BASH_FUNC_") {
        return false;
    }

    !matches!(
        key,
        "PWD"
            | "OLDPWD"
            | "SHLVL"
            | "_"
            | "BASH_ENV"
            | "ENV"
            | "PROMPT_COMMAND"
            | "PS1"
            | "PS2"
            | "PS4"
            | "COLUMNS"
            | "LINES"
            | "TERM"
            | "COLORTERM"
            | "HISTFILE"
            | "HISTCONTROL"
            | "HISTIGNORE"
            | "HISTSIZE"
            | "HISTFILESIZE"
            | "BASH_ARGC"
            | "BASH_ARGV"
            | "BASH_EXECUTION_STRING"
            | "SHELLOPTS"
            | "BASHOPTS"
    )
}

#[cfg(target_os = "linux")]
fn linux_port_holder(port: u16) -> Option<String> {
    let output = StdCommand::new("ss")
        .args(["-ltnp"])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    let needle = format!(":{port}");

    for line in text.lines() {
        if line.starts_with("State") {
            continue;
        }
        let fields: Vec<&str> = line.split_whitespace().collect();
        if fields.len() < 4 {
            continue;
        }
        let local = fields[3];
        if !local.ends_with(&needle) {
            continue;
        }

        let process = fields.get(5).copied().unwrap_or("");
        let pid = process
            .split("pid=")
            .nth(1)
            .and_then(|rest| rest.split(',').next())
            .and_then(|pid| pid.parse::<u32>().ok());

        return Some(match pid {
            Some(pid) => {
                let comm = std::fs::read_to_string(format!("/proc/{pid}/comm"))
                    .map(|s| s.trim().to_string())
                    .unwrap_or_else(|_| "unknown".into());
                format!("{comm} (pid {pid})")
            }
            None => "another process".into(),
        });
    }

    None
}

#[cfg(target_os = "macos")]
fn macos_port_holder(port: u16) -> Option<String> {
    let output = StdCommand::new("/usr/sbin/lsof")
        .args([
            "-nP",
            &format!("-iTCP:{port}"),
            "-sTCP:LISTEN",
            "-Fpc",
        ])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }

    let text = String::from_utf8_lossy(&output.stdout);
    let mut pid = None;
    let mut command = None;
    for line in text.lines() {
        if let Some(value) = line.strip_prefix('p') {
            pid = value.parse::<u32>().ok();
        } else if let Some(value) = line.strip_prefix('c') {
            command = Some(value.to_string());
        }
        if pid.is_some() && command.is_some() {
            break;
        }
    }

    match (pid, command) {
        (Some(pid), Some(command)) => Some(format!("{command} (pid {pid})")),
        (Some(pid), None) => Some(format!("pid {pid}")),
        _ => Some("another process".into()),
    }
}
