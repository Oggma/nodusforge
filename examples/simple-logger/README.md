# Simple Logger example

A dependency-free Node script that prints timestamped, ANSI-colored log lines
every second. It handles `SIGINT`/`SIGTERM` and exits gracefully, so it is a
good way to try NodusForge's Start/Stop buttons and log viewer.

## Run it directly

```bash
node app.mjs
```

## Run it with NodusForge

Add this to your config (the same entry is included in
[`../../nodusforge.example.yaml`](../../nodusforge.example.yaml)):

```yaml
groups:
  - { id: examples, name: Examples }

apps:
  - id: simple-logger
    name: Simple Logger
    group: examples
    cwd: ./examples/simple-logger
    command: node app.mjs
    health: { type: none }
    stopSignal: SIGTERM
    stopTimeoutMs: 3000
```

The relative `cwd` is resolved from the directory NodusForge was launched in —
for development, run `npm run desktop` from the repo root. If you use the
installed app, replace `cwd` with an absolute path or a `~/...` path.

No port or health check is used: the app is marked `Running` as soon as the
process starts, and all output appears in the **Logs** tab.
