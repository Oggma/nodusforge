#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = "Oggma/nodusforge";
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const conf = JSON.parse(
  fs.readFileSync(path.join(root, "src-tauri/tauri.conf.json"), "utf8"),
);
const version = conf.version;
const tag = `v${version}`;
const name = `NodusForge_${version}_amd64.deb`;
const deb = path.join(root, "src-tauri/target/release/bundle/deb", name);
const sig = `${deb}.sig`;
const outDir = path.join(root, "release-assets", tag);
const notesPath = path.join(outDir, "RELEASE_NOTES.md");
const out = path.join(outDir, "latest.json");

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!fs.existsSync(deb)) {
  fail(`Missing .deb: ${deb}\nBuild it first with scripts/release.sh.`);
}
if (!fs.existsSync(sig)) {
  fail(`Missing signature: ${sig}\nThe .deb must be built with the updater key.`);
}

const signature = fs.readFileSync(sig, "utf8").trim();
if (!signature) {
  fail(`Empty signature: ${sig}`);
}

const notes = fs.existsSync(notesPath)
  ? fs.readFileSync(notesPath, "utf8").trim()
  : `NodusForge ${version}`;

const manifest = {
  version,
  notes,
  pub_date: new Date().toISOString(),
  release_url: `https://github.com/${repo}/releases/tag/${tag}`,
  platforms: {
    "linux-x86_64-deb": {
      signature,
      url: `https://github.com/${repo}/releases/download/${tag}/${name}`,
    },
  },
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(out, JSON.stringify(manifest, null, 2) + "\n");

console.log(`Wrote ${out}`);
console.log(`Version: ${version}`);
console.log(`Signature: ${sig}`);
console.log(`Package: ${name}`);
