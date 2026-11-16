import { create } from "zustand";

import { ipc } from "../lib/ipc";
import type { ContainerInfo } from "../lib/types";
import { useAppStore } from "./useAppStore";

export interface ContainerToolStatus {
  installed: boolean;
  daemonReachable: boolean;
  version: string | null;
  error: string | null;
}

interface ContainerStore {
  containers: ContainerInfo[];
  selectedId: string | null;
  status: ContainerToolStatus;
  loaded: boolean;
  refreshing: boolean;
  busy: Record<string, boolean>;

  refresh: () => Promise<void>;
  select: (id: string | null) => void;
  start: (id: string) => Promise<void>;
  stop: (id: string) => Promise<void>;
}

const EMPTY_STATUS: ContainerToolStatus = {
  installed: false,
  daemonReachable: false,
  version: null,
  error: null,
};

function sortContainers(containers: ContainerInfo[]): ContainerInfo[] {
  return [...containers].sort((left, right) => {
    const leftRunning = left.state.toLowerCase() === "running" ? 0 : 1;
    const rightRunning = right.state.toLowerCase() === "running" ? 0 : 1;
    if (leftRunning !== rightRunning) return leftRunning - rightRunning;
    return left.name.localeCompare(right.name);
  });
}

export const useContainerStore = create<ContainerStore>((set, get) => ({
  containers: [],
  selectedId: null,
  status: EMPTY_STATUS,
  loaded: false,
  refreshing: false,
  busy: {},

  refresh: async () => {
    if (get().refreshing) return;
    set({ refreshing: true });

    try {
      const result = await ipc.containers();
      const containers = sortContainers(result.containers);
      set((state) => ({
        containers,
        selectedId:
          state.selectedId &&
          containers.some((container) => container.id === state.selectedId)
            ? state.selectedId
            : (containers[0]?.id ?? null),
        status: {
          installed: result.installed,
          daemonReachable: result.daemonReachable,
          version: result.version ?? null,
          error: result.error ?? null,
        },
        loaded: true,
        refreshing: false,
      }));
    } catch (error) {
      set((state) => ({
        status: {
          ...state.status,
          daemonReachable: false,
          error: String(error),
        },
        loaded: true,
        refreshing: false,
      }));
    }
  },

  select: (id) => set({ selectedId: id }),

  start: async (id) => {
    if (get().busy[id]) return;
    set((state) => ({ busy: { ...state.busy, [id]: true } }));
    try {
      await ipc.startContainer(id);
    } catch (error) {
      useAppStore
        .getState()
        .pushToast("error", "Start container failed", String(error));
    } finally {
      set((state) => ({ busy: { ...state.busy, [id]: false } }));
      await get().refresh();
    }
  },

  stop: async (id) => {
    if (get().busy[id]) return;
    set((state) => ({ busy: { ...state.busy, [id]: true } }));
    try {
      await ipc.stopContainer(id);
    } catch (error) {
      useAppStore
        .getState()
        .pushToast("error", "Stop container failed", String(error));
    } finally {
      set((state) => ({ busy: { ...state.busy, [id]: false } }));
      await get().refresh();
    }
  },
}));
