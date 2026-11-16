import {
  useEffect,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { X } from "lucide-react";
import { cn } from "../lib/format";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: "sm" | "md";
}

const VARIANT: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-canvas border-accent hover:bg-accent/90 active:bg-accent/80",
  secondary:
    "bg-panel-2 text-ink border-line hover:bg-[#1b2533] active:bg-[#1f2b3a]",
  ghost:
    "bg-transparent text-muted border-transparent hover:text-ink hover:bg-panel-2",
  danger:
    "bg-danger/10 text-danger border-danger/30 hover:bg-danger/20 active:bg-danger/25",
};

export function Button({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex select-none items-center justify-center gap-1.5 rounded-md border font-medium transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-40",
        size === "sm" ? "h-7 px-2.5 text-[12px]" : "h-8 px-3 text-[12.5px]",
        VARIANT[variant],
        className,
      )}
      {...props}
    />
  );
}

export function IconButton({
  className,
  title,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      title={title}
      aria-label={title}
      className={cn(
        "inline-flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors",
        "hover:bg-panel-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40",
        className,
      )}
      {...props}
    />
  );
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = "max-w-2xl",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-6 backdrop-blur-[2px]"
      onMouseDown={onClose}
    >
      <div
        className={cn(
          "flex max-h-[88vh] w-full flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-2xl shadow-black/50",
          width,
        )}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-6 border-b border-line px-5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
            {subtitle && (
              <p className="mt-1 text-[12px] leading-relaxed text-muted">
                {subtitle}
              </p>
            )}
          </div>
          <IconButton title="Close" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-line bg-panel-2/40 px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-start justify-between gap-6 rounded-lg border border-line bg-panel-2/40 px-3.5 py-3 text-left transition-colors hover:border-line/80"
    >
      <span>
        <span className="block text-[13px] font-medium text-ink">{label}</span>
        {description && (
          <span className="mt-0.5 block text-[11.5px] leading-relaxed text-muted">
            {description}
          </span>
        )}
      </span>
      <span
        className={cn(
          "relative mt-0.5 h-[20px] w-[36px] shrink-0 rounded-full border transition-colors",
          checked
            ? "border-accent/40 bg-accent/80"
            : "border-line bg-canvas",
        )}
      >
        <span
          className={cn(
            "absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white transition-all",
            checked ? "left-[18px]" : "left-[2px] bg-muted",
          )}
        />
      </span>
    </button>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline gap-2">
        <span className="text-[11.5px] font-medium uppercase tracking-wide text-muted">
          {label}
        </span>
        {hint && <span className="text-[11px] text-muted/70">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

export const inputClass =
  "w-full rounded-md border border-line bg-canvas px-3 py-2 text-[12.5px] text-ink outline-none transition-colors placeholder:text-muted/50 focus:border-accent/50 focus:ring-1 focus:ring-accent/20";
