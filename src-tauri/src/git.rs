use std::path::Path;
use std::time::Duration;

use serde::Serialize;
use tokio::process::Command;

use crate::tools::{ToolOutput, ToolRuntime};

const STATUS_TIMEOUT: Duration = Duration::from_secs(5);
const SWITCH_TIMEOUT: Duration = Duration::from_secs(20);

const GIT_ENV_REMOVE: &[&str] = &[
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_COMMON_DIR",
    "GIT_NAMESPACE",
    "GIT_PREFIX",
    "GIT_CEILING_DIRECTORIES",
    "GIT_DISCOVERY_ACROSS_FILESYSTEM",
    "GIT_QUARANTINE_PATH",
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRepoStatus {
    pub installed: bool,
    pub is_repo: bool,
    pub repo_marker: bool,
    pub root: Option<String>,
    pub branch: Option<String>,
    pub detached: bool,
    pub branches: Vec<String>,
    pub error: Option<String>,
}

impl GitRepoStatus {
    fn empty(repo_marker: bool) -> Self {
        Self {
            installed: false,
            is_repo: false,
            repo_marker,
            root: None,
            branch: None,
            detached: false,
            branches: Vec::new(),
            error: None,
        }
    }
}

pub async fn status(runtime: &ToolRuntime, cwd: &Path) -> GitRepoStatus {
    let repo_marker = has_repo_marker(cwd);

    match run_git(runtime, None, &["--version"], STATUS_TIMEOUT).await {
        Ok(output) if output.success => {}
        Ok(output) => {
            let mut status = GitRepoStatus::empty(repo_marker);
            status.error = Some(output.error_message());
            return status;
        }
        Err(error) => {
            let mut status = GitRepoStatus::empty(repo_marker);
            status.error = Some(error);
            return status;
        }
    }

    let mut status = GitRepoStatus {
        installed: true,
        is_repo: false,
        repo_marker,
        root: None,
        branch: None,
        detached: false,
        branches: Vec::new(),
        error: None,
    };

    if !cwd.is_dir() {
        status.error = Some(format!(
            "working directory does not exist: {}",
            cwd.display()
        ));
        return status;
    }

    let inside = match run_git(
        runtime,
        Some(cwd),
        &["rev-parse", "--is-inside-work-tree"],
        STATUS_TIMEOUT,
    )
    .await
    {
        Ok(output) => output,
        Err(error) => {
            status.error = Some(error);
            return status;
        }
    };

    if !inside.success || inside.stdout.trim() != "true" {
        return status;
    }
    status.is_repo = true;

    if let Ok(output) = run_git(
        runtime,
        Some(cwd),
        &["rev-parse", "--show-toplevel"],
        STATUS_TIMEOUT,
    )
    .await
    {
        if output.success {
            let root = output.stdout.trim();
            if !root.is_empty() {
                status.root = Some(root.to_string());
            }
        }
    }

    match run_git(
        runtime,
        Some(cwd),
        &["symbolic-ref", "--quiet", "--short", "HEAD"],
        STATUS_TIMEOUT,
    )
    .await
    {
        Ok(output) if output.success => {
            let branch = output.stdout.trim();
            if !branch.is_empty() {
                status.branch = Some(branch.to_string());
            }
        }
        _ => {
            status.detached = true;
        }
    }

    if let Ok(output) = run_git(
        runtime,
        Some(cwd),
        &[
            "for-each-ref",
            "--format=%(refname:short)",
            "refs/heads/",
        ],
        STATUS_TIMEOUT,
    )
    .await
    {
        if output.success {
            let mut branches: Vec<String> = output
                .stdout
                .lines()
                .map(str::trim)
                .filter(|branch| !branch.is_empty())
                .map(str::to_string)
                .collect();
            branches.sort_by_key(|branch| branch.to_ascii_lowercase());
            status.branches = branches;
        } else {
            status.error = Some(output.error_message());
        }
    }

    status
}

pub async fn switch(
    runtime: &ToolRuntime,
    cwd: &Path,
    branch: &str,
) -> Result<GitRepoStatus, String> {
    let branch = branch.trim();
    if branch.is_empty() {
        return Err("branch name is empty".into());
    }
    if branch.starts_with('-') {
        return Err(format!("invalid branch name '{branch}'"));
    }

    let current = status(runtime, cwd).await;
    if !current.installed {
        return Err(current
            .error
            .unwrap_or_else(|| "Git is not installed".into()));
    }
    if !current.is_repo {
        return Err(current
            .error
            .unwrap_or_else(|| "not a Git repository".into()));
    }
    if !current.branches.iter().any(|name| name == branch) {
        return Err(format!("local branch '{branch}' does not exist"));
    }
    if current.branch.as_deref() == Some(branch) && !current.detached {
        return Ok(current);
    }

    let output = run_git(
        runtime,
        Some(cwd),
        &["switch", branch],
        SWITCH_TIMEOUT,
    )
    .await?;

    if output.success {
        return Ok(status(runtime, cwd).await);
    }

    // `git switch` was added in Git 2.23. Fall back for older installations.
    if output
        .stderr
        .to_ascii_lowercase()
        .contains("not a git command")
    {
        let fallback = run_git(
            runtime,
            Some(cwd),
            &["checkout", branch],
            SWITCH_TIMEOUT,
        )
        .await?;
        if fallback.success {
            return Ok(status(runtime, cwd).await);
        }
        return Err(git_error("git checkout", &fallback));
    }

    Err(git_error("git switch", &output))
}

fn git_error(action: &str, output: &ToolOutput) -> String {
    format!("{action} failed: {}", output.error_message())
}

async fn run_git(
    runtime: &ToolRuntime,
    cwd: Option<&Path>,
    args: &[&str],
    timeout: Duration,
) -> Result<ToolOutput, String> {
    let mut command = git_command(runtime, cwd);
    command.args(args);
    runtime
        .run_command(command, timeout, "git")
        .await
}

fn git_command(runtime: &ToolRuntime, cwd: Option<&Path>) -> Command {
    let mut command = runtime.command("git");
    for key in GIT_ENV_REMOVE {
        command.env_remove(key);
    }
    command
        .env("GIT_PAGER", "cat")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0");
    if let Some(cwd) = cwd {
        command.arg("-C").arg(cwd);
    }
    command
}

fn has_repo_marker(cwd: &Path) -> bool {
    let base = cwd
        .canonicalize()
        .unwrap_or_else(|_| cwd.to_path_buf());
    let mut current = Some(base.as_path());
    while let Some(dir) = current {
        if dir.join(".git").exists() {
            return true;
        }
        current = dir.parent();
    }
    false
}
