#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const host = process.platform === "win32"
  ? "windows"
  : process.platform === "darwin"
    ? "macos"
    : "linux";

function option(name, fallback) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} needs a value`);
  }
  return value;
}

const platform = option("--platform", host);
const arch = option("--arch", process.arch === "arm64" ? "aarch64" : "x86_64");
const skipChecks = args.includes("--skip-checks");
const outArg = option("--out", "");

if (platform !== host) {
  throw new Error(
    `Cross-building is not supported: host is ${host}, requested ${platform}. Build on the target OS or use GitHub Actions.`,
  );
}

const expectedArch = {
  linux: "x86_64",
  windows: "x86_64",
  macos: "aarch64",
}[platform];
if (expectedArch && arch !== expectedArch) {
  throw new Error(
    `Unsupported architecture for ${platform}: ${arch}. Expected ${expectedArch}.`,
  );
}

const bundles = {
  linux: ["deb"],
  windows: ["nsis"],
  macos: ["app", "dmg"],
}[platform];
if (!bundles) throw new Error(`Unsupported platform: ${platform}`);

const conf = JSON.parse(
  fs.readFileSync(path.join(root, "src-tauri", "tauri.conf.json"), "utf8"),
);
const version = conf.version;
const product = conf.productName ?? "NodusForge";
const releaseAssetsRoot = process.env.NODUSFORGE_RELEASE_ASSETS
  ? path.resolve(process.env.NODUSFORGE_RELEASE_ASSETS)
  : path.resolve(root, "..", "release-assets");
const outDir = outArg
  ? path.resolve(outArg)
  : path.join(releaseAssetsRoot, `v${version}`, "platforms", platform);

const baseEnv = { ...process.env };
const cargoBin = path.join(os.homedir(), ".cargo", "bin");
if (fs.existsSync(cargoBin)) {
  const pathKey =
    Object.keys(baseEnv).find((key) => key.toUpperCase() === "PATH") ?? "PATH";
  baseEnv[pathKey] = `${cargoBin}${path.delimiter}${baseEnv[pathKey] ?? ""}`;
}

function run(command, commandArgs, env = baseEnv) {
  console.log(`\n$ ${command} ${commandArgs.join(" ")}`);
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    env,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const output = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) output.push(...walk(full));
    else output.push(full);
  }
  return output;
}

function findBundle(dir, predicate) {
  return walk(dir).find(predicate);
}

function copy(source, name = path.basename(source)) {
  fs.mkdirSync(outDir, { recursive: true });
  const target = path.join(outDir, name);
  fs.copyFileSync(source, target);
  return target;
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

if (!skipChecks) {
  run(npmCommand(), ["run", "typecheck"]);
  run("cargo", ["check", "--manifest-path", "src-tauri/Cargo.toml"]);
}

run(npmCommand(), [
  "run",
  "tauri",
  "--",
  "build",
  "--bundles",
  bundles.join(","),
]);

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const bundleRoot = path.join(root, "src-tauri", "target", "release", "bundle");
const files = [];
const installers = [];
let updater = null;

if (platform === "linux") {
  const deb = findBundle(path.join(bundleRoot, "deb"), (file) => file.endsWith(".deb"));
  if (!deb) throw new Error("No .deb bundle was produced");
  files.push(copy(deb));
  installers.push(path.basename(deb));
  updater = path.basename(deb);
} else if (platform === "windows") {
  const installer = findBundle(
    path.join(bundleRoot, "nsis"),
    (file) => file.endsWith(".exe") && file.includes("setup"),
  );
  if (!installer) throw new Error("No NSIS installer was produced");
  files.push(copy(installer));
  installers.push(path.basename(installer));
  updater = path.basename(installer);
} else {
  const appDir = path.join(bundleRoot, "macos");
  const app = fs
    .readdirSync(appDir, { withFileTypes: true })
    .find((entry) => entry.isDirectory() && entry.name.endsWith(".app"));
  if (!app) throw new Error("No macOS .app bundle was produced");
  const dmg = findBundle(path.join(bundleRoot, "dmg"), (file) =>
    file.endsWith(".dmg"),
  );
  if (!dmg) throw new Error("No macOS .dmg bundle was produced");
  files.push(copy(dmg));
  installers.push(path.basename(dmg));

  const archiveName = `${product}_${version}_${arch}.app.tar.gz`;
  const archive = path.join(outDir, archiveName);
  const tar = spawnSync(
    "tar",
    ["-czf", archive, "-C", appDir, app.name],
    {
      cwd: root,
      env: { ...process.env, COPYFILE_DISABLE: "1" },
      stdio: "inherit",
    },
  );
  if (tar.error) throw tar.error;
  if (tar.status !== 0) throw new Error("Could not create the macOS updater archive");
  files.push(archive);
  updater = archiveName;
}

const fragment = {
  version,
  platform,
  arch,
  builtAt: new Date().toISOString(),
  updater,
  installers,
  files: files.map((file) => ({
    file: path.basename(file),
    sha256: sha256(file),
  })),
};

fs.writeFileSync(
  path.join(outDir, "fragment.json"),
  `${JSON.stringify(fragment, null, 2)}\n`,
);

console.log(`\nBuilt ${platform} ${arch} ${version}`);
console.log(`Artifacts: ${outDir}`);
for (const file of files) console.log(`  ${path.basename(file)}`);
console.log(`Updater artifact: ${updater}`);
