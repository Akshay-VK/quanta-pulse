# Windows native test command — 2026-11-16

The Windows library-test runner at [`2be8ff0`](https://github.com/Akshay-VK/quanta-pulse/commit/2be8ff0) provides a repeatable PowerShell command for the Rust library suite and an explicit opt-in for the isolated native-window test. Use the canonical instructions in [Windows library tests](../testing/windows-native-tests.md).

The runner uses command-scoped MSVC manifest flags. For future checks through this runner, that replaces the prior manual post-link `mt.exe` mutation. It does not change production build configuration. The dated [manifest proof](../research/redesign/implementation-plan/contracts/windows-native-test-manifest-proof.md) records the implementation evidence; this note does not revise earlier Windows startup-smoke or native-delivery claims.

Recorded results: Windows library suite **258 passed, 1 ignored**; explicitly invoked native test **1 passed**. The execution toolchain was Rust 1.97.1, so execution on the project's minimum Rust 1.77 remains unproven. The native test uses a blank window and isolated local state; it does not establish live SSO, macOS, or packaged-app behavior.
