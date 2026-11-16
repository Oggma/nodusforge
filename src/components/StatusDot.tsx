import { statusColor, statusLabel, statusText, cn } from "../lib/format";
import type { AppState } from "../lib/types";

export function StatusDot({
  state,
  className,
}: {
  state: AppState;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-block h-2 w-2 shrink-0 rounded-full",
        statusColor(state),
        (state === "starting" || state === "stopping") && "animate-pulse",
        className,
      )}
    />
  );
}

export function StatusChip({ state }: { state: AppState }) {
  const background =
    state === "running"
      ? "bg-accent/10 border-accent/25"
      : state === "starting" || state === "stopping"
        ? "bg-amber/10 border-amber/25"
        : state === "failed" || state === "crashed"
          ? "bg-danger/10 border-danger/25"
          : "bg-panel-2 border-line";

  return (
    <span
      className={cn(
        "inline-flex h-[22px] items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium",
        background,
        statusText(state),
      )}
    >
      <StatusDot state={state} className="h-1.5 w-1.5" />
      {statusLabel(state)}
    </span>
  );
}
