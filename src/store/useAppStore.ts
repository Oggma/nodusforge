import { create } from "zustand";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { ipc } from "../lib/ipc";
import type {
  AppDraft,
  AppView,
  Group,
  LogBatch,
  Settings,
  Snapshot,
  StatusEvent,
  ToastEvent,
} from "../lib/types";

export type ToastLevel = "error" | "warning" | "info";

export interface ToastItem {
  id: number;
  level: ToastLevel;
  title: string;
  message: string;
}

const DEFAULT_SETTINGS: Settings = {
  closeToTray: true,
  autostart: false,
  logBufferLines: 5000,
  persistLogs: true,
  theme: "dark",
};

interface AppStore {
  initializing: boolean;
  ready: boolean;
  apps: Record<string, AppView>;
  order: string[];
  groups: Group[];
  settings: Settings;
  configPath: string;
  configError: string | null;
  warnings: string[];
  selectedId: string | null;
  logs: Record<string, string[]>;
  toasts: ToastItem[];
  configDirty: boolean;
  busy: Record<string, boolean>;
  wizardOpen: boolean;
  settingsOpen: boolean;

  init: () => Promise<void>;
  select: (id: string) => void;
  start: (id: string) => Promise<void>;
  stop: (id: string) => Promise<void>;
  restart: (id: string) => Promise<void>;
  startAll: () => Promise<void>;
  stopAll: () => Promise<void>;
  startGroup: (groupId: string) => Promise<void>;
  clearLogs: (id: string) => Promise<void>;
  ensureLogs: (id: string) => Promise<void>;
  reload: () => Promise<void>;
  saveApp: (draft: AppDraft) => Promise<string>;
  updateSettings: (settings: Settings) => Promise<void>;
  pushToast: (level: ToastLevel, title: string, message: string) => void;
  dismissToast: (id: number) => void;
  setWizardOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
}

let unlisteners: UnlistenFn[] = [];
let initStarted = false;
let toastSeq = 0;
let ignoreConfigUntil = 0;

function applySnapshot(
  set: (partial: Partial<AppStore>) => void,
  snapshot: Snapshot,
  keepSelected: string | null,
) {
  const apps: Record<string, AppView> = {};
  for (const app of snapshot.apps) {
    apps[app.id] = app;
  }

  const selectedId =
    keepSelected && apps[keepSelected]
      ? keepSelected
      : (snapshot.apps[0]?.id ?? null);

  set({
    apps,
    order: snapshot.apps.map((app) => app.id),
    groups: snapshot.groups,
    settings: snapshot.settings,
    configPath: snapshot.configPath,
    configError: snapshot.configError ?? null,
    warnings: snapshot.warnings,
    selectedId,
  });
}

