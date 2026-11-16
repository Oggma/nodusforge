#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

function option(name, fallback) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} needs a value`);
  }
  return value;
}

if (process.platform !== "linux") {
  console.error("Updater signing must run on the Linux workstation.");
  process.exit(1);
}

const conf = JSON.parse(
  fs.readFileSync(path.join(root, "src-tauri", "tauri.conf.json"), "utf8"),
);
const version = conf.version;
const releaseAssetsRoot = process.env.NODUSFORGE_RELEASE_ASSETS
  ? path.resolve(process.env.NODUSFORGE_RELEASE_ASSETS)
  : path.resolve(root, "..", "release-assets");
const platformsRoot = path.resolve(
  option(
    "--artifacts",
    path.join(releaseAssetsRoot, `v${version}`, "platforms"),
  ),
);

function signingPassword() {
  if (process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD) {
    return process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD;
  }
  const file = path.join(os.homedir(), ".tauri", "signing.env");
  if (!fs.existsSync(file)) return "";
  const result = spawnSync(
    "bash",
    [
      "-c",
      'source "$1"; printf "%s" "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"',
      "bash",
      file,
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) return "";
  return result.stdout;
}

const keySetting =
  process.env.TAURI_SIGNING_PRIVATE_KEY ||
  path.join(os.homedir(), ".tauri", "myapp.key");
let keyIsFile = false;
try {
  keyIsFile = fs.existsSync(keySetting);
} catch {
  keyIsFile = false;
}
let keyArgs;
if (keyIsFile) {
  keyArgs = ["--private-key-path", keySetting];
} else if (keySetting.includes("untrusted comment:")) {
  keyArgs = ["--private-key", keySetting];
} else {
  console.error(`Updater private key not found: ${keySetting}`);
  process.exit(1);
}

const tauri = path.join(root, "node_modules", ".bin", "tauri");
if (!fs.existsSync(tauri)) {
  console.error("Tauri CLI not found. Run npm install first.");
  process.exit(1);
}

if (!fs.existsSync(platformsRoot)) {
  console.error(`No platform artifacts found at ${platformsRoot}`);
  process.exit(1);
}

const platforms = fs
  .readdirSync(platformsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

if (platforms.length === 0) {
  console.error(`No platform artifacts found at ${platformsRoot}`);
  process.exit(1);
}

const password = signingPassword();
const env = { ...process.env };
delete env.TAURI_SIGNING_PRIVATE_KEY;
delete env.TAURI_SIGNING_PRIVATE_KEY_PATH;
if (password) env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = password;

for (const platform of platforms) {
  const dir = path.join(platformsRoot, platform);
  const fragmentPath = path.join(dir, "fragment.json");
  if (!fs.existsSync(fragmentPath)) {
    throw new Error(`Missing fragment: ${fragmentPath}`);
  }
  const fragment = JSON.parse(fs.readFileSync(fragmentPath, "utf8"));
  const artifact = path.join(dir, fragment.updater);
  if (!fs.existsSync(artifact)) {
    throw new Error(`Missing updater artifact: ${artifact}`);
  }

  const signature = `${artifact}.sig`;
  fs.rmSync(signature, { force: true });
  console.log(`Signing ${platform}: ${path.basename(artifact)}`);
  const result = spawnSync(
    tauri,
    [
      "signer",
      "sign",
      "--app-version",
      version,
      ...keyArgs,
      artifact,
    ],
    { cwd: root, env, stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  if (!fs.existsSync(signature) || fs.statSync(signature).size === 0) {
    throw new Error(`Signature was not created for ${artifact}`);
  }
}

console.log(`\nSigned updater artifacts for ${platforms.join(", ")} (${version}).`);
