import { useEffect, useState } from "react";
import { ExternalLink, RotateCw } from "lucide-react";

import { ipc } from "../lib/ipc";
import { useAppStore } from "../store/useAppStore";
import { CopyButton } from "./CopyButton";
import { Button } from "./ui";

export function ConfigTab({ appId }: { appId: string }) {
  const configPath = useAppStore((state) => state.configPath);
  const pushToast = useAppStore((state) => state.pushToast);
  const reload = useAppStore((state) => state.reload);

  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setError(null);
    ipc
      .getAppConfig(appId)
      .then((value) => {
        if (active) setText(value);
      })
      .catch((reason) => {
        if (active) setError(String(reason));
      });
    return () => {
      active = false;
    };
  }, [appId]);

  const openConfig = async () => {
    try {
      await ipc.openConfig();
    } catch (reason) {
      pushToast("error", "Could not open config", String(reason));
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-line-soft bg-panel/50 px-3 py-1.5">
        <span className="truncate font-mono text-[10.5px] text-muted" title={configPath}>
          {configPath}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <CopyButton text={text} title="Copy YAML" />
          <Button size="sm" variant="ghost" onClick={() => void openConfig()}>
            <ExternalLink size={12} /> Open config
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void reload()}>
            <RotateCw size={12} /> Reload
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
        <div className="mb-2 text-[11px] text-muted">
          Effective entry for this app. Editing is done in the YAML file; saving
          from the wizard reformats the file and drops comments.
        </div>
        {error ? (
          <p className="text-[12px] text-danger">{error}</p>
        ) : (
          <pre className="rounded-lg border border-line bg-canvas p-3 font-mono text-[11.5px] leading-relaxed text-ink/90">
            {text || "Loading…"}
          </pre>
        )}
      </div>
    </div>
  );
}
