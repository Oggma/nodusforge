use std::collections::HashMap;
use std::path::Path;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use tokio::process::Command;

/// Shared runtime for host tools such as Git and Docker.
///
/// Desktop launches inherit the session environment, which usually lacks
/// nvm/pyenv/sdkman and sometimes even the user's PATH additions. The runtime
/// resolves an interactive login-shell environment once and uses it as the base
/// for managed processes and optional tools.
#[derive(Clone)]
pub struct ToolRuntime {
    env: Arc<HashMap<String, String>>,
}

#[derive(Debug, Clone)]
pub struct ToolOutput {
    pub success: bool,
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

impl ToolOutput {
    pub fn error_message(&self) -> String {
        let stderr = self.stderr.trim();
        if !stderr.is_empty() {
            return stderr.to_string();
        }
        let stdout = self.stdout.trim();
        if !stdout.is_empty() {
            return stdout.to_string();
        }
        match self.code {
            Some(code) => format!("command failed with exit code {code}"),
            None => "command failed".to_string(),
        }
    }
}

impl ToolRuntime {
    pub fn new() -> Self {
        Self {
            env: Arc::new(resolve_shell_env()),
        }
    }

    pub fn base_env(&self) -> &HashMap<String, String> {
        &self.env
    }

    /// Build a command with the login-shell environment and non-interactive
    /// stdio. Callers can add tool-specific environment overrides.
    pub fn command(&self, program: &str) -> Command {
        let mut command = Command::new(program);
        for (key, value) in self.env.iter() {
            command.env(key, value);
        }
        command
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        command
    }

    pub async fn run(
        &self,
        program: &str,
        args: &[&str],
        cwd: Option<&Path>,
        timeout: Duration,
    ) -> Result<ToolOutput, String> {
        let mut command = self.command(program);
        command.args(args);
        if let Some(cwd) = cwd {
            command.current_dir(cwd);
        }
        self.run_command(command, timeout, program).await
    }

    pub async fn run_command(
        &self,
        mut command: Command,
        timeout: Duration,
        label: &str,
    ) -> Result<ToolOutput, String> {
        let output = tokio::time::timeout(timeout, command.output())
            .await
            .map_err(|_| {
                format!(
                    "{label} timed out after {}s",
                    timeout.as_secs_f32().ceil() as u64
                )
            })?
            .map_err(|error| format!("cannot run {label}: {error}"))?;

        Ok(ToolOutput {
            success: output.status.success(),
            code: output.status.code(),
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        })
    }
}

impl Default for ToolRuntime {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolStatus {
    pub installed: bool,
    pub version: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerStatus {
    pub installed: bool,
    pub version: Option<String>,
    pub daemon_reachable: bool,
    pub daemon_version: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolsStatus {
    pub git: ToolStatus,
    pub docker: DockerStatus,
}

pub async fn status(runtime: &ToolRuntime) -> ToolsStatus {
    ToolsStatus {
        git: git_status(runtime).await,
        docker: docker_status(runtime).await,
    }
}

async fn git_status(runtime: &ToolRuntime) -> ToolStatus {
    match runtime
        .run("git", &["--version"], None, Duration::from_secs(5))
        .await
    {
        Ok(output) if output.success => ToolStatus {
            installed: true,
            version: Some(output.stdout.trim().to_string()),
            error: None,
        },
        Ok(output) => ToolStatus {
            installed: false,
            version: None,
            error: Some(output.error_message()),
        },
        Err(error) => ToolStatus {
            installed: false,
            version: None,
            error: Some(error),
        },
    }
}

async fn docker_status(runtime: &ToolRuntime) -> DockerStatus {
    let version = match runtime
        .run("docker", &["--version"], None, Duration::from_secs(5))
        .await
    {
        Ok(output) if output.success => output.stdout.trim().to_string(),
        Ok(output) => {
            return DockerStatus {
                installed: false,
                version: None,
                daemon_reachable: false,
                daemon_version: None,
                error: Some(output.error_message()),
            }
        }
        Err(error) => {
            return DockerStatus {
                installed: false,
                version: None,
                daemon_reachable: false,
                daemon_version: None,
                error: Some(error),
            }
        }
    };

    match runtime
        .run(
            "docker",
            &["info", "--format", "{{.ServerVersion}}"],
            None,
            Duration::from_secs(8),
        )
        .await
    {
        Ok(output) if output.success => DockerStatus {
            installed: true,
            version: Some(version),
            daemon_reachable: true,
            daemon_version: Some(output.stdout.trim().to_string()),
            error: None,
        },
        Ok(output) => DockerStatus {
            installed: true,
            version: Some(version),
            daemon_reachable: false,
            daemon_version: None,
            error: Some(output.error_message()),
        },
        Err(error) => DockerStatus {
            installed: true,
            version: Some(version),
            daemon_reachable: false,
            daemon_version: None,
            error: Some(error),
        },
    }
}

/// Desktop launches inherit the session PATH, which normally has no nvm,
/// pyenv, sdkman or similar. Ask an interactive login shell for its
/// environment once and use it as the base environment for managed commands.
fn resolve_shell_env() -> HashMap<String, String> {
    const MARKER: &[u8] = b"__NODUSFORGE_ENV__\0";
    const SCRIPT: &str = "printf '__NODUSFORGE_ENV__\\0'; /usr/bin/env -0";

    let output = std::process::Command::new("/usr/bin/timeout")
        .args(["-s", "KILL", "5", "/bin/bash", "-lic", SCRIPT])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output();

    let Ok(output) = output else {
        return HashMap::new();
    };
    if !output.status.success() {
        return HashMap::new();
    }

    let Some(index) = output
        .stdout
        .windows(MARKER.len())
        .position(|window| window == MARKER)
    else {
        return HashMap::new();
    };

    output.stdout[index + MARKER.len()..]
        .split(|byte| *byte == 0)
        .filter_map(|entry| {
            let text = String::from_utf8_lossy(entry);
            let (key, value) = text.split_once('=')?;
            if !keep_shell_var(key) {
                return None;
            }
            Some((key.to_string(), value.to_string()))
        })
        .collect()
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
