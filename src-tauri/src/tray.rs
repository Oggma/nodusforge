use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Wry};

use crate::state::AppState;

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let menu = build_menu(app)?;

    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("NodusForge — local dev control panel")
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

pub fn show_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn build_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let show = MenuItemBuilder::with_id("show", "Show NodusForge").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
    let separator = PredefinedMenuItem::separator(app)?;

    MenuBuilder::new(app)
        .item(&show)
        .item(&separator)
        .item(&quit)
        .build()
}

fn handle_menu(app: &AppHandle, id: &str) {
    match id {
        "show" => show_window(app),
        "quit" => {
            let state = app.state::<AppState>();
            state
                .quitting
                .store(true, std::sync::atomic::Ordering::SeqCst);
            app.exit(0);
        }
        _ => {}
    }
}
