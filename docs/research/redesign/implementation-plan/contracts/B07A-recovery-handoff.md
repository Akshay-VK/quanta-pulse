# B07A filesystem/index recovery handoff

Issue: [B07A #38](https://github.com/Akshay-VK/quanta-pulse/issues/38). Base: `4badbb922628f8575b861bb2047959517af5f460`.

## Per-entry deletion phases

Deletion still uses the frozen in-memory scope, verifies the captured saved-copy or retained-version identity, and serializes under the existing connection/root ordering. For a present file it now:

1. Renames the original to a unique same-directory `.quanta-delete-<uuid>.stage` path.
2. Deletes only the exact captured index row and commits its transaction.
3. Removes the staged path after commit.

A missing original remains idempotent and clears only the exact index row. Queue rows and unrelated saved/version rows are untouched. Partial successes remain committed independently, and failed entries stay in the same scope for retry. `removed` continues to count exact index rows cleared in this call; a post-commit cleanup failure can therefore include the entry in `removed` and also in `failed` until its staged bytes are recovered.

A staging/verification/removal failure before commit restores the staged bytes to the original path. SQL statement, zero-row identity, and commit failures also restore the original path while leaving SQLite's transaction to roll back. The code never overwrites a file that has appeared at the original path. If restoration fails, the failure includes both the staged and intended original locations; the scope retains that exact entry and staged path. Its retry restores the bytes before retrying deletion. If SQL committed but staged-file cleanup fails, the failure names the remaining stage path; the scope retains a recovery entry, and retry removes that staged file without touching a successor at the original path.

The filesystem seam used by tests shares the production order, including the staging rename. Coverage exercises ordinary trigger failure, deferred foreign-key commit failure, post-stage filesystem failure and compensation failure, post-commit cleanup failure, retry, saved rows, retained-version rows, and staging cleanup.

## Recovery boundary

The scope and staged-path recovery record are process-local. A crash or power loss after the rename can leave a `.stage` file; there is no durable journal or startup recovery scan, so this change does not claim crash/power-loss atomicity. Existing scope expiry/restart behavior remains honest: process restart invalidates the confirmation. A portable race remains possible if an external process replaces a path between validation and rename; in-process publication and root changes remain serialized as before.

## Contract delta

No public Rust API or wire contract changed. `delete_scope` still returns per-entry success/failure; cleanup failure is reported as failure even after the index transaction committed, because staged bytes remain. Consumers should display the concrete path/error and allow retry with the same process-local scope ID. No `db.rs` changes were required.

## Proof

Native Windows tests use the configured PowerShell runner, `CARGO_INCREMENTAL=0`, and `CARGO_TARGET_DIR=C:\Temp\quanta-pulse-cargo-target`. See the task completion record for exact command outcomes.
