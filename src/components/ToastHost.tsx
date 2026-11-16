import { useEffect } from "react";
import { AlertTriangle, CheckCircle2, X } from "lucide-react";

import { cn } from "../lib/format";
import { useAppStore, type ToastItem } from "../store/useAppStore";
import { IconButton } from "./ui";

export function ToastHost() {
  const toasts = useAppStore((state) => state.toasts);

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[80] flex w-[370px] flex-col gap-2">
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} />
      ))}
    </div>
  );
}

function ToastCard({ toast }: { toast: ToastItem }) {
  const dismiss = useAppStore((state) => state.dismissToast);

  useEffect(() => {
    const timer = window.setTimeout(() => dismiss(toast.id), 7000);
    return () => window.clearTimeout(timer);
  }, [toast.id, dismiss]);

  const palette =
    toast.level === "error"
      ? {
          box: "border-danger/30 bg-[#2a1618]",
          icon: <AlertTriangle size={14} className="text-danger" />,
        }
      : toast.level === "warning"
        ? {
            box: "border-amber/25 bg-[#2a2113]",
            icon: <AlertTriangle size={14} className="text-amber" />,
          }
        : {
            box: "border-accent/25 bg-[#12241d]",
            icon: <CheckCircle2 size={14} className="text-accent" />,
          };

  return (
    <div
      className={cn(
        "pointer-events-auto flex items-start gap-2.5 rounded-lg border px-3 py-2.5 shadow-lg shadow-black/40",
        palette.box,
      )}
    >
      <span className="mt-0.5 shrink-0">{palette.icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-medium text-ink">{toast.title}</div>
        <div className="mt-0.5 whitespace-pre-wrap break-words text-[11px] leading-relaxed text-muted">
          {toast.message}
        </div>
      </div>
      <IconButton
        title="Dismiss"
        className="h-6 w-6 shrink-0"
        onClick={() => dismiss(toast.id)}
      >
        <X size={12} />
      </IconButton>
    </div>
  );
}
