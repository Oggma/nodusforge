use std::collections::HashSet;

use tauri::{AppHandle, Emitter};

use crate::config;
use crate::events::{toast, Snapshot, State, EVT_SNAPSHOT};
use crate::state::AppState;

pub fn reload(app: &AppHandle, state: &AppState) -> Result<Snapshot, String> {
    let path = state.config_path.lock().unwrap().clone();

    match config::load(&path) {
        Ok(loaded) => {
            state.apply_loaded(&loaded);
            let snapshot = state.snapshot();
            let _ = app.emit(EVT_SNAPSHOT, snapshot.clone());
            if let Err(error) = crate::tray::rebuild(app) {
                toast(
                    app,
                    "warning",
                    "Tray menu",
                    format!("Could not rebuild tray menu: {error}"),
                );
            }
            Ok(snapshot)
        }
        Err(error) => {
            *state.config_error.write().unwrap() = Some(error.clone());
            toast(app, "error", "Invalid config", error.clone());
            Err(error)
        }
    }
}

pub async fn start_ids(state: &AppState, ids: &[String]) -> Result<(), String> {
    let config = state.config();
    let order = config::topo_order(&config.apps)?;

    let mut targets: HashSet<String> = HashSet::new();
    for id in ids {
        if config::find_app(&config, id).is_none() {
            return Err(format!("unknown app '{id}'"));
        }
        targets.insert(id.clone());
        targets.extend(config::ancestors(&config, id));
    }

    for id in order {
        if !targets.contains(&id) {
            continue;
        }
        let Some(app_cfg) = config::find_app(&config, &id) else {
            continue;
        };
        if state.manager.status(&id).state == State::Running {
            continue;
        }
        state.manager.start(app_cfg).await?;
    }

    Ok(())
}

pub async fn start_group(state: &AppState, group_id: &str) -> Result<(), String> {
    let config = state.config();
    let ids: Vec<String> = config
        .apps
        .iter()
        .filter(|app| app.group.as_deref() == Some(group_id))
        .map(|app| app.id.clone())
        .collect();

    if ids.is_empty() {
        return Err(format!("group '{group_id}' has no apps"));
    }

    start_ids(state, &ids).await
}

pub async fn start_all(state: &AppState) -> Result<(), String> {
    let config = state.config();
    let ids: Vec<String> = config.apps.iter().map(|app| app.id.clone()).collect();
    start_ids(state, &ids).await
}

pub async fn stop_all(state: &AppState) -> Result<(), String> {
    let config = state.config();
    let mut order = config::topo_order(&config.apps)?;
    order.reverse();

    let mut first_error = None;
    for id in order {
        if !state.manager.status(&id).is_active() {
            continue;
        }
        if let Err(error) = state.manager.stop(&id).await {
            first_error.get_or_insert(error);
        }
    }

    match first_error {
        Some(error) => Err(error),
        None => Ok(()),
    }
}

pub async fn restart(state: &AppState, id: &str) -> Result<(), String> {
    if config::find_app(&state.config(), id).is_none() {
        return Err(format!("unknown app '{id}'"));
    }
    state.manager.stop(id).await?;
    start_ids(state, &[id.to_string()]).await
}

pub fn apply_autostart(app: &AppHandle, enabled: bool) {
    use tauri_plugin_autostart::ManagerExt;

    let manager = app.autolaunch();
    let result = if enabled {
        manager.enable()
    } else {
        manager.disable()
    };

    if let Err(error) = result {
        toast(
            app,
            "warning",
            "Autostart",
            format!("Could not update login autostart: {error}"),
        );
    }
}
