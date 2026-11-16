import { useState } from "react";
import { Loader2, Play, Plus, Search, Settings, Square } from "lucide-react";

import { useAppStore } from "../store/useAppStore";
import { appPort, cn, statusLabel, statusText } from "../lib/format";
import type { AppView, Group } from "../lib/types";
import { Button, IconButton } from "./ui";
import { StatusDot } from "./StatusDot";

export function Sidebar({
  onAddApp,
  onSettings,
}: {
  onAddApp: () => void;
  onSettings: () => void;
}) {
  const apps = useAppStore((state) => state.apps);
  const order = useAppStore((state) => state.order);
  const groups = useAppStore((state) => state.groups);
  const selectedId = useAppStore((state) => state.selectedId);
  const busy = useAppStore((state) => state.busy);
  const configPath = useAppStore((state) => state.configPath);
  const startAll = useAppStore((state) => state.startAll);
  const stopAll = useAppStore((state) => state.stopAll);
  const startGroup = useAppStore((state) => state.startGroup);
  const select = useAppStore((state) => state.select);

  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const query = search.trim().toLowerCase();
  const ordered = order
    .map((id) => apps[id])
    .filter((app): app is AppView => Boolean(app));

  const visible = ordered.filter((app) => {
    if (!query) return true;
    return (
      app.name.toLowerCase().includes(query) ||
      app.id.toLowerCase().includes(query) ||
      app.command.toLowerCase().includes(query)
    );
  });

  const groupSections: Array<{ group: Group; apps: AppView[] }> = groups
    .map((group) => ({
      group,
      apps: visible.filter((app) => app.group === group.id),
    }))
    .filter((section) => section.apps.length > 0);

  const knownGroups = new Set(groups.map((group) => group.id));
  const ungrouped = visible.filter(
    (app) => !app.group || !knownGroups.has(app.group),
  );

  const hasApps = ordered.length > 0;
  const anyRunning = ordered.some(
    (app) => app.state === "running" || app.state === "starting",
  );

  const toggleGroup = (id: string) =>
    setCollapsed((current) => ({ ...current, [id]: !current[id] }));

  return (
    <aside className="flex w-[270px] shrink-0 flex-col border-r border-line bg-panel">
      <div className="px-3.5 pb-3 pt-4">
        <div className="flex items-center gap-2.5">
          <div className="grid h-8 w-8 place-items-center rounded-lg border border-accent/30 bg-accent/10">
            <Play size={14} className="text-accent" fill="currentColor" />
          </div>
          <div className="min-w-0">
            <div className="text-[15px] font-semibold leading-none tracking-tight">
              NodusForge
            </div>
            <div className="mt-1 text-[9.5px] uppercase tracking-[0.18em] text-muted">
              local dev panel
            </div>
          </div>
          <div className="ml-auto flex items-center gap-0.5">
            <IconButton title="Add app" onClick={onAddApp}>
              <Plus size={16} />
            </IconButton>
            <IconButton title="Settings" onClick={onSettings}>
              <Settings size={15} />
            </IconButton>
          </div>
        </div>

        <div className="relative mt-4">
          <Search
            size={13}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
          />
          <input
            id="nodusforge-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search apps"
            className={cn(
              "h-8 w-full rounded-md border border-line bg-canvas pl-8 pr-14 text-[12px] text-ink",
              "outline-none placeholder:text-muted/50 focus:border-accent/40 focus:ring-1 focus:ring-accent/15",
            )}
          />
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-line px-1 py-[1px] font-mono text-[9.5px] text-muted">
            Ctrl K
          </span>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-2 pb-3">
        {groupSections.map(({ group, apps: groupApps }) => {
          const isCollapsed = Boolean(collapsed[group.id]);
          const running = groupApps.filter(
            (app) => app.state === "running" || app.state === "starting",
          ).length;

          return (
            <section key={group.id}>
              <div className="group flex items-center gap-1 px-1">
                <button
                  onClick={() => toggleGroup(group.id)}
                  className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-left"
                >
                  <span
                    className={cn(
                      "text-[9px] text-muted transition-transform",
                      isCollapsed ? "-rotate-90" : "rotate-0",
                    )}
                  >
                    ▼
                  </span>
                  <span className="truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
                    {group.name || group.id}
                  </span>
                  <span className="font-mono text-[9.5px] text-muted/70">
                    {running}/{groupApps.length}
                  </span>
                </button>
                <IconButton
                  title={`Start ${group.name}`}
                  className="h-6 w-6 opacity-0 group-hover:opacity-100"
                  disabled={busy[`group:${group.id}`]}
                  onClick={() => startGroup(group.id)}
                >
                  {busy[`group:${group.id}`] ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <Play size={11} />
                  )}
                </IconButton>
              </div>

              {!isCollapsed && (
                <div className="space-y-0.5">
                  {groupApps.map((app) => (
                    <AppRow
                      key={app.id}
                      app={app}
                      selected={app.id === selectedId}
                      onSelect={() => select(app.id)}
                    />
                  ))}
                </div>
              )}
            </section>
          );
        })}

        {ungrouped.length > 0 && (
          <section>
            <div className="flex items-center gap-1.5 px-1 py-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
                Apps
              </span>
              <span className="font-mono text-[9.5px] text-muted/70">
                {ungrouped.length}
              </span>
            </div>
            <div className="space-y-0.5">
              {ungrouped.map((app) => (
                <AppRow
                  key={app.id}
                  app={app}
                  selected={app.id === selectedId}
                  onSelect={() => select(app.id)}
                />
              ))}
            </div>
          </section>
        )}

        {!hasApps && (
          <div className="px-3 py-8 text-center">
            <p className="text-[12px] text-muted">No apps configured yet.</p>
            <Button
              size="sm"
              variant="secondary"
              className="mt-3"
              onClick={onAddApp}
            >
              <Plus size={13} /> Add your first app
            </Button>
          </div>
        )}

        {hasApps && visible.length === 0 && (
          <p className="px-3 py-6 text-center text-[11.5px] text-muted">
            Nothing matches “{search}”.
          </p>
        )}
      </div>

      <div className="space-y-1.5 border-t border-line p-2.5">
        <div className="grid grid-cols-2 gap-1.5">
          <Button
            size="sm"
            variant="secondary"
            onClick={startAll}
            disabled={!hasApps || Boolean(busy.__all)}
            title="Start all apps"
          >
            {busy.__all ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Play size={12} />
            )}
            Start all
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={stopAll}
            disabled={!anyRunning || Boolean(busy.__all)}
          >
            {busy.__all ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Square size={10} />
            )}
            Stop all
          </Button>
        </div>
        <button
          onClick={onSettings}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] text-muted transition-colors hover:bg-panel-2 hover:text-ink"
        >
          <span className="truncate font-mono" title={configPath}>
            {configPath || "config.yaml"}
          </span>
        </button>
      </div>
    </aside>
  );
}

