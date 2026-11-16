import { useState } from "react";
import {
  Container,
  Loader2,
  Play,
  RefreshCw,
  Search,
  Square,
} from "lucide-react";

import { cn } from "../lib/format";
import type { ContainerInfo } from "../lib/types";
import { useContainerStore } from "../store/useContainerStore";
import { IconButton } from "./ui";

export function ContainersSidebar() {
  const containers = useContainerStore((state) => state.containers);
  const selectedId = useContainerStore((state) => state.selectedId);
  const loaded = useContainerStore((state) => state.loaded);
  const refreshing = useContainerStore((state) => state.refreshing);
  const refresh = useContainerStore((state) => state.refresh);
  const select = useContainerStore((state) => state.select);

  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  const visible = containers.filter((container) => {
    if (!query) return true;
    return (
      container.name.toLowerCase().includes(query) ||
      container.image.toLowerCase().includes(query) ||
      container.id.toLowerCase().includes(query)
    );
  });

  const running = containers.filter(
    (container) => container.state.toLowerCase() === "running",
  ).length;

  return (
    <aside className="flex w-[300px] shrink-0 flex-col border-r border-line bg-panel">
      <div className="px-3.5 pb-3 pt-4">
        <div className="flex items-center gap-2.5">
          <div className="grid h-8 w-8 place-items-center rounded-lg border border-info/30 bg-info/10">
            <Container size={15} className="text-info" />
          </div>
          <div className="min-w-0">
            <div className="text-[15px] font-semibold leading-none tracking-tight">
              Containers
            </div>
            <div className="mt-1 text-[9.5px] uppercase tracking-[0.18em] text-muted">
              {containers.length} total · {running} running
            </div>
          </div>
          <div className="ml-auto">
            <IconButton
              title="Refresh containers"
              disabled={refreshing}
              onClick={() => void refresh()}
            >
              {refreshing ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <RefreshCw size={14} />
              )}
            </IconButton>
          </div>
        </div>

        <div className="relative mt-4">
          <Search
            size={13}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
          />
          <input
            id="nodusforge-container-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search containers"
            className={cn(
              "h-8 w-full rounded-md border border-line bg-canvas pl-8 pr-3 text-[12px] text-ink",
              "outline-none placeholder:text-muted/50 focus:border-accent/40 focus:ring-1 focus:ring-accent/15",
            )}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
        {visible.map((container) => (
          <ContainerRow
            key={container.id}
            container={container}
            selected={container.id === selectedId}
            onSelect={() => select(container.id)}
          />
        ))}

        {loaded && visible.length === 0 && (
          <p className="px-3 py-8 text-center text-[11.5px] leading-relaxed text-muted">
            {containers.length === 0
              ? "No containers found."
              : `Nothing matches “${search}”.`}
          </p>
        )}
      </div>

      <div className="border-t border-line px-3 py-2.5 text-[10px] leading-relaxed text-muted/75">
        Compose containers appear as ordinary containers. Dependencies are not
        started automatically.
      </div>
    </aside>
  );
}

function ContainerRow({
  container,
  selected,
  onSelect,
}: {
  container: ContainerInfo;
  selected: boolean;
  onSelect: () => void;
}) {
  const busy = useContainerStore((state) => Boolean(state.busy[container.id]));
  const start = useContainerStore((state) => state.start);
  const stop = useContainerStore((state) => state.stop);
  const running = container.state.toLowerCase() === "running";

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
        "group flex cursor-pointer items-center gap-2.5 rounded-md border px-2 py-2 outline-none transition-colors",
        selected
          ? "border-line bg-panel-2"
          : "border-transparent hover:bg-panel-2/70 focus-visible:border-line",
      )}
    >
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dotClass(container.state))} />

      <div className="min-w-0 flex-1">
        <div className="truncate text-[12.5px] font-medium leading-tight text-ink">
          {container.name || container.id.slice(0, 12)}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[9.5px] leading-none text-muted">
          <span className={running ? "text-accent/90" : "text-muted"}>
            {container.state || "unknown"}
          </span>
          <span className="text-muted/40">·</span>
          <span className="truncate">{container.image || "no image"}</span>
        </div>
      </div>

      <IconButton
        title={running ? `Stop ${container.name}` : `Start ${container.name}`}
        className={cn(
          "h-6 w-6",
          busy ? "opacity-100" : "opacity-0 group-hover:opacity-100",
        )}
        disabled={busy}
        onClick={(event) => {
          event.stopPropagation();
          if (running) {
            void stop(container.id);
          } else {
            void start(container.id);
          }
        }}
      >
        {busy ? (
          <Loader2 size={11} className="animate-spin" />
        ) : running ? (
          <Square size={9} />
        ) : (
          <Play size={10} />
        )}
      </IconButton>
    </div>
  );
}

function dotClass(state: string): string {
  switch (state.toLowerCase()) {
    case "running":
      return "bg-accent shadow-[0_0_6px_rgba(52,211,153,0.5)]";
    case "paused":
      return "bg-amber";
    case "restarting":
      return "bg-info animate-pulse";
    case "created":
      return "bg-muted/40";
    case "exited":
    case "dead":
      return "bg-muted/50";
    default:
      return "bg-muted/60";
  }
}
