use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub const SAMPLE_CONFIG: &str = r#"# NodusForge configuration
# See README.md and nodusforge.example.yaml for the full field reference.
#
# Each app is a shell command run inside `cwd`. Start/stop, ports, health checks
# and logs are handled by NodusForge.
#
# Example:
#
# groups:
#   - { id: backend, name: Backend }
#
# apps:
#   - id: api
#     name: API
#     group: backend
#     cwd: ~/Projects/example-api
#     command: dotnet run --project src/Api
#     envFile: .env
#     url: http://localhost:5080
#     health: { type: tcp, port: 5080, timeoutMs: 180000 }
#     stopSignal: SIGINT
#     stopTimeoutMs: 15000
#
#   - id: web
#     name: Web
#     cwd: ~/Projects/example-web
#     command: yarn dev
#     url: http://localhost:5173
#     health: { type: tcp, port: 5173, timeoutMs: 120000 }
#     dependsOn: [api]

version: 1

settings:
  closeToTray: true
  autostart: false
  logBufferLines: 5000
  persistLogs: true
  autoCheckUpdates: true
  theme: dark

groups: []
apps: []
"#;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub close_to_tray: bool,
    pub autostart: bool,
    pub log_buffer_lines: usize,
    pub persist_logs: bool,
    pub auto_check_updates: bool,
    pub theme: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            close_to_tray: true,
            autostart: false,
            log_buffer_lines: 5000,
            persist_logs: true,
            auto_check_updates: true,
            theme: "dark".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Config {
    pub version: u32,
    pub settings: Settings,
    pub groups: Vec<Group>,
    pub include: Vec<String>,
    pub apps: Vec<AppConfig>,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            version: 1,
            settings: Settings::default(),
            groups: Vec::new(),
            include: Vec::new(),
            apps: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Group {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum HealthKind {
    None,
    Tcp,
    Http,
}

impl Default for HealthKind {
    fn default() -> Self {
        Self::None
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Health {
    #[serde(rename = "type")]
    pub kind: HealthKind,
    pub url: Option<String>,
    pub port: Option<u16>,
    pub path: Option<String>,
    pub timeout_ms: u64,
}

impl Default for Health {
    fn default() -> Self {
        Self {
            kind: HealthKind::None,
            url: None,
            port: None,
            path: None,
            timeout_ms: 60_000,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "UPPERCASE")]
pub enum StopSignal {
    Sigint,
    Sigterm,
}

impl Default for StopSignal {
    fn default() -> Self {
        Self::Sigterm
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppConfig {
    pub id: String,
    pub name: String,
    pub group: Option<String>,
    pub cwd: String,
    pub command: String,
    pub env: HashMap<String, String>,
    pub env_file: Option<String>,
    pub url: Option<String>,
    pub health: Health,
    pub depends_on: Vec<String>,
    pub auto_start: bool,
    pub stop_signal: StopSignal,
    pub stop_timeout_ms: u64,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            group: None,
            cwd: String::new(),
            command: String::new(),
            env: HashMap::new(),
            env_file: None,
            url: None,
            health: Health::default(),
            depends_on: Vec::new(),
            auto_start: false,
            stop_signal: StopSignal::default(),
            stop_timeout_ms: 10_000,
        }
    }
}

#[derive(Debug, Clone)]
pub struct Loaded {
    pub config: Config,
    pub warnings: Vec<String>,
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub fn resolve_config_path() -> PathBuf {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut i = 0;
    while i < args.len() {
        if args[i] == "--config" && i + 1 < args.len() {
            return PathBuf::from(&args[i + 1]);
        }
        if let Some(value) = args[i].strip_prefix("--config=") {
            return PathBuf::from(value);
        }
        i += 1;
    }

    if let Ok(value) = std::env::var("NODUSFORGE_CONFIG") {
        if !value.trim().is_empty() {
            return PathBuf::from(value);
        }
    }

    let local = PathBuf::from("nodusforge.yaml");
    if local.exists() {
        return local;
    }

    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("nodusforge")
        .join("config.yaml")
}

pub fn wants_minimized() -> bool {
    std::env::args().any(|a| a == "--minimized")
}

pub fn ensure_config(path: &Path) -> Result<(), String> {
    if path.exists() {
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("cannot create {}: {e}", parent.display()))?;
    }
    std::fs::write(path, SAMPLE_CONFIG)
        .map_err(|e| format!("cannot write {}: {e}", path.display()))
}

pub fn state_dir() -> PathBuf {
    dirs::state_dir()
        .or_else(|| dirs::home_dir().map(|h| h.join(".local/state")))
        .unwrap_or_else(|| PathBuf::from("."))
        .join("nodusforge")
}

pub fn log_dir() -> PathBuf {
    state_dir().join("logs")
}

pub fn state_file() -> PathBuf {
    state_dir().join("state.json")
}

pub fn expand_path(raw: &str) -> Result<PathBuf, String> {
    let expanded = shellexpand::full(raw)
        .map_err(|e| format!("cannot expand path '{raw}': {e}"))?;
    Ok(PathBuf::from(expanded.to_string()))
}

fn resolve_relative(base: &Path, raw: &str) -> Result<PathBuf, String> {
    let expanded = expand_path(raw)?;
    if expanded.is_absolute() {
        Ok(expanded)
    } else {
        Ok(base.join(expanded))
    }
}

pub fn load_file(path: &Path) -> Result<Config, String> {
    let text = std::fs::read_to_string(path)
        .map_err(|e| format!("cannot read {}: {e}", path.display()))?;
    serde_yaml_ng::from_str::<Config>(&text)
        .map_err(|e| format!("invalid YAML in {}: {e}", path.display()))
}

pub fn save_file(path: &Path, config: &Config) -> Result<(), String> {
    let text = serde_yaml_ng::to_string(config)
        .map_err(|e| format!("cannot serialize config: {e}"))?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("cannot create {}: {e}", parent.display()))?;
    }
    let tmp = path.with_extension("yaml.tmp");
    std::fs::write(&tmp, text)
        .map_err(|e| format!("cannot write {}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, path)
        .map_err(|e| format!("cannot replace {}: {e}", path.display()))?;
    Ok(())
}

pub fn load(path: &Path) -> Result<Loaded, String> {
    let root = load_file(path)?;
    let mut merged = Config {
        version: root.version,
        settings: root.settings.clone(),
        groups: Vec::new(),
        include: Vec::new(),
        apps: Vec::new(),
    };

    let mut stack = HashSet::new();
    merge_file(path, 0, &mut stack, &mut merged)?;

    let mut warnings = Vec::new();
    validate(&mut merged, &mut warnings)?;

    Ok(Loaded {
        config: merged,
        warnings,
    })
}

fn merge_file(
    path: &Path,
    depth: usize,
    stack: &mut HashSet<PathBuf>,
    merged: &mut Config,
) -> Result<(), String> {
    if depth > 4 {
        return Err(format!(
            "include depth exceeded while loading {}",
            path.display()
        ));
    }

    let key = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    if !stack.insert(key.clone()) {
        return Err(format!("include cycle detected at {}", path.display()));
    }

    let raw = load_file(path)?;
    merged.groups.extend(raw.groups);
    merged.apps.extend(raw.apps);

    let base = path.parent().unwrap_or_else(|| Path::new("."));
    for include in &raw.include {
        let included = resolve_relative(base, include)?;
        merge_file(&included, depth + 1, stack, merged)?;
    }

    stack.remove(&key);
    Ok(())
}

fn validate(config: &mut Config, warnings: &mut Vec<String>) -> Result<(), String> {
    config.settings.log_buffer_lines = config.settings.log_buffer_lines.clamp(200, 200_000);

    let group_ids: HashSet<String> = config.groups.iter().map(|g| g.id.clone()).collect();
    let mut seen_ids = HashSet::new();

    for app in &mut config.apps {
        if app.id.trim().is_empty() {
            return Err("an app is missing its `id`".into());
        }
        if !app
            .id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        {
            return Err(format!(
                "app id '{}' may only contain letters, digits, '-' and '_'",
                app.id
            ));
        }
        if !seen_ids.insert(app.id.clone()) {
            return Err(format!("duplicate app id '{}'", app.id));
        }
        if app.name.trim().is_empty() {
            app.name = app.id.clone();
        }
        if app.command.trim().is_empty() {
            return Err(format!("app '{}' has an empty `command`", app.id));
        }
        if app.cwd.trim().is_empty() {
            return Err(format!("app '{}' has an empty `cwd`", app.id));
        }

        match expand_path(&app.cwd) {
            Ok(cwd) if !cwd.is_dir() => warnings.push(format!(
                "app '{}': cwd does not exist or is not a directory: {}",
                app.id,
                cwd.display()
            )),
            Ok(_) => {}
            Err(error) => warnings.push(format!("app '{}': {error}", app.id)),
        }

        if let Some(group) = &app.group {
            if !group_ids.contains(group) {
                warnings.push(format!(
                    "app '{}' references unknown group '{}'",
                    app.id, group
                ));
            }
        }

        if app.stop_timeout_ms < 500 {
            app.stop_timeout_ms = 500;
        }

        match app.health.kind {
            HealthKind::Tcp => {
                if app.health.port.is_none() {
                    return Err(format!(
                        "app '{}': health type tcp requires `health.port`",
                        app.id
                    ));
                }
            }
            HealthKind::Http => {
                if app.health.url.is_none() && app.url.is_none() {
                    return Err(format!(
                        "app '{}': health type http requires `health.url` or `url`",
                        app.id
                    ));
                }
            }
            HealthKind::None => {}
        }
    }

    for app in &config.apps {
        for dep in &app.depends_on {
            if dep == &app.id {
                return Err(format!("app '{}' depends on itself", app.id));
            }
            if !seen_ids.contains(dep) {
                return Err(format!(
                    "app '{}' depends on unknown app '{}'",
                    app.id, dep
                ));
            }
        }
    }

    topo_order(&config.apps)?;

    Ok(())
}

/// Stable topological order: dependencies come before dependents, otherwise
/// config order is preserved.
pub fn topo_order(apps: &[AppConfig]) -> Result<Vec<String>, String> {
    let mut indegree: HashMap<String, usize> = HashMap::new();
    let mut dependents: HashMap<String, Vec<String>> = HashMap::new();

    for app in apps {
        indegree.insert(app.id.clone(), app.depends_on.len());
    }
    for app in apps {
        for dep in &app.depends_on {
            dependents
                .entry(dep.clone())
                .or_default()
                .push(app.id.clone());
        }
    }

    let mut queue: Vec<String> = apps
        .iter()
        .filter(|a| a.depends_on.is_empty())
        .map(|a| a.id.clone())
        .collect();

    let mut order = Vec::with_capacity(apps.len());
    let mut index = 0;
    while index < queue.len() {
        let id = queue[index].clone();
        index += 1;
        order.push(id.clone());
        if let Some(children) = dependents.get(&id) {
            for child in children {
                if let Some(degree) = indegree.get_mut(child) {
                    *degree = degree.saturating_sub(1);
                    if *degree == 0 {
                        queue.push(child.clone());
                    }
                }
            }
        }
    }

    if order.len() != apps.len() {
        return Err("dependency cycle detected between apps".into());
    }

    Ok(order)
}

pub fn ancestors(config: &Config, id: &str) -> HashSet<String> {
    let by_id: HashMap<&str, &AppConfig> =
        config.apps.iter().map(|a| (a.id.as_str(), a)).collect();
    let mut result = HashSet::new();
    let mut stack = vec![id.to_string()];
    while let Some(current) = stack.pop() {
        if let Some(app) = by_id.get(current.as_str()) {
            for dep in &app.depends_on {
                if result.insert(dep.clone()) {
                    stack.push(dep.clone());
                }
            }
        }
    }
    result
}

pub fn find_app<'a>(config: &'a Config, id: &str) -> Option<&'a AppConfig> {
    config.apps.iter().find(|a| a.id == id)
}

pub fn validate_config(config: &mut Config) -> Result<Vec<String>, String> {
    let mut warnings = Vec::new();
    validate(config, &mut warnings)?;
    Ok(warnings)
}

/// Watch the config directory and let the UI decide whether to reload.
pub fn watch(app: &tauri::AppHandle, path: PathBuf) {
    use notify::{RecursiveMode, Watcher};
    use tauri::Emitter;

    let app = app.clone();
    std::thread::spawn(move || {
        let parent = match path.parent() {
            Some(parent) if !parent.as_os_str().is_empty() => parent.to_path_buf(),
            _ => PathBuf::from("."),
        };

        let target = std::fs::canonicalize(&path).unwrap_or_else(|_| path.clone());
        let target_name = target.file_name().map(|name| name.to_os_string());

        let (tx, rx) = std::sync::mpsc::channel();
        let mut watcher = match notify::recommended_watcher(
            move |result: notify::Result<notify::Event>| {
                let Ok(event) = result else {
                    return;
                };
                let relevant = event.paths.iter().any(|changed| {
                    let canonical =
                        std::fs::canonicalize(changed).unwrap_or_else(|_| changed.clone());
                    canonical == target
                        || (target_name.is_some()
                            && changed.file_name() == target_name.as_deref())
                });
                if relevant {
                    let _ = tx.send(());
                }
            },
        ) {
            Ok(watcher) => watcher,
            Err(_) => return,
        };

        if watcher.watch(&parent, RecursiveMode::NonRecursive).is_err() {
            return;
        }

        loop {
            match rx.recv() {
                Ok(_) => {
                    std::thread::sleep(Duration::from_millis(400));
                    while rx.try_recv().is_ok() {}
                    let _ = app.emit(crate::events::EVT_CONFIG_CHANGED, ());
                }
                Err(_) => break,
            }
        }

        drop(watcher);
    });
}
