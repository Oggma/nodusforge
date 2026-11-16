use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

use crate::config::{AppConfig, HealthKind};

pub async fn probe(app: &AppConfig) -> bool {
    match app.health.kind {
        HealthKind::None => true,
        HealthKind::Tcp => match app.health.port {
            Some(port) => tcp_open_any(port).await,
            None => false,
        },
        HealthKind::Http => {
            let base = app
                .health
                .url
                .clone()
                .or_else(|| app.url.clone())
                .unwrap_or_default();
            if base.is_empty() {
                return false;
            }
            let mut url = base.trim_end_matches('/').to_string();
            if let Some(path) = &app.health.path {
                let path = path.trim_start_matches('/');
                url = format!("{url}/{path}");
            }
            http_ok(&url).await
        }
    }
}

async fn tcp_open_any(port: u16) -> bool {
    tcp_open("127.0.0.1", port).await || tcp_open("::1", port).await
}

async fn tcp_open(host: &str, port: u16) -> bool {
    matches!(
        tokio::time::timeout(Duration::from_millis(800), TcpStream::connect((host, port))).await,
        Ok(Ok(_))
    )
}

async fn http_ok(url: &str) -> bool {
    let (host, port, path, tls) = match parse_url(url) {
        Some(parsed) => parsed,
        None => return false,
    };

    // TLS handshakes are not worth reimplementing for a readiness probe; a
    // reachable port is enough for https endpoints.
    if tls {
        return tcp_open(&host, port).await;
    }

    let mut stream = match tokio::time::timeout(
        Duration::from_millis(900),
        TcpStream::connect((host.as_str(), port)),
    )
    .await
    {
        Ok(Ok(stream)) => stream,
        _ => return false,
    };

    let request = format!(
        "GET {path} HTTP/1.1\r\nHost: {host}:{port}\r\nUser-Agent: nodusforge\r\nAccept: */*\r\nConnection: close\r\n\r\n"
    );

    if tokio::time::timeout(Duration::from_millis(900), stream.write_all(request.as_bytes()))
        .await
        .is_err()
    {
        return false;
    }

    let mut buffer = [0u8; 32];
    match tokio::time::timeout(Duration::from_millis(900), stream.read(&mut buffer)).await {
        Ok(Ok(n)) => n > 0 && buffer.starts_with(b"HTTP/"),
        _ => false,
    }
}

fn parse_url(url: &str) -> Option<(String, u16, String, bool)> {
    let (rest, tls) = if let Some(rest) = url.strip_prefix("http://") {
        (rest, false)
    } else if let Some(rest) = url.strip_prefix("https://") {
        (rest, true)
    } else {
        return None;
    };

    let (authority, path) = match rest.find('/') {
        Some(index) => (&rest[..index], &rest[index..]),
        None => (rest, "/"),
    };

    let (host, port) = match authority.rsplit_once(':') {
        Some((host, port)) => (host.to_string(), port.parse::<u16>().ok()?),
        None => (authority.to_string(), if tls { 443 } else { 80 }),
    };

    if host.is_empty() {
        return None;
    }

    Some((host, port, path.to_string(), tls))
}

pub fn port_free(port: u16) -> bool {
    let v4_free = std::net::TcpListener::bind(("127.0.0.1", port)).is_ok();
    let v6_free = match std::net::TcpListener::bind(("::1", port)) {
        Ok(_) => true,
        Err(error) => error.kind() == std::io::ErrorKind::AddrNotAvailable,
    };
    v4_free && v6_free
}

pub fn port_holder(port: u16) -> Option<String> {
    let output = std::process::Command::new("ss")
        .args(["-ltnp"])
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    let needle = format!(":{port}");

    for line in text.lines() {
        if line.starts_with("State") {
            continue;
        }
        let fields: Vec<&str> = line.split_whitespace().collect();
        if fields.len() < 4 {
            continue;
        }
        let local = fields[3];
        if !local.ends_with(&needle) {
            continue;
        }

        let process = fields.get(5).copied().unwrap_or("");
        let pid = process
            .split("pid=")
            .nth(1)
            .and_then(|rest| rest.split(',').next())
            .and_then(|pid| pid.parse::<u32>().ok());

        return Some(match pid {
            Some(pid) => {
                let comm = std::fs::read_to_string(format!("/proc/{pid}/comm"))
                    .map(|s| s.trim().to_string())
                    .unwrap_or_else(|_| "unknown".into());
                format!("{comm} (pid {pid})")
            }
            None => "another process".into(),
        });
    }

    None
}

/// Poll every 500ms until the health probe succeeds, the process leaves the
/// starting state, or the timeout expires.
pub async fn wait_until_ready(
    app: &AppConfig,
    is_current: impl Fn() -> bool,
    state: impl Fn() -> crate::events::State,
) -> bool {
    use crate::events::State;

    if app.health.kind == HealthKind::None {
        return true;
    }

    let deadline = tokio::time::Instant::now()
        + Duration::from_millis(app.health.timeout_ms.max(1_000));

    loop {
        if !is_current() {
            return false;
        }
        match state() {
            State::Starting | State::Running => {}
            _ => return false,
        }

        if probe(app).await {
            return true;
        }

        if tokio::time::Instant::now() >= deadline {
            return false;
        }

        tokio::time::sleep(Duration::from_millis(500)).await;
    }
}
