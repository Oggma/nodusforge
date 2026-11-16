use std::collections::HashMap;
use std::path::Path;
use std::process::Stdio;
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};

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
    env: Arc<RwLock<HashMap<String, String>>>,
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
        let env = Arc::new(RwLock::new(HashMap::new()));
        let slot = env.clone();
        std::thread::spawn(move || {
            let started = Instant::now();
            let resolved = crate::platform::base_env();
            crate::diagnostics::log(format!(
                "login-shell environment resolved ({} vars) in {} ms",
                resolved.len(),
                started.elapsed().as_millis()
            ));
            if let Ok(mut current) = slot.write() {
                *current = resolved;
            }
        });
        Self { env }
    }

    pub fn base_env(&self) -> HashMap<String, String> {
        self.env
            .read()
            .map(|env| env.clone())
            .unwrap_or_default()
    }

    /// Build a command with the login-shell environment and non-interactive
    /// stdio. Callers can add tool-specific environment overrides.
    pub fn command(&self, program: &str) -> Command {
        let mut command = Command::new(program);
        if let Ok(env) = self.env.read() {
            for (key, value) in env.iter() {
                command.env(key, value);
            }
        }
        command
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        crate::platform::configure_command(&mut command);
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
        let started = Instant::now();
        let result = tokio::time::timeout(timeout, command.output()).await;
        crate::diagnostics::log(format!(
            "{label} completed in {} ms",
            started.elapsed().as_millis()
        ));

        let output = match result {
            Ok(Ok(output)) => output,
            Ok(Err(error)) => return Err(format!("cannot run {label}: {error}")),
            Err(_) => {
                return Err(format!(
                    "{label} timed out after {}s",
                    timeout.as_secs_f32().ceil() as u64
                ))
            }
        };

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
