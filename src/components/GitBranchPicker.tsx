import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  GitBranch,
  Loader2,
  RefreshCw,
  Search,
} from "lucide-react";

import { ipc } from "../lib/ipc";
import { cn } from "../lib/format";
import type { AppView, GitRepoStatus } from "../lib/types";
import { useAppStore } from "../store/useAppStore";
import { IconButton } from "./ui";

export function GitBranchPicker({ app }: { app: AppView }) {
  const pushToast = useAppStore((state) => state.pushToast);
  const [data, setData] = useState<GitRepoStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [switching, setSwitching] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const requestSeq = useRef(0);
  const lastRefresh = useRef(0);

  const refresh = useCallback(
    async (announce = false) => {
      const seq = ++requestSeq.current;
      lastRefresh.current = Date.now();
      setLoading(true);
      try {
        const status = await ipc.gitStatus(app.id);
        if (seq === requestSeq.current) {
          setData(status);
        }
      } catch (error) {
        if (seq === requestSeq.current) {
          setData(null);
          if (announce) {
            pushToast("error", "Could not read Git status", String(error));
          }
        }
      } finally {
        if (seq === requestSeq.current) {
          setLoading(false);
        }
      }
    },
    [app.id, pushToast],
  );

  useEffect(() => {
    requestSeq.current += 1;
    setData(null);
    setOpen(false);
    setFilter("");
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onFocus = () => {
      if (document.hidden) return;
      if (Date.now() - lastRefresh.current < 2_000) return;
      void refresh();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!data) return null;

  if (!data.installed) {
    if (!data.repoMarker) return null;
    return (
      <div className="px-6 pb-2.5">
        <span
          className="inline-flex items-center gap-1.5 rounded-md border border-amber/30 bg-amber/10 px-2 py-1 text-[11px] text-amber"
          title={data.error ?? undefined}
        >
          <AlertTriangle size={11} /> Git not installed
        </span>
      </div>
    );
  }

  if (!data.isRepo) return null;

  const currentBranch = data.detached ? null : data.branch;
  const branchLabel = currentBranch ?? "detached HEAD";
  const query = filter.trim().toLowerCase();
  const branches = data.branches.filter((branch) =>
    query ? branch.toLowerCase().includes(query) : true,
  );

  const switchTo = async (branch: string) => {
    if (switching) return;
    if (branch === currentBranch) {
      setOpen(false);
      return;
    }

    setSwitching(branch);
    try {
      const next = await ipc.switchGitBranch(app.id, branch);
      setData(next);
      setOpen(false);
      setFilter("");
      if (app.state === "running" || app.state === "starting") {
        pushToast(
          "warning",
          "Restart to apply",
          `${app.name} is still running; restart it to use ${branch}.`,
        );
      } else {
        pushToast("info", "Branch switched", `Now on ${branch}.`);
      }
    } catch (error) {
      pushToast("error", "Could not switch branch", String(error));
    } finally {
      setSwitching(null);
    }
  };

  return (
    <div ref={wrapperRef} className="relative px-6 pb-2.5">
      <button
        type="button"
        onClick={() => {
          setOpen((value) => !value);
          if (!open) void refresh();
        }}
        className={cn(
          "inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition-colors",
          open
            ? "border-accent/35 bg-panel-2 text-ink"
            : "border-line bg-panel-2/50 text-muted hover:border-line hover:bg-panel-2 hover:text-ink",
        )}
        title={`Git branch: ${branchLabel}`}
      >
        <GitBranch size={11} className="shrink-0 text-accent/80" />
        <span className="truncate font-mono text-[11px] text-ink/85">
          {branchLabel}
        </span>
        {loading ? (
          <Loader2 size={11} className="shrink-0 animate-spin text-muted" />
        ) : (
          <ChevronDown
            size={11}
            className={cn(
              "shrink-0 text-muted transition-transform",
              open && "rotate-180",
            )}
          />
        )}
      </button>

      {open && (
        <div className="absolute left-6 top-[calc(100%-4px)] z-30 w-[340px] overflow-hidden rounded-lg border border-line bg-panel shadow-2xl shadow-black/50">
          <div className="flex items-start justify-between gap-3 border-b border-line px-3 py-2.5">
            <div className="min-w-0">
              <div className="text-[11px] font-medium text-ink">
                Switch branch
              </div>
              <div
                className="mt-0.5 truncate font-mono text-[9.5px] text-muted/75"
                title={data.root ?? undefined}
              >
                {data.root ?? "Git repository"}
              </div>
            </div>
            <IconButton
              title="Refresh branches"
              className="h-6 w-6 shrink-0"
              disabled={loading}
              onClick={() => void refresh(true)}
            >
              {loading ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <RefreshCw size={12} />
              )}
            </IconButton>
          </div>

          <div className="relative border-b border-line px-3 py-2">
            <Search
              size={12}
              className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-muted"
            />
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Filter branches"
              autoFocus
              className="h-7 w-full rounded border border-line bg-canvas pl-7 pr-2 text-[11.5px] text-ink outline-none placeholder:text-muted/50 focus:border-accent/40"
            />
          </div>

          <div className="max-h-64 overflow-y-auto py-1">
            {branches.map((branch) => {
              const current = branch === currentBranch;
              return (
                <button
                  key={branch}
                  type="button"
                  onClick={() => void switchTo(branch)}
                  disabled={Boolean(switching)}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-[11.5px] transition-colors",
                    "hover:bg-panel-2 disabled:cursor-not-allowed disabled:opacity-60",
                    current ? "text-ink" : "text-ink/75",
                  )}
                >
                  <span className="w-3.5 shrink-0">
                    {switching === branch ? (
                      <Loader2 size={11} className="animate-spin text-accent" />
                    ) : current ? (
                      <Check size={11} className="text-accent" />
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{branch}</span>
                  {current && (
                    <span className="text-[9px] uppercase tracking-[0.1em] text-muted">
                      current
                    </span>
                  )}
                </button>
              );
            })}

            {branches.length === 0 && (
              <p className="px-3 py-4 text-center text-[11px] text-muted">
                {data.branches.length === 0
                  ? "No local branches."
                  : "No branches match the filter."}
              </p>
            )}
          </div>

          <div className="border-t border-line px-3 py-2 text-[10px] leading-relaxed text-muted/75">
            Switching changes the checked-out branch for the whole repository.
          </div>
        </div>
      )}
    </div>
  );
}
