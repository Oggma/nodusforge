use std::time::Duration;

use serde::Serialize;

use crate::tools::{ToolOutput, ToolRuntime};

const COMMAND_TIMEOUT: Duration = Duration::from_secs(10);
const STOP_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainerInfo {
    pub id: String,
    pub name: String,
    pub image: String,
    pub state: String,
    pub status: String,
    pub ports: String,
    pub created: String,
    pub command: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContainersResult {
    pub installed: bool,
    pub daemon_reachable: bool,
    pub version: Option<String>,
    pub error: Option<String>,
    pub containers: Vec<ContainerInfo>,
}

impl ContainersResult {
    fn unavailable(error: String) -> Self {
        Self {
            installed: false,
            daemon_reachable: false,
            version: None,
            error: Some(error),
            containers: Vec::new(),
        }
    }
}

pub async fn list(runtime: &ToolRuntime) -> ContainersResult {
    let version = match runtime
        .run("docker", &["--version"], None, COMMAND_TIMEOUT)
        .await
    {
        Ok(output) if output.success => output.stdout.trim().to_string(),
        Ok(output) => return ContainersResult::unavailable(output.error_message()),
        Err(error) => return ContainersResult::unavailable(error),
    };

    let output = match runtime
        .run(
            "docker",
            &["ps", "-a", "--format", "{{json .}}"],
            None,
            COMMAND_TIMEOUT,
        )
        .await
    {
        Ok(output) => output,
        Err(error) => {
            return ContainersResult {
                installed: true,
                daemon_reachable: false,
                version: Some(version),
                error: Some(error),
                containers: Vec::new(),
            }
        }
    };

    if !output.success {
        return ContainersResult {
            installed: true,
            daemon_reachable: false,
            version: Some(version),
            error: Some(output.error_message()),
            containers: Vec::new(),
        };
    }

    let containers = output
        .stdout
        .lines()
        .filter(|line| !line.trim().is_empty())
        .filter_map(parse_container)
        .collect();

    ContainersResult {
        installed: true,
        daemon_reachable: true,
        version: Some(version),
        error: None,
        containers,
    }
}

pub async fn start(runtime: &ToolRuntime, id: &str) -> Result<(), String> {
    let id = validate_id(id)?;
    let output = runtime
        .run("docker", &["start", id], None, STOP_TIMEOUT)
        .await?;
    if output.success {
        Ok(())
    } else {
        Err(docker_error("docker start", &output))
    }
}

pub async fn stop(runtime: &ToolRuntime, id: &str) -> Result<(), String> {
    let id = validate_id(id)?;
    let output = runtime
        .run("docker", &["stop", "-t", "10", id], None, STOP_TIMEOUT)
        .await?;
    if output.success {
        Ok(())
    } else {
        Err(docker_error("docker stop", &output))
    }
}

fn parse_container(line: &str) -> Option<ContainerInfo> {
    let value: serde_json::Value = serde_json::from_str(line).ok()?;
    let field = |name: &str| {
        value
            .get(name)
            .and_then(|item| item.as_str())
            .unwrap_or_default()
            .to_string()
    };

    let id = field("ID");
    if id.is_empty() {
        return None;
    }

    Some(ContainerInfo {
        id,
        name: field("Names"),
        image: field("Image"),
        state: field("State"),
        status: field("Status"),
        ports: field("Ports"),
        created: {
            let value = field("CreatedAt");
            if value.is_empty() {
                field("Created")
            } else {
                value
            }
        },
        command: field("Command"),
    })
}

fn validate_id(id: &str) -> Result<&str, String> {
    let id = id.trim();
    if id.is_empty()
        || id.len() > 128
        || id.starts_with('-')
        || !id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
    {
        return Err(format!("invalid container id '{id}'"));
    }
    Ok(id)
}

fn docker_error(action: &str, output: &ToolOutput) -> String {
    format!("{action} failed: {}", output.error_message())
}
