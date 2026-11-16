use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tokio::process::Command;
use tokio::sync::Mutex as AsyncMutex;

use crate::config::{now_ms, AppConfig, Config, StopSignal};
use crate::events::{
    State, Status, StatusEvent, Toast, EVT_STATUS, EVT_TOAST,
};
use crate::platform::{self, ProcessHandle};
use crate::process::health;
use crate::process::logs::{self, LogBuffer};
use crate::tools::ToolRuntime;

pub struct AppRuntime {
    pub id: String,
    pub status: Mutex<Status>,
    pub log: Mutex<LogBuffer>,
    pub process: Mutex<Option<ProcessHandle>>,
    pub generation: AtomicU64,
    pub start_lock: AsyncMutex<()>,
    pub stop_signal: Mutex<StopSignal>,
    pub stop_timeout_ms: AtomicU64,
    pub command: Mutex<String>,
}

impl AppRuntime {
    fn new(id: &str, capacity: usize) -> Self {
        Self {
            id: id.to_string(),
            status: Mutex::new(Status::stopped()),
            log: Mutex::new(LogBuffer::new(capacity)),
            process: Mutex::new(None),
            generation: AtomicU64::new(0),
            start_lock: AsyncMutex::new(()),
            stop_signal: Mutex::new(StopSignal::Sigterm),
            stop_timeout_ms: AtomicU64::new(10_000),
            command: Mutex::new(String::new()),
        }
    }

    pub fn status_snapshot(&self) -> Status {
        self.status.lock().unwrap().clone()
    }

    fn status_event(&self) -> StatusEvent {
        let status = self.status.lock().unwrap().clone();
        StatusEvent {
            id: self.id.clone(),
            state: status.state,
            message: status.message,
            exit_code: status.exit_code,
            pid: status.pid,
            started_at: status.started_at,
        }
    }
}

pub struct ProcessManager {
    app: AppHandle,
    runtimes: Mutex<HashMap<String, Arc<AppRuntime>>>,
    capacity: AtomicU64,
    persist: AtomicBool,
    tools: ToolRuntime,
}

impl ProcessManager {
    pub fn new(app: AppHandle, capacity: usize, persist: bool, tools: ToolRuntime) -> Self {
        Self {
            app,
            runtimes: Mutex::new(HashMap::new()),
            capacity: AtomicU64::new(capacity as u64),
            persist: AtomicBool::new(persist),
            tools,
        }
    }

    pub fn update_log_options(&self, capacity: usize, persist: bool) {
        self.capacity.store(capacity as u64, Ordering::SeqCst);
        self.persist.store(persist, Ordering::SeqCst);
    }

    fn runtime(&self, id: &str) -> Arc<AppRuntime> {
        let mut runtimes = self.runtimes.lock().unwrap();
        runtimes
            .entry(id.to_string())
            .or_insert_with(|| {
                Arc::new(AppRuntime::new(
                    id,
                    self.capacity.load(Ordering::SeqCst) as usize,
                ))
            })
            .clone()
    }

    pub fn get_runtime(&self, id: &str) -> Option<Arc<AppRuntime>> {
        self.runtimes.lock().unwrap().get(id).cloned()
    }

    pub fn status(&self, id: &str) -> Status {
        self.get_runtime(id)
            .map(|rt| rt.status_snapshot())
            .unwrap_or_else(Status::stopped)
    }

    pub fn sync_config(&self, config: &Config) {
        let ids: Vec<String> = config.apps.iter().map(|a| a.id.clone()).collect();
        for id in &ids {
            self.runtime(id);
        }

        let known: std::collections::HashSet<String> = ids.iter().cloned().collect();
        let extra: Vec<Arc<AppRuntime>> = {
            let runtimes = self.runtimes.lock().unwrap();
            runtimes
                .iter()
                .filter(|(id, _)| !known.contains(id.as_str()))
                .map(|(_, rt)| rt.clone())
                .collect()
        };

        for rt in extra {
            if let Some(handle) = rt.process.lock().unwrap().as_ref() {
                handle.request_stop(*rt.stop_signal.lock().unwrap());
            }
            self.runtimes.lock().unwrap().remove(&rt.id);
        }
    }

