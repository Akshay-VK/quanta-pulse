# B07A core handoff

Issue: [B07A #38](https://github.com/Akshay-VK/quanta-pulse/issues/38), child of B07 #37. Base: `4badbb922628f8575b861bb2047959517af5f460`.

## Exported Rust contract

`core::mirror::MirrorDeleteScope` serializes camelCase `{ scopeId: String, count: usize }`. `Mirror::snapshot_delete_scope(&Connection) -> Result<MirrorDeleteScope, String>` captures exact saved-copy rows with status `ok`/`kept` and every retained `local_file_versions` row. Count is captured indexed file entries. Queue and unfinished attempts are excluded.

`core::mirror::MirrorDeleteResult` serializes camelCase `{ removed: usize, failed: Vec<MirrorDeleteFailure> }`; each `MirrorDeleteFailure` is `{ resourceId: i64, path: String, error: String }`. `Mirror::delete_scope(&Connection, scope_id: &str) -> Result<MirrorDeleteResult, String>` processes only pending entries from that in-memory scope. Removed means the exact entry was cleared from its index; a missing file is idempotent success and does not claim bytes were unlinked. Unknown/expired scopes return an error asking for renewed confirmation. A completed scope is removed; a failed scope remains retryable using the same ID.

Scopes are per `Mirror` instance, expire after ten minutes, and are bounded to 16. Overflow evicts the oldest scope. A restart creates a new instance and therefore rejects old scope IDs. Active publication identity uses `rel_path`, `sha256`, `size_bytes`, B02's `attempts` publication counter, `downloaded_at`, and saved status. Retained-version identity uses the exact SQLite rowid plus resource/path/hash/size/replaced time. Root path or canonical-root identity changes and saved-file identity mismatches preserve successor data and report a failure.

Each attempt validates path syntax and existing symlink containment, begins an exact SQLite transaction, verifies the captured identity, unlinks the file if present, deletes only the matching index row, then commits. This serializes with publication when callers hold the shared connection lock, in the established connection-before-root/attempt ordering. Filesystem or DB errors return a path/error failure and retain the matching row. If unlink succeeds but the DB operation fails, bytes are absent, the index row remains, and the entry stays retryable; retry treats NotFound as idempotent and clears the row. The legacy `Mirror::delete_all(&Connection) -> usize` now delegates through a fresh safe scope and no longer clears all local files, versions, or queue rows.

## Consumer notes and limits

B07B may re-export/wrap these types but should keep the core scope ID stable across retries and report unknown/expired scopes as a renewed-confirmation path. The core method returns per-entry failures; it does not change commands, registrations, frontend types, Settings UI, or Inbox.

The filesystem path check rejects traversal and canonicalized symlink escapes. A file can still be externally replaced between the last check and OS unlink; Rust's portable path APIs do not provide a cross-platform no-follow unlink primitive here. Publication and Settings root changes inside the application are serialized by the shared connection/root locks. Symlink regression is Unix-gated because Windows symlink creation is privilege/configuration dependent; traversal and injected filesystem failure regressions run on Windows.

## Proof record

Native Windows proof passed with `CARGO_INCREMENTAL=0` and `CARGO_TARGET_DIR=C:\Temp\quanta-pulse-cargo-target`:

- `cargo check --lib` — passed.
- `cargo test --lib core::mirror:: -- --nocapture` — 40 passed, including the new core deletion tests and existing B02 HTTP publication fixtures.
- `cargo test --lib` — 235 passed.
- Direct `rustfmt --edition 2021 --config skip_children=true` — applied to `core/mirror.rs`, `core/mirror/deletion.rs`, and `db.rs` only.

Regressions use temporary SQLite databases/files and a production-used injected removal operation for deterministic partial failure. The B02 HTTP barrier fixture captures before successor publication and verifies the later file survives the empty frozen scope. The symlink escape and root-retarget tests are Unix-gated because Windows symlink creation is privilege/configuration dependent; traversal, missing-root, and injected filesystem failure run on Windows. No live Quanta or native app was used.
