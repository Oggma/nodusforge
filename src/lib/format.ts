import type { AppState, AppView, Health } from "./types";

export function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

export function appPort(app: AppView): number | null {
  if (app.health?.port) return app.health.port;
  if (app.health?.url) return portFromUrl(app.health.url);
  if (app.url) return portFromUrl(app.url);
  return null;
}

function portFromUrl(url: string): number | null {
  try {
    const parsed = new URL(url);
    if (parsed.port) return Number(parsed.port);
    return parsed.protocol === "https:" ? 443 : 80;
  } catch {
    return null;
  }
}

export function statusLabel(state: AppState): string {
  switch (state) {
    case "stopped":
      return "Stopped";
    case "starting":
      return "Starting";
    case "running":
      return "Running";
    case "stopping":
      return "Stopping";
    case "failed":
      return "Failed";
    case "crashed":
      return "Crashed";
  }
}

export function statusColor(state: AppState): string {
  switch (state) {
    case "running":
      return "bg-accent";
    case "starting":
    case "stopping":
      return "bg-amber";
    case "failed":
    case "crashed":
      return "bg-danger";
    default:
      return "bg-muted/50";
  }
}

export function statusText(state: AppState): string {
  switch (state) {
    case "running":
      return "text-accent";
    case "starting":
    case "stopping":
      return "text-amber";
    case "failed":
    case "crashed":
      return "text-danger";
    default:
      return "text-muted";
  }
}

export function formatUptime(startedAt?: number | null, now = Date.now()): string {
  if (!startedAt) return "";
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map((part) => String(part).padStart(2, "0")).join(":");
}

export function healthLabel(health: Health): string {
  if (health.type === "tcp") return `TCP ${health.port ?? "?"}`;
  if (health.type === "http") return `HTTP ${health.path ?? health.url ?? ""}`.trim();
  return "Process only";
}

export function compactPath(path: string, home = "/home/dev"): string {
  return path.startsWith(home) ? `~${path.slice(home.length)}` : path;
}
