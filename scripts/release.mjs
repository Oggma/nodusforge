#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
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

const conf = JSON.parse(
  fs.readFileSync(path.join(root, "src-tauri", "tauri.conf.json"), "utf8"),
);
const version = conf.version;
const tag = `v${version}`;
const repo = "Oggma/nodusforge";
const releaseAssetsRoot = process.env.NODUSFORGE_RELEASE_ASSETS
  ? path.resolve(process.env.NODUSFORGE_RELEASE_ASSETS)
  : path.resolve(root, "..", "release-assets");
const platformsRoot = path.resolve(
  option(
    "--artifacts",
    path.join(releaseAssetsRoot, tag, "platforms"),
  ),
);
const releaseRoot = path.resolve(
  option("--out", path.join(releaseAssetsRoot, tag, "release")),
);
const notesPath = path.join(releaseAssetsRoot, tag, "RELEASE_NOTES.md");
const publish = args.includes("--publish");
const requiredArg = option("--require-platforms", "all");
const required =
  requiredArg === "all"
    ? ["linux", "windows", "macos"]
    : requiredArg.split(",").map((value) => value.trim()).filter(Boolean);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    env: process.env,
    stdio: "inherit",
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

if (!fs.existsSync(notesPath)) {
  fail(`Missing release notes: ${notesPath}`);
}
if (!fs.existsSync(platformsRoot)) {
  fail(`Missing platform artifacts: ${platformsRoot}`);
}

const fragments = {};
for (const entry of fs.readdirSync(platformsRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const fragmentPath = path.join(platformsRoot, entry.name, "fragment.json");
  if (!fs.existsSync(fragmentPath)) continue;
  const fragment = JSON.parse(fs.readFileSync(fragmentPath, "utf8"));
  fragments[fragment.platform] = {
    ...fragment,
    dir: path.join(platformsRoot, entry.name),
  };
}

for (const platform of required) {
  if (!fragments[platform]) {
    fail(`Missing required platform build: ${platform}`);
  }
}

const files = new Map();
const platformEntries = {};
const keysByPlatform = {
  linux: (arch) => [`linux-${arch}-deb`, `linux-${arch}`],
  windows: (arch) => [`windows-${arch}-nsis`, `windows-${arch}`],
  macos: (arch) => [`darwin-${arch}-app`, `darwin-${arch}`],
};

for (const [platform, fragment] of Object.entries(fragments)) {
  const dir = fragment.dir;
  const updaterPath = path.join(dir, fragment.updater);
  const signaturePath = `${updaterPath}.sig`;
  if (!fs.existsSync(updaterPath)) {
    fail(`Missing updater artifact for ${platform}: ${updaterPath}`);
  }
  if (!fs.existsSync(signaturePath) || fs.statSync(signaturePath).size === 0) {
    fail(`Missing signature for ${platform}. Run npm run release:sign on Linux.`);
  }

  for (const file of fragment.files ?? []) {
    const full = path.join(dir, file.file);
    if (!fs.existsSync(full)) {
      fail(`Missing artifact for ${platform}: ${full}`);
    }
    const digest = sha256(full);
    if (file.sha256 && file.sha256 !== digest) {
      fail(`Checksum mismatch for ${platform}/${file.file}`);
    }
    files.set(file.file, full);
  }
  files.set(path.basename(signaturePath), signaturePath);

  const url = `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(fragment.updater)}`;
  const signature = fs.readFileSync(signaturePath, "utf8").trim();
  const keys = keysByPlatform[platform]?.(fragment.arch);
  if (!keys) fail(`Unknown platform in fragment: ${platform}`);
  for (const key of keys) {
    platformEntries[key] = { signature, url };
  }
}

if (Object.keys(platformEntries).length === 0) {
  fail("No updater platforms were staged");
}

fs.rmSync(releaseRoot, { recursive: true, force: true });
fs.mkdirSync(releaseRoot, { recursive: true });

for (const [name, source] of files) {
  fs.copyFileSync(source, path.join(releaseRoot, name));
}
fs.copyFileSync(notesPath, path.join(releaseRoot, "RELEASE_NOTES.md"));

const manifest = {
  version,
  notes: fs.readFileSync(notesPath, "utf8").trim(),
  pub_date: new Date().toISOString(),
  release_url: `https://github.com/${repo}/releases/tag/${tag}`,
  platforms: platformEntries,
};
fs.writeFileSync(
  path.join(releaseRoot, "latest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);

const checksummed = fs
  .readdirSync(releaseRoot)
  .filter((name) => name !== "SHA256SUMS")
  .sort();
const checksums = checksummed
  .map((name) => `${sha256(path.join(releaseRoot, name))}  ${name}`)
  .join("\n");
fs.writeFileSync(path.join(releaseRoot, "SHA256SUMS"), `${checksums}\n`);
const assets = [...checksummed, "SHA256SUMS"];

console.log(`\nStaged ${tag} in ${releaseRoot}`);
console.log(`Platforms: ${Object.keys(fragments).join(", ")}`);
for (const name of assets) console.log(`  ${name}`);

if (!publish) {
  console.log("\nPublish with: npm run release:publish");
  process.exit(0);
}

const status = spawnSync("git", ["status", "--porcelain"], {
  cwd: root,
  encoding: "utf8",
});
if (status.status !== 0) fail("Could not read git status");
if (status.stdout.trim()) {
  fail("Source working tree is not clean. Commit changes before publishing.");
}

const tagCommit = spawnSync("git", ["rev-list", "-n", "1", tag], {
  cwd: root,
  encoding: "utf8",
});
if (tagCommit.status !== 0 || !tagCommit.stdout.trim()) {
  fail(`Tag ${tag} does not exist. Create it on the version-bump commit first.`);
}
const head = spawnSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
});
if (head.stdout.trim() !== tagCommit.stdout.trim()) {
  fail(`Tag ${tag} does not point at HEAD.`);
}

const auth = spawnSync("gh", ["auth", "status"], {
  cwd: root,
  stdio: "ignore",
});
if (auth.status !== 0) fail("GitHub CLI is not authenticated.");

const releaseAssets = assets.map((name) => path.join(releaseRoot, name));
run("gh", [
  "release",
  "create",
  tag,
  ...releaseAssets,
  "--title",
  `NodusForge ${tag}`,
  "--notes-file",
  path.join(releaseRoot, "RELEASE_NOTES.md"),
  "--latest",
  "--verify-tag",
]);
