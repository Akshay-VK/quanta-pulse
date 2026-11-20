# Quanta Pulse safety and operational architecture audit

Audit date: 2026-11-15. Baseline: `1bd0e8b5a24b05733295b5751a7bc42de7b90b43`. Read-only source audit; no application, installer, live Quanta, credentials, or release was executed. Findings distinguish source-proven behavior from unverified runtime consequences. Repository paths/line numbers below refer to that baseline.

## Current trust and data flow

- The local React main window calls registered Rust commands (`src-tauri/src/lib.rs:44`). The sole capability file names `main`, includes opener, dialogs, notifications, autostart, updater and process permissions, and has no explicit remote-origin scope (`src-tauri/capabilities/default.json:5`). This is an explicit configuration observation, not a runtime proof of every framework permission rule.
- Password login uses the official origin, Moodle form token, and a `Zeroizing<String>` password (`auth.rs:71`, `:89`, `:103`). SSO opens a separate external webview, waits to return to the Quanta hostname beyond login/auth paths, reads MoodleSession, closes the window, and verifies `/my/` (`auth.rs:195`, `:218`, `:287`). Remote SSO navigation is distinct from local command permission; no finding here claims remote SSO pages automatically receive main-window privileges.
- `QuantaClient` holds the session in memory with a host-scoped Secure/HttpOnly cookie jar (`quanta/client.rs:170`). The client and download client share cookies; each follows up to ten redirects (`:184`, `:195`). There is no centralized per-purpose route/redirect policy. A host-scoped cookie is not evidence that it is sent to an unrelated host; no credential leak via redirects was demonstrated.
- The app opens one SQLite file and one mirror/cache setup for the OS application identity (`state.rs:123`). Resource, event, baseline, settings, and mirror state have no student owner column. The mirror normally lives in Documents. Binary preview fetches are bounded and external-host previews are rejected (`commands.rs:429`, `:432`, `:468`); text previews extract readable text rather than returning raw page markup (`:475`).
- Native notification and Telegram event text share one presentation function. Telegram is opt-in, off by default; incoming bot commands are filtered by configured chat (`settings.rs:102`, `telegram_worker.rs:103`). It can send locally mirrored files and searchable course material to Telegram intentionally. This means the app is local-first with optional external user-configured sharing, not an absolute no-egress system.
- Updates check an HTTPS GitHub release feed through the Tauri updater plugin; configuration supplies a public signing key and creates updater artifacts (`tauri.conf.json:68` onward). The release workflow uses signing secrets, creates a draft, and emits updater JSON (`.github/workflows/release.yml:24`, `:82`). Actual verification/install is delegated to the plugin; no custom signature bypass was observed. This audit did not validate the live signing key, installed binary, downloaded artifact, or updater endpoint.
- Update invocation has two routes: the Rust background check uses `UpdaterExt` in `updater.rs:51`; manual frontend check/install/relaunch is centralized in `src/lib/api.ts:105–117` and invokes the updater/process plugins directly. Only preparation crosses the custom `prepare_for_update` command. Mirror networking uses its `MirrorCtx.client: Option<Arc<QuantaClient>>` (`core/mirror.rs:97`, `:544`), including the shared-cookie download client; Telegram has its own independent `reqwest::Client` (`core/telegram.rs:207–224`). Draw these as distinct outgoing paths.
- Session reset has a real operation admission gate (`auth_resetting`), cancellation, draining, and a cancelled-inventory guard (`auth.rs:382–429`; `state.rs:72–90`; `sync/engine.rs:27–47`, `:156`). Logout and update preparation do not have equivalent full admission semantics.

## Findings

### S1 — Verified identity metadata is discarded from the stored session

**Priority:** high before academic collection. **Classification:** confirmed implementation defect; high confidence, source-level.

`auth.rs:283` builds an `Arc<QuantaClient>` from `session.clone()`. After fetching `/my/`, lines 297–310 enrich a *different local* `session` with `user_id`, `sesskey`, and `fullname`, but line 318 stores the earlier client. SSO initially supplies all three as `None` (`:261–268`), so verified values never reach `client.session`. `auth_status` subsequently reads that stored client. The local email label may be updated in SQLite while the client retains its older label. Password login can mask the problem when its first response already provided these facts.

**Consequence:** academic collectors cannot safely depend on the supposed verified current user ID/session key, and SSO labels may be inconsistent. This does not prove login authentication itself fails: cookie verification already succeeded.

