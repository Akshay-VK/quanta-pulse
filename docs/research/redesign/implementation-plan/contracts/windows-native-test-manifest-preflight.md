# Windows native-test manifest preflight

Recommendation: add only `scripts/test-windows-lib.ps1` below. This runs ordinary Cargo tests with link-time manifest generation, including the ignored native test on request. Bare, unconfigured `cargo test --lib` remains unchanged. No implementation was applied.

Installed-source diagnosis: `tauri-build 2.7.2` (`src/lib.rs:816,873`) calls `tauri-winres 0.3.6` (`src/lib.rs:540`), which calls `embed-resource 3.0.12` (`src/lib.rs:426–448`). Because this package has `src/main.rs`, the resource directive is `rustc-link-arg-bins`; the library unittest never receives it. `WindowsAttributes::app_manifest` changes resource contents, not target selection. `Attributes::app_manifest` configures ACL metadata. Neither fixes this gap. [Tauri source](https://docs.rs/tauri-build/2.7.2/src/tauri_build/lib.rs.html).

Cargo's `rustc-link-arg-tests` matches integration-test targets, not library unittests; [Cargo 1.77 source](https://raw.githubusercontent.com/rust-lang/cargo/rust-1.77.0/src/cargo/core/compiler/custom_build.rs) uses `target.is_test()`. Generic `rustc-link-arg` works, but also affects production binaries/cdylibs. Do not add unconditional manifest flags or replace the app manifest without proving production compatibility.

Windows disposable harness: `C:\Temp\quanta-manifest-preflight`, Rust/Cargo **1.97.1**, matching library crate types, no dependencies, static `TaskDialogIndirect` import. Baseline and `rustc-link-arg-tests` both failed before test entry (`0xc0000138`); verbose invocation omitted the latter flags. With no integration target Cargo rejected that directive (101). Generic build-script flags passed normal/ignored tests. Command-scoped encoded flags also passed normal tests, then ignored tests after forced source relink. SDK `mt.exe` **extraction only** confirmed resource #1/Common Controls v6. No post-link writes. Logs: `/tmp/quanta-manifest-{preflight,env-proof}.log`.

Proposed complete new file:

```powershell
param([switch]$Native)
$ErrorActionPreference = 'Stop'
$keys = @('CARGO_ENCODED_RUSTFLAGS','CARGO_TARGET_DIR','CARGO_INCREMENTAL')
$prior = @{}
foreach ($key in $keys) { $prior[$key] = [Environment]::GetEnvironmentVariable($key,'Process') }
if ($env:RUSTFLAGS -or $env:CARGO_ENCODED_RUSTFLAGS) { throw 'Review existing Rust flags first' }
Push-Location (Join-Path $PSScriptRoot '../src-tauri')
try {
  $env:CARGO_TARGET_DIR = Join-Path $env:TEMP 'quanta-native-test-target'
  $env:CARGO_INCREMENTAL = '0'
  $dep = "/MANIFESTDEPENDENCY:type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'"
  $env:CARGO_ENCODED_RUSTFLAGS = @('-C','link-arg=/MANIFEST:EMBED','-C',"link-arg=$dep") -join [char]31
  $testArgs = @()
  if ($Native) { $testArgs = @('auth::tests::native_blank_window_focus_cancel_delivery','--','--ignored','--exact','--nocapture') }
  cargo test --target x86_64-pc-windows-msvc --lib @testArgs
  $result = $LASTEXITCODE
} finally {
  Pop-Location
  foreach ($key in $keys) { [Environment]::SetEnvironmentVariable($key,$prior[$key],'Process') }
}
exit $result
```

Commands: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/test-windows-lib.ps1`; repeat with `-Native`.

Risks/next gate: x64 MSVC only; target dependency flags trigger a separate rebuild and override configured rustflags. Production environment/manifest and other platforms remain unchanged. Repository suite/native proof was deliberately not rerun; root should run both commands after approval. Rust 1.77 execution remains unverified; its [documented encoded flags](https://raw.githubusercontent.com/rust-lang/cargo/rust-1.77.0/src/doc/src/reference/environment-variables.md) require no MSRV/dependency change. Microsoft documents [embedding](https://learn.microsoft.com/en-us/cpp/build/reference/manifest-create-side-by-side-assembly-manifest?view=msvc-170) and [dependency syntax](https://learn.microsoft.com/en-us/cpp/build/reference/manifestdependency-specify-manifest-dependencies?view=msvc-170).
