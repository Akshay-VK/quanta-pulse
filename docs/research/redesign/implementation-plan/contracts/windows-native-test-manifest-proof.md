# Windows library-test manifest proof

Completed 2026-11-16 in the actual repository. Scope is test tooling only.
Input: accepted `772764b` and the latest working-tree
[preflight](windows-native-test-manifest-preflight.md). Observed checkout HEAD:
`4d87291578ab9c3fb74c6bb638c1686378d778ff`. No Git writes or delegates.

## Artifacts

- New `scripts/test-windows-lib.ps1`.
- New `docs/testing/windows-native-tests.md`; no existing testing guide was found.
- This new proof. No package manifest, AGENTS, build script, Rust, frontend or
  test source edits. Other workers' existing changes were left alone.

## Windows execution

WSL repository `/mnt/d/dev/web/projects/quanta-app/quanta-pulse` maps to
`D:\dev\web\projects\quanta-app\quanta-pulse`. Used the installed Windows
`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`, version
5.1.26100.9818, with `-NoProfile -ExecutionPolicy Bypass -File`.
Rust compiler: `rustc 1.97.1 (8bab26f4f 2026-07-14)`, LLVM 22.1.6;
Cargo: `1.97.1 (c980f4866 2026-06-30)`; host and explicit target:
`x86_64-pc-windows-msvc`. Installed MSVC tools: 14.51.36231;
`link.exe` file version: 14.51.36248.0. No SDK installation or host changes.

Invocations from the actual repo (ordinary user commands are also in the guide):

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\dev\web\projects\quanta-app\quanta-pulse\scripts\test-windows-lib.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\dev\web\projects\quanta-app\quanta-pulse\scripts\test-windows-lib.ps1 -Native
```

The first full run rebuilt dependencies and relinked the actual library test in
`%TEMP%\quanta-native-test-target\x86_64-pc-windows-msvc\debug\deps`:
**258 passed, 0 failed, 1 ignored**, process exit 0. The native command was run
once: **1 passed, 0 failed, 258 filtered out**, exit 0. Its output confirms A
shown/foreground, minimized/restored, HWND destroyed, both waiters completed,
stale A operations left B untouched, B shown/foreground and destroyed, no
authenticated client, blank URLs only, and event-loop exit. It logged a
nonfatal missing application-icon resource warning; the assertions passed.

After launch/error-handling hardening, the final launcher was exercised by the
full actual library suite again: **258 passed, 0 failed, 1 ignored**, exit 0.
The final `-Native` argument path was verified with the external harness; the
interactive test was not repeated. This launcher change did not change linker
flags or the already-loaded native test executable.

Logs retained outside the artifact lease:

- `/tmp/quanta-windows-lib-default.log` — initial rebuild and full suite.
- `/tmp/quanta-windows-lib-native.log` — actual opted-in native run.
- `/tmp/quanta-windows-lib-final.log` — final launcher, full suite.
- `/tmp/quanta-windows-runner-harness.log` — final safe harness checks.
- `/tmp/quanta-windows-runner-inspect.log` — read-only manifest/hash/tool checks.
- `/tmp/quanta-windows-runner-cleanup.log` — isolated native-data cleanup.

## Manifest and loader evidence

The rebuilt executable is `quanta_pulse_lib-c48e337f8495d08a.exe` in the target
directory above. Both actual test modes entered and passed through the Windows
loader without any post-link manifest writes. Standard command-scoped encoded
`-C link-arg=/MANIFEST:EMBED` and Common Controls v6
`-C link-arg=/MANIFESTDEPENDENCY:...` were the only manifest intervention.
`CARGO_INCREMENTAL=0`; the production target directory was not selected.

Installed SDK `10.0.26100.0\x64\mt.exe` was discovered dynamically for
**extraction only**, using `-inputresource:<test-exe>;#1 -out:<temporary-file>`.
Resource #1 contains `Microsoft.Windows.Common-Controls`, version `6.0.0.0`.
SHA-256 before and after extraction was identical:

```text
4CC9059E4232F91979B415E2ECED909917BC76D654818141F48B4B5D7F41F405
```

No `mt.exe -outputresource` or executable mutation was used. Application build
configuration/manifest, bare Cargo behavior and other platforms are unchanged.

## Failure and restoration checks

External Windows harness:
`C:\Temp\quanta-windows-runner-proof\harness.ps1` (not a repository artifact).
It temporarily compiled a credential-free fake `cargo.exe` and prepended its
directory to its own process PATH. The stub checks exact default/native
arguments, repository working directory, dedicated temporary target,
incremental=0 and the complete encoded flags. Same-process checks verify the
original working location and environment after each runner invocation.

Final harness passed:

- Default invocation and native exact/ignored arguments, exit 0.
- Stub writes stderr and exits **37**: runner returns exactly 37, including
  through a separate `powershell.exe -NoProfile -File` process.
- Each of the four existing Rust flag variables is refused with exit 1;
  sentinel values do not appear in runner error output.
- Relative TEMP rejected with exit 1; no sentinel disclosure.
- Invalid executable launch returns 1; environment/location still restored.
- Stub removed and harness's original environment restored.

The harness exposed two issues fixed before completion: selecting the first
Cargo application when multiple installations are on PATH, and avoiding
PowerShell 5.1's conversion of redirected native stderr into a terminating
error. The final script uses `Start-Process -NoNewWindow -Wait -PassThru` and the
process's exit code, with only fixed argument tokens. Its launch failures use a
plain controlled error, without rendering exception/environment details.

## Cleanup and limits

All proof commands reached terminal status. Inspection found **zero** matching
test processes and **zero** WebView2 processes associated with the unique
isolated native data root. The test left its isolated `.tmpsb884k` directory;
it was removed explicitly after the run. Final inspection confirms that root
and the harness stub directory are absent. No other application was stopped.
The dedicated Cargo target is retained as a disposable cache; proof harness,
extracted XML and logs are retained externally for review. No server, live SSO,
packaged application, packaging automation or host configuration changes.

Rust **1.77 was not executed**. Interface availability only was verified against
the [Cargo 1.77 primary-source environment documentation](https://raw.githubusercontent.com/rust-lang/cargo/rust-1.77.0/src/doc/src/reference/environment-variables.md)
listed in the preflight: `CARGO_ENCODED_RUSTFLAGS` uses ASCII 0x1f, and
`CARGO_INCREMENTAL=0` disables incremental compilation. Microsoft documents the
[link-time manifest dependency option](https://learn.microsoft.com/en-us/cpp/build/reference/manifestdependency-specify-manifest-dependencies?view=msvc-170).
The proof does not establish execution of this dependency graph on Rust 1.77.

Whitespace validation: `git diff --check` and explicit `git diff --no-index
--check /dev/null <file>` checks for each of the three new leased files produced
no whitespace diagnostics. The no-index comparisons return 1 because the files
are new; the working-tree check returned 0.
