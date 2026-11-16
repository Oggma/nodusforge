import { Download, ExternalLink, Loader2, RefreshCw } from "lucide-react";

import { useAppStore } from "../store/useAppStore";
import { useUpdateStore } from "../store/useUpdateStore";
import { Button, Modal } from "./ui";

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value?: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString();
}

export function UpdateDialog() {
  const platform = useAppStore((state) => state.platform);
  const open = useUpdateStore((state) => state.open);
  const status = useUpdateStore((state) => state.status);
  const info = useUpdateStore((state) => state.info);
  const progress = useUpdateStore((state) => state.progress);
  const error = useUpdateStore((state) => state.error);
  const install = useUpdateStore((state) => state.install);
  const dismiss = useUpdateStore((state) => state.dismiss);
  const openRelease = useUpdateStore((state) => state.openRelease);
  const openSettingsForUpdates = useUpdateStore(
    (state) => state.openSettingsForUpdates,
  );
  const check = useUpdateStore((state) => state.check);

  if (!open || !info) return null;

  const busy =
    status === "downloading" ||
    status === "installing" ||
    status === "restarting";
  const percent =
    progress?.total && progress.total > 0
      ? Math.min(100, Math.round((progress.downloaded / progress.total) * 100))
      : null;
  const published = formatDate(info.date);

  const close = () => {
    if (!busy) void dismiss();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title={status === "error" ? "Update failed" : "Update available"}
      subtitle={`NodusForge ${info.currentVersion} → ${info.version}`}
      width="max-w-xl"
      footer={
        status === "available" ? (
          <>
            <button
              onClick={openSettingsForUpdates}
              className="mr-auto text-[11px] text-muted underline decoration-line underline-offset-4 transition-colors hover:text-ink"
            >
              Don't check automatically
            </button>
            <Button variant="ghost" onClick={() => void openRelease()}>
              <ExternalLink size={12} /> View release
            </Button>
            <Button variant="ghost" onClick={() => void dismiss()}>
              Later
            </Button>
            <Button variant="primary" onClick={() => void install()}>
              <Download size={12} /> Update now
            </Button>
          </>
        ) : status === "error" ? (
          <>
            <Button variant="ghost" onClick={() => void openRelease()}>
              <ExternalLink size={12} /> View release
            </Button>
            <Button variant="secondary" onClick={close}>
              Close
            </Button>
            <Button variant="primary" onClick={() => void check(true)}>
              <RefreshCw size={12} /> Check again
            </Button>
          </>
        ) : (
          <Button variant="primary" disabled>
            <Loader2 size={12} className="animate-spin" />
            {status === "downloading"
              ? "Downloading…"
              : status === "installing"
                ? "Installing…"
                : "Restarting…"}
          </Button>
        )
      }
    >
      <div className="space-y-3.5">
        {published && (
          <div className="font-mono text-[10.5px] text-muted">
            Published {published}
          </div>
        )}

        {info.body && (
          <div>
            <div className="mb-1.5 text-[10.5px] font-medium uppercase tracking-[0.1em] text-muted">
              Release notes
            </div>
            <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg border border-line bg-panel-2/40 px-3.5 py-3 font-sans text-[11.5px] leading-relaxed text-ink/85">
              {info.body}
            </pre>
          </div>
        )}

        <div className="rounded-lg border border-amber/25 bg-amber/10 px-3.5 py-3 text-[11.5px] leading-relaxed text-amber/90">
          {platform === "linux" ? (
            <>
              Updating stops all managed apps and restarts NodusForge. The
              system may ask for your administrator password to install the{" "}
              <span className="font-mono">.deb</span> package.
            </>
          ) : platform === "windows" ? (
            <>
              Updating stops all managed apps, closes NodusForge and installs the
              new version. Windows may ask you to allow the installer.
            </>
          ) : (
            <>
              Updating stops all managed apps, replaces the app and restarts
              NodusForge. macOS may ask for permission.
            </>
          )}
        </div>

        {(status === "downloading" || status === "installing") && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between font-mono text-[10.5px] text-muted">
              <span>
                {status === "installing"
                  ? "Installing package…"
                  : progress?.total
                    ? `${formatBytes(progress.downloaded)} of ${formatBytes(progress.total)}`
                    : `${formatBytes(progress?.downloaded ?? 0)} downloaded`}
              </span>
              {percent !== null && <span>{percent}%</span>}
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-canvas">
              <div
                className={
                  percent === null
                    ? "h-full w-1/3 animate-pulse rounded-full bg-accent"
                    : "h-full rounded-full bg-accent transition-[width]"
                }
                style={percent === null ? undefined : { width: `${percent}%` }}
              />
            </div>
          </div>
        )}

        {status === "restarting" && (
          <div className="flex items-center gap-2 rounded-lg border border-line bg-panel-2/40 px-3.5 py-3 text-[11.5px] text-muted">
            <Loader2 size={13} className="animate-spin text-accent" />
            Update installed. Restarting NodusForge…
          </div>
        )}

        {error && (
          <div className="rounded-md border border-danger/25 bg-danger/10 px-3.5 py-2.5 text-[11.5px] leading-relaxed text-danger">
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}
