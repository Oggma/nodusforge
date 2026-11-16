import {
  ExternalLink,
  FolderOpen,
  Loader2,
  Play,
  RotateCw,
  Square,
} from "lucide-react";

import { ipc } from "../lib/ipc";
import { formatUptime } from "../lib/format";
import type { AppView } from "../lib/types";
import { useAppStore } from "../store/useAppStore";
import { useNow } from "../hooks/useNow";
import { StatusChip } from "./StatusDot";
import { Button } from "./ui";
import { CopyButton } from "./CopyButton";
import { GitBranchPicker } from "./GitBranchPicker";

export type Tab = "logs" | "details" | "config";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "logs", label: "Logs" },
  { id: "details", label: "Details" },
  { id: "config", label: "Config" },
];

export function AppHeader({
  app,
  tab,
  onTab,
}: {
  app: AppView;
  tab: Tab;
  onTab: (tab: Tab) => void;
}) {
  const now = useNow();
  const busy = useAppStore((state) => Boolean(state.busy[app.id]));
  const groups = useAppStore((state) => state.groups);
  const start = useAppStore((state) => state.start);
  const stop = useAppStore((state) => state.stop);
  const restart = useAppStore((state) => state.restart);
  const pushToast = useAppStore((state) => state.pushToast);

  const active =
    app.state === "running" ||
    app.state === "starting" ||
    app.state === "stopping";
  const url = app.url;
  const canRestart =
    !busy && app.state !== "starting" && app.state !== "stopping";

  const run = async (action: () => Promise<unknown>, title: string) => {
    try {
      await action();
    } catch (error) {
      pushToast("error", title, String(error));
    }
  };

  return (
    <div className="shrink-0 border-b border-line">
      <div className="flex items-start justify-between gap-6 px-6 pb-4 pt-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-[19px] font-semibold leading-none tracking-tight">
              {app.name}
            </h1>
            <StatusChip state={app.state} />
            {app.state === "running" && app.startedAt && (
              <span className="font-mono text-[11px] text-muted">
                {formatUptime(app.startedAt, now)}
              </span>
            )}
            {app.pid && (
              <span className="font-mono text-[10.5px] text-muted/70">
                pid {app.pid}
              </span>
            )}
          </div>

          <div className="mt-2 flex items-center gap-1 font-mono text-[11.5px] text-muted">
            <span className="max-w-[640px] truncate" title={app.command}>
              {app.command}
            </span>
            <CopyButton text={app.command} title="Copy command" />
          </div>

          {app.message && (
            <p
              className={
                app.state === "failed" || app.state === "crashed"
                  ? "mt-2 max-w-[720px] text-[11.5px] leading-relaxed text-danger/90"
                  : "mt-2 max-w-[720px] text-[11.5px] leading-relaxed text-muted"
              }
            >
              {app.message}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
          <Button
            size="sm"
            variant="ghost"
            disabled={!url}
            onClick={() => {
              if (url) {
                void run(() => ipc.openExternal(url), "Could not open URL");
              }
            }}
            title={url ?? "No URL configured"}
          >
            <ExternalLink size={13} /> Open
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              void run(() => ipc.openFolder(app.id), "Could not open folder")
            }
            title={app.cwd}
          >
            <FolderOpen size={13} /> Folder
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={!canRestart}
            onClick={() => void restart(app.id)}
          >
            <RotateCw size={12} /> Restart
          </Button>
          <Button
            size="sm"
            variant={active ? "danger" : "primary"}
            disabled={busy || app.state === "stopping"}
            onClick={() => {
              if (active) {
                void stop(app.id);
              } else {
                void start(app.id);
              }
            }}
          >
            {busy || app.state === "stopping" ? (
              <Loader2 size={12} className="animate-spin" />
            ) : active ? (
              <Square size={10} />
            ) : (
              <Play size={12} />
            )}
            {active ? "Stop" : "Start"}
          </Button>
        </div>
      </div>

      <GitBranchPicker app={app} />

      <div className="flex items-end gap-1 px-6">
        {TABS.map((item) => (
          <button
            key={item.id}
            onClick={() => onTab(item.id)}
            className={
              tab === item.id
                ? "border-b-2 border-accent px-2.5 pb-2 text-[12px] font-medium text-ink"
                : "border-b-2 border-transparent px-2.5 pb-2 text-[12px] text-muted transition-colors hover:text-ink"
            }
          >
            {item.label}
          </button>
        ))}

        <div className="ml-auto pb-1.5 font-mono text-[10px] text-muted/70">
          {groups.find((group) => group.id === app.group)?.name ??
            app.group ??
            "app"}
          {app.health.type !== "none" && ` · ${app.health.type}`}
        </div>
      </div>
    </div>
  );
}
