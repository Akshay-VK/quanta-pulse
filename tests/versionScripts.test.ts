// Tests for the version scripts: agreement, disagreement, tag mismatch and
// the npm `version` lifecycle sync. Each case runs the real script against a
// throwaway project so the logic under test is the shipped one.
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPTS = ["version-check.mjs", "sync-version.mjs"];

function makeProject(version = "1.2.3") {
  const dir = mkdtempSync(join(tmpdir(), "qp-version-"));
  mkdirSync(join(dir, "scripts"), { recursive: true });
  mkdirSync(join(dir, "src-tauri"), { recursive: true });
  for (const script of SCRIPTS) {
    copyFileSync(join("scripts", script), join(dir, "scripts", script));
  }
  writeFileSync(
    join(dir, "package.json"),
    `${JSON.stringify({ name: "quanta-pulse", version }, null, 2)}\n`,
  );
  writeFileSync(
    join(dir, "src-tauri", "tauri.conf.json"),
    `${JSON.stringify({ version: "../package.json" }, null, 2)}\n`,
  );
  writeFileSync(
    join(dir, "src-tauri", "Cargo.toml"),
    `[package]\nname = "quanta-pulse"\nversion = "${version}"\n`,
  );
  writeFileSync(
    join(dir, "src-tauri", "Cargo.lock"),
    `[[package]]\nname = "quanta-pulse"\nversion = "${version}"\n`,
  );
  return dir;
}

function run(script: string, dir: string, args: string[] = []) {
  return execFileSync("node", [join(dir, "scripts", script), ...args], {
    encoding: "utf8",
    cwd: dir,
  });
}

function runExpectingFailure(script: string, dir: string, args: string[] = []) {
  try {
    run(script, dir, args);
  } catch (err) {
    return String((err as Error & { stderr?: string }).stderr ?? err);
  }
  throw new Error(`${script} should have failed`);
}

// npm is a .cmd shim on Windows and needs a shell to spawn.
function runNpm(args: string[], cwd: string) {
  const isWin = process.platform === "win32";
  const npm = isWin ? "npm.cmd" : "npm";
  const res = spawnSync(npm, args, { cwd, stdio: "inherit", shell: isWin });
  if (res.status !== 0) throw new Error(`npm ${args.join(" ")} failed`);
}

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("version-check.mjs", () => {
  it("passes when every file agrees with package.json", () => {
    const dir = makeProject();
    dirs.push(dir);
    expect(run("version-check.mjs", dir)).toContain("version:check ok — 1.2.3");
  });

  it("passes with a matching tag argument", () => {
    const dir = makeProject();
    dirs.push(dir);
    expect(run("version-check.mjs", dir, ["v1.2.3"])).toContain("tag v1.2.3");
  });

  it("fails with a precise diff when Cargo.toml disagrees", () => {
    const dir = makeProject();
    dirs.push(dir);
    writeFileSync(
      join(dir, "src-tauri", "Cargo.toml"),
      '[package]\nname = "quanta-pulse"\nversion = "9.9.9"\n',
    );
    const stderr = runExpectingFailure("version-check.mjs", dir);
    expect(stderr).toContain("version:check failed");
    expect(stderr).toContain("src-tauri/Cargo.toml: expected 1.2.3, found 9.9.9");
  });

  it("fails when Cargo.lock disagrees", () => {
    const dir = makeProject();
    dirs.push(dir);
    writeFileSync(
      join(dir, "src-tauri", "Cargo.lock"),
      '[[package]]\nname = "quanta-pulse"\nversion = "0.0.1"\n',
    );
    const stderr = runExpectingFailure("version-check.mjs", dir);
    expect(stderr).toContain("src-tauri/Cargo.lock (quanta-pulse): expected 1.2.3, found 0.0.1");
  });

  it("fails when the tag argument is not v + version", () => {
    const dir = makeProject();
    dirs.push(dir);
    const stderr = runExpectingFailure("version-check.mjs", dir, ["1.2.3"]);
    expect(stderr).toContain("tag argument: expected v1.2.3, found 1.2.3");
  });
});

describe("sync-version.mjs", () => {
  it("copies the package version into Cargo.toml and Cargo.lock", () => {
    const dir = makeProject();
    dirs.push(dir);
    writeFileSync(
      join(dir, "package.json"),
      `${JSON.stringify({ name: "quanta-pulse", version: "2.0.0" }, null, 2)}\n`,
    );
    const out = run("sync-version.mjs", dir);
    expect(out).toContain("synced to 2.0.0");
    expect(readFileSync(join(dir, "src-tauri", "Cargo.toml"), "utf8")).toContain(
      'version = "2.0.0"',
    );
    expect(readFileSync(join(dir, "src-tauri", "Cargo.lock"), "utf8")).toContain(
      'name = "quanta-pulse"\nversion = "2.0.0"',
    );
    // And the project is back in agreement.
    expect(run("version-check.mjs", dir)).toContain("version:check ok — 2.0.0");
  });

  it("leaves a tauri.conf.json path untouched", () => {
    const dir = makeProject();
    dirs.push(dir);
    writeFileSync(
      join(dir, "package.json"),
      `${JSON.stringify({ name: "quanta-pulse", version: "2.0.0" }, null, 2)}\n`,
    );
    run("sync-version.mjs", dir);
    const conf = JSON.parse(readFileSync(join(dir, "src-tauri", "tauri.conf.json"), "utf8"));
    expect(conf.version).toBe("../package.json");
  });

  it("syncs through the npm version lifecycle", () => {
    const dir = makeProject();
    dirs.push(dir);
    // Wire the lifecycle exactly as package.json does.
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    pkg.scripts = {
      "version:check": "node scripts/version-check.mjs",
      preversion: "node scripts/version-check.mjs",
      version: "node scripts/sync-version.mjs",
    };
    writeFileSync(join(dir, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
    // npm bumps package.json, then runs the version script.
    runNpm(["version", "2.0.0", "--no-git-tag-version"], dir);
    expect(readFileSync(join(dir, "package.json"), "utf8")).toContain('"version": "2.0.0"');
    expect(readFileSync(join(dir, "src-tauri", "Cargo.toml"), "utf8")).toContain('version = "2.0.0"');
    expect(readFileSync(join(dir, "src-tauri", "Cargo.lock"), "utf8")).toContain(
      'name = "quanta-pulse"\nversion = "2.0.0"',
    );
  });
});

describe("package.json lifecycle wiring", () => {
  it("runs version:check before the bump and sync-version after", () => {
    const pkg = JSON.parse(readFileSync(join("package.json"), "utf8"));
    expect(pkg.scripts?.preversion).toBe("node scripts/version-check.mjs");
    expect(pkg.scripts?.version).toBe("node scripts/sync-version.mjs");
  });
});