**Proposed deepening:** authentication module owns a fully verified session observation before publishing the active client. Keep temporary verification work internal to its interface. Test self-ID, fresh sesskey/name, and stale-label replacement using a synthetic verification response; assert published state, not just parser results.

### S2 — No student ownership seam for persistent state or normal account changes

**Priority:** high expansion gate. **Classification:** confirmed missing ownership model; cross-account contamination is an unverified runtime risk.

`state.rs:123` always opens the same SQLite path; `migrations/0001_init.sql:15`, `:27`, `:51` key courses/resources/events without account identity. `auth.rs:348–356` logout only removes two settings and clears the active client; it does not drain a scan or purge/partition local academic records. A scan obtains a cloned client at `sync/engine.rs:103` and can outlive clearing the shared client. The robust `restart_quanta_session` gate is specific to reset; no generation/owner fencing was found around ordinary logout/login publication.

**Consequence:** extending the existing tables with personal marks/submissions would leave ambiguous ownership and stale work after an account switch. This audit did not execute an A→B login race or observe another student's records. Existing local material retention is not itself a security incident.

**Proposed deepening:** define the supported product rule first: single verified student per local workspace with an explicit switch workflow, or separate student workspaces. An identity module must guard publication and active-work generations; academic reads/writes must carry the verified owner. Keep old offline content only with an explicit ownership/retention policy. Test A→logout→B, delayed A scan/preview/download, process restart, and a failed switch with temporary SQLite and synthetic sessions.

### S3 — Pre-migration backup decision compares versions as strings

**Priority:** high before schema expansion. **Classification:** confirmed defect; high confidence. Shared finding with backend audit.

`db.rs:56` uses `app_version > v.as_str()` to decide whether to back up; migration still runs at line 65. For example, the string `0.10.0` sorts below `0.9.0`, so that upgrade can migrate without the promised prior-version backup. The code's backup-on-failure contract at `db.rs:41–47` is valuable; its version decision undermines it at multi-digit versions and other version transitions.

**Proposed change:** give the migration module explicit schema revisions and a semantic app-version decision where app versions remain relevant. Preserve SQLite-consistent backups and fail-before-migration on backup failure. Test 0.9→0.10, 0.3→0.10, prerelease transitions, same-version startup, unknown legacy version, and downgrade policy. No new database adapter is needed; temporary SQLite is the test setup.

### S4 — Secret configuration is part of ordinary settings and backups

**Priority:** medium now; resolve before adding more credentials/export formats. **Classification:** confirmed storage/surface behavior, not a demonstrated unauthorized read.

`Settings` serializes `telegram_bot_token` as an ordinary optional string (`settings.rs:62–65`); `db.rs:347–352` writes the whole object as SQLite JSON; `commands.rs:321` returns the full Settings object to the main renderer. Full database backups copy this value (`db.rs:93`). Settings clones also spread the token across worker snapshots. Log redaction and `reqwest::Error::without_url()` are useful protections but do not remove this plaintext from settings/backups.

**Proposed deepening:** a secret-storage module keeps a small set/update/clear/check workflow; normal preference reads expose configured status rather than secret values. Use the OS credential store adapter where supported, with explicit migration and recovery behavior. Do not silently drop a working token or claim local SQLite is encrypted. Test migration, credential-store failure, clearing, old-backup handling and renderer redaction. Separately decide whether personal academic data needs encrypted-at-rest storage; do not impose encryption without a recoverability model.

### S5 — Request meaning and safe collection policy are not one owned responsibility

**Priority:** high before grade/attendance collectors. **Classification:** confirmed coarse behavior plus future collection risk; no live Quanta side effects observed.

HTTP 403 is mapped to expired login in `quanta/client.rs:246` and related byte/download/head paths; discovery/engine propagate that to a scan-wide stop. `tests/session_expiry.rs:94` intentionally locks in a course-page 403 expiry case, so report-specific distinction is a behavior change, not mechanical extraction. Initial preview checks require http(s) and Quanta hostname (`commands.rs:429–432`), while hostname identity (`urlnorm.rs:58`) and generic ten-hop redirects (`client.rs:184`) do not express safe read-route intent or final-origin validation. HTML `fetch` buffers `resp.text()` without a body ceiling (`client.rs:256`).

