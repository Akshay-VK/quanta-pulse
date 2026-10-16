#!/usr/bin/env node
// Copies the version from package.json into Cargo.toml and Cargo.lock.
//
// Wired into npm's `version` lifecycle: npm bumps package.json first, then runs
// this, so `npm version <x>` commits every version-bearing file atomically.
// tauri.conf.json needs no edit while it points at package.json.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;

function sync(path, label, transform) {
  const before = readFileSync(path, "utf8");
  const after = transform(before);
  if (before === after) {
    console.log(`${label}: already ${version}`);
    return;
  }
  writeFileSync(path, after);
  console.log(`${label}: synced to ${version}`);
}

// Cargo.toml: the [package] version line.
sync(join(root, "src-tauri/Cargo.toml"), "src-tauri/Cargo.toml", (text) =>
  text.replace(/(^\[package\][\s\S]*?^version\s*=\s*")[^"]*(")/m, `$1${version}$2`),
);

// Cargo.lock: the quanta-pulse package entry.
sync(join(root, "src-tauri/Cargo.lock"), "src-tauri/Cargo.lock", (text) =>
  text.replace(/(name = "quanta-pulse"\nversion = ")[^"]*(")/, `$1${version}$2`),
);

// tauri.conf.json: only when it holds a literal version.
const confPath = join(root, "src-tauri/tauri.conf.json");
const conf = JSON.parse(readFileSync(confPath, "utf8"));
if (typeof conf.version === "string" && !conf.version.endsWith("package.json")) {
  conf.version = version;
  writeFileSync(confPath, `${JSON.stringify(conf, null, 2)}\n`);
  console.log(`src-tauri/tauri.conf.json: synced to ${version}`);
}