function AppRow({
  app,
  selected,
  onSelect,
}: {
  app: AppView;
  selected: boolean;
  onSelect: () => void;
}) {
  const busy = useAppStore((state) => Boolean(state.busy[app.id]));
  const start = useAppStore((state) => state.start);
  const stop = useAppStore((state) => state.stop);

  const port = appPort(app);
  const active = app.state === "running" || app.state === "starting";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        "group flex cursor-pointer items-center gap-2.5 rounded-md border px-2 py-1.5 outline-none transition-colors",
        selected
          ? "border-line bg-panel-2"
          : "border-transparent hover:bg-panel-2/70 focus-visible:border-line",
      )}
    >
      <StatusDot state={app.state} />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[12.5px] font-medium leading-tight text-ink">
            {app.name}
          </span>
          {app.autoStart && (
            <span
              title="Starts with NodusForge"
              className="rounded border border-line px-1 font-mono text-[8.5px] uppercase text-muted"
            >
              auto
            </span>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[9.5px] leading-none text-muted">
          <span className={statusText(app.state)}>{statusLabel(app.state)}</span>
          <span className="text-muted/40">·</span>
          <span>{port ? `:${port}` : "no port"}</span>
        </div>
      </div>

      <IconButton
        title={active ? `Stop ${app.name}` : `Start ${app.name}`}
        className="h-6 w-6 opacity-0 group-hover:opacity-100"
        disabled={busy}
        onClick={(event) => {
          event.stopPropagation();
          if (active) {
            void stop(app.id);
          } else {
            void start(app.id);
          }
        }}
      >
        {busy ? (
          <Loader2 size={11} className="animate-spin" />
        ) : active ? (
          <Square size={9} />
        ) : (
          <Play size={10} />
        )}
      </IconButton>
    </div>
  );
}