export const useAppStore = create<AppStore>((set, get) => ({
  initializing: false,
  ready: false,
  apps: {},
  order: [],
  groups: [],
  settings: DEFAULT_SETTINGS,
  configPath: "",
  configError: null,
  warnings: [],
  selectedId: null,
  logs: {},
  toasts: [],
  configDirty: false,
  busy: {},
  wizardOpen: false,
  settingsOpen: false,

  init: async () => {
    if (initStarted) return;
    initStarted = true;
    ignoreConfigUntil = Date.now() + 3000;
    set({ initializing: true });

    try {
      const snapshot = await ipc.snapshot();
      applySnapshot(set, snapshot, get().selectedId);

      unlisteners.push(
        await listen<StatusEvent>("nodusforge://status", (event) => {
          const payload = event.payload;
          set((state) => {
            const current = state.apps[payload.id];
            if (!current) return {};
            const updated: AppView = { ...current, ...payload };
            let toasts = state.toasts;
            if (payload.state === "failed" && current.state !== "failed") {
              toasts = [
                ...state.toasts,
                {
                  id: ++toastSeq,
                  level: "error",
                  title: `${current.name} failed`,
                  message: payload.message ?? "The app did not start.",
                },
              ];
            }
            return {
              apps: { ...state.apps, [payload.id]: updated },
              toasts,
            };
          });
        }),
      );

      unlisteners.push(
        await listen<LogBatch>("nodusforge://log-batch", (event) => {
          const { id, lines } = event.payload;
          set((state) => {
            const current = state.logs[id];
            if (current === undefined) return {};
            const limit = state.settings.logBufferLines || 5000;
            const merged = current.concat(lines);
            return {
              logs: {
                ...state.logs,
                [id]:
                  merged.length > limit
                    ? merged.slice(merged.length - limit)
                    : merged,
              },
            };
          });
        }),
      );

      unlisteners.push(
        await listen<ToastEvent>("nodusforge://toast", (event) => {
          const { level, title, message } = event.payload;
          set((state) => ({
            toasts: [
              ...state.toasts,
              { id: ++toastSeq, level: level as ToastLevel, title, message },
            ],
          }));
        }),
      );

      unlisteners.push(
        await listen<Snapshot>("nodusforge://snapshot", (event) => {
          applySnapshot(set, event.payload, get().selectedId);
          set({ configDirty: false });
        }),
      );

      unlisteners.push(
        await listen("nodusforge://config-changed", () => {
          if (Date.now() >= ignoreConfigUntil) {
            set({ configDirty: true });
          }
        }),
      );
    } catch (error) {
      set({ configError: String(error) });
    } finally {
      set({ initializing: false, ready: true });
    }
  },

  select: (id) => set({ selectedId: id }),

  start: async (id) => {
    if (get().busy[id]) return;
    set((state) => ({ busy: { ...state.busy, [id]: true } }));
    try {
      await ipc.start(id);
    } catch (error) {
      get().pushToast("error", "Start failed", String(error));
    } finally {
      set((state) => ({ busy: { ...state.busy, [id]: false } }));
    }
  },

  stop: async (id) => {
    if (get().busy[id]) return;
    set((state) => ({ busy: { ...state.busy, [id]: true } }));
    try {
      await ipc.stop(id);
    } catch (error) {
      get().pushToast("error", "Stop failed", String(error));
    } finally {
      set((state) => ({ busy: { ...state.busy, [id]: false } }));
    }
  },

  restart: async (id) => {
    if (get().busy[id]) return;
    set((state) => ({ busy: { ...state.busy, [id]: true } }));
    try {
      await ipc.restart(id);
    } catch (error) {
      get().pushToast("error", "Restart failed", String(error));
    } finally {
      set((state) => ({ busy: { ...state.busy, [id]: false } }));
    }
  },

  startAll: async () => {
    if (get().busy.__all) return;
    set((state) => ({ busy: { ...state.busy, __all: true } }));
    try {
      await ipc.startAll();
    } catch (error) {
      get().pushToast("error", "Start all failed", String(error));
    } finally {
      set((state) => ({ busy: { ...state.busy, __all: false } }));
    }
  },

  stopAll: async () => {
    if (get().busy.__all) return;
    set((state) => ({ busy: { ...state.busy, __all: true } }));
    try {
      await ipc.stopAll();
    } catch (error) {
      get().pushToast("error", "Stop all failed", String(error));
    } finally {
      set((state) => ({ busy: { ...state.busy, __all: false } }));
    }
  },

  startGroup: async (groupId) => {
    const key = `group:${groupId}`;
    if (get().busy[key]) return;
    set((state) => ({ busy: { ...state.busy, [key]: true } }));
    try {
      await ipc.startGroup(groupId);
    } catch (error) {
      get().pushToast("error", "Start group failed", String(error));
    } finally {
      set((state) => ({ busy: { ...state.busy, [key]: false } }));
    }
  },

  clearLogs: async (id) => {
    try {
      await ipc.clearLogs(id);
    } catch (error) {
      get().pushToast("error", "Could not clear logs", String(error));
    }
    set((state) => ({ logs: { ...state.logs, [id]: [] } }));
  },

  ensureLogs: async (id) => {
    if (get().logs[id] !== undefined) return;
    set((state) => ({ logs: { ...state.logs, [id]: [] } }));

    try {
      const history = await ipc.getLogs(id);
      set((state) => {
        const current = state.logs[id] ?? [];
        let prefix = history;
        if (current.length > 0) {
          const first = current[0];
          const index = history.lastIndexOf(first);
          if (index >= 0) prefix = history.slice(0, index);
        }
        const limit = state.settings.logBufferLines || 5000;
        const merged = prefix.concat(current);
        return {
          logs: {
            ...state.logs,
            [id]: merged.length > limit ? merged.slice(-limit) : merged,
          },
        };
      });
    } catch {
      // The empty buffer stays; live lines will fill it.
    }
  },

  reload: async () => {
    try {
      const snapshot = await ipc.reload();
      applySnapshot(set, snapshot, get().selectedId);
      set({ configDirty: false });
      get().pushToast("info", "Config reloaded", "Configuration is up to date.");
    } catch (error) {
      set({ configError: String(error) });
      get().pushToast("error", "Config reload failed", String(error));
    }
  },

  saveApp: async (draft) => {
    ignoreConfigUntil = Date.now() + 5000;
    const snapshot = await ipc.saveApp(draft);
    ignoreConfigUntil = Date.now() + 2000;
    applySnapshot(set, snapshot, draft.id);
    set({ wizardOpen: false, configDirty: false });
    get().pushToast(
      "info",
      "App added",
      `${draft.name || draft.id} was written to ${snapshot.configPath}.`,
    );
    return draft.id;
  },

  updateSettings: async (settings) => {
    ignoreConfigUntil = Date.now() + 5000;
    const snapshot = await ipc.updateSettings(settings);
    ignoreConfigUntil = Date.now() + 2000;
    applySnapshot(set, snapshot, get().selectedId);
    set({ settingsOpen: false, configDirty: false });
    get().pushToast("info", "Settings saved", "Preferences updated.");
  },

  pushToast: (level, title, message) => {
    set((state) => ({
      toasts: [
        ...state.toasts.slice(-4),
        { id: ++toastSeq, level, title, message },
      ],
    }));
  },

  dismissToast: (id) => {
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
  },

  setWizardOpen: (open) => set({ wizardOpen: open }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
}));

export function disposeStoreListeners() {
  for (const unlisten of unlisteners) {
    unlisten();
  }
  unlisteners = [];
}
