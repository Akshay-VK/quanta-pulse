# 2026-11-21 S1/S2 search integration checkpoint

Search issues [#58](https://github.com/Akshay-VK/quanta-pulse/issues/58) and [#59](https://github.com/Akshay-VK/quanta-pulse/issues/59), under [#57](https://github.com/Akshay-VK/quanta-pulse/issues/57), are integrated locally on `feat/search-academic-expansion`, pending review corrections and final gates. Neither ticket nor the parent is accepted or closed by this checkpoint.

## Code and preservation

- Root before integration: `a61932c23dff15ea7da7991d1ff3855de874e853` (clean).
- Immutable search source: `0b80b58dce9215c8a173a7c771b8c1cf18db593d`, from source worktree `t3-b0a93395`; includes common base `377c97c537584ad508e0827b510a9cf00e0f1bb8`, R2 and R1/auth proofs. Search implementation checkpoints are `d43ac3c` and `96a1799`.
- Integration merge: `fad3b486c44daa9103a76f66c04bd0bad292455b`, conventional `--no-ff`, with parents `a61932c23dff15ea7da7991d1ff3855de874e853` and `0b80b58dce9215c8a173a7c771b8c1cf18db593d`. No conflicts or source edits by the integrator.
- Compared with the source tip, the merge differs only in `src-tauri/src/db.rs` and the three inherited wiki files. The root prerelease comparator/helper and two upgrade tests from `4ed4b79882c78237d8082b75da72e046637bcab6` are preserved byte-for-byte, as are root R1/R2/auth implementation and regression paths. The search source delta is 26 files.

The command `list_search_inventory` is registered, its handler holds one state connection lock, and the helper reads courses/resources in one SQLite transaction. Rust `DesktopSearchInventory` uses camelCase serialization and matches TypeScript `courses: Course[]` / `resources: Resource[]`; the sole frontend invoke boundary remains `src/lib/api.ts`. This structural check does not resolve the separately reviewed unread-fact snapshot gap below.

## Inspected evidence and limits

No frontend/native suite was rerun during this conflict-free integration. A0 holds the canonical Windows runner; it was not used. Retained logs were inspected, not newly produced:

| Provenance | Result | Retained log |
| --- | --- | --- |
| Search source `0b80b58` frontend | 895 tests / 89 files passed; bounded invocation `VITEST_MAX_FORKS=4 VITEST_MIN_FORKS=1 npm test` | `/tmp/quanta-search-assembled-test.log` |
| Search source frontend lint/build | `npm run lint` and `npm run build` passed; existing Vite chunk-size advisory | `/tmp/quanta-search-final-lint.log`, `/tmp/quanta-search-final-build.log` |
| Search source Windows library suite | 294 passed, 0 failed, 1 ignored, 0 filtered | `/tmp/quanta-search-assembled-rust-test.log` |
| Search source Windows all-targets check | `cargo check --all-targets --target x86_64-pc-windows-msvc` passed | `/tmp/quanta-search-assembled-rust-check.log` |
| Independent root prerelease repair `4ed4b79` | 15 Windows upgrade tests passed (including the two added tests); all-targets check passed | `/tmp/quanta-57-prerelease-upgrade-tests.log`, `/tmp/quanta-57-prerelease-check.log` |

The combined merge includes the root's two extra Rust tests, but its assembled native suite has **not** been rerun. There is no evidence of a 296-test assembled pass. Frontend source/test/config content equals the tested search candidate; backend differs by the independently tested prerelease repair. Parent final-review gates remain pending.

Fresh `git diff --check a61932c fad3b486` reports trailing whitespace at `tests/appDesktopSearch.test.tsx:81` (a whitespace-only line). It is inherited from the immutable search tip, contradicting the implementation handoff's reported whitespace pass. The integrator preserved source and reports it for parent cleanup; no behavioral change was made. Documentation-only whitespace checks pass separately.

Existing real-App browser fixture screenshots under `/tmp/quanta-search-screenshots/` were already shown during this work session. No unchanged UI was recaptured. They use synthetic data and do not establish native WebView2/WKWebView interaction or live Quanta acceptance. Those smoke gates remain unperformed. S3 scale benchmarks/content indexing and academic-domain delivery remain separate work.

## Pending review corrections

The completed read-only spec review `/tmp/quanta-57-search-review-spec.md` reports:

- F1 P2: deadline queries do not consume the shared App clock, so visible results can freeze across instant deadlines or configured-zone midnight.
- F2 P2: Materials row unread indicators use an independent Activity publication while matching uses App unread facts.
- F3 P2: widening Materials scope drops its existing category constraint from the serialized handoff.
- F4 P2: search unread membership uses separately queried History/Inbox facts outside the atomic course/resource transaction; a coherent filtered inventory revision is not established.
- F5 P3: course ranking scores only its displayed label rather than the best canonical/short/display name.

The standards review `/tmp/quanta-57-search-review-standards.md` reports S-1 P3 query rewriting/selection inside presentational `SearchControls` and S-2 P3 duplicate category activity/guard predicates in `desktopSearch`.

Per this integration work session's explicit ownership, a separate implementation agent will address the four P2 production contracts and regressions; the parent handles F5, both standards findings and small cleanup after the clean handoff. No review fixes were implemented or delegated here. The reports identify source-supported defects; this integration did not execute new reproductions. Keep #58/#59 open with existing labels pending corrections, review and final acceptance.


## 2026-11-21: Small search-review corrections verified

On 2026-11-21, `Akshay-VK/quanta-pulse@35fd65bd8f8207f0c81ec9557701c5cb8a908036` corrected the three small S1/S2 review findings: query editing/value policy moved from SearchControls to the pure palette-query module, duplicate category guards were removed, and course ranking scores the best canonical/short/display name. It also removed the inherited test whitespace noted above. The new exact-name-versus-alias-prefix regression failed before the ranking correction and passed afterward; filter-edit coverage preserves quoted phrases and independent read/saved dimensions.

Fresh verification of that source tree passed lint, all 897 frontend tests across 89 files, and the production build (existing chunk-size advisory retained). Evidence: `/tmp/quanta-57-search-small-red.log`, `...-lint.log`, `...-tests.log`, and `...-build.log`; the full bounded run used `VITEST_MAX_FORKS=4 VITEST_MIN_FORKS=1 npm test`, without timeout changes. No Rust source changed in this correction. This supersedes the specific P3/whitespace pending claims above; the four P2 consistency findings and final S1/S2 acceptance remain pending in their own workstream.