**Proposed deepening:** a request-reading module owns transport facts, login recognition, optional-report denial, response/body limits, and per-purpose navigation constraints. Reuse current HTTP plus synthetic local responses; do not add a token adapter or general network framework prematurely. Preserve ordinary file-download redirects where needed; do not globally forbid them without fixtures. Add denied-report vs real-expiry fixtures, redirect chains, non-HTML/error pages, oversized/decompressed bodies, and known-safe route checks.

The existing academic research documents why request intent matters: assignment page views can update completion; Attendance mobile/self-mark paths can mark attendance; course-log automarking can be influenced indirectly by reads. Those are upstream-supported concerns, not verified Quanta settings. Do not describe any GET-only crawler as inherently side-effect-free.

### S6 — Telegram events are acknowledged before delivery succeeds

**Priority:** medium current reliability defect. **Classification:** confirmed control-flow defect; no live message-loss reproduction.

In `notify.rs:94–99`, merely enabling Telegram puts the event into `handled`; line 103 starts `telegram_worker::forward`, and line 107 marks it notified. Forwarding is fire-and-forget (`telegram_worker.rs:194–215`); an eventual send failure only logs (`:232–233`). A crash/offline failure after acknowledgment can therefore leave no queued retry. One shared notified marker also cannot represent successful native delivery and failed Telegram delivery independently.

**Proposed deepening:** delivery module owns per-transport attempts, outcomes and durable retry state. A local outbox seam is justified by existing asynchronous external delivery; keep bounded backoff and a clear policy for duplicate delivery around crashes. Tests should simulate native success/Telegram failure, worker crash before acknowledgment, restart, disabled transport, and duplicate retry. Do not promise exactly-once delivery from local acknowledgments alone.

**Academic expansion constraint:** current native/Telegram rendering deliberately shares text (`notify.rs:47`; `core/telegram.rs:92`), so academic event details must be omitted by default or explicitly opted into per destination. Existing categories reject unknown kinds, so academic events are not currently leaking automatically; the risk appears when new kinds join that pipeline.

### S7 — Update preparation cancels current work without holding an admission gate

**Priority:** medium. **Classification:** source-supported lifecycle race risk; no installed update or concurrent race reproduced.

`commands.rs:1114–1136` sets the scan cancellation flag, polls `state.is_busy()`, and returns once idle. It does not hold a gate through installation. Unlike `auth_resetting`, a future scheduled/manual scan can be admitted and resets `cancel=false` (`sync/engine.rs:25–42`); a preview can also begin when no auth reset is active (`state.rs:81`). Telegram forwarding tasks are separately spawned and are not a complete installation drain contract. Existing tests assert cooperative cancellation leaves monitoring enabled, which is correct but narrower than exclusive quiescence.

**Proposed deepening:** a lifecycle module provides reversible admission control for install/reset/shutdown purposes, with a defined drain set and release-on-failure. Keep “failed update leaves monitoring alive” as an invariant. Test the race between final idle check and a new scan/preview; verify failed preparation/install releases the gate. This is a correctness improvement, not a reason to stop background work permanently.

### S8 — Release validation does not itself require the tested tagged revision

**Priority:** medium operational gap. **Classification:** confirmed workflow omission; repository protections and actual release state unverified.

`.github/workflows/ci.yml:3` runs frontend/Rust checks on PRs and main pushes; Rust is Windows-only (`:45`). `.github/workflows/release.yml:30` verifies the tag commit is reachable from main and checks version/config (`:73–77`), then builds the signed draft (`:82`). It does not depend on successful CI for that exact SHA or run the complete tests itself. Main ancestry is not proof of a green matching run; whether repository rules supply that guarantee was not inspected.

**Proposed change:** require verified same-SHA gates or reusable CI before producing a publishable release; preserve draft publication and signature checks. Add macOS checks if macOS remains a supported shipped target, and bounded native smoke evidence for authentication, filesystem opening, updater failure recovery, and new academic collection. CI's stable Rust job does not verify the declared minimum Rust 1.77; either test that support claim or document a supported toolchain policy.

## Further hardening notes, not demonstrated vulnerabilities

