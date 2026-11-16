use std::collections::VecDeque;
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::sync::Arc;
use std::time::Duration;

use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncRead, BufReader};
use tokio::sync::mpsc;

use crate::config::log_dir;
use crate::events::{LogBatch, EVT_LOG_BATCH};
use crate::process::manager::AppRuntime;

const MAX_LINE_BYTES: usize = 8192;
const MAX_LOG_FILE_BYTES: u64 = 10 * 1024 * 1024;

pub struct LogBuffer {
    lines: VecDeque<String>,
    capacity: usize,
}

impl LogBuffer {
    pub fn new(capacity: usize) -> Self {
        Self {
            lines: VecDeque::with_capacity(capacity.min(2048)),
            capacity: capacity.max(200),
        }
    }

    pub fn push(&mut self, line: String) {
        if self.lines.len() >= self.capacity {
            self.lines.pop_front();
        }
        self.lines.push_back(line);
    }

    pub fn tail(&self, count: usize) -> Vec<String> {
        let count = count.min(self.lines.len());
        self.lines
            .iter()
            .skip(self.lines.len() - count)
            .cloned()
            .collect()
    }

    pub fn clear(&mut self) {
        self.lines.clear();
    }
}

pub fn start_pipeline(
    app: AppHandle,
    id: String,
    runtime: Arc<AppRuntime>,
    stdout: Option<tokio::process::ChildStdout>,
    stderr: Option<tokio::process::ChildStderr>,
    persist: bool,
    capacity: usize,
) {
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();

    if let Some(out) = stdout {
        spawn_reader(out, tx.clone());
    }
    if let Some(err) = stderr {
        spawn_reader(err, tx.clone());
    }
    drop(tx);

    {
        let mut buffer = runtime.log.lock().unwrap();
        buffer.capacity = capacity.max(200);
    }

    tokio::spawn(async move {
        let mut pending: Vec<String> = Vec::new();
        let mut file = if persist { Some(open_log_file(&id)) } else { None };
        let mut ticker = tokio::time::interval(Duration::from_millis(50));
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

        loop {
            tokio::select! {
                _ = ticker.tick() => {
                    flush(&app, &id, &runtime, &mut pending, file.as_mut());
                }
                message = rx.recv() => {
                    match message {
                        Some(line) => {
                            pending.push(line);
                            if pending.len() >= 500 {
                                flush(&app, &id, &runtime, &mut pending, file.as_mut());
                            }
                        }
                        None => {
                            flush(&app, &id, &runtime, &mut pending, file.as_mut());
                            break;
                        }
                    }
                }
            }
        }
    });
}

fn spawn_reader<R>(reader: R, tx: mpsc::UnboundedSender<String>)
where
    R: AsyncRead + Unpin + Send + 'static,
{
    tokio::spawn(async move {
        let mut lines = BufReader::new(reader).lines();
        loop {
            match lines.next_line().await {
                Ok(Some(line)) => {
                    if tx.send(clean_line(line)).is_err() {
                        break;
                    }
                }
                _ => break,
            }
        }
    });
}

fn clean_line(line: String) -> String {
    let line = line.replace('\r', "");
    if line.len() <= MAX_LINE_BYTES {
        return line;
    }
    let mut cut = MAX_LINE_BYTES;
    while !line.is_char_boundary(cut) {
        cut -= 1;
    }
    format!("{} … [truncated]", &line[..cut])
}

fn flush(
    app: &AppHandle,
    id: &str,
    runtime: &Arc<AppRuntime>,
    pending: &mut Vec<String>,
    file: Option<&mut File>,
) {
    if pending.is_empty() {
        return;
    }

    let lines = std::mem::take(pending);
    {
        let mut buffer = runtime.log.lock().unwrap();
        for line in &lines {
            buffer.push(line.clone());
        }
    }

    if let Some(file) = file {
        for line in &lines {
            let _ = writeln!(file, "{line}");
        }
        let _ = file.flush();
    }

    let _ = app.emit(
        EVT_LOG_BATCH,
        LogBatch {
            id: id.to_string(),
            lines,
        },
    );
}

fn open_log_file(id: &str) -> File {
    let dir = log_dir();
    let _ = std::fs::create_dir_all(&dir);
    let safe = sanitize(id);
    let path = dir.join(format!("{safe}.log"));

    if let Ok(meta) = path.metadata() {
        if meta.len() > MAX_LOG_FILE_BYTES {
            let _ = std::fs::rename(&path, dir.join(format!("{safe}.1.log")));
        }
    }

    OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .unwrap_or_else(|_| {
            // Falling back to a temp file keeps the pipeline alive if the state
            // directory is unwritable.
            let fallback = std::env::temp_dir().join(format!("nodusforge-{safe}.log"));
            OpenOptions::new()
                .create(true)
                .append(true)
                .open(fallback)
                .expect("temp log file")
        })
}

pub fn truncate_log(id: &str) {
    let path = log_dir().join(format!("{}.log", sanitize(id)));
    let _ = std::fs::remove_file(path);
}

fn sanitize(id: &str) -> String {
    id.chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect()
}
