import { invoke } from "@tauri-apps/api/core";
import type {
  AppDraft,
  ContainersResult,
  DetectResult,
  GitRepoStatus,
  Settings,
  Snapshot,
  ToolsStatus,
} from "./types";

export const ipc = {
  snapshot: () => invoke<Snapshot>("get_snapshot"),
  reload: () => invoke<Snapshot>("reload_config"),

  start: (id: string) => invoke<void>("start_app", { id }),
  stop: (id: string) => invoke<void>("stop_app", { id }),
  restart: (id: string) => invoke<void>("restart_app", { id }),

  startGroup: (groupId: string) => invoke<void>("start_group", { groupId }),
  startAll: () => invoke<void>("start_all"),
  stopAll: () => invoke<void>("stop_all"),

  getLogs: (id: string, tailLines = 5000) =>
    invoke<string[]>("get_logs", { id, tailLines }),
  clearLogs: (id: string) => invoke<void>("clear_logs", { id }),

  getAppConfig: (id: string) => invoke<string>("get_app_config", { id }),
  openExternal: (url: string) => invoke<void>("open_external", { url }),
  openFolder: (id: string) => invoke<void>("open_folder", { id }),
  openConfig: () => invoke<void>("open_config_file"),
  relaunch: () => invoke<void>("relaunch_app"),

  toolsStatus: () => invoke<ToolsStatus>("get_tools_status"),
  gitStatus: (id: string) => invoke<GitRepoStatus>("get_git_status", { id }),
  switchGitBranch: (id: string, branch: string) =>
    invoke<GitRepoStatus>("switch_git_branch", { id, branch }),

  containers: () => invoke<ContainersResult>("list_containers"),
  startContainer: (id: string) =>
    invoke<void>("start_container", { id }),
  stopContainer: (id: string) => invoke<void>("stop_container", { id }),

  detect: (path: string) => invoke<DetectResult>("detect_app_folder", { path }),
  saveApp: (draft: AppDraft) => invoke<Snapshot>("save_app", { draft }),
  updateSettings: (settings: Settings) =>
    invoke<Snapshot>("update_settings", { settings }),
};