- CSP is explicitly disabled (`tauri.conf.json:26`). Add a tested content policy compatible with local previews, fonts, and the bridge, and review the broad main-window permission list before adding more powerful commands. No script injection exploit or unauthorized remote invocation was established; text extraction and React's normal text rendering are existing protections. Do not confuse CSP with command/window authorization.
- The logging module redacts marker-bearing lines and Telegram errors strip request URLs (`logging.rs:14–42`; `core/telegram.rs:200–203`). This is not a guarantee that arbitrary future grade/attendance values, personally identifying URLs or raw page bodies are safe to log. Retention/diagnostic export should explicitly exclude academic contents. No secret log was inspected or exposed.
- The current code comment in `quanta/mod.rs:4` asserts web services are disabled on Quanta. The research reports correctly treat current installed configuration as unverified; retain that distinction rather than turning an old comment into a current capability claim.

## Strengths to preserve

- Password zeroization and login-token handling; verified-session check; process-memory session cookies rather than DB credential/session persistence.
- Gated, draining session reset with guards against overlapping SSO/reset and cancelled inventories.
- Host-aware cookie jar, HTTPS official origin, finite ordinary requests, finite/chunk-aware downloads, bounded binary previews and external preview rejection.
- Readable-text extraction instead of returning arbitrary authenticated HTML into the UI; scheme-checked external opening and ID-based local file commands.
- Mirror path sanitation, rejection of relative traversal and canonical ancestor containment checks (`core/mirror/paths.rs:75`, `:139`, `:160`); broad path tests already exist. No path exploit was established.
- Telegram defaults disabled; configured-chat filter; local-mirror-only file selection; token URL error redaction; notification quiet hours/category controls.
- Consistent SQLite backup operation and fail-before-migrate if backup fails, despite the version-compare defect.
- Signed-updater configuration, draft release, version/config checks, isolated CI and frontend/updater regression tests. No reason for a wholesale updater rewrite.

## Proposed organization and safe rollout

1. Fix verified identity-publication and semantic-backup defects with focused regressions. Avoid bundling these behavior fixes into broad file moves.
2. Deepen content collection as already selected; preserve behavior using existing HTTP fixture technique and add positive collection tests. Keep session request policy and lifecycle helpers private until their real callers justify a stable seam.
3. Establish verified student ownership plus stale-work rejection before persistent personal academic records. Make an explicit single-student workspace rule acceptable; multi-account support is not required to achieve isolation.
4. Add distinct academic observations with quiet first-domain baselines, capability/freshness states and domain-specific absence rules. Never map unavailable grades to zero or unmarked attendance to absence.
5. Give academic notification contents and transport permissions an explicit opt-in path; separate delivery tracking if reliable forwarding is a product promise. Keep secrets out of preference snapshots and backup exports.
6. Roll out assignments, then grades, then detected attendance. Use sanitized/synthetic fixtures and valid read routes; verify upstream view/completion/automarking policy rather than making a no-side-effects claim.
7. Gate each slice on frontend lint/tests/build, Windows cargo check/tests, migration backup/rollback proof, and narrow native smoke for the affected seam. Document unavailable platform/live coverage separately.

For diagrams: local renderer → command module → focused application modules → local stores/external adapters. Draw separate external arrows for Quanta/BITS authentication, optional Telegram, and the GitHub updater feed. Proposed identity/lifecycle/request modules sit around those effects; future academic records have owner/domain freshness and separate reconciliation rather than joining the material mirror indiscriminately.

## Coverage and limits

Reviewed: `AGENTS.md`, domain/wiki references; `auth.rs`, `client.rs`, relevant `state.rs`, commands and scan gates; `lib.rs` registration/startup; config/capabilities; settings/logging; notification and Telegram worker/client; updater/check/install preparation; migration backup/settings storage and schema ownership; mirror path protections; all four workflows; release configuration helper/package manifests; related auth, expiry, updater/release and path tests. Existing `docs/wiki/2026-11-14-windows-development-smoke.md` proves only startup/login-screen rendering, explicitly not successful live authentication or updater installation. Deeper frontend and persistence/collection correctness belong to the other audit agents.

Not performed: exhaustive line-by-line review of generated lockfiles or vendor ZIP implementation; dependency CVE scan; penetration testing; live Quanta configuration/token probing; native macOS/Windows authenticated flow; signature/certificate validation of a downloaded release; new test executions. This report is a source audit with concrete mechanisms, not a security certification.

Read-only verification run during this audit: `npm run version:check` passed (`0.3.0`); `npm run release:config:check` passed (configured endpoint/key are present and non-placeholder). These checks do not prove feed reachability, key correctness, signed-artifact validity, or installer operation. No signing, release, installer, or app command was run.
