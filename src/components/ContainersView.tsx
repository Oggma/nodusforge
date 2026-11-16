import { useEffect, type ReactNode } from "react";
import {
  AlertTriangle,
  Container,
  Loader2,
  Play,
  RefreshCw,
  Square,
} from "lucide-react";

import { cn } from "../lib/format";
import { useContainerStore } from "../store/useContainerStore";
import { Button } from "./ui";
import { CopyButton } from "./CopyButton";
import type { ContainerInfo } from "../lib/types";

export function ContainersView() {
  const containers = useContainerStore((state) => state.containers);
  const selectedId = useContainerStore((state) => state.selectedId);
  const status = useContainerStore((state) => state.status);
  const loaded = useContainerStore((state) => state.loaded);
  const refresh = useContainerStore((state) => state.refresh);

  useEffect(() => {
    void refresh();

    let timer: number | null = null;
    const start = () => {
      if (timer !== null) return;
      timer = window.setInterval(() => {
        if (!document.hidden) void refresh();
      }, 5_000);
    };
    const stop = () => {
      if (timer === null) return;
      window.clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        void refresh();
        start();
      }
    };

    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  const selected = containers.find((container) => container.id === selectedId);

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      {!loaded ? (
        <CenteredState
          icon={<Loader2 size={20} className="animate-spin text-muted" />}
          title="Loading containers"
          message="Reading Docker containers."
        />
      ) : !status.installed ? (
        <CenteredState
          icon={<AlertTriangle size={20} className="text-amber" />}
          title="Docker is not installed"
          message="Container management is unavailable. Install Docker and refresh."
          detail={status.error}
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void refresh()}
            >
              <RefreshCw size={12} /> Refresh
            </Button>
          }
        />
      ) : !status.daemonReachable ? (
        <CenteredState
          icon={<AlertTriangle size={20} className="text-amber" />}
          title="Docker daemon is not reachable"
          message="Docker is installed but the daemon is not responding. Start Docker and refresh."
          detail={status.error}
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void refresh()}
            >
              <RefreshCw size={12} /> Refresh
            </Button>
          }
        />
      ) : containers.length === 0 ? (
        <CenteredState
          icon={<Container size={20} className="text-muted" />}
          title="No containers"
          message="Create a container or a Compose project and it will appear here."
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void refresh()}
            >
              <RefreshCw size={12} /> Refresh
            </Button>
          }
        />
      ) : !selected ? (
        <CenteredState
          icon={<Container size={20} className="text-muted" />}
          title="Select a container"
          message="Pick a container from the sidebar to see its details."
        />
      ) : (
        <ContainerDetails container={selected} />
      )}
    </main>
  );
}

function ContainerDetails({ container }: { container: ContainerInfo }) {
  const busy = useContainerStore((state) => Boolean(state.busy[container.id]));
  const start = useContainerStore((state) => state.start);
  const stop = useContainerStore((state) => state.stop);
  const running = container.state.toLowerCase() === "running";

  return (
    <>
      <div className="flex shrink-0 items-start justify-between gap-6 border-b border-line px-6 pb-4 pt-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="max-w-[680px] truncate text-[19px] font-semibold leading-none tracking-tight">
              {container.name || container.id.slice(0, 12)}
            </h1>
            <ContainerStateChip state={container.state} />
          </div>
          <div className="mt-2 flex items-center gap-1 font-mono text-[11.5px] text-muted">
            <span className="max-w-[700px] truncate" title={container.image}>
              {container.image || "no image"}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
          <Button
            size="sm"
            variant={running ? "danger" : "primary"}
            disabled={busy}
            onClick={() => {
              if (running) {
                void stop(container.id);
              } else {
                void start(container.id);
              }
            }}
          >
            {busy ? (
              <Loader2 size={12} className="animate-spin" />
            ) : running ? (
              <Square size={10} />
            ) : (
              <Play size={12} />
            )}
            {running ? "Stop" : "Start"}
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        <div className="max-w-4xl">
          <section className="space-y-2">
            <Row label="Name">
              <span className="flex min-w-0 items-center gap-1">
                <code className="truncate font-mono text-[11.5px] text-ink/90">
                  {container.name || "—"}
                </code>
                {container.name && (
                  <CopyButton text={container.name} title="Copy name" />
                )}
              </span>
            </Row>

            <Row label="State">
              <span className="capitalize">{container.state || "unknown"}</span>
            </Row>

            <Row label="Image">
              <span className="flex min-w-0 items-center gap-1">
                <code className="truncate font-mono text-[11.5px] text-ink/90" title={container.image}>
                  {container.image || "—"}
                </code>
                {container.image && (
                  <CopyButton text={container.image} title="Copy image" />
                )}
              </span>
            </Row>

            <Row label="ID">
              <span className="flex min-w-0 items-center gap-1">
                <code className="truncate font-mono text-[11.5px] text-ink/90" title={container.id}>
                  {container.id}
                </code>
                <CopyButton text={container.id} title="Copy ID" />
              </span>
            </Row>

            <Row label="Ports">
              <code className="break-all font-mono text-[11.5px] text-ink/90">
                {container.ports || "—"}
              </code>
            </Row>

            <Row label="Status">
              <span className="text-[12px] text-ink/85">
                {container.status || "—"}
              </span>
            </Row>

            <Row label="Created">
              <span className="text-[12px] text-ink/85">
                {container.created || "—"}
              </span>
            </Row>

            <Row label="Command">
              <code className="break-all font-mono text-[11px] leading-relaxed text-ink/85">
                {container.command || "—"}
              </code>
            </Row>
          </section>
        </div>
      </div>
    </>
  );
}

function ContainerStateChip({ state }: { state: string }) {
  const value = state.toLowerCase();
  const running = value === "running";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10.5px] font-medium capitalize",
        running
          ? "border-accent/30 bg-accent/10 text-accent"
          : "border-line bg-panel-2 text-muted",
      )}
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          running ? "bg-accent" : "bg-muted/60",
        )}
      />
      {state || "unknown"}
    </span>
  );
}

function CenteredState({
  icon,
  title,
  message,
  detail,
  action,
}: {
  icon: ReactNode;
  title: string;
  message: string;
  detail?: string | null;
  action?: ReactNode;
}) {
  return (
    <div className="grid min-h-0 flex-1 place-items-center p-10">
      <div className="max-w-lg text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-line bg-panel">
          {icon}
        </div>
        <h2 className="mt-4 text-[17px] font-semibold tracking-tight">{title}</h2>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">{message}</p>
        {detail && (
          <pre className="mt-3 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-md border border-line bg-panel px-3 py-2 text-left font-mono text-[10.5px] leading-relaxed text-muted">
            {detail}
          </pre>
        )}
        {action && <div className="mt-5 flex justify-center">{action}</div>}
      </div>
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[150px_1fr] items-start gap-4 border-b border-line-soft py-2 last:border-0">
      <div className="pt-0.5 text-[10.5px] font-medium uppercase tracking-[0.1em] text-muted">
        {label}
      </div>
      <div className="min-w-0 text-[12px]">{children}</div>
    </div>
  );
}
