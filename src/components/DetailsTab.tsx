import type { ReactNode } from "react";

import { healthLabel } from "../lib/format";
import type { AppView } from "../lib/types";
import { useAppStore } from "../store/useAppStore";
import { CopyButton } from "./CopyButton";

export function DetailsTab({ app }: { app: AppView }) {
  const apps = useAppStore((state) => state.apps);
  const groups = useAppStore((state) => state.groups);

  const groupName =
    groups.find((group) => group.id === app.group)?.name ?? app.group;

  const dependencies = app.dependsOn.map(
    (id) => apps[id]?.name ?? id,
  );

  return (
    <div className="h-full overflow-y-auto px-6 py-4">
      <div className="max-w-4xl">
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Status" value={app.state} />
          <Stat
            label="PID"
            value={app.pid ? String(app.pid) : "—"}
            mono
          />
          <Stat
            label="Started"
            value={
              app.startedAt
                ? new Date(app.startedAt).toLocaleString()
                : "—"
            }
          />
          <Stat
            label="Last exit code"
            value={
              app.exitCode === null || app.exitCode === undefined
                ? "—"
                : String(app.exitCode)
            }
            mono
          />
          <Stat label="Group" value={groupName ?? "—"} />
          <Stat label="Health check" value={healthLabel(app.health)} mono />
          <Stat
            label="Auto start"
            value={app.autoStart ? "Yes, with NodusForge" : "No"}
          />
          <Stat label="Stop signal" value={app.stopSignal} mono />
        </div>

        <section className="mt-5 space-y-2">
          <Row label="Working directory">
            <span className="flex min-w-0 items-center gap-1">
              <code className="truncate font-mono text-[11.5px] text-ink/90" title={app.cwd}>
                {app.cwd}
              </code>
              <CopyButton text={app.cwd} title="Copy path" />
            </span>
          </Row>

          <Row label="Command">
            <span className="flex min-w-0 items-center gap-1">
              <code className="truncate font-mono text-[11.5px] text-ink/90" title={app.command}>
                {app.command}
              </code>
              <CopyButton text={app.command} title="Copy command" />
            </span>
          </Row>

          <Row label="URL">
            {app.url ? (
              <span className="flex min-w-0 items-center gap-1">
                <a
                  className="truncate font-mono text-[11.5px] text-info hover:underline"
                  href={app.url}
                  onClick={(event) => event.preventDefault()}
                  title={app.url}
                >
                  {app.url}
                </a>
                <CopyButton text={app.url} title="Copy URL" />
              </span>
            ) : (
              <span className="text-muted">Not set</span>
            )}
          </Row>

          <Row label="Depends on">
            {dependencies.length > 0 ? (
              <span className="flex flex-wrap gap-1.5">
                {dependencies.map((name) => (
                  <span
                    key={name}
                    className="rounded border border-line bg-panel-2 px-1.5 py-0.5 font-mono text-[10.5px] text-ink/80"
                  >
                    {name}
                  </span>
                ))}
              </span>
            ) : (
              <span className="text-muted">Nothing</span>
            )}
          </Row>

          <Row label="In tray">
            <span className="text-muted">
              {app.showInTray ? "Shown" : "Hidden"}
            </span>
          </Row>
        </section>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-lg border border-line bg-panel-2/40 px-3 py-2.5">
      <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted">
        {label}
      </div>
      <div
        className={
          mono
            ? "mt-1 truncate font-mono text-[12px] text-ink"
            : "mt-1 truncate text-[12px] capitalize text-ink"
        }
      >
        {value}
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
    <div className="grid grid-cols-[150px_1fr] items-center gap-4 border-b border-line-soft py-2 last:border-0">
      <div className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-muted">
        {label}
      </div>
      <div className="min-w-0 text-[12px]">{children}</div>
    </div>
  );
}
