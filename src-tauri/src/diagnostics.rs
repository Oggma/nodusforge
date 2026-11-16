use std::sync::OnceLock;
use std::time::{Duration, Instant};

use tauri::AppHandle;

static ENABLED: OnceLock<bool> = OnceLock::new();

pub fn enabled() -> bool {
    *ENABLED.get_or_init(|| std::env::var_os("NODUSFORGE_DEBUG").is_some())
}

pub fn log(message: impl AsRef<str>) {
    if enabled() {
        eprintln!("NodusForge debug: {}", message.as_ref());
    }
}

pub fn start_main_thread_watchdog(app: AppHandle) {
    if !enabled() {
        return;
    }

    std::thread::spawn(move || loop {
        let started = Instant::now();
        let (tx, rx) = std::sync::mpsc::channel();

        if let Err(error) = app.run_on_main_thread(move || {
            let _ = tx.send(());
        }) {
            log(format!("main-thread watchdog stopped: {error}"));
            return;
        }

        match rx.recv_timeout(Duration::from_secs(5)) {
            Ok(()) => {
                let elapsed = started.elapsed();
                if elapsed >= Duration::from_millis(500) {
                    log(format!(
                        "main thread responded after {} ms",
                        elapsed.as_millis()
                    ));
                }
            }
            Err(_) => log("main thread did not respond within 5s"),
        }

        std::thread::sleep(Duration::from_secs(5));
    });
}
