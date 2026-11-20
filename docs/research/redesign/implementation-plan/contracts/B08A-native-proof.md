# B08A / #45 native delivery proof — PASS

Shared dirty checkout at accepted HEAD `84c20eb`; root remains sole integrator. This record completes the native-delivery gap in `B08A-integration-proof.md`. It does not extend scope into B08B.

## Test and acceptance

Added only `auth::tests::native_blank_window_focus_cancel_delivery` inside the existing `cfg(test)` module in `src-tauri/src/auth.rs`. It is Windows-only and ignored unless explicitly requested. There is no production seam, command, plugin, application startup, or shipping test mode. It builds a real `tauri::Builder::default().any_thread()` application, runs `run_return`, and creates actual WebView2 windows at `about:blank`. Private attempts are fixture inputs; lifecycle delivery uses the **actual** `auth::focus_sso_login` and `auth::cancel_sso_login` functions, without copied lifecycle logic.

Runtime assertions passed on Windows 11 build `10.0.26200.0` (installed WebView2 versions `157.0.4341.46` and `157.0.4341.57`; selected runtime version not separately queried):

- **PASS:** hidden A becomes visible and the OS foreground window after actual focus. Minimized A is restored and becomes foreground after focus again. Assertions query User32 `IsWindowVisible`, `GetForegroundWindow`, and `IsIconic`, polling for at most ten seconds per condition.
- **PASS:** actual cancellation destroys A's HWND (`IsWindow == 0`), removes its Tauri window, publishes cancellation to both subscribed completion receivers, and releases the lifecycle slot and active flag.
- **PASS:** successor B can occupy the slot and own a second real blank HWND. Repeated stale A focus/cancel calls leave B hidden, alive, current, active, nonterminal, and without a completion result. A native dispatcher roundtrip precedes these checks.
- **PASS:** actual focus shows B and makes it OS foreground; actual cancellation then destroys B's HWND and completes its receiver. No authenticated client is installed.

The native test passed twice: first without capture (1.66s), then with a window-only capture handshake (1.74s). The optional capture handshake exists only in this ignored test. Screenshot: `C:\Temp\b08a-native-artifacts\blank-successor-B.png` (654 × 518, dark native titlebar, intentionally blank content). It was captured with `PrintWindow` against B's HWND and inspected; assertions provide the delivery proof.

## Exact commands and logs

All commands used Windows PowerShell through `/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe -NoProfile -ExecutionPolicy Bypass -File <script>`. Windows working directory: `D:\dev\web\projects\quanta-app\quanta-pulse\src-tauri`; `CARGO_INCREMENTAL=0`; `CARGO_TARGET_DIR=C:\Temp\quanta-pulse-cargo-target`.

1. `C:\Temp\b08a-native-proof.ps1`: `rustfmt --edition 2021 --config skip_children=true src/auth.rs`, then `cargo test --lib auth::tests::native_blank_window_focus_cancel_delivery -- --ignored --exact --nocapture`. Compilation passed; initial loader failure `0xc0000139` occurred before test entry. Log: `/tmp/b08a-native-proof.log`.
2. Resolved the loader issue solely in the generated test executable using Tauri's own Common Controls v6 manifest. The newly linked native code imports `comctl32!TaskDialogIndirect`; the legacy System32 DLL lacks that export. `C:\Temp\b08a-native-manifest.ps1` runs:

   ```powershell
   & 'C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64\mt.exe' -nologo -manifest 'C:\Users\aksha\.cargo\registry\src\index.crates.io-1949cf8c6b5b557f\tauri-build-2.7.2\src\windows-app-manifest.xml' '-outputresource:C:\Temp\quanta-pulse-cargo-target\debug\deps\quanta_pulse_lib-143d9d2c9ba5062c.exe;#1'
   & 'C:\Temp\quanta-pulse-cargo-target\debug\deps\quanta_pulse_lib-143d9d2c9ba5062c.exe' auth::tests::native_blank_window_focus_cancel_delivery --ignored --exact --nocapture
   ```

   **1 passed**. Log: `/tmp/b08a-native-manifest.log`. Reapply the manifest after any relink; this changes only a disposable development test artifact. No build configuration or dependency was edited. The test exe emits a harmless missing default icon-resource warning.
3. `C:\Temp\b08a-native-capture.ps1`: same exact `cargo test` command, with a bounded PowerShell capture job and `B08A_NATIVE_CAPTURE_MARKER=C:\Temp\b08a-native-artifacts\capture.hwnd`. **1 passed**. Log: `/tmp/b08a-native-capture.log`.
4. `C:\Temp\b08a-proof.ps1`: `cargo check` **PASS**; `cargo test --lib auth::tests -- --nocapture` **11 passed, 1 ignored**; `cargo test --lib` **258 passed, 1 ignored**. Log: `/tmp/b08a-final-gates.log`. The ignored native test was explicitly exercised in steps 2–3.
5. `C:\Temp\b08a-native-cleanup.ps1`: **PASS**. Log: `/tmp/b08a-native-cleanup.log`. Source diff and new-document whitespace checks passed.

## Isolation, cleanup, and limits

The builder uses a separate per-process identifier `com.quantapulse.b08a.native.<PID>`, clears configured startup windows, and registers no plugins. SQLite, file store, mirror root, and explicit WebView2 data directory all point inside each fresh temporary root. It never calls `AppState::initialize`, so the normal Documents mirror is not initialized. No installed app, credentials, production SSO URL, live authentication, or packaged executable is used.

After both test processes exited, cleanup verified zero proof executables and zero WebView2 children referencing their profiles, then removed only `C:\Users\aksha\AppData\Local\Temp\.tmprbHuj9` and `C:\Users\aksha\AppData\Local\Temp\.tmpHutoCG`. No identity-specific Roaming/Local directories existed. Existing installed app PID **35660**, started 13 November, remained running and was never signalled. Capture and logs remain as evidence.

Contract delta: **none**. Worker changes are the ignored test and this new document only; prior dirty edits are preserved. Native focus/close delivery is proved for blank Windows development windows. Live SSO success, production SSO window creation, timeout/reset integration, forced delayed close during successor creation, command/TS/UI wiring, installed-app behavior, and macOS native delivery are not claimed. Existing deterministic lifecycle tests cover the race orderings; B08B remains outside this worker's scope.
