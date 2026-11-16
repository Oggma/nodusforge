use tauri::{AppHandle, State};

use crate::actions;
use crate::config::{self, AppConfig, Settings};
use crate::detect::{self, DetectResult};
use crate::events::Snapshot;
use crate::state::AppState;

#[tauri::command]
pub fn get_snapshot(state: State<'_, AppState>) -> Snapshot {
    state.snapshot()
}

#[tauri::command(async)]
pub fn reload_config(app: AppHandle, state: State<'_, AppState>) -> Result<Snapshot, String> {
    actions::reload(&app, state.inner())
}

#[tauri::command]
pub async fn start_app(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let state = state.inner().clone();
    actions::start_ids(&state, std::slice::from_ref(&id)).await
}

#[tauri::command]
pub async fn stop_app(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let state = state.inner().clone();
    state.manager.stop(&id).await
}

#[tauri::command]
pub async fn restart_app(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let state = state.inner().clone();
    actions::restart(&state, &id).await
}

#[tauri::command]
pub async fn start_group(state: State<'_, AppState>, group_id: String) -> Result<(), String> {
    let state = state.inner().clone();
    actions::start_group(&state, &group_id).await
}

#[tauri::command]
pub async fn start_all(state: State<'_, AppState>) -> Result<(), String> {
    let state = state.inner().clone();
    actions::start_all(&state).await
}

#[tauri::command]
pub async fn stop_all(state: State<'_, AppState>) -> Result<(), String> {
    let state = state.inner().clone();
    actions::stop_all(&state).await
}

#[tauri::command(async)]
pub fn get_logs(state: State<'_, AppState>, id: String, tail_lines: Option<usize>) -> Vec<String> {
    let lines = tail_lines.unwrap_or(5000).clamp(1, 20_000);
    state.manager.log_tail(&id, lines)
}

#[tauri::command]
pub fn clear_logs(state: State<'_, AppState>, id: String) {
    state.manager.clear_logs(&id);
}

#[tauri::command]
pub fn get_app_config(state: State<'_, AppState>, id: String) -> Result<String, String> {
    let app = state
        .app(&id)
        .ok_or_else(|| format!("unknown app '{id}'"))?;
    serde_yaml_ng::to_string(&app).map_err(|error| format!("cannot serialize config: {error}"))
}

#[tauri::command]
pub async fn open_external(url: String) -> Result<(), String> {
    let url = url.trim().to_string();
    let lower = url.to_ascii_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://")) {
        return Err("only http:// and https:// URLs are supported".into());
    }
    spawn_blocking("open link", move || open_target(&url)).await
}

#[tauri::command]
pub fn relaunch_app(app: AppHandle, state: State<'_, AppState>) {
    let state = state.inner().clone();
    state
        .quitting
        .store(true, std::sync::atomic::Ordering::SeqCst);
    state.manager.shutdown_blocking();
    app.restart();
}

#[tauri::command]
pub async fn open_folder(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let target = {
        let app = state
            .app(&id)
            .ok_or_else(|| format!("unknown app '{id}'"))?;
        let cwd = config::expand_path(&app.cwd)?;
        if !cwd.exists() {
            return Err(format!("folder does not exist: {}", cwd.display()));
        }
        cwd.to_string_lossy().to_string()
    };
    spawn_blocking("open folder", move || open_target(&target)).await
}

#[tauri::command]
pub async fn open_config_file(state: State<'_, AppState>) -> Result<(), String> {
    let path = state.config_path.lock().unwrap().clone();
    let target = path.to_string_lossy().to_string();
    spawn_blocking("open config", move || open_target(&target)).await
}

#[tauri::command]
pub async fn get_tools_status(
    state: State<'_, AppState>,
) -> Result<crate::tools::ToolsStatus, String> {
    let tools = state.tools.clone();
    Ok(crate::tools::status(&tools).await)
}

#[tauri::command]
pub async fn get_git_status(
    state: State<'_, AppState>,
    id: String,
) -> Result<crate::git::GitRepoStatus, String> {
    let app = state
        .app(&id)
        .ok_or_else(|| format!("unknown app '{id}'"))?;
    let cwd = config::expand_path(&app.cwd)?;
    let tools = state.tools.clone();
    Ok(crate::git::status(&tools, &cwd).await)
}

#[tauri::command]
pub async fn switch_git_branch(
    state: State<'_, AppState>,
    id: String,
    branch: String,
) -> Result<crate::git::GitRepoStatus, String> {
    let app = state
        .app(&id)
        .ok_or_else(|| format!("unknown app '{id}'"))?;
    let cwd = config::expand_path(&app.cwd)?;
    let tools = state.tools.clone();
    crate::git::switch(&tools, &cwd, &branch).await
}

#[tauri::command]
pub async fn list_containers(
    state: State<'_, AppState>,
) -> Result<crate::docker::ContainersResult, String> {
    let tools = state.tools.clone();
    Ok(crate::docker::list(&tools).await)
}

#[tauri::command]
pub async fn start_container(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    let tools = state.tools.clone();
    crate::docker::start(&tools, &id).await
}

#[tauri::command]
pub async fn stop_container(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    let tools = state.tools.clone();
    crate::docker::stop(&tools, &id).await
}

#[tauri::command]
pub async fn detect_app_folder(path: String) -> Result<DetectResult, String> {
    spawn_blocking("detect app folder", move || detect::detect(&path)).await
}

#[tauri::command(async)]
pub fn save_app(
    app: AppHandle,
    state: State<'_, AppState>,
    draft: AppConfig,
) -> Result<Snapshot, String> {
    let path = state.config_path.lock().unwrap().clone();
    let mut merged = state.config();

    if merged.apps.iter().any(|current| current.id == draft.id) {
        return Err(format!("app id '{}' already exists", draft.id));
    }

    let mut draft = draft;
    if draft.name.trim().is_empty() {
        draft.name = draft.id.clone();
    }

    merged.apps.push(draft.clone());
    config::validate_config(&mut merged)?;

    let mut raw = config::load_file(&path)?;
    raw.apps.push(draft);
    config::save_file(&path, &raw)?;

    actions::reload(&app, state.inner())
}

#[tauri::command(async)]
pub fn update_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    settings: Settings,
) -> Result<Snapshot, String> {
    let path = state.config_path.lock().unwrap().clone();
    let mut raw = config::load_file(&path)?;
    raw.settings = settings.clone();
    config::save_file(&path, &raw)?;

    actions::apply_autostart(&app, settings.autostart);
    actions::reload(&app, state.inner())
}

fn open_target(target: &str) -> Result<(), String> {
    open::that_detached(target).map_err(|error| format!("cannot open '{target}': {error}"))
}

async fn spawn_blocking<T, F>(label: &'static str, task: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    let started = std::time::Instant::now();
    let result = tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| format!("{label} task failed: {error}"))?;
    crate::diagnostics::log(format!(
        "{label} completed in {} ms",
        started.elapsed().as_millis()
    ));
    result
}
