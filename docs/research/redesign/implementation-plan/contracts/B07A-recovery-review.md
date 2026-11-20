# B07A recovery review

## Findings

- **Medium — `deletion.rs` scope expiry/eviction can orphan staged bytes during normal process use.** A compensation failure or post-commit cleanup failure stores the stage path only in `DeleteScopeState.recovery`. Both `snapshot_delete_scope` and `delete_scope_with_ops` prune scopes solely by `created.elapsed() < SCOPE_TTL`; snapshot also evicts the oldest scope at `MAX_SCOPES`. Either operation drops recovery metadata and the only retry handle while leaving the `.stage` file on disk. This is distinct from the documented process-crash limitation: it can happen in a running process when another scope is captured or a stale scope is used after ten minutes. Smallest fix: do not expire/evict scopes with nonempty recovery; alternatively preserve the recovery record in a process-level registry independent of confirmation scope expiry, with a cleanup/retry route. Add focused expiry and max-scope tests proving the stage remains reachable.

## Resolved concerns

- **Post-commit cleanup failure counts the entry in both `removed` and `failed`.** This follows the stated result contract: `removed` counts exact index rows committed as cleared, while `failed` reports that stage cleanup failed and supplies its path. Retry sees the absent row and removes the stage without touching the original path. The focused test asserts this behavior. No finding, provided consumers treat `failed` as outstanding filesystem cleanup rather than a transaction rollback.
- Statement and commit failures call `rollback_staging` before retaining the entry; failed restoration leaves the stage in `recovery` and names it in the failure. Deferred-FK commit failure is covered. Post-stage injected failure uses the same compensation; if compensation fails, retry requires the original path to be absent before restoring, preserving a successor. Retry then repeats deletion. No defect found in these paths within reviewed code.

## Proof limits

Reviewed only `contracts/B07A-recovery-handoff.md`, `contracts/B07A-review.md`, `core/mirror/deletion.rs`, and its focused tests. Did not rerun tests; worker-reported 239 native tests are unverified here. No crash/power-loss durability is claimed or reviewed. No other mirror modules, public shapes, or whole history reviewed.
