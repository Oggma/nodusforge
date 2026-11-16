use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;

use crate::config::{expand_path, Health, HealthKind};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedApp {
    pub kind: String,
    pub name: String,
    pub cwd: String,
    pub command: String,
    pub url: Option<String>,
    pub health: Health,
    pub notes: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectResult {
    pub root: String,
    pub existing_config: bool,
    pub candidates: Vec<DetectedApp>,
}

struct Files {
    csproj: Vec<PathBuf>,
    package_json: Vec<PathBuf>,
    compose: Vec<PathBuf>,
}

pub fn detect(raw_path: &str) -> Result<DetectResult, String> {
    let root = expand_path(raw_path)?;
    if !root.is_dir() {
        return Err(format!("not a directory: {}", root.display()));
    }

    let mut files = Files {
        csproj: Vec::new(),
        package_json: Vec::new(),
        compose: Vec::new(),
    };
    walk(&root, 0, &mut files);

    let mut candidates = Vec::new();

    let mut compose_files = files.compose.clone();
    compose_files.sort_by_key(|path| path.parent() != Some(root.as_path()));
    for compose in compose_files.iter().take(3) {
        if let Some(candidate) = compose_candidate(compose, &root) {
            candidates.push(candidate);
        }
    }

    if let Some(project) = pick_dotnet_project(&files.csproj, &root) {
        candidates.push(dotnet_candidate(&root, &project, files.csproj.len()));
    }

    for package in files.package_json.iter().take(3) {
        if let Some(candidate) = vite_candidate(package) {
            candidates.push(candidate);
            break;
        }
    }

    Ok(DetectResult {
        root: root.to_string_lossy().to_string(),
        existing_config: root.join("nodusforge.yaml").exists(),
        candidates,
    })
}

fn walk(dir: &Path, depth: usize, files: &mut Files) {
    if depth > 5 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        if path.is_dir() {
            if matches!(
                name.as_str(),
                "node_modules"
                    | "bin"
                    | "obj"
                    | ".git"
                    | "dist"
                    | "build"
                    | "target"
                    | ".venv"
                    | "venv"
                    | "coverage"
            ) {
                continue;
            }
            walk(&path, depth + 1, files);
            continue;
        }

        match name.as_str() {
            _ if name.ends_with(".csproj") => files.csproj.push(path),
            "package.json" => files.package_json.push(path),
            "docker-compose.yml" | "docker-compose.yaml" | "compose.yml" | "compose.yaml" => {
                files.compose.push(path)
            }
            _ => {}
        }
    }
}

fn pick_dotnet_project(projects: &[PathBuf], root: &Path) -> Option<PathBuf> {
    let mut scored: Vec<(u8, &PathBuf)> = projects
        .iter()
        .map(|path| {
            let dir = path.parent().unwrap_or(root);
            let mut score = 0;
            if dir.join("Program.cs").exists() {
                score += 4;
            }
            if dir.join("Properties").join("launchSettings.json").exists() {
                score += 3;
            }
            let stem = path.file_stem().unwrap_or_default().to_string_lossy();
            if stem.to_ascii_lowercase().contains("main") {
                score += 2;
            }
            if stem.to_ascii_lowercase().ends_with(".api") {
                score += 1;
            }
            if score == 0 {
                score = 1;
            }
            (score, path)
        })
        .collect();

    scored.sort_by(|a, b| b.0.cmp(&a.0));
    scored.first().map(|(_, path)| (*path).clone())
}