    pub async fn start(self: &Arc<Self>, app_cfg: &AppConfig) -> Result<(), String> {
        let rt = self.runtime(&app_cfg.id);

        let spawn_result = async {
            let _guard = rt.start_lock.lock().await;

            let current = rt.status_snapshot();
            if matches!(current.state, State::Running | State::Starting) {
                return Ok::<(u64, bool), String>((rt.generation.load(Ordering::SeqCst), false));
            }

            if app_cfg.health.kind == crate::config::HealthKind::Tcp {
                if let Some(port) = app_cfg.health.port {
                    if !health::port_free(port) {
                        let holder = health::port_holder(port)
                            .unwrap_or_else(|| "another process".to_string());
                        let message =
                            format!("port {port} is already in use by {holder}");
                        self.set_status(&rt, failed_status(message.clone()));
                        return Err(message);
                    }
                }
            }

            let cwd = match crate::config::expand_path(&app_cfg.cwd) {
                Ok(cwd) => cwd,
                Err(error) => {
                    self.set_status(&rt, failed_status(error.clone()));
                    return Err(error);
                }
            };
            if !cwd.is_dir() {
                let message = format!("working directory does not exist: {}", cwd.display());
                self.set_status(&rt, failed_status(message.clone()));
                return Err(message);
            }

            let mut env = std::collections::HashMap::new();
            if let Some(env_file) = &app_cfg.env_file {
                read_env_file(&cwd, env_file, &mut env);
            }
            for (key, value) in &app_cfg.env {
                env.insert(key.clone(), value.clone());
            }

            let generation = rt.generation.fetch_add(1, Ordering::SeqCst) + 1;
            *rt.command.lock().unwrap() = app_cfg.command.clone();
            *rt.stop_signal.lock().unwrap() = app_cfg.stop_signal;
            rt.stop_timeout_ms
                .store(app_cfg.stop_timeout_ms.max(500), Ordering::SeqCst);

            let (shell, shell_args) = platform::shell_command();
            let mut command = Command::new(shell);
            // A desktop launch inherits the session PATH, which usually lacks
            // nvm/pyenv/sdkman. Overlay the interactive login-shell environment
            // so commands behave like they do in a terminal.
            for (key, value) in self.tools.base_env() {
                command.env(key, value);
            }
            command
                .args(&shell_args)
                .arg(&app_cfg.command)
                .current_dir(&cwd)
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .env("FORCE_COLOR", "1")
                .env("CLICOLOR_FORCE", "1")
                .env("DOTNET_SYSTEM_CONSOLE_ALLOW_ANSI_COLOR_REDIRECTION", "1")
                .env_remove("NO_COLOR")
                .kill_on_drop(false);
            for (key, value) in &env {
                command.env(key, value);
            }
            platform::configure_command(&mut command);

            let mut child = match command.spawn() {
                Ok(child) => child,
                Err(error) => {
                    let message = format!("failed to spawn '{}': {error}", app_cfg.command);
                    self.set_status(&rt, failed_status(message.clone()));
                    return Err(message);
                }
            };

            let pid = child.id().unwrap_or(0);
            let handle = match ProcessHandle::from_child(&mut child) {
                Ok(handle) => handle,
                Err(error) => {
                    let _ = child.kill().await;
                    self.set_status(&rt, failed_status(error.clone()));
                    return Err(error);
                }
            };
            *rt.process.lock().unwrap() = Some(handle);
            self.set_status(
                &rt,
                Status {
                    state: State::Starting,
                    message: None,
                    exit_code: None,
                    pid: Some(pid),
                    started_at: Some(now_ms()),
                },
            );

            let stdout = child.stdout.take();
            let stderr = child.stderr.take();
            logs::start_pipeline(
                self.app.clone(),
                app_cfg.id.clone(),
                rt.clone(),
                stdout,
                stderr,
                self.persist.load(Ordering::SeqCst),
                self.capacity.load(Ordering::SeqCst) as usize,
            );

            let manager = self.clone();
            let waiter_rt = rt.clone();
            let app_id = app_cfg.id.clone();
            tokio::spawn(async move {
                let result = child.wait().await;
                if waiter_rt.generation.load(Ordering::SeqCst) != generation {
                    return;
                }

                let previous = waiter_rt.status_snapshot();
                *waiter_rt.process.lock().unwrap() = None;

                let (state, message, code) = match result {
                    Ok(exit) => {
                        let code = exit.code();
                        let suffix = match code {
                            Some(code) => format!(" (exit code {code})"),
                            None => " (signal)".to_string(),
                        };
                        match previous.state {
                            State::Stopping => (State::Stopped, None, code),
                            State::Starting => (
                                State::Failed,
                                Some(format!("process exited during startup{suffix}")),
                                code,
                            ),
                            _ => (
                                State::Crashed,
                                Some(format!("process exited unexpectedly{suffix}")),
                                code,
                            ),
                        }
                    }
                    Err(error) => (
                        State::Failed,
                        Some(format!("failed to wait for process: {error}")),
                        None,
                    ),
                };

                manager.set_status(
                    &waiter_rt,
                    Status {
                        state,
                        message: message.clone(),
                        exit_code: code,
                        pid: None,
                        started_at: None,
                    },
                );

                if state == State::Crashed {
                    let _ = manager.app.emit(
                        EVT_TOAST,
                        Toast {
                            level: "error",
                            title: format!("{app_id} crashed"),
                            message: message.unwrap_or_else(|| "process exited".into()),
                        },
                    );
                }
            });

            Ok((generation, true))
        }
        .await;

        let (generation, spawned) = match spawn_result {
            Ok(result) => result,
            Err(error) => return Err(error),
        };

        if !spawned {
            return Ok(());
        }

        let ready = health::wait_until_ready(
            app_cfg,
            || rt.generation.load(Ordering::SeqCst) == generation,
            || rt.status_snapshot().state,
        )
        .await;

        if !ready {
            let current = rt.status_snapshot();
            if rt.generation.load(Ordering::SeqCst) != generation {
                return Err("start was superseded".into());
            }
            if matches!(current.state, State::Starting) {
                self.terminate(&rt).await;
                let message = if app_cfg.health.kind == crate::config::HealthKind::None {
                    "process exited during startup".to_string()
                } else {
                    format!(
                        "health check timed out after {}s",
                        app_cfg.health.timeout_ms / 1000
                    )
                };
                self.set_status(&rt, failed_status(message.clone()));
                return Err(message);
            }
            if matches!(current.state, State::Stopping | State::Stopped) {
                return Ok(());
            }
            return Err(current
                .message
                .unwrap_or_else(|| "app exited during startup".into()));
        }

        if rt.generation.load(Ordering::SeqCst) == generation {
            let mut status = rt.status_snapshot();
            if status.state == State::Starting {
                status.state = State::Running;
                status.message = None;
                status.started_at = status.started_at.or_else(|| Some(now_ms()));
                self.set_status(&rt, status);
            }
        }

        Ok(())
    }

