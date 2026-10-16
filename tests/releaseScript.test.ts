// Tests for the release script's preflight logic. Each case runs the real
// script inside a throwaway git repository; nothing is pushed and no tag is
// created outside --dry-run.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPTS = [
  "version-check.mjs",
  "sync-version.mjs",
  "check-release-config.mjs",
  "release.mjs",
];

function makeRepo(version = "0.2.0") {
  const dir = mkdtempSync(join(tmpdir(), "qp-release-"));
  const git = (args: string[]) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  git(["init", "-b", "main"]);
  git(["config", "user.email", "test@example.com"]);
  git(["config", "user.name", "Test"]);
  mkdirSync(join(dir, "scripts"), { recursive: true });
  mkdirSync(join(dir, "src-tauri"), { recursive: true });
  for (const script of SCRIPTS) {
    copyFileSync(join("scripts", script), join(dir, "scripts", script));
  }
  writeFileSync(
    join(dir, "package.json"),
    `${JSON.stringify(
      {
        name: "quanta-pulse",
        version,
        private: true,
        scripts: { "version:check": "node scripts/version-check.mjs" },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(dir, "src-tauri", "tauri.conf.json"),
    `${JSON.stringify(
      {
        version: "../package.json",
        plugins: {
          updater: {
            pubkey: "dW50cnVzdGVkIGNvbW1lbnQ6IGZha2UgcHVibGljIGtleQo=",
            endpoints: ["https://example.com/releases/latest/download/latest.json"],
          },
        },
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(dir, "src-tauri", "Cargo.toml"),
    `[package]\nname = "quanta-pulse"\nversion = "${version}"\n`,
  );
  writeFileSync(
    join(dir, "src-tauri", "Cargo.lock"),
    `[[package]]\nname = "quanta-pulse"\nversion = "${version}"\n`,
  );
  git(["add", "-A"]);
  git(["commit", "-m", "chore: test fixture"]);
  return dir;
}

function release(dir: string, args: string[]) {
  return execFileSync("node", [join(dir, "scripts", "release.mjs"), ...args], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, QP_RELEASE_SKIP_TOOLCHAIN: "1" },
  });
}

function releaseExpectingFailure(dir: string, args: string[]) {
  try {
    release(dir, args);
  } catch (err) {
    return String((err as Error & { stderr?: string }).stderr ?? err);
  }
  throw new Error("release should have failed");
}

function git(dir: string, args: string[]) {
  return execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
}

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("release.mjs", () => {
  it("dry-runs the first release without creating a tag or commit", () => {
    const dir = makeRepo();
    dirs.push(dir);
    const head = git(dir, ["rev-parse", "HEAD"]);
    const out = release(dir, ["0.2.0", "--dry-run"]);
    expect(out).toContain("[dry-run] create tag v0.2.0");
    expect(out).toContain("git push --follow-tags");
    expect(git(dir, ["tag", "-l"])).toBe("");
    expect(git(dir, ["rev-parse", "HEAD"])).toBe(head);
  });

  it("dry-runs a version bump without changing the tree", () => {
    const dir = makeRepo();
    dirs.push(dir);
    const head = git(dir, ["rev-parse", "HEAD"]);
    const out = release(dir, ["0.3.0", "--dry-run"]);
    expect(out).toContain("[dry-run] run npm version 0.3.0");
    expect(git(dir, ["rev-parse", "HEAD"])).toBe(head);
    expect(git(dir, ["tag", "-l"])).toBe("");
  });

  it("fails on a dirty tree", () => {
    const dir = makeRepo();
    dirs.push(dir);
    writeFileSync(join(dir, "dirty.txt"), "uncommitted");
    const stderr = releaseExpectingFailure(dir, ["0.3.0", "--dry-run"]);
    expect(stderr).toContain("working tree is not clean");
  });

  it("fails when not on main", () => {
    const dir = makeRepo();
    dirs.push(dir);
    git(dir, ["checkout", "-b", "feature"]);
    const stderr = releaseExpectingFailure(dir, ["0.3.0", "--dry-run"]);
    expect(stderr).toContain("not on main");
  });

  it("fails when the tag already exists", () => {
    const dir = makeRepo();
    dirs.push(dir);
    git(dir, ["tag", "v0.2.0"]);
    const stderr = releaseExpectingFailure(dir, ["0.2.0", "--dry-run"]);
    expect(stderr).toContain("tag v0.2.0 already exists");
  });

  it("fails when the requested version is lower than the latest tag", () => {
    const dir = makeRepo();
    dirs.push(dir);
    git(dir, ["tag", "v0.3.0"]);
    const stderr = releaseExpectingFailure(dir, ["0.2.0", "--dry-run"]);
    expect(stderr).toContain("lower than the latest tag v0.3.0");
  });

  it("fails when the release config is incomplete", () => {
    const dir = makeRepo();
    dirs.push(dir);
    writeFileSync(
      join(dir, "src-tauri", "tauri.conf.json"),
      `${JSON.stringify({ version: "../package.json", plugins: { updater: {} } }, null, 2)}\n`,
    );
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-m", "chore: break release config"]);
    const stderr = releaseExpectingFailure(dir, ["0.3.0", "--dry-run"]);
    expect(stderr).toContain("release config check failed");
  });
});
