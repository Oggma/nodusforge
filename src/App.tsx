import { useEffect, useState } from "react";
import {
  AlertTriangle,
  FolderOpen,
  LayoutGrid,
  Plus,
  RefreshCw,
} from "lucide-react";

import { ipc } from "./lib/ipc";
import { useAppStore } from "./store/useAppStore";
import { Sidebar } from "./components/Sidebar";
import { AppHeader, type Tab } from "./components/AppHeader";
import { LogView } from "./components/LogView";
import { DetailsTab } from "./components/DetailsTab";
import { ConfigTab } from "./components/ConfigTab";
import { AddAppWizard } from "./components/AddAppWizard";
import { SettingsDialog } from "./components/SettingsDialog";
import { UpdateDialog } from "./components/UpdateDialog";
import { ToastHost } from "./components/ToastHost";
import { Button } from "./components/ui";
import { useUpdateStore } from "./store/useUpdateStore";

export default function App() {
  const init = useAppStore((state) => state.init);
  const ready = useAppStore((state) => state.ready);
  const apps = useAppStore((state) => state.apps);
  const selectedId = useAppStore((state) => state.selectedId);
  const configPath = useAppStore((state) => state.configPath);
  const configError = useAppStore((state) => state.configError);
  const configDirty = useAppStore((state) => state.configDirty);
  const warnings = useAppStore((state) => state.warnings);
  const reload = useAppStore((state) => state.reload);
  const setWizardOpen = useAppStore((state) => state.setWizardOpen);
  const setSettingsOpen = useAppStore((state) => state.setSettingsOpen);
  const settingsOpen = useAppStore((state) => state.settingsOpen);
  const autoCheckUpdates = useAppStore(
    (state) => state.settings.autoCheckUpdates,
  );
  const checkForUpdates = useUpdateStore((state) => state.check);
  const pushToast = useAppStore((state) => state.pushToast);

  const [tab, setTab] = useState<Tab>("logs");

  const app = selectedId ? apps[selectedId] : undefined;

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href || !/^https?:\/\//i.test(href)) return;
      event.preventDefault();
      void ipc
        .openExternal(href)
        .catch((error) =>
          pushToast("error", "Could not open link", String(error)),
        );
    };

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [pushToast]);

  useEffect(() => {
    if (!ready || !autoCheckUpdates || import.meta.env.DEV) return;
    const timeout = window.setTimeout(
      () => void checkForUpdates(false),
      5_000,
    );
    const interval = window.setInterval(
      () => void checkForUpdates(false),
      24 * 60 * 60 * 1000,
    );
    return () => {
      window.clearTimeout(timeout);
      window.clearInterval(interval);
    };
  }, [ready, autoCheckUpdates, checkForUpdates]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const state = useAppStore.getState();
      const key = event.key.toLowerCase();

      if (key === "k") {
        event.preventDefault();
        document.getElementById("nodusforge-search")?.focus();
        return;
      }

      const id = state.selectedId;
      if (!id) return;
      const current = state.apps[id];
      if (!current) return;

      const target = event.target as HTMLElement | null;
      const editing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT");

      if (key === "enter" && !editing) {
        event.preventDefault();
        if (
          current.state === "running" ||
          current.state === "starting" ||
          current.state === "stopping"
        ) {
          void state.stop(id);
        } else {
          void state.start(id);
        }
      } else if (key === "r" && event.shiftKey) {
        event.preventDefault();
        void state.restart(id);
      } else if (key === "l" && event.shiftKey) {
        event.preventDefault();
        void state.clearLogs(id);
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const openConfig = async () => {
    try {
      await ipc.openConfig();
    } catch (error) {
      pushToast("error", "Could not open config", String(error));
    }
  };

  if (!ready) {
    return (
      <div className="grid h-screen place-items-center bg-canvas">
        <div className="flex items-center gap-3">
          <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
          <span className="text-[13px] text-muted">Loading NodusForge…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-canvas text-ink">
      <Sidebar
        onAddApp={() => setWizardOpen(true)}
        onSettings={() => setSettingsOpen(true)}
      />

      <main className="flex min-w-0 flex-1 flex-col">
        {configError && (
          <div className="flex shrink-0 items-center gap-2 border-b border-danger/25 bg-danger/10 px-4 py-2">
            <AlertTriangle size={13} className="shrink-0 text-danger" />
            <span className="min-w-0 flex-1 truncate text-[11.5px] text-danger" title={configError}>
              Config error: {configError}
            </span>
            <Button size="sm" variant="ghost" onClick={() => void reload()}>
              <RefreshCw size={11} /> Retry
            </Button>
          </div>
        )}

        {configDirty && (
          <div className="flex shrink-0 items-center gap-2 border-b border-amber/25 bg-amber/10 px-4 py-2">
            <RefreshCw size={12} className="shrink-0 text-amber" />
            <span className="min-w-0 flex-1 truncate text-[11.5px] text-amber">
              The config file changed on disk.
            </span>
            <Button size="sm" variant="ghost" onClick={() => void reload()}>
              Reload
            </Button>
            <button
              onClick={() => useAppStore.setState({ configDirty: false })}
              className="text-[11px] text-muted hover:text-ink"
            >
              Dismiss
            </button>
          </div>
        )}

        {warnings.length > 0 && (
          <div
            className="flex shrink-0 items-center gap-2 border-b border-line bg-panel-2/40 px-4 py-1.5"
            title={warnings.join("\n")}
          >
            <AlertTriangle size={11} className="shrink-0 text-amber/80" />
            <span className="truncate text-[10.5px] text-muted">
              {warnings.length} config warning{warnings.length === 1 ? "" : "s"}:{" "}
              {warnings[0]}
            </span>
          </div>
        )}

        {app ? (
          <>
            <AppHeader app={app} tab={tab} onTab={setTab} />
            <div className="min-h-0 flex-1">
              {tab === "logs" && <LogView key={app.id} appId={app.id} />}
              {tab === "details" && <DetailsTab app={app} />}
              {tab === "config" && <ConfigTab appId={app.id} />}
            </div>
          </>
        ) : (
          <div className="grid min-h-0 flex-1 place-items-center p-10">
            <div className="max-w-md text-center">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-line bg-panel">
                <LayoutGrid size={22} className="text-muted" />
              </div>
              <h2 className="mt-4 text-[17px] font-semibold tracking-tight">
                {Object.keys(apps).length === 0
                  ? "No apps configured"
                  : "Select an app"}
              </h2>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">
                {Object.keys(apps).length === 0
                  ? "Add a .NET or Vite project and NodusForge will run it, watch its port and stream the logs. You can also write the YAML by hand."
                  : "Pick an app from the sidebar to see its status and logs."}
              </p>

              <div className="mt-5 flex items-center justify-center gap-2">
                <Button
                  variant="primary"
                  onClick={() => setWizardOpen(true)}
                >
                  <Plus size={13} /> Add app
                </Button>
                <Button variant="secondary" onClick={() => void openConfig()}>
                  <FolderOpen size={13} /> Open config
                </Button>
              </div>

              <p
                className="mt-4 truncate font-mono text-[10px] text-muted/70"
                title={configPath}
              >
                {configPath}
              </p>
            </div>
          </div>
        )}
      </main>

      <AddAppWizard />
      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
      <UpdateDialog />
      <ToastHost />
    </div>
  );
}