fn dotnet_candidate(root: &Path, project: &Path, total_projects: usize) -> DetectedApp {
    let name = project
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "dotnet-app".into());
    let relative = project
        .strip_prefix(root)
        .unwrap_or(project)
        .to_string_lossy()
        .to_string();

    let port = launch_settings_port(project);
    let health = match port {
        Some(port) => Health {
            kind: HealthKind::Tcp,
            port: Some(port),
            timeout_ms: 120_000,
            ..Health::default()
        },
        None => Health::default(),
    };

    let notes = match port {
        Some(port) => format!(
            "Detected {total_projects} project(s); using {name} on port {port} from launchSettings.json."
        ),
        None => format!(
            "Detected {total_projects} project(s); no http port found in launchSettings.json. Set health manually if needed."
        ),
    };

    DetectedApp {
        kind: "dotnet".into(),
        name,
        cwd: root.to_string_lossy().to_string(),
        command: format!("dotnet run --project {relative}"),
        url: port.map(|port| format!("http://localhost:{port}")),
        health,
        notes,
    }
}

fn launch_settings_port(project: &Path) -> Option<u16> {
    let dir = project.parent()?;
    let path = dir.join("Properties").join("launchSettings.json");
    let text = std::fs::read_to_string(path).ok()?;
    let text = text.trim_start_matches('\u{feff}');
    let json: Value = serde_json::from_str(text).ok()?;
    let profiles = json.get("profiles")?.as_object()?;

    for key in ["http", "https"] {
        if let Some(port) = profiles.get(key).and_then(profile_http_port) {
            return Some(port);
        }
    }

    for profile in profiles.values() {
        if let Some(port) = profile_http_port(profile) {
            return Some(port);
        }
    }

    None
}

fn profile_http_port(profile: &Value) -> Option<u16> {
    let urls = profile.get("applicationUrl")?.as_str()?;
    for url in urls.split(';') {
        let url = url.trim();
        if url.starts_with("http://") {
            if let Some(port) = url_port(url) {
                return Some(port);
            }
        }
    }
    None
}

fn url_port(url: &str) -> Option<u16> {
    let rest = url.strip_prefix("http://")?;
    let authority = rest.split('/').next()?;
    authority.rsplit(':').next()?.parse().ok()
}

fn compose_candidate(compose: &Path, root: &Path) -> Option<DetectedApp> {
    let dir = compose.parent()?;
    let text = std::fs::read_to_string(compose).ok()?;
    let text = text.trim_start_matches('\u{feff}');
    let yaml: Value = serde_yaml_ng::from_str(text).ok()?;
    let env = crate::envfile::read(&dir.join(".env"));

    let name = yaml
        .get("name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| {
            dir.file_name()
                .map(|value| value.to_string_lossy().to_string())
        })
        .unwrap_or_else(|| "compose".to_string());

    let port = compose_port(&yaml, &env);
    let health = match port {
        Some(port) => Health {
            kind: HealthKind::Tcp,
            port: Some(port),
            timeout_ms: 180_000,
            ..Health::default()
        },
        None => Health {
            timeout_ms: 180_000,
            ..Health::default()
        },
    };

    let notes = match port {
        Some(port) => format!(
            "Detected Docker Compose project in {}. Starts with `docker compose up`; using port {port} for health.",
            dir.strip_prefix(root).unwrap_or(dir).display()
        ),
        None => format!(
            "Detected Docker Compose project in {}. Starts with `docker compose up`; no published host port found, so health is not checked.",
            dir.strip_prefix(root).unwrap_or(dir).display()
        ),
    };

    Some(DetectedApp {
        kind: "compose".into(),
        name,
        cwd: dir.to_string_lossy().to_string(),
        command: "docker compose up".into(),
        url: port.map(|port| format!("http://localhost:{port}")),
        health,
        notes,
    })
}

fn compose_port(yaml: &Value, env: &HashMap<String, String>) -> Option<u16> {
    let services = yaml.get("services")?.as_object()?;
    for service in services.values() {
        let Some(ports) = service.get("ports").and_then(Value::as_array) else {
            continue;
        };
        for port in ports {
            if let Some(port) = compose_port_value(port, env) {
                return Some(port);
            }
        }
    }
    None
}

