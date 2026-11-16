mod actions;
mod commands;
mod config;
mod detect;
mod events;
mod process;
mod state;
mod tray;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;

use tauri::{Manager, WindowEvent};

use crate::config::Config;
use crate::process::manager::{reconcile_orphans, ProcessManager};
use crate::state::AppState;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            tray::show_window(app);
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized".into()]),
        ))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let handle = app.handle().clone();
            let path = config::resolve_config_path();
            let _ = config::ensure_config(&path);

            let (config, warnings, error) = match config::load(&path) {
                Ok(loaded) => (loaded.config, loaded.warnings, None),
                Err(error) => {
                    eprintln!("NodusForge: {error}");
                    (Config::default(), Vec::new(), Some(error))
                }
            };
            let config_ok = error.is_none();

            let manager = Arc::new(ProcessManager::new(
                handle.clone(),
                config.settings.log_buffer_lines,
                config.settings.persist_logs,
            ));

            let state = AppState {
                config_path: Arc::new(Mutex::new(path.clone())),
                config: Arc::new(RwLock::new(config.clone())),
                config_error: Arc::new(RwLock::new(error)),
                warnings: Arc::new(RwLock::new(warnings)),
                manager: manager.clone(),
                quitting: Arc::new(AtomicBool::new(false)),
            };

            app.manage(state.clone());
            manager.sync_config(&config);
            reconcile_orphans();

            tray::setup(&handle)?;

            if config_ok {
                actions::apply_autostart(&handle, config.settings.autostart);
            }

            if let Some(window) = app.get_webview_window("main") {
                if config::wants_minimized() {
                    let _ = window.hide();
                }

                let window_for_event = window.clone();
                let handle_for_event = handle.clone();
                window.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        let state = handle_for_event.state::<AppState>();
                        let close_to_tray =
                            state.config.read().unwrap().settings.close_to_tray;
                        if !state.quitting.load(Ordering::SeqCst) && close_to_tray {
                            api.prevent_close();
                            let _ = window_for_event.hide();
                        }
                    }
                });
            }

            config::watch(&handle, path);

            if config.apps.iter().any(|app| app.auto_start) {
                let auto_state = state.clone();
                let auto_handle = handle.clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(Duration::from_millis(800)).await;
                    let config = auto_state.config();
                    let ids: Vec<String> = config
                        .apps
                        .iter()
                        .filter(|app| app.auto_start)
                        .map(|app| app.id.clone())
                        .collect();

                    for id in ids {
                        if let Err(error) = actions::start_ids(&auto_state, &[id]).await {
                            events::toast(
                                &auto_handle,
                                "error",
                                "Autostart app",
                                error,
                            );
                        }
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_snapshot,
            commands::reload_config,
            commands::start_app,
            commands::stop_app,
            commands::restart_app,
            commands::start_group,
            commands::start_all,
            commands::stop_all,
            commands::get_logs,
            commands::clear_logs,
            commands::get_app_config,
            commands::open_url,
            commands::open_external,
            commands::relaunch_app,
            commands::open_folder,
            commands::open_config_file,
            commands::detect_app_folder,
            commands::save_app,
            commands::update_settings,
        ])
        .build(tauri::generate_context!())
        .expect("error while building NodusForge")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                let state = app.state::<AppState>();
                state.quitting.store(true, Ordering::SeqCst);
                state.manager.shutdown_blocking();
            }
        });
}
