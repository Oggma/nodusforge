use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::config::{AppConfig, Group, Health, Settings, StopSignal};

pub const EVT_STATUS: &str = "nodusforge://status";
pub const EVT_LOG_BATCH: &str = "nodusforge://log-batch";
pub const EVT_SNAPSHOT: &str = "nodusforge://snapshot";
pub const EVT_CONFIG_CHANGED: &str = "nodusforge://config-changed";
pub const EVT_TOAST: &str = "nodusforge://toast";

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum State {
    Stopped,
    Starting,
    Running,
    Stopping,
    Failed,
    Crashed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub state: State,
    pub message: Option<String>,
    pub exit_code: Option<i32>,
    pub pid: Option<u32>,
    pub started_at: Option<u64>,
}

impl Status {
    pub fn stopped() -> Self {
        Self {
            state: State::Stopped,
            message: None,
            exit_code: None,
            pid: None,
            started_at: None,
        }
    }

    pub fn is_active(&self) -> bool {
        matches!(
            self.state,
            State::Starting | State::Running | State::Stopping
        )
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusEvent {
    pub id: String,
    pub state: State,
    pub message: Option<String>,
    pub exit_code: Option<i32>,
    pub pid: Option<u32>,
    pub started_at: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogBatch {
    pub id: String,
    pub lines: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Toast {
    pub level: &'static str,
    pub title: String,
    pub message: String,
}

pub fn toast(
    app: &AppHandle,
    level: &'static str,
    title: impl Into<String>,
    message: impl Into<String>,
) {
    let _ = app.emit(
        EVT_TOAST,
        Toast {
            level,
            title: title.into(),
            message: message.into(),
        },
    );
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppView {
    pub id: String,
    pub name: String,
    pub group: Option<String>,
    pub cwd: String,
    pub command: String,
    pub url: Option<String>,
    pub health: Health,
    pub depends_on: Vec<String>,
    pub auto_start: bool,
    pub stop_signal: StopSignal,
    pub state: State,
    pub message: Option<String>,
    pub exit_code: Option<i32>,
    pub pid: Option<u32>,
    pub started_at: Option<u64>,
}

impl AppView {
    pub fn new(app: &AppConfig, status: &Status) -> Self {
        Self {
            id: app.id.clone(),
            name: app.name.clone(),
            group: app.group.clone(),
            cwd: app.cwd.clone(),
            command: app.command.clone(),
            url: app.url.clone(),
            health: app.health.clone(),
            depends_on: app.depends_on.clone(),
            auto_start: app.auto_start,
            stop_signal: app.stop_signal,
            state: status.state,
            message: status.message.clone(),
            exit_code: status.exit_code,
            pid: status.pid,
            started_at: status.started_at,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub version: String,
    pub config_path: String,
    pub config_error: Option<String>,
    pub warnings: Vec<String>,
    pub settings: Settings,
    pub groups: Vec<Group>,
    pub apps: Vec<AppView>,
}
