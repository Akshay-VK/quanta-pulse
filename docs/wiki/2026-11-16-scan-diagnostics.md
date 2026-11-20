# 2026-11-16: Observed scan diagnostics acceptance

On 2026-11-16, the coordinator accepted B04A storage/query at `Akshay-VK/quanta-pulse@d369117` and B04B observation at `Akshay-VK/quanta-pulse@1e62651`. The [B04 umbrella #24](https://github.com/Akshay-VK/quanta-pulse/issues/24) and [B04B #26](https://github.com/Akshay-VK/quanta-pulse/issues/26) remain open with `ready-for-human`.

At those commits, typed discovery observations capture real course-page and material-detail boundaries; a bounded collector preserves observed order and persists diagnostics after aggregate scan finalization. Legacy scan details remain nullable. The History UI remains a separate task.

Sources: [implementation](../research/redesign/implementation-plan/contracts/B04B-implementation.md), [independent review](../research/redesign/implementation-plan/contracts/B04B-review.md), and [native Windows proof](../research/redesign/implementation-plan/contracts/B04B-native-proof.md). The latter records successful `cargo check`, one local HTTP-boundary test, three diagnostics tests, and all 209 library tests. It supersedes the implementation report’s compile-only verification limitation; it does not establish native UI rendering.
