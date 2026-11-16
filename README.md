<div align="center">

# NodusForge

**A desktop control panel for local development processes.**

Start, stop, restart and watch APIs, workers and SPAs from one window — with
dependency ordering, health-aware status and live colored logs.

[![Tauri 2](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white)](https://tauri.app)
[![React 19](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Rust](https://img.shields.io/badge/Rust-stable-000000?logo=rust&logoColor=white)](https://www.rust-lang.org)
[![Linux](https://img.shields.io/badge/Linux-Debian%20%2F%20Ubuntu-FCC624?logo=linux&logoColor=black)](#requirements)

[![NodusForge screenshot](assets/screenshot.png)](assets/screenshot.png)

</div>

## What is NodusForge?

NodusForge is a lightweight Linux desktop app for running a local development
stack without keeping a dozen terminal tabs open. Each app is a YAML entry with
a folder and a shell command. Click **Start**, and NodusForge supervises the
process, waits for its port or health endpoint, and streams stdout/stderr with
colors intact.

It runs processes **natively on the host** — no container runtime or Compose
file required.

> :sound: **AI assistance disclosure:** NodusForge was initially created with the help
> of AI-assisted development tools. The author does not claim authorship of the
> entire codebase and is disclosing this in the interest of transparency and
> openness.

## Features

- **YAML configuration** — one entry per app, optional per-repo includes.
- **Process-tree control** — each command runs in its own process group, so
  Stop terminates the whole tree instead of leaving orphaned `dotnet` or
  `node` children.
- **Health-aware status** — `Starting` becomes `Running` only when the TCP port
  or HTTP endpoint answers. Port conflicts are detected before spawning.
- **Dependency ordering** — `dependsOn` starts services in order and stops them
  in reverse.
- **Live logs** — xterm.js view with ANSI colors, follow-tail, search, copy,
  download, a bounded in-memory buffer and optional persistence to disk.
- **Add-app wizard** — detects .NET projects (including `launchSettings.json`
  ports) and Vite projects (npm/pnpm/yarn/bun).
- **Automatic updates** — installed `.deb` builds check GitHub Releases, verify
  signed packages and can install updates in-app.
- **Tray integration** — Show/Quit menu, close-to-tray and optional
  start-on-login.
- **Native packaging** — builds a Debian package with Tauri 2.

## Requirements

- Linux Mint 22.x / Ubuntu 24.04 (other Debian-based distributions should work)
- Node.js 20.19+ or 22.12+ with npm
- Rust stable (1.90+; the updater plugin requires it)
- GTK 3 and WebKitGTK 4.1 development headers
- Whatever the managed apps need: .NET SDK, Go, Yarn, Python, etc.

The one-time setup script installs the system packages and Rust:

```bash
bash scripts/install-deps.sh
```

It needs `sudo` for the apt step and only targets Debian/Ubuntu-based systems.

## Run locally

```bash
git clone <repository-url>
cd nodusforge
npm install
npm run desktop
```

`npm run desktop` loads the Rust toolchain, checks the GTK/WebKit
dependencies, then starts Vite and the Tauri window.

If `cargo` is not on your `PATH`:

```bash
source "$HOME/.cargo/env"
npm run tauri dev
```

The config file is created on first launch:

```
~/.config/nodusforge/config.yaml
```

## Build and install

Build a Debian package:

```bash
npm run build
npm run tauri build -- --bundles deb
```

Bundles land in:

```
src-tauri/target/release/bundle/deb/
```

For an updater-enabled release, set the signing key first:

```bash
export TAURI_SIGNING_PRIVATE_KEY="$HOME/.tauri/myapp.key"
# export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="..." # only if the key is encrypted
npm run release
```

`npm run release` runs the checks, builds the signed `.deb`, and verifies that
the `.deb.sig` exists. Then create `release-assets/v<version>/RELEASE_NOTES.md`
and run `npm run release:manifest` to generate `latest.json`.

Install:

```bash
sudo dpkg -i src-tauri/target/release/bundle/deb/*.deb
sudo apt-get -f install   # only if dependencies are missing
```

Launch **NodusForge** from the application menu, or run `nodusforge`.

AppImage output is also supported (`--bundles appimage`), but the `.deb` is
recommended on Mint/Ubuntu: tray icons and autostart rely on a proper desktop
entry.

## Configuration

Config lookup order:

1. `--config <path>`
2. `$NODUSFORGE_CONFIG`
3. `./nodusforge.yaml` in the launch directory
4. `~/.config/nodusforge/config.yaml`

### Example

```yaml
version: 1

settings:
  closeToTray: true
  autostart: false
  logBufferLines: 5000
  persistLogs: true
  autoCheckUpdates: true

groups:
  - { id: backend, name: Backend }
  - { id: frontend, name: Frontend }

apps:
  - id: api
    name: API
    group: backend
    cwd: ~/Projects/example-api
    command: dotnet run --project src/Api
    envFile: .env
    url: http://localhost:5080
    health: { type: tcp, port: 5080, timeoutMs: 180000 }
    stopSignal: SIGINT
    stopTimeoutMs: 15000

  - id: web
    name: Web
    group: frontend
    cwd: ~/Projects/example-web
    command: yarn dev
    envFile: .env
    url: http://localhost:5173
    health: { type: tcp, port: 5173, timeoutMs: 120000 }
    dependsOn: [api]
    stopSignal: SIGTERM
    stopTimeoutMs: 10000
```

A complete, copy-pasteable file lives in
[`nodusforge.example.yaml`](nodusforge.example.yaml).

### Try the bundled example

`examples/simple-logger` is a dependency-free Node script that prints colored,
timestamped logs every second and handles Stop cleanly. The entry is already in
`nodusforge.example.yaml`:

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

Start NodusForge from the repo root so the relative `cwd` resolves. If you use
the installed app, replace it with an absolute or `~/...` path.

### Fields

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | yes | Unique id (`letters`, digits, `-`, `_`). |
| `name` | no | Display name; defaults to `id`. |
| `group` | no | Sidebar group (`groups:` entry). |
| `cwd` | yes | Working directory; `~` and `$VARS` are expanded. |
| `command` | yes | Shell command, run through `/bin/bash -lc`. |
| `env` | no | Extra environment variables. |
| `envFile` | no | dotenv file relative to `cwd`; `env` wins on conflicts. |
| `url` | no | Enables the **Open** button and HTTP health. |
| `health` | no | `{ type: none \| tcp \| http, port, path, timeoutMs }`. |
| `dependsOn` | no | Apps that must be healthy first; cycles are rejected. |
| `autoStart` | no | Start when NodusForge launches. |
| `stopSignal` | no | `SIGTERM` (default) or `SIGINT`. |
| `stopTimeoutMs` | no | Grace period before escalating to `SIGKILL` (default 10000). |

`health.type: tcp` waits for a connection on the port; `http` sends a GET and
accepts any valid HTTP response. Use `none` for apps without a listening port.

Split configuration between repositories with `include:`:

```yaml
version: 1
include:
  - ~/Projects/example-api/nodusforge.yaml
```

## Using NodusForge

- **Start / Stop** — header button, sidebar hover action, or `Ctrl+Enter`.
- **Start all / Stop all** — sidebar footer; respects `dependsOn` (dependents
  stop first).
- **Add app** — `+` in the sidebar. Pick a folder, review the detected command
  and port, then save.
- **Logs** — `Follow` pins output to the bottom, `Ctrl+F` searches, and the
  toolbar can copy or download the buffer.
- **Details / Config** — inspect PID, exit code, health target and the effective
  YAML entry. App URLs open in the system browser.
- **Tray** — closing the window hides it to the tray by default. The tray menu
  contains **Show NodusForge** and **Quit**.
- **About** — **Settings → About** shows the app version and a link to the
  GitHub repository.
- **Updates** — **Settings → Updates** has **Check now** and the automatic-check
  toggle. When a new version is available, the dialog offers **Update now**,
  **Later**, **View release**, and a link to disable automatic checks. Installing
  the `.deb` may ask for your administrator password; managed apps stop and
  NodusForge restarts.

Automatic updates were introduced in 0.2.0; users on 0.1.1 must install a 0.2.x
release manually once. 0.2.1 is the first release delivered through the updater
to 0.2.0.

Keyboard shortcuts:

| Shortcut | Action |
| --- | --- |
| `Ctrl+K` | Focus app search |
| `Ctrl+Enter` | Start/stop selected app |
| `Ctrl+Shift+R` | Restart selected app |
| `Ctrl+Shift+L` | Clear selected app's logs |
| `Ctrl+F` | Search within logs |

## How it works

- Commands run as `/bin/bash -lc "<command>"` inside the configured folder.
- At startup NodusForge imports the environment of an interactive login shell
  once. A desktop launch therefore finds nvm/yarn/pyenv/dotnet on `PATH` just
  like a terminal does. Explicit `env` and `envFile` values still win.
- Each process gets its own process group. Stop signals the group, waits, then
  escalates to `SIGKILL` if needed.
- Readiness is polled every 500 ms until `health.timeoutMs` expires. On
  timeout the group is stopped and the app is marked `failed`.
- Logs are batched every 50 ms to keep the UI responsive under heavy output.
  The in-memory buffer defaults to 5,000 lines per app.
- Live process groups are recorded in
  `~/.local/state/nodusforge/state.json`; after a crash, NodusForge terminates
  groups whose command line still matches on the next launch.
- Optional log files live in `~/.local/state/nodusforge/logs/`.

## Project structure

```
assets/                 assets
examples/simple-logger/ Runnable demo app that prints logs
scripts/                install-deps.sh, desktop dev wrapper
src/                    React renderer (components, store, IPC)
src-tauri/              Rust backend
  src/config.rs         YAML model, includes, validation, watcher
  src/process/          lifecycle, process groups, health, logs
  src/detect.rs         .NET / Vite detection for the wizard
  src/tray.rs           tray menu and window toggling
nodusforge.example.yaml Example configuration
```

## Development checks

```bash
npm run typecheck
npm run build
cd src-tauri && cargo check
```

There is no automated test suite yet; changes are verified with the checks
above and a manual smoke pass (start/stop, health, logs, wizard).

## Troubleshooting

**`failed to run 'cargo metadata' ... No such file or directory`** — Rust is not
on `PATH`:

```bash
source "$HOME/.cargo/env"
```

**Missing `webkit2gtk-4.1` / `gtk+-3.0` / `ayatana-appindicator3-0.1`** — install
the development headers:

```bash
bash scripts/install-deps.sh
```

**`Could not connect to localhost: Connection refused` in the window** — the
debug binary loads its UI from the Vite dev server. Run `npm run desktop` (or
`npm run tauri dev`), not the raw binary, during development.

**White screen after moving the repository** — the dev window loads the UI from
Vite at `http://localhost:1420`. Start NodusForge from the folder containing
`package.json` (the repo root), and make sure no stale dev server is running:

```bash
ss -ltnp | grep 1420   # should be empty, or owned by the current Vite
npm run desktop
```

If an old `tauri dev`/`vite` process still owns 1420, stop it first.

**Blank white window** — try WebKit's software paths:

```bash
WEBKIT_DISABLE_DMABUF_RENDERER=1 npm run desktop
# or
WEBKIT_DISABLE_COMPOSITING_MODE=1 npm run desktop
```

**`yarn` / `node` / `dotnet` not found only in the installed app** — the GUI
inherits a minimal desktop `PATH`. Since 0.1.1 NodusForge imports the
interactive login-shell environment (including nvm/pyenv) before starting apps.
Restart NodusForge after changing `~/.bashrc`, and confirm the tool is available
in `bash -lic 'command -v yarn'`.

**Update check fails or the update will not install** — automatic updates were
introduced in 0.2.0, so 0.1.1 users must install a 0.2.x release manually once.
0.2.1 is the first update delivered through the updater to 0.2.0. The latest
GitHub release must contain `latest.json` and a signed `.deb` (`.sig`); dev
builds skip automatic checks. Installing the `.deb` may ask for your
administrator password. If the check still fails, confirm the release is marked
**Latest**, not a draft or pre-release.

**Port already in use** — NodusForge refuses to start a `tcp`-checked app when
the port is bound and reports the holding process. Free the port or change the
health `port`.

**Tray icon missing** — install `libayatana-appindicator3-1`; AppImage builds
often lack tray integration, so prefer the `.deb`.

## Limitations

- No PTY: apps use piped stdio. Interactive prompts are unsupported.
- HTTPS health checks fall back to a TCP reachability probe.
- Saving from the UI re-serializes the YAML file and drops comments.
- In-app updates are available for installed `.deb` builds; 0.1.1 users must
  install 0.2.0 manually once.
- Linux only for now.
- No auto-restart policy or container orchestration.
