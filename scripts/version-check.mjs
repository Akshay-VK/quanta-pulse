#!/usr/bin/env node
// Verifies that every version-bearing file agrees with package.json.
//
//   node scripts/version-check.mjs [tag]
//
// With a tag argument it must equal "v" + the package version. Exits non-zero
// and prints a precise diff when anything disagrees.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tagArg = process.argv[2];

const version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const problems = [];

function check(label, found, expected = version) {
  if (found !== expected) {
    problems.push(`${label}: expected ${expected}, found ${found}`);
  }
}

// tauri.conf.json: either a literal semver or a path to a package.json.
const confPath = join(root, "src-tauri/tauri.conf.json");
const conf = JSON.parse(readFileSync(confPath, "utf8"));
const confVersion = conf.version;
if (typeof confVersion === "string" && confVersion.endsWith("package.json")) {
  const linked = JSON.parse(readFileSync(resolve(join(root, "src-tauri"), confVersion), "utf8")).version;
  check(`src-tauri/tauri.conf.json -> ${confVersion}`, linked);
} else {
  check("src-tauri/tauri.conf.json", confVersion);
}

// Cargo.toml: the [package] version line.
const cargoToml = readFileSync(join(root, "src-tauri/Cargo.toml"), "utf8");
const packageSection = cargoToml.split("[package]")[1]?.split(/^\[/m)[0] ?? "";
const cargoVersion = /^version\s*=\s*"([^"]+)"/m.exec(packageSection)?.[1];
check("src-tauri/Cargo.toml", cargoVersion);

// Cargo.lock: the quanta-pulse package entry.
const lock = readFileSync(join(root, "src-tauri/Cargo.lock"), "utf8");
const lockEntry = lock
  .split("[[package]]")
  .find((block) => /name = "quanta-pulse"/.test(block));
const lockVersion = lockEntry ? /^version = "([^"]+)"/m.exec(lockEntry)?.[1] : undefined;
check("src-tauri/Cargo.lock (quanta-pulse)", lockVersion);

// Optional tag argument.
if (tagArg !== undefined) {
  check("tag argument", tagArg, `v${version}`);
}

if (problems.length > 0) {
  console.error(`version:check failed — package.json is ${version}:`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`version:check ok — ${version}${tagArg ? ` (tag ${tagArg})` : ""}`);
