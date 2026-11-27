# S3 local-content search evidence

The synthetic fixtures exercise the metadata and saved-content boundaries of [#69](https://github.com/Akshay-VK/quanta-pulse/issues/69) under [#57](https://github.com/Akshay-VK/quanta-pulse/issues/57). The implementation started from integration `140a094`. All course names, documents, and observations used here are generated.

## Benchmark before enablement

Ubuntu 24.04.5 under WSL2 on an Intel Core Ultra 9 185H host, 22 logical CPUs. Node 24.18.0 executed S1/S2's production `searchDesktop` function directly. SQLite 3.45.1 executed the production snapshot SQL under an uncontended mutex with Python row materialization. Each size has 100 courses, two-level folders, ten percent unread resources, and alternating broad metadata queries. Each cold sample is the first invocation in a new process or connection against a generated fixture. Filesystem caches were not flushed. Each of five trials has one cold sample and 20 warm samples. The p95 of five cold observations uses the maximum. Warm values below are medians of five per-trial percentiles.

| Metadata rows | Policy cold p50 / p95 | Policy warm p50 / p95 | Fixture derivation p50 | Node peak RSS p50 / max | Snapshot SQL lock cold p50 / p95 | Snapshot SQL lock warm p50 / p95 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 5,000 | 88 / 128 ms | 40 / 72 ms | 2.9 ms | 199 / 200 MiB | 31 / 31 ms | 25 / 29 ms |
| 25,000 | 337 / 437 ms | 155 / 315 ms | 14.5 ms | 290 / 292 MiB | 193 / 238 ms | 171 / 188 ms |
| 100,000 | 1,386 / 3,091 ms | 759 / 1,729 ms | 78.7 ms | 497 / 509 MiB | 1,388 / 1,715 ms | 800 / 1,304 ms |

Fixture construction measured roughly 2.4 / 10.6 / 43.3 MiB median JavaScript heap growth. GC made individual heap deltas noisy. Peak RSS includes the Node and Vite loader. Policy times include per-query dedupe, folder derivation, filtering and ranking. The desktop query itself uses zero database locks after the metadata snapshot is loaded. The Python snapshot column estimates transaction plus row-materialization time. It excludes Tauri IPC. The Windows debug probe below times actual Rust row mapping.

### Supported size

Enable the saved-content prototype for **up to 5,000 metadata rows**, with a baseline policy budget of **150 ms p95** for the 5,000-row cold and warm measurements and a **40 ms p95** uncontended snapshot SQL budget on this fixture. At 25,000 and 100,000 rows the fixture exceeds both budgets, so metadata search continues with its existing complete-inventory behavior. These are measured development budgets for this host and fixture. Native WebView and slower-host latency are unmeasured.

## Built App follow-up timing

Chromium 159.0.8154.6 on the same WSL2 host opened the production Vite build through Playwright's local asset routing. The fixture bridge held metadata in the browser with the saved-text option off. Times run from the DOM input event to the animation frame in which the first corresponding palette file result is present. Cold samples are the first edit from each of five fresh browser pages. Warm results pool the subsequent 100 alternating edits. Other local checks ran concurrently, so the tail includes host contention. The measurement excludes native Tauri IPC and snapshot loading.

| Metadata rows | Chromium cold p50 / p95 | Chromium warm p50 / p95 |
| ---: | ---: | ---: |
| 5,000 | 147 / 1,096 ms | 144 / 526 ms |
| 25,000 | 504 / 561 ms | 322 / 508 ms |
| 100,000 | 1,402 / 2,234 ms | 959 / 1,894 ms |

## Native Windows snapshot timing

Windows 11 build 26200, x64 MSVC, Rust/Cargo 1.97.1 on the same physical host. The debug library probe times the complete production Rust snapshot under an uncontended application-style mutex and includes real SQLite row mapping, without IPC. Concurrent machine work contributed to the tail. The 100,000-row debug probe completed one cold read and 20 warm reads. The supplemental run was then stopped because each additional debug trial took several minutes. The pre-enablement SQL and browser tables include five cold and 100 warm samples at that size.

| Metadata rows | Windows debug lock cold p50 / p95 | Windows debug lock warm p50 / p95 |
| ---: | ---: | ---: |
| 5,000 | 127 / 199 ms | 117 / 384 ms |
| 25,000 | 1,000 / 2,461 ms | 1,047 / 2,920 ms |
| 100,000 | 11,437 ms (one observation) | 10,872 / 12,237 ms |

## Runtime and coverage

- The command palette, Library All Files and course Materials share the **Include saved text** option. **See all results** carries it into Library. The existing parsed terms, scope, filters, metadata ranking and explicit sorts still apply. To qualify as a body hit, a saved document must match every parsed free term using FTS5's literal phrase semantics. Body-only hits follow metadata hits. Snippets are bounded to 360 characters and rendered as text.
- **Build text index** and **Rebuild text index** use one cancellable blocking worker per app, building a new in-memory SQLite FTS5 index beside the authoritative store. The worker takes up to 16 source rows per read, releases the database mutex before filesystem and extraction work, and limits SQLite read statements to a cooperative 20 ms progress deadline. It attempts up to 256 indexed documents, 128 KiB each, with a cooperative 3-second build budget. Lookup has a cooperative 150 ms budget after the frontend's 100 ms debounce. An OS filesystem call already in progress can complete after the cooperative deadline. Cancel keeps the previous usable index. A restart starts with an empty index.
- Each document uses the stable resource ID, SHA-256 of the bytes, and an extraction version. Index admission requires a current available material mirror record and matching file hash. A cache copy needs the same current mirror hash and the expected managed cache path. A cache row alone carries no current-source proof. The worker uses neither the mirror history table nor academic data. The desktop command is read-only with respect to authoritative state and has no client or download call.
- Every hit rechecks the live material identity, current mirror record and file identity before publishing. Cache eviction, replacement, local deletion, source unavailability and a newer material update invalidate affected hits. Editing a saved copy externally invalidates its file stamp and the next build requires the mirror digest to agree. Rebuild explicitly refreshes coverage for newly saved copies. Skips and partial results are visible. Indexing does not write material change events or take a schema migration.

| Platform | UTF-8 TXT, Markdown, CSV and LOG | Text-layer PDF | Other formats and scanned PDF |
| --- | --- | --- | --- |
| Windows x64 | Enabled for proven local regular copies passing the bounds and MIME checks | Metadata only | Metadata only |
| macOS | Metadata only pending native extraction verification | Metadata only | Metadata only |
| Linux | Metadata only in the application | Metadata only | Metadata only |

Windows accepts the listed extensions with plain, Markdown or CSV MIME, or missing/generic MIME. Strict UTF-8, plain-text extraction rejects corrupt bytes, NULs and over-limit files. UNC paths, offline placeholders, reparse-point files, and paths outside the managed roots or within `.history` are excluded. There is no verified bounded backend PDF extractor on a shipped platform. PDF preview remains independent. OCR, historical versions, private academic data and Telegram are outside the index.

## Reproduce

```sh
npm ci
for n in 5000 25000 100000; do
  for trial in 1 2 3 4 5; do
    node node_modules/vite-node/vite-node.mjs scripts/bench/desktop-search.ts -- "$n"
    python3 scripts/bench/desktop-snapshot.py "$n"
  done
done
npm run build
# Playwright Python and its Chromium are required. The harness fulfills only
# local dist assets and uses the real App with a synthetic Tauri bridge.
for n in 5000 25000 100000; do
  python scripts/bench/desktop-search-browser.py --size "$n"
done
python scripts/bench/desktop-search-browser.py --screenshot /tmp/s3-saved-text.png
```

The native snapshot benchmark is an ignored test in `src-tauri/src/search.rs`. It uses production `desktop_inventory`, bundled SQLite, a real temporary database and a mutex. Run it on Windows with the manifest flags from the [native test runner](../testing/windows-native-tests.md), with a distinct `CARGO_TARGET_DIR` when the canonical target has a lease.

```powershell
cargo test --locked --lib --target x86_64-pc-windows-msvc search::benchmark::synthetic_desktop_snapshot_lock -- --ignored --exact --nocapture
```

The [palette screenshot](assets/2026-11-22/s3-saved-text.png) shows synthetic metadata results and labeled body hits. T3 Preview could not open a tab because its host lacked NSS/NSPR libraries. The screenshot harness used local Chromium 159 and extracted NSS/NSPR libraries with no server.

## Verification

Validation ran on assembled source tree `586550a`, including integration `b7f9c52` and its private assignment details, using synthetic fixtures throughout. The Windows commands used the documented Common Controls manifest flags with `CARGO_INCREMENTAL=0` and a distinct `%TEMP%\quanta-s3-distinct-target`. Native WebView and macOS extraction are unverified.

| Command | Result | Local log |
| --- | --- | --- |
| `npm run lint` | Passed | `/tmp/quanta-s3-lint-handoff.log` |
| `VITEST_MAX_FORKS=4 VITEST_MIN_FORKS=1 npm test` | 934 passed across 95 files | `/tmp/quanta-s3-tests-handoff.log` |
| `npm run build` | Passed with the existing Vite chunk-size advisory | `/tmp/quanta-s3-build-handoff.log` |
| `cargo check --all-targets --target x86_64-pc-windows-msvc` | Passed | `/tmp/quanta-s3-win-check-handoff.log` |
| `cargo test --locked --lib --target x86_64-pc-windows-msvc` | 325 passed, 2 ignored | `/tmp/quanta-s3-win-tests-handoff.log` |

The App regression failed before the saved-text option existed, then passed with shared filtering, relevance, escaped snippets and fallback. The bridge test checks literal argument forwarding and command names. Native regressions check atomic cancellation, replacement, manual deletion, cache eviction, explicit local removal, rebuild, invalid and oversized text, PDF metadata fallback, and exclusion of an archived file, ambiguous cached variant and synthetic private grade. They check that material events and metadata remain independent of rebuild.

Raw benchmark logs are `/tmp/quanta-s3-query.jsonl`, `/tmp/quanta-s3-snapshot.jsonl`, `/tmp/quanta-s3-browser-bench.log` and `/tmp/quanta-s3-win-bench.log`. The browser capture log is `/tmp/quanta-s3-screenshot-final.log`.
