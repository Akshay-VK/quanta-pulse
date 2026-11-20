# B07A independent review

**Review base:** `4badbb922628f8575b861bb2047959517af5f460`
**Scope:** `core/mirror.rs`, `core/mirror/deletion.rs`, and `db.rs` saved-copy/version helpers only. UI changes excluded.

## Findings

- **Medium — `src-tauri/src/core/mirror/deletion.rs`, unlink before index commit:** If the SQL delete or transaction commit fails after `remove_file` succeeds, the transaction preserves the index row but the indexed bytes are gone. This is explicitly admitted by the handoff and the injected-trigger regression. It retains the matching row and the same frozen scope can retry (NotFound then clears it), so it meets the literal “retain matching rows and report failure” clause; however, it temporarily violates index truth and the row still appears to represent an available saved copy. Smallest robust correction: rename the file to a same-directory temporary tombstone, update/commit the index, then remove the tombstone; on DB failure, rename it back and report failure. If rollback can fail, surface that separately. Otherwise narrow the consumer contract to state explicitly that DB failure may leave an indexed-but-missing file until retry.

## Identity and scope assessment

The saved-copy identity includes path, hash, size, status, `attempts`, and `downloaded_at`. `attempts` is a persisted counter, not an in-flight attempt ID: failure bookkeeping and successful publication increment it from the prior row. A same-path, same-byte completed publication is intentionally not a new publication (it retains the prior row); a replacement publication increments the counter, so second-precision timestamp repetition does not collapse it. The in-memory attempt ID is not used here and would not be an adequate durable identity. The code checks identity before unlink and deletes only the matching captured row. Versions use rowid plus their indexed fields.

Root checks, relative-path containment, symlink validation, frozen remaining-entry retries, and no blanket queue/index clear are consistent with the handoff. Filesystem removal failures retain entries and index rows. The barrier proof captures an empty scope before publication; it proves uncaptured downloads remain outside deletion, but does **not** prove replacement of an already captured saved file. The changed-publication unit case changes `attempts` directly rather than exercising a real B02 publication over a captured saved row. The persisted counter logic supports the intended behavior, but that specific regression is absent.

## Proof limits

The handoff reports Windows `cargo check --lib`, 40 focused mirror tests, and 235 library tests passing. I did not rerun them. Symlink and root-retarget tests are Unix-gated; no native Windows proof covers those branches. No whole mirror history or test module was reviewed.