fn compose_port_value(value: &Value, env: &HashMap<String, String>) -> Option<u16> {
    match value {
        Value::String(text) => {
            let text = resolve_compose_value(text, env);
            let parts: Vec<&str> = text.split(':').collect();
            let host = match parts.len() {
                2 => parts[0],
                3 => parts[1],
                _ => return None,
            };
            parse_port(host)
        }
        Value::Object(map) => {
            let published = map.get("published")?;
            let text = match published {
                Value::String(text) => resolve_compose_value(text.as_str(), env),
                Value::Number(number) => number.to_string(),
                _ => return None,
            };
            parse_port(&text)
        }
        _ => None,
    }
}

fn parse_port(value: &str) -> Option<u16> {
    let value = value.trim();
    let first = value.split('-').next()?.trim();
    first.parse::<u16>().ok().filter(|port| *port > 0)
}

fn resolve_compose_value(value: &str, env: &HashMap<String, String>) -> String {
    let mut result = value.to_string();
    for _ in 0..8 {
        let Some(start) = result.find("${") else {
            break;
        };
        let Some(end_offset) = result[start + 2..].find('}') else {
            break;
        };
        let end = start + 2 + end_offset;
        let expression = &result[start + 2..end];
        let (key, default) = expression.split_once(":-").unwrap_or((expression, ""));
        let replacement = env
            .get(key)
            .filter(|value| !value.is_empty())
            .cloned()
            .or_else(|| {
                std::env::var(key)
                    .ok()
                    .filter(|value| !value.is_empty())
            })
            .unwrap_or_else(|| default.to_string());
        result.replace_range(start..=end, &replacement);
    }
    result
}

fn vite_candidate(package_json: &Path) -> Option<DetectedApp> {
    let dir = package_json.parent()?;
    let text = std::fs::read_to_string(package_json).ok()?;
    let text = text.trim_start_matches('\u{feff}');
    let json: Value = serde_json::from_str(text).ok()?;

    let has_vite = json
        .get("devDependencies")
        .and_then(|v| v.get("vite"))
        .is_some()
        || json
            .get("dependencies")
            .and_then(|v| v.get("vite"))
            .is_some()
        || json
            .get("scripts")
            .and_then(|v| v.get("dev"))
            .and_then(|v| v.as_str())
            .map(|script| script.contains("vite"))
            .unwrap_or(false);

    if !has_vite {
        return None;
    }

    let package_name = json
        .get("name")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty())
        .or_else(|| {
            dir.file_name()
                .map(|s| s.to_string_lossy().to_string())
        })
        .unwrap_or_else(|| "vite-app".into());

    let (runner, command) = if dir.join("pnpm-lock.yaml").exists() {
        ("pnpm", "pnpm dev".to_string())
    } else if dir.join("yarn.lock").exists() {
        ("yarn", "yarn dev".to_string())
    } else if dir.join("bun.lockb").exists() || dir.join("bun.lock").exists() {
        ("bun", "bun run dev".to_string())
    } else {
        ("npm", "npm run dev".to_string())
    };

    let port = vite_port(dir).unwrap_or(5173);
    let notes = format!("Detected Vite project using {runner} on port {port}.");

    Some(DetectedApp {
        kind: "vite".into(),
        name: package_name,
        cwd: dir.to_string_lossy().to_string(),
        command,
        url: Some(format!("http://localhost:{port}")),
        health: Health {
            kind: HealthKind::Tcp,
            port: Some(port),
            timeout_ms: 60_000,
            ..Health::default()
        },
        notes,
    })
}

fn vite_port(dir: &Path) -> Option<u16> {
    for name in [
        "vite.config.ts",
        "vite.config.mts",
        "vite.config.js",
        "vite.config.mjs",
    ] {
        let path = dir.join(name);
        let Ok(text) = std::fs::read_to_string(path) else {
            continue;
        };
        if let Some(index) = text.find("port:") {
            let rest = text[index + 5..].trim_start();
            let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
            if let Ok(port) = digits.parse::<u16>() {
                return Some(port);
            }
        }
    }
    None
}
