export type AppState =
  | "stopped"
  | "starting"
  | "running"
  | "stopping"
  | "failed"
  | "crashed";

export type StopSignal = "SIGINT" | "SIGTERM";

export interface Health {
  type: "none" | "tcp" | "http";
  url?: string | null;
  port?: number | null;
  path?: string | null;
  timeoutMs: number;
}

export interface AppView {
  id: string;
  name: string;
  group?: string | null;
  cwd: string;
  command: string;
  url?: string | null;
  health: Health;
  dependsOn: string[];
  autoStart: boolean;
  stopSignal: StopSignal;
  state: AppState;
  message?: string | null;
  exitCode?: number | null;
  pid?: number | null;
  startedAt?: number | null;
}

export interface Group {
  id: string;
  name: string;
}

export interface Settings {
  closeToTray: boolean;
  autostart: boolean;
  logBufferLines: number;
  persistLogs: boolean;
  autoCheckUpdates: boolean;
  theme: string;
}

export interface Snapshot {
  version: string;
  configPath: string;
  configError?: string | null;
  warnings: string[];
  settings: Settings;
  groups: Group[];
  apps: AppView[];
}

export interface StatusEvent {
  id: string;
  state: AppState;
  message?: string | null;
  exitCode?: number | null;
  pid?: number | null;
  startedAt?: number | null;
}

export interface LogBatch {
  id: string;
  lines: string[];
}

export interface ToastEvent {
  level: "error" | "warning" | "info";
  title: string;
  message: string;
}

export interface DetectedApp {
  kind: "dotnet" | "vite" | string;
  name: string;
  cwd: string;
  command: string;
  url?: string | null;
  health: Health;
  notes: string;
}

export interface DetectResult {
  root: string;
  existingConfig: boolean;
  candidates: DetectedApp[];
}

/** Shape accepted by save_app; defaults are filled on the Rust side. */
export interface AppDraft {
  id: string;
  name?: string;
  group?: string | null;
  cwd: string;
  command: string;
  env?: Record<string, string>;
  envFile?: string | null;
  url?: string | null;
  health?: Health;
  dependsOn?: string[];
  autoStart?: boolean;
  stopSignal?: StopSignal;
  stopTimeoutMs?: number;
}
