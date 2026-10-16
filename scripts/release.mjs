#!/usr/bin/env node
// Cut a release: preflight, bump, commit, tag, print the push command.
//
//   npm run release -- <patch|minor|major|x.y.z> [--push] [--dry-run]
//
// Never pushes unless --push is passed. Never creates the tag or the commit
// during --dry-run.
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const willPush = args.includes("--push");
const requested = args.find((a) => !a.startsWith("--"));
// Test seam: QP_RELEASE_SKIP_TOOLCHAIN=1 skips the slow tsc/eslint/vitest run.
const skipToolchain = process.env.QP_RELEASE_SKIP_TOOLCHAIN === "1";

function fail(message) {
  console.error(`release: ${message}`);
  process.exit(1);
}

// On Windows npm and npx are .cmd shims that spawnSync cannot exec directly.
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";
const NPX = process.platform === "win32" ? "npx.cmd" : "npx";

function run(cmd) {
  // npm/npx are .cmd shims on Windows and need a shell to be spawned.
  const needsShell = cmd[0] === NPM || cmd[0] === NPX;
  const res = spawnSync(cmd[0], cmd.slice(1), {
    cwd: root,
    stdio: "inherit",
    ...(needsShell ? { shell: true } : {}),
  });
  if (res.status !== 0) fail(`${cmd.join(" ")} failed`);
}

function git(...gitArgs) {
  return execFileSync("git", gitArgs, { cwd: root, encoding: "utf8" }).trim();
}

if (!requested) fail("usage: npm run release -- <patch|minor|major|x.y.z> [--push] [--dry-run]");

const current = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;

// --- preflight -------------------------------------------------------------
if (git("status", "--porcelain")) fail("working tree is not clean");

const branch = git("branch", "--show-current");
if (branch !== "main") fail(`not on main (currently on ${branch})`);

// Up to date with origin when origin exists and has been fetched at least once.
const remotes = execFileSync("git", ["remote"], { cwd: root, encoding: "utf8" });
if (remotes.includes("origin")) {
  const remoteMain = spawnSync("git", ["rev-parse", "--verify", "--quiet", "origin/main"], {
    cwd: root,
  });
  if (remoteMain.status === 0) {
    const fetch = spawnSync("git", ["fetch", "origin", "--quiet"], { cwd: root });
    if (fetch.status !== 0) fail("cannot reach origin");
    const counts = git("rev-list", "--left-right", "--count", "origin/main...HEAD").split(/\s+/);
    const behind = Number(counts[1]);
    if (behind > 0) fail(`main is ${behind} commit(s) behind origin/main`);
  }
}

run([NPM, "run", "version:check"]);
if (!skipToolchain) {
  run([NPX, "tsc", "-b"]);
  run([NPX, "eslint", ".", "--max-warnings", "0"]);
  run([NPX, "vitest", "run"]);
}
run(["node", "scripts/check-release-config.mjs"]);

// --- version resolution ----------------------------------------------------
function parse(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
  return m ? m.slice(1, 4).map(Number) : null;
}
function cmp(a, b) {
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

const cur = parse(current);
if (!cur) fail(`cannot parse current version ${current}`);

let target;
if (requested === "patch" || requested === "minor" || requested === "major") {
  target = [...cur];
  if (requested === "patch") target[2] += 1;
  else if (requested === "minor") {
    target[1] += 1;
    target[2] = 0;
  } else {
    target[0] += 1;
    target[1] = 0;
    target[2] = 0;
  }
  target = target.join(".");
} else {
  target = requested;
  if (!parse(target)) fail(`invalid version ${target}`);
}

const tags = git("tag", "-l")
  .split("\n")
  .filter(Boolean)
  .map((t) => t.replace(/^v/, ""))
  .filter((t) => parse(t));
const latestTag = tags.sort((a, b) => cmp(parse(a), parse(b))).pop();
const tag = `v${target}`;
const tagExists = git("tag", "-l", tag).length > 0;

if (tagExists) fail(`tag ${tag} already exists`);
if (latestTag && cmp(parse(target), parse(latestTag)) < 0) {
  fail(`${target} is lower than the latest tag v${latestTag}`);
}

// First release: the version is already in package.json, only the tag is missing.
const isFirstRelease = target === current;
if (!isFirstRelease && latestTag && cmp(parse(target), parse(latestTag)) === 0) {
  fail(`${target} equals the latest tag v${latestTag} — bump to a higher version`);
}

// --- act -------------------------------------------------------------------
if (dryRun) {
  console.log(`\n[dry-run] ${isFirstRelease ? `create tag ${tag}` : `run npm version ${target}`}`);
} else if (isFirstRelease) {
  run(["git", "tag", "-a", tag, "-m", tag]);
  console.log(`\ncreated tag ${tag}`);
} else {
  run([NPM, "version", target]);
  // npm tags with the version; make sure the v-prefixed tag exists too.
  if (!git("tag", "-l", tag)) run(["git", "tag", "-a", tag, "-m", tag]);
}

console.log("\npush with:");
console.log("  git push --follow-tags origin main");
if (willPush && !dryRun) run(["git", "push", "--follow-tags", "origin", "main"]);

