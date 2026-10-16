#!/usr/bin/env node
// Installs a signing public key into the Tauri config.
//
//   node scripts/set-pubkey.mjs <path to .pub>
//
// Writes the trimmed public key into plugins.updater.pubkey.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pubPath = process.argv[2];
if (!pubPath) {
  console.error("usage: node scripts/set-pubkey.mjs <path to .pub>");
  process.exit(1);
}

const pubkey = readFileSync(pubPath, "utf8").trim();
if (!pubkey) {
  console.error("error: the public key file is empty");
  process.exit(1);
}

const confPath = join(root, "src-tauri", "tauri.conf.json");
const conf = JSON.parse(readFileSync(confPath, "utf8"));
conf.plugins = conf.plugins || {};
conf.plugins.updater = conf.plugins.updater || {};
conf.plugins.updater.pubkey = pubkey;
if (conf.bundle && conf.bundle.updater) {
  conf.bundle.updater.pubkey = pubkey;
}
writeFileSync(confPath, `${JSON.stringify(conf, null, 2)}\n`);
console.log(`plugins.updater.pubkey set from ${pubPath}`);
console.log("Run 'npm run release:config:check' to confirm it is no longer a placeholder.");
