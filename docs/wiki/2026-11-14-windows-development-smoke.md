# 2026-11-14: Windows native development startup verified

On 14 November 2026, a bounded native development smoke verified startup of `Akshay-VK/quanta-pulse@b4c54f9a326bd607d8f2ac67a3f85265a42416cb` in Windows 11/WebView2. Later changes at that time were documentation only.

This supersedes the earlier startup-isolation limitation in the [final integration record](2026-11-14-final-ui-integration.md). The preflight concern was resolved by inspecting the concrete startup behavior and verifying that the default Documents course-files directory already existed and remained unchanged.

## Isolation and result

The smoke used a supported temporary Tauri configuration overlay with a separate development identifier and local Vite port. That identifier isolated app data and the single-instance key. The development executable was compiled and run with Windows Cargo; the installed executable and its existing process were left untouched. No packaged app or installer ran.

The actual WebView2 window rendered the sign-in screen with dark appearance, visible keyboard focus, username/password fields, Sign in, and Continue with BITS SSO. No credentials were entered. A [window-only screenshot](../acceptance/assets/2026-11-14/windows-dev-login.png) retains the evidence without capturing other applications.

The smoke process and Vite server were stopped. The temporary identity's app-data directories and logs were removed, and the pre-existing course-files directory's modification time remained unchanged. No repository source changed and no update was downloaded or installed. Default startup may have attempted its normal read-only update check.

## Scope and limits

This verifies Windows native development startup and login rendering only. It does not verify authenticated workspace flows, password/SSO success, a live baseline, reconnect, native file/media handling, OS appearance changes, an installed-app update, or macOS runtime behavior. The [updater diagnosis](2026-11-14-final-ui-integration.md#superseding-installed-updater-evidence) remains separate: Windows manifest retrieval timed out, without proving a specific network cause or installer failure.

Source: `/tmp/quanta-ui-windows-dev-smoke-20261114.md`; original window capture: `/tmp/quanta-ui-progress-20261114/native/login-smoke.png`. The [acceptance record](../acceptance/2026-11-14-ui-final-coverage.md) retains the broader automated and rendered coverage.
