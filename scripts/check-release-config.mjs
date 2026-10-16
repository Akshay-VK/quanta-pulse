#!/usr/bin/env node
// Fails while the updater signing key or endpoint is still a placeholder.
//
// The public key can only exist after scripts/generate-signing-key.ps1 has run,
// so this is the gate that stops a release from shipping an unverifiable bundle.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const conf = JSON.parse(readFileSync(join(root, "src-tauri/tauri.conf.json"), "utf8"));
const updater = conf?.plugins?.updater ?? {};
const problems = [];

const PLACEHOLDER = /(PASTE|YOUR[_-]|CHANGE[_-]?ME|PLACEHOLDER|<.*>)/i;

const pubkey = typeof updater.pubkey === "string" ? updater.pubkey.trim() : "";
if (!pubkey) problems.push("plugins.updater.pubkey is missing");
else if (PLACEHOLDER.test(pubkey)) problems.push("plugins.updater.pubkey is still a placeholder");

const endpoints = Array.isArray(updater.endpoints) ? updater.endpoints : [];
if (endpoints.length === 0) problems.push("plugins.updater.endpoints is missing");
for (const endpoint of endpoints) {
  if (PLACEHOLDER.test(String(endpoint))) {
    problems.push(`endpoint is still a placeholder: ${endpoint}`);
  }
}

if (problems.length > 0) {
  console.error("release config check failed:");
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error(
    "\nRun scripts/generate-signing-key.ps1, then scripts/set-pubkey.mjs <key.pub>.",
  );
  process.exit(1);
}
console.log("release config ok — updater endpoint and signing key are set");
