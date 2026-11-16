import { useEffect, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";

import { ipc } from "../lib/ipc";
import { useAppStore } from "../store/useAppStore";
import type { Settings } from "../lib/types";
import { Button, Field, Modal, Toggle, inputClass } from "./ui";

export function SettingsDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const settings = useAppStore((state) => state.settings);
  const configPath = useAppStore((state) => state.configPath);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const pushToast = useAppStore((state) => state.pushToast);

  const [form, setForm] = useState<Settings>(settings);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(settings);
      setError(null);
    }
  }, [open, settings]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await updateSettings({
        ...form,
        logBufferLines: Math.max(
          200,
          Math.min(200_000, Number(form.logBufferLines) || 5000),
        ),
      });
    } catch (reason) {
      setError(String(reason));
    } finally {
      setSaving(false);
    }
  };

  const openConfig = async () => {
    try {
      await ipc.openConfig();
    } catch (reason) {
      pushToast("error", "Could not open config", String(reason));
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Settings"
      subtitle="Preferences are stored in the same YAML file as your apps."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={saving}>
            {saving && <Loader2 size={12} className="animate-spin" />}
            Save changes
          </Button>
        </>
      }
    >
      <div className="space-y-2.5">
        <Toggle
          checked={form.closeToTray}
          onChange={(value) => setForm({ ...form, closeToTray: value })}
          label="Close to tray"
          description="Closing the window keeps apps running. Quit from the tray menu to stop them."
        />
        <Toggle
          checked={form.autostart}
          onChange={(value) => setForm({ ...form, autostart: value })}
          label="Start NodusForge on login"
          description="Launches minimized to the tray, apps with autoStart are started."
        />
        <Toggle
          checked={form.persistLogs}
          onChange={(value) => setForm({ ...form, persistLogs: value })}
          label="Persist logs to disk"
          description="Writes each app's output to ~/.local/state/nodusforge/logs, rotated at 10 MB."
        />

        <Field
          label="Log buffer"
          hint="lines kept in memory per app (200–200000)"
        >
          <input
            type="number"
            min={200}
            max={200000}
            step={100}
            value={form.logBufferLines}
            onChange={(event) =>
              setForm({
                ...form,
                logBufferLines: Number(event.target.value),
              })
            }
            className={inputClass}
          />
        </Field>

        <div className="rounded-lg border border-line bg-panel-2/40 px-3.5 py-3">
          <div className="text-[10.5px] font-medium uppercase tracking-[0.1em] text-muted">
            Config file
          </div>
          <div className="mt-1 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink/85">
              {configPath}
            </code>
            <Button size="sm" variant="ghost" onClick={() => void openConfig()}>
              <ExternalLink size={12} /> Open
            </Button>
          </div>
        </div>

        {error && (
          <p className="rounded-md border border-danger/25 bg-danger/10 px-3 py-2 text-[11.5px] text-danger">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
