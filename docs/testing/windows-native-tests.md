# Windows library tests

From the repository root in Windows PowerShell:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\test-windows-lib.ps1
```

This runs the complete ordinary Rust library suite. The interactive native test
stays ignored. Requires Windows, Cargo/Rust with the
`x86_64-pc-windows-msvc` target, MSVC build tools and a Windows SDK already
installed. The runner does not install or configure tools.

To opt into the existing isolated native test, use an interactive Windows
desktop with WebView2 available:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\test-windows-lib.ps1 -Native
```

This selects only
`auth::tests::native_blank_window_focus_cancel_delivery` with
`--ignored --exact --nocapture`. Expect brief blank windows and foreground/focus
changes; leave the desktop available until it finishes. The test checks show,
minimize/restore, cancellation delivery to both waiters, stale-attempt isolation
and successor cleanup. It uses `about:blank`, an isolated temporary database and
WebView2 profile, and no authenticated client. It does not run the packaged app,
start a server or perform live SSO. Desktop restrictions can make it fail.

The script always passes `--target x86_64-pc-windows-msvc --lib`. It sets
`CARGO_INCREMENTAL=0` and uses only `%TEMP%\quanta-native-test-target` for Cargo
output, independent of any existing `CARGO_TARGET_DIR`. The first run can rebuild
many dependencies; later runs reuse this dedicated cache. After all runs finish,
you may remove that directory manually to reclaim space. The script does not
delete it automatically or remove other build directories.

Command-scoped `CARGO_ENCODED_RUSTFLAGS` passes standard MSVC link-time
`/MANIFEST:EMBED` and `/MANIFESTDEPENDENCY` options for Common Controls v6.
No post-link executable mutation or `mt.exe` writes are used. The library
unittest otherwise misses the application binary's manifest, as explained in the
[preflight](../research/redesign/implementation-plan/contracts/windows-native-test-manifest-preflight.md).
Production build configuration, application manifest and other platforms are
unchanged. Bare `cargo test --lib` does not gain these flags.

The runner refuses nonempty `RUSTFLAGS`, `CARGO_ENCODED_RUSTFLAGS`,
`CARGO_BUILD_RUSTFLAGS` or `CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_RUSTFLAGS` rather
than silently replacing them. Review and explicitly clear those variables in
your test shell before retrying. Their values are never included in the
runner's errors. Cargo configuration-file rustflags are overridden by the
encoded flags; review custom Cargo configuration before using this command.
No arbitrary Cargo arguments are accepted. `TEMP` must be an existing,
fully qualified directory. Runner validation/launch errors exit 1; a completed
Cargo invocation returns Cargo's exit code, including failures. Working location
and the three changed environment variables are restored in `finally`, including
after errors. Forced process termination cannot guarantee `finally` execution.
Cargo and tests retain their ordinary diagnostic output; avoid enabling verbose
tracing or adding secrets to custom compiler/tool configuration.

Verification used Rust/Cargo 1.97.1, not Rust 1.77. The encoded-flags interface
already appears in [Cargo's Rust 1.77 documentation](https://raw.githubusercontent.com/rust-lang/cargo/rust-1.77.0/src/doc/src/reference/environment-variables.md),
including the ASCII `0x1f` separator. This establishes interface availability,
not execution of this dependency graph on 1.77. Linker options are documented by
Microsoft: [manifest embedding](https://learn.microsoft.com/en-us/cpp/build/reference/manifest-create-side-by-side-assembly-manifest?view=msvc-170)
and [manifest dependencies](https://learn.microsoft.com/en-us/cpp/build/reference/manifestdependency-specify-manifest-dependencies?view=msvc-170).
Completed repository verification is recorded in the
[proof](../research/redesign/implementation-plan/contracts/windows-native-test-manifest-proof.md).
