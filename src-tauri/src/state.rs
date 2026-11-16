use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex, RwLock};

use crate::config::{self, AppConfig, Config};
use crate::events::{AppView, Snapshot};
use crate::process::manager::ProcessManager;
use crate::tools::ToolRuntime;

#[derive(Clone)]
pub struct AppState {
    pub config_path: Arc<Mutex<PathBuf>>,
    pub config: Arc<RwLock<Config>>,
    pub config_error: Arc<RwLock<Option<String>>>,
    pub warnings: Arc<RwLock<Vec<String>>>,
    pub manager: Arc<ProcessManager>,
    pub tools: ToolRuntime,
    pub quitting: Arc<AtomicBool>,
}

impl AppState {
    pub fn config(&self) -> Config {
        self.config.read().unwrap().clone()
    }

    pub fn app(&self, id: &str) -> Option<AppConfig> {
        self.config
            .read()
            .unwrap()
            .apps
            .iter()
            .find(|app| app.id == id)
            .cloned()
    }

    pub fn snapshot(&self) -> Snapshot {
        let config = self.config.read().unwrap().clone();
        let config_path = self.config_path.lock().unwrap().clone();
        let config_error = self.config_error.read().unwrap().clone();
        let warnings = self.warnings.read().unwrap().clone();

        let apps = config
            .apps
            .iter()
            .map(|app| AppView::new(app, &self.manager.status(&app.id)))
            .collect();

        Snapshot {
            version: env!("CARGO_PKG_VERSION").to_string(),
            config_path: config_path.to_string_lossy().to_string(),
            config_error,
            warnings,
            settings: config.settings,
            groups: config.groups,
            apps,
        }
    }

    pub fn apply_loaded(&self, loaded: &config::Loaded) {
        self.manager.sync_config(&loaded.config);
        self.manager.update_log_options(
            loaded.config.settings.log_buffer_lines,
            loaded.config.settings.persist_logs,
        );
        *self.config.write().unwrap() = loaded.config.clone();
        *self.config_error.write().unwrap() = None;
        *self.warnings.write().unwrap() = loaded.warnings.clone();
    }
}