    pub async fn stop(&self, id: &str) -> Result<(), String> {
        let rt = self.runtime(id);
        {
            let _guard = rt.start_lock.lock().await;
            let state = rt.status_snapshot().state;
            if !matches!(
                state,
                State::Starting | State::Running | State::Stopping
            ) {
                *rt.process.lock().unwrap() = None;
                self.set_status(&rt, Status::stopped());
                return Ok(());
            }
            self.terminate(&rt).await;
        }
        Ok(())
    }

    async fn terminate(&self, rt: &Arc<AppRuntime>) {
        if rt.process.lock().unwrap().is_none() {
            self.set_status(rt, Status::stopped());
            return;
        }

        let mut status = rt.status_snapshot();
        status.state = State::Stopping;
        status.message = None;
        self.set_status(rt, status);

        let signal = *rt.stop_signal.lock().unwrap();
        if let Some(handle) = rt.process.lock().unwrap().as_ref() {
            handle.request_stop(signal);
        }

        let timeout = Duration::from_millis(rt.stop_timeout_ms.load(Ordering::SeqCst));
        if self.wait_for_exit(rt, timeout).await {
            return;
        }

        if let Some(handle) = rt.process.lock().unwrap().as_ref() {
            handle.request_stop(StopSignal::Sigterm);
        }
        if self.wait_for_exit(rt, Duration::from_secs(3)).await {
            return;
        }

        if let Some(handle) = rt.process.lock().unwrap().as_ref() {
            handle.force_kill();
        }
        let _ = self
            .wait_for_exit(rt, Duration::from_millis(1_500))
            .await;
        *rt.process.lock().unwrap() = None;
        self.set_status(
            rt,
            Status {
                state: State::Stopped,
                message: Some("force-killed after timeout".into()),
                exit_code: None,
                pid: None,
                started_at: None,
            },
        );
    }

