use std::future::Future;

use tauri::menu::{Menu, MenuBuilder, MenuItem, MenuItemBuilder, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Wry};

use crate::actions;
use crate::config::Config;
use crate::events::toast;
use crate::state::AppState;

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let config = app.state::<AppState>().config();
    let menu = build_menu(app, &config)?;

    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip(tooltip(&config))
        .menu(&menu)
        .on_menu_event(|app, event| handle_menu(app, event.id.as_ref()))
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    if window.is_visible().unwrap_or(false) {
                        let _ = window.hide();
                    } else {
                        show_window(app);
                    }
                }
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    builder.build(app)?;
    Ok(())
}

pub fn rebuild(app: &AppHandle) -> tauri::Result<()> {
    let state = app.state::<AppState>();
    let config = state.config();
    let menu = build_menu(app, &config)?;
    if let Some(tray) = app.tray_by_id("main") {
        tray.set_menu(Some(menu))?;
        tray.set_tooltip(Some(tooltip(&config)))?;
    }
    Ok(())
}

pub fn show_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn tooltip(config: &Config) -> String {
    format!("NodusForge — {} app(s) configured", config.apps.len())
}

fn build_menu(app: &AppHandle, config: &Config) -> tauri::Result<Menu<Wry>> {
    let show = MenuItemBuilder::with_id("show", "Show NodusForge").build(app)?;
    let start_all = MenuItemBuilder::with_id("start-all", "▶  Start all").build(app)?;
    let stop_all = MenuItemBuilder::with_id("stop-all", "■  Stop all").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
    let separator_one = PredefinedMenuItem::separator(app)?;
    let separator_two = PredefinedMenuItem::separator(app)?;

    let mut builder = MenuBuilder::new(app)
        .item(&show)
        .item(&separator_one)
        .item(&start_all)
        .item(&stop_all)
        .item(&separator_two);

    let tray_apps: Vec<MenuItem<Wry>> = config
        .apps
        .iter()
        .filter(|app_cfg| app_cfg.show_in_tray)
        .flat_map(|app_cfg| {
            let start = MenuItemBuilder::with_id(
                format!("start:{}", app_cfg.id),
                format!("Start {}", app_cfg.name),
            )
            .build(app);
            let stop = MenuItemBuilder::with_id(
                format!("stop:{}", app_cfg.id),
                format!("Stop {}", app_cfg.name),
            )
            .build(app);
            [start, stop]
        })
        .collect::<tauri::Result<Vec<_>>>()?;

    for item in &tray_apps {
        builder = builder.item(item);
    }

    builder.item(&quit).build()
}

fn handle_menu(app: &AppHandle, id: &str) {
    let state = app.state::<AppState>().inner().clone();

    match id {
        "show" => show_window(app),
        "quit" => {
            state
                .quitting
                .store(true, std::sync::atomic::Ordering::SeqCst);
            app.exit(0);
        }
        "start-all" => {
            let state = state.clone();
            run(app, async move { actions::start_all(&state).await });
        }
        "stop-all" => {
            let state = state.clone();
            run(app, async move { actions::stop_all(&state).await });
        }
        _ => {
            if let Some(app_id) = id.strip_prefix("start:") {
                let app_id = app_id.to_string();
                let state = state.clone();
                run(app, async move {
                    actions::start_ids(&state, &[app_id]).await
                });
            } else if let Some(app_id) = id.strip_prefix("stop:") {
                let id = app_id.to_string();
                let manager = state.manager.clone();
                run(app, async move { manager.stop(&id).await });
            }
        }
    }
}

fn run<F>(app: &AppHandle, future: F)
where
    F: Future<Output = Result<(), String>> + Send + 'static,
{
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = future.await {
            toast(&app, "error", "NodusForge", error);
        }
    });
}
