import { create } from "zustand";
import { check as checkForUpdate } from "@tauri-apps/plugin-updater";
import type { Update } from "@tauri-apps/plugin-updater";

import { ipc } from "../lib/ipc";
import { useAppStore } from "./useAppStore";

export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "installing"
  | "restarting"
  | "error";

export interface UpdateInfo {
  version: string;
  currentVersion: string;
  date?: string;
  body?: string;
  releaseUrl: string;
}

interface UpdateStore {
  status: UpdateStatus;
  info: UpdateInfo | null;
  open: boolean;
  progress: { downloaded: number; total: number | null } | null;
  error: string | null;
  dismissedVersion: string | null;

  check: (manual?: boolean) => Promise<void>;
  install: () => Promise<void>;
  dismiss: () => Promise<void>;
  openRelease: () => Promise<void>;
  openSettingsForUpdates: () => void;
}

let activeUpdate: Update | null = null;

function releaseUrl(version: string, rawJson: Record<string, unknown>): string {
  const fromManifest = rawJson.release_url;
  if (typeof fromManifest === "string" && fromManifest.length > 0) {
    return fromManifest;
  }
  return `https://github.com/Oggma/nodusforge/releases/tag/v${version}`;
}

export const useUpdateStore = create<UpdateStore>((set, get) => ({
  status: "idle",
  info: null,
  open: false,
  progress: null,
  error: null,
  dismissedVersion: null,

  check: async (manual = false) => {
    const status = get().status;
    if (
      status === "checking" ||
      status === "downloading" ||
      status === "installing" ||
      status === "restarting"
    ) {
      return;
    }

    if (get().info && get().status === "available") {
      if (manual) set({ open: true });
      return;
    }

    if (import.meta.env.DEV) {
      if (manual) {
        useAppStore
          .getState()
          .pushToast(
            "info",
            "Updates",
            "Update checks are available in installed builds.",
          );
      }
      return;
    }

    if (activeUpdate) {
      await activeUpdate.close().catch(() => {});
      activeUpdate = null;
    }

    set({ status: "checking", error: null });
    try {
      const update = await checkForUpdate();
      if (!update) {
        set({ status: "idle", open: false, info: null, progress: null });
        if (manual) {
          useAppStore
            .getState()
            .pushToast("info", "Updates", "NodusForge is up to date.");
        }
        return;
      }

      activeUpdate = update;
      const appState = useAppStore.getState();
      if (!manual && !appState.settings.autoCheckUpdates) {
        await update.close().catch(() => {});
        if (activeUpdate === update) activeUpdate = null;
        set({ status: "idle", open: false, info: null });
        return;
      }

      if (!manual && get().dismissedVersion === update.version) {
        await update.close().catch(() => {});
        if (activeUpdate === update) activeUpdate = null;
        set({ status: "idle", open: false, info: null });
        return;
      }

      set({
        status: "available",
        info: {
          version: update.version,
          currentVersion: update.currentVersion,
          date: update.date,
          body: update.body,
          releaseUrl: releaseUrl(update.version, update.rawJson),
        },
        open: true,
        progress: null,
        error: null,
      });
    } catch (error) {
      const message = String(error);
      if (manual) {
        set({ status: "error", error: message, open: false });
        useAppStore
          .getState()
          .pushToast("error", "Update check failed", message);
      } else {
        set({ status: "idle", error: null, open: false });
      }
    }
  },

  install: async () => {
    const update = activeUpdate;
    if (!update) return;

    set({
      status: "downloading",
      open: true,
      error: null,
      progress: { downloaded: 0, total: null },
    });

    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          set({
            progress: {
              downloaded: 0,
              total: event.data.contentLength ?? null,
            },
          });
        } else if (event.event === "Progress") {
          set((state) => ({
            progress: {
              downloaded:
                (state.progress?.downloaded ?? 0) + event.data.chunkLength,
              total: state.progress?.total ?? null,
            },
          }));
        } else if (event.event === "Finished") {
          set((state) => ({
            status: "installing",
            progress: {
              downloaded: state.progress?.downloaded ?? 0,
              total: state.progress?.total ?? null,
            },
          }));
        }
      });

      activeUpdate = null;
      set({ status: "restarting" });
      await ipc.relaunch();
    } catch (error) {
      set({ status: "error", error: String(error) });
    }
  },

  dismiss: async () => {
    const update = activeUpdate;
    const version = get().info?.version;
    activeUpdate = null;
    set((state) => ({
      open: false,
      status: "idle",
      info: null,
      progress: null,
      error: null,
      dismissedVersion: version ?? state.dismissedVersion,
    }));
    if (update) {
      await update.close().catch(() => {});
    }
  },

  openRelease: async () => {
    const url = get().info?.releaseUrl;
    if (!url) return;
    try {
      await ipc.openExternal(url);
    } catch (error) {
      useAppStore
        .getState()
        .pushToast("error", "Could not open release", String(error));
    }
  },

  openSettingsForUpdates: () => {
    const update = activeUpdate;
    const version = get().info?.version;
    activeUpdate = null;
    set((state) => ({
      open: false,
      status: "idle",
      info: null,
      progress: null,
      error: null,
      dismissedVersion: version ?? state.dismissedVersion,
    }));
    if (update) {
      void update.close().catch(() => {});
    }
    const app = useAppStore.getState();
    app.setSettingsOpen(true);
    app.setSettingsFocus("updates");
  },
}));
