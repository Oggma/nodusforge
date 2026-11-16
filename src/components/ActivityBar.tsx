import type { ReactNode } from "react";
import { Container, LayoutGrid, Play, Settings } from "lucide-react";

import { cn } from "../lib/format";

export type MainView = "apps" | "containers";

export function ActivityBar({
  view,
  onChange,
  onSettings,
}: {
  view: MainView;
  onChange: (view: MainView) => void;
  onSettings: () => void;
}) {
  return (
    <nav className="flex w-[52px] shrink-0 flex-col items-center border-r border-line bg-panel py-2">
      <div
        className="mb-2 grid h-8 w-8 place-items-center rounded-lg border border-accent/30 bg-accent/10"
        title="NodusForge"
      >
        <Play size={13} className="text-accent" fill="currentColor" />
      </div>

      <div className="mb-2 h-px w-7 bg-line" />

      <ActivityButton
        active={view === "apps"}
        label="Apps"
        onClick={() => onChange("apps")}
      >
        <LayoutGrid size={18} />
      </ActivityButton>
      <ActivityButton
        active={view === "containers"}
        label="Containers"
        onClick={() => onChange("containers")}
      >
        <Container size={18} />
      </ActivityButton>

      <div className="mt-auto">
        <ActivityButton label="Settings" onClick={onSettings}>
          <Settings size={17} />
        </ActivityButton>
      </div>
    </nav>
  );
}

function ActivityButton({
  active = false,
  label,
  onClick,
  children,
}: {
  active?: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "relative mb-1 inline-flex h-10 w-10 items-center justify-center rounded-lg transition-colors",
        active
          ? "bg-panel-2 text-ink"
          : "text-muted hover:bg-panel-2 hover:text-ink",
      )}
    >
      {active && (
        <span className="absolute left-0 top-2 h-6 w-[2px] rounded-r bg-accent" />
      )}
      {children}
    </button>
  );
}
