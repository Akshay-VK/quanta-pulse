# B04B native Windows proof

Date: 2026-11-16

Runner: `/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe` (Windows PowerShell 5.1.26100.9818). The temporary runner was `C:\Temp\b04b-native-proof.ps1`. It changed directory to `D:\dev\web\projects\quanta-app\quanta-pulse\src-tauri`, set `CARGO_INCREMENTAL=0` and `CARGO_TARGET_DIR=C:\Temp\quanta-pulse-cargo-target`, then executed these native Windows Cargo commands:

| Command | Result | Exact test count |
| --- | --- | --- |
| `cargo check` | Exit 0; `Finished dev profile [unoptimized + debuginfo] target(s) in 4.99s` | — |
| `cargo test --lib observer_reports_real_course_and_detail_http_boundaries -- --nocapture` | Exit 0; `test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 208 filtered out; finished in 0.01s` | 1 passed |
| `cargo test --lib diagnostics -- --nocapture` | Exit 0; `test result: ok. 3 passed; 0 failed; 0 ignored; 0 measured; 206 filtered out; finished in 0.03s` | 3 passed |
| `cargo test --lib` | Exit 0; `test result: ok. 209 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 5.40s` | 209 passed |

The test executable ran natively from `C:\Temp\quanta-pulse-cargo-target\debug\deps\quanta_pulse_lib-143d9d2c9ba5062c.exe`; this is runtime proof, not compile-only proof. The observer test used its local HTTP fixture. No live Quanta endpoint or packaged app was used. This records the Windows environment and Rust library tests only; it makes no claim about UI tests or other platforms.