    async fn wait_for_exit(&self, rt: &Arc<AppRuntime>, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        loop {
            let state = rt.status_snapshot().state;
            if !matches!(
                state,
                State::Starting | State::Running | State::Stopping
            ) {
                return true;
            }
            if Instant::now() >= deadline {
                return false;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }

    pub fn log_tail(&self, id: &str, lines: usize) -> Vec<String> {
        self.get_runtime(id)
            .map(|rt| rt.log.lock().unwrap().tail(lines))
            .unwrap_or_default()
    }

    pub fn clear_logs(&self, id: &str) {
        if let Some(rt) = self.get_runtime(id) {
            rt.log.lock().unwrap().clear();
        }
        logs::truncate_log(id);
    }

    fn set_status(&self, rt: &Arc<AppRuntime>, status: Status) {
        {
            let mut current = rt.status.lock().unwrap();
            *current = status;
        }
        let _ = self.app.emit(EVT_STATUS, rt.status_event());
        self.save_state();
    }

    fn save_state(&self) {
        #[derive(Serialize)]
        struct Saved {
            id: String,
            pid: u32,
            pgid: i32,
            command: String,
        }

        let entries: Vec<Saved> = {
            let runtimes = self.runtimes.lock().unwrap();
            runtimes
                .values()
                .filter_map(|rt| {
                    let status = rt.status_snapshot();
                    if !status.is_active() {
                        return None;
                    }
                    let process = rt.process.lock().unwrap();
                    let handle = process.as_ref()?;
                    Some(Saved {
                        id: rt.id.clone(),
                        pid: handle.pid(),
                        pgid: handle.group_id(),
                        command: rt.command.lock().unwrap().clone(),
                    })
                })
                .collect()
        };

        let path = crate::config::state_file();
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if entries.is_empty() {
            let _ = std::fs::remove_file(&path);
            return;
        }
        if let Ok(text) = serde_json::to_string_pretty(&entries) {
            let tmp = path.with_extension("json.tmp");
            if std::fs::write(&tmp, text).is_ok() {
                let _ = std::fs::rename(tmp, path);
            }
        }
    }

    /// Synchronous last-resort cleanup used when the UI is exiting.
    pub fn shutdown_blocking(&self) {
        let runtimes: Vec<Arc<AppRuntime>> =
            self.runtimes.lock().unwrap().values().cloned().collect();

        for rt in &runtimes {
            if let Some(handle) = rt.process.lock().unwrap().as_ref() {
                handle.request_stop(*rt.stop_signal.lock().unwrap());
            }
        }

        std::thread::sleep(Duration::from_millis(1500));

        for rt in &runtimes {
            if let Some(handle) = rt.process.lock().unwrap().as_ref() {
                handle.force_kill();
            }
            *rt.process.lock().unwrap() = None;
        }

        let _ = std::fs::remove_file(crate::config::state_file());
    }
}

fn failed_status(message: String) -> Status {
    Status {
        state: State::Failed,
        message: Some(message),
        exit_code: None,
        pid: None,
        started_at: None,
    }
}

fn read_env_file(cwd: &Path, file: &str, env: &mut std::collections::HashMap<String, String>) {
    let path = PathBuf::from(file);
    let path = if path.is_absolute() { path } else { cwd.join(path) };
    env.extend(crate::envfile::read(&path));
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RecoveredProc {
    id: String,
    #[serde(default)]
    pid: u32,
    #[serde(default)]
    pgid: i32,
    #[serde(default)]
    command: String,
}

/// Kill process groups left behind by a previous NodusForge crash. Only groups whose
/// command line still matches the recorded command are touched.
pub fn reconcile_orphans() {
    let path = crate::config::state_file();
    let Ok(text) = std::fs::read_to_string(&path) else {
        return;
    };
    let Ok(entries) = serde_json::from_str::<Vec<RecoveredProc>>(&text) else {
        let _ = std::fs::remove_file(&path);
        return;
    };

    for entry in entries {
        let pgid = if entry.pgid != 0 { entry.pgid } else { entry.pid as i32 };
        if pgid <= 0 {
            continue;
        }
        platform::terminate_orphan(pgid, &entry.command);
    }

    let _ = std::fs::remove_file(&path);
}
