import { useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Check,
  FolderSearch,
  Loader2,
  ScanSearch,
  Sparkles,
  Terminal,
} from "lucide-react";

import { ipc } from "../lib/ipc";
import { cn } from "../lib/format";
import type { AppDraft, DetectedApp, DetectResult } from "../lib/types";
import { useAppStore } from "../store/useAppStore";
import { Button, Field, Modal, inputClass } from "./ui";

interface FormState {
  cwd: string;
  id: string;
  name: string;
  command: string;
  port: string;
  url: string;
  group: string;
  dependsOn: string[];
  timeoutMs: number;
}

const emptyForm = (cwd = ""): FormState => ({
  cwd,
  id: "",
  name: "",
  command: "",
  port: "",
  url: "",
  group: "",
  dependsOn: [],
  timeoutMs: 90_000,
});

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "app"
  );
}

function uniqueId(base: string, apps: Record<string, unknown>): string {
  if (!apps[base]) return base;
  let index = 2;
  while (apps[`${base}-${index}`]) index += 1;
  return `${base}-${index}`;
}

export function AddAppWizard() {
  const openWizard = useAppStore((state) => state.wizardOpen);
  const setWizardOpen = useAppStore((state) => state.setWizardOpen);
  const groups = useAppStore((state) => state.groups);
  const apps = useAppStore((state) => state.apps);
  const saveApp = useAppStore((state) => state.saveApp);
  const start = useAppStore((state) => state.start);

  const [step, setStep] = useState<"pick" | "configure">("pick");
  const [path, setPath] = useState("");
  const [detecting, setDetecting] = useState(false);
  const [result, setResult] = useState<DetectResult | null>(null);
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [manual, setManual] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [startAfter, setStartAfter] = useState(true);

  const candidate: DetectedApp | undefined = useMemo(
    () => result?.candidates[candidateIndex],
    [result, candidateIndex],
  );

  useEffect(() => {
    if (!openWizard) {
      setStep("pick");
      setPath("");
      setResult(null);
      setManual(false);
      setError(null);
      setCandidateIndex(0);
      setForm(emptyForm());
      setSaving(false);
    }
  }, [openWizard]);

  const close = () => setWizardOpen(false);

  const applyCandidate = (detected: DetectedApp) => {
    const id = uniqueId(slug(detected.name), apps);
    const port = detected.health.port ? String(detected.health.port) : "";
    setForm({
      cwd: detected.cwd,
      id,
      name: detected.name,
      command: detected.command,
      port,
      url:
        detected.url ??
        (detected.health.port
          ? `http://localhost:${detected.health.port}`
          : ""),
      group: groups[0]?.id ?? "",
      dependsOn: [],
      timeoutMs: detected.health.timeoutMs || 90_000,
    });
  };

  const browse = async () => {
    setError(null);
    try {
      const picked = await open({
        directory: true,
        multiple: false,
        title: "Select the app folder",
      });
      if (typeof picked === "string") {
        setPath(picked);
        setResult(null);
      }
    } catch (reason) {
      setError(String(reason));
    }
  };

  const detect = async () => {
    if (!path.trim()) {
      setError("Choose a project folder first.");
      return;
    }
    setDetecting(true);
    setError(null);
    setResult(null);
    try {
      const detected = await ipc.detect(path.trim());
      setResult(detected);
      if (detected.candidates.length > 0) {
        setCandidateIndex(0);
        applyCandidate(detected.candidates[0]);
        setManual(false);
        setStep("configure");
      } else {
        setManual(true);
        setForm({
          ...emptyForm(detected.root),
          id: uniqueId("my-app", apps),
          name: "My app",
        });
        setStep("configure");
      }
    } catch (reason) {
      setError(String(reason));
    } finally {
      setDetecting(false);
    }
  };

  const startManual = () => {
    setManual(true);
    setForm({
      ...emptyForm(result?.root ?? path),
      id: uniqueId("my-app", apps),
      name: "My app",
    });
    setStep("configure");
  };

  const selectCandidate = (index: number) => {
    setCandidateIndex(index);
    const detected = result?.candidates[index];
    if (detected) {
      applyCandidate(detected);
      setManual(false);
    }
  };

  const save = async () => {
    const id = form.id.trim();
    const command = form.command.trim();
    const portText = form.port.trim();
    const port = portText ? Number(portText) : null;

    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
      setError("Id may only contain letters, digits, '-' and '_'.");
      return;
    }
    if (!form.cwd.trim()) {
      setError("Working directory is required.");
      return;
    }
    if (!command) {
      setError("Command is required.");
      return;
    }
    if (
      port !== null &&
      (!Number.isInteger(port) || port < 1 || port > 65535)
    ) {
      setError("Port must be a number between 1 and 65535.");
      return;
    }

    const url = form.url.trim() || (port !== null ? `http://localhost:${port}` : null);

    const draft: AppDraft = {
      id,
      name: form.name.trim() || id,
      group: form.group || null,
      cwd: form.cwd.trim(),
      command,
      url,
      health:
        port !== null
          ? { type: "tcp", port, timeoutMs: form.timeoutMs }
          : { type: "none", timeoutMs: 60_000 },
      dependsOn: form.dependsOn,
      autoStart: false,
      stopSignal: "SIGTERM",
      stopTimeoutMs: 10_000,
      showInTray: true,
    };

    setSaving(true);
    setError(null);
    try {
      await saveApp(draft);
      if (startAfter) {
        void start(id);
      }
    } catch (reason) {
      setError(String(reason));
    } finally {
      setSaving(false);
    }
  };

  const toggleDependency = (id: string) => {
    setForm((current) => ({
      ...current,
      dependsOn: current.dependsOn.includes(id)
        ? current.dependsOn.filter((value) => value !== id)
        : [...current.dependsOn, id],
    }));
  };

  const otherApps = Object.values(apps).filter((app) => app.id !== form.id);

  return (
    <Modal
      open={openWizard}
      onClose={close}
      title="Add app"
      subtitle={
        step === "pick"
          ? "Point NodusForge at a project folder; it will figure out how to run it."
          : "Review what will be written to your config."
      }
      width="max-w-3xl"
      footer={
        step === "pick" ? (
          <>
            <Button variant="ghost" onClick={close} disabled={detecting}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => void detect()}
              disabled={detecting || !path.trim()}
            >
              {detecting ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <ScanSearch size={13} />
              )}
              Detect app
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="ghost"
              onClick={() => setStep("pick")}
              disabled={saving}
            >
              Back
            </Button>
            <Button
              variant="primary"
              onClick={() => void save()}
              disabled={saving}
            >
              {saving && <Loader2 size={12} className="animate-spin" />}
              Add app
            </Button>
          </>
        )
      }
    >
      {step === "pick" ? (
        <div className="space-y-4">
          <Field label="Project folder" hint="a repo or a subfolder">
            <div className="flex gap-1.5">
              <div className="relative min-w-0 flex-1">
                <FolderSearch
                  size={14}
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
                />
                <input
                  autoFocus
                  value={path}
                  onChange={(event) => {
                    setPath(event.target.value);
                    setResult(null);
                  }}
                  placeholder="~/Projects/my-app"
                  className={cn(inputClass, "pl-8 font-mono")}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void detect();
                  }}
                />
              </div>
              <Button variant="secondary" onClick={() => void browse()}>
                Browse…
              </Button>
            </div>
          </Field>

          <div className="rounded-lg border border-line bg-panel-2/40 px-3.5 py-3 text-[11.5px] leading-relaxed text-muted">
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.1em] text-ink/70">
              <Sparkles size={12} className="text-accent" /> What gets detected
            </div>
            <ul className="space-y-1">
              <li>
                <span className="text-ink/80">.NET</span> — .sln/.csproj, with the
                first http port from <code className="font-mono">launchSettings.json</code>.
              </li>
              <li>
                <span className="text-ink/80">Vue / Vite</span> — package.json
                with vite, using npm/pnpm/yarn/bun based on the lockfile.
              </li>
              <li>
                Ports are optional; a TCP health check is added when one is found.
              </li>
            </ul>
          </div>

          <button
            onClick={startManual}
            className="text-[11.5px] text-muted underline decoration-line underline-offset-4 transition-colors hover:text-ink"
          >
            Skip detection and configure manually
          </button>

          {error && <ErrorBox message={error} />}
        </div>
      ) : (
        <div className="space-y-4">
          {result && result.candidates.length > 1 && (
            <div>
              <div className="mb-1.5 text-[10.5px] font-medium uppercase tracking-[0.1em] text-muted">
                Detected apps in this folder
              </div>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {result.candidates.map((detected, index) => (
                  <button
                    key={`${detected.kind}-${detected.cwd}`}
                    onClick={() => selectCandidate(index)}
                    className={cn(
                      "rounded-lg border px-3 py-2 text-left transition-colors",
                      index === candidateIndex && !manual
                        ? "border-accent/40 bg-accent/5"
                        : "border-line bg-panel-2/40 hover:border-line/80",
                    )}
                  >
                    <div className="flex items-center gap-1.5">
                      <Terminal size={11} className="text-accent" />
                      <span className="text-[12px] font-medium">
                        {detected.name}
                      </span>
                      <span className="ml-auto rounded border border-line px-1 font-mono text-[9px] uppercase text-muted">
                        {detected.kind}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[10px] text-muted">
                      {detected.command}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {manual && (
            <div className="rounded-md border border-amber/20 bg-amber/5 px-3 py-2 text-[11.5px] text-amber/90">
              No supported project was detected. Fill in the command manually —
              anything that runs in a shell works.
            </div>
          )}

          {result?.existingConfig && (
            <div className="rounded-md border border-info/20 bg-info/5 px-3 py-2 text-[11.5px] text-info/90">
              This folder already contains a nodusforge.yaml. Saving here adds the app to
              your main config instead of duplicating the file.
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name">
              <input
                value={form.name}
                onChange={(event) =>
                  setForm({ ...form, name: event.target.value })
                }
                className={inputClass}
                placeholder="Ground Control"
              />
            </Field>
            <Field label="Id" hint="used by dependsOn">
              <input
                value={form.id}
                onChange={(event) =>
                  setForm({ ...form, id: event.target.value })
                }
                className={cn(inputClass, "font-mono")}
                placeholder="ground-control"
              />
            </Field>
          </div>

          <Field label="Command">
            <input
              value={form.command}
              onChange={(event) =>
                setForm({ ...form, command: event.target.value })
              }
              className={cn(inputClass, "font-mono")}
              placeholder="dotnet run --project src/Api"
            />
          </Field>

          <Field label="Working directory">
            <input
              value={form.cwd}
              onChange={(event) =>
                setForm({ ...form, cwd: event.target.value })
              }
              className={cn(inputClass, "font-mono")}
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Port" hint="optional">
              <input
                value={form.port}
                onChange={(event) =>
                  setForm({ ...form, port: event.target.value })
                }
                className={cn(inputClass, "font-mono")}
                placeholder="auto"
                inputMode="numeric"
              />
            </Field>
            <Field label="Health timeout" hint="ms">
              <input
                type="number"
                min={1000}
                step={1000}
                value={form.timeoutMs}
                onChange={(event) =>
                  setForm({
                    ...form,
                    timeoutMs: Number(event.target.value),
                  })
                }
                className={cn(inputClass, "font-mono")}
              />
            </Field>
            <Field label="Group" hint="optional">
              <select
                value={form.group}
                onChange={(event) =>
                  setForm({ ...form, group: event.target.value })
                }
                className={inputClass}
              >
                <option value="">No group</option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name || group.id}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="URL" hint="used by the Open button">
            <input
              value={form.url}
              onChange={(event) =>
                setForm({ ...form, url: event.target.value })
              }
              className={cn(inputClass, "font-mono")}
              placeholder="http://localhost:3000"
            />
          </Field>

          {otherApps.length > 0 && (
            <div>
              <div className="mb-1.5 text-[10.5px] font-medium uppercase tracking-[0.1em] text-muted">
                Starts after
              </div>
              <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto rounded-lg border border-line bg-panel-2/30 p-2">
                {otherApps.map((app) => {
                  const checked = form.dependsOn.includes(app.id);
                  return (
                    <button
                      key={app.id}
                      onClick={() => toggleDependency(app.id)}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-colors",
                        checked
                          ? "border-accent/40 bg-accent/10 text-accent"
                          : "border-line bg-canvas text-muted hover:text-ink",
                      )}
                    >
                      {checked && <Check size={10} />}
                      {app.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <label className="flex cursor-pointer items-center gap-2 text-[11.5px] text-muted">
            <input
              type="checkbox"
              checked={startAfter}
              onChange={(event) => setStartAfter(event.target.checked)}
              className="accent-[var(--color-accent)]"
            />
            Start the app after adding it
          </label>

          {candidate?.notes && !manual && (
            <p className="font-mono text-[10.5px] leading-relaxed text-muted/80">
              {candidate.notes}
            </p>
          )}

          {error && <ErrorBox message={error} />}
        </div>
      )}
    </Modal>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <p className="rounded-md border border-danger/25 bg-danger/10 px-3 py-2 text-[11.5px] leading-relaxed text-danger">
      {message}
    </p>
  );
}
