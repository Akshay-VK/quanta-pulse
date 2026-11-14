# 2026-11-14: Inbox and Agenda integration

Integration commit: `e8b0302cc9e18a363faa94bca68cd3f6148aad15` (`merge: integrate Inbox and Agenda with shared material destinations`) on `feat/themes-and-student-workflows`. It merges completed Inbox/Agenda tip `1a8bec211ef6a214864ef86c27c4fa25224f14fb` (implementation `bfdd4a66ad7efea02fa784766112f6c81eff8857`) into parent `6b415c8`, preserving appearance `a53fbb4`, updater `9673bb4`, attention contracts `e89c381`, and shared material policy `d0d6af1`. This records integration of completed slices; the separate Settings and material-completion branches have not been merged here.

## Reconciled ownership

[App](https://github.com/Akshay-VK/quanta-pulse/blob/e8b0302cc9e18a363faa94bca68cd3f6148aad15/src/App.tsx) retains `useInbox`, independent complete/global grouped counts, captured read/dismiss IDs, both due-inventory owners, complete resource enrichment, base refresh generations, selected Agenda resource refresh, and rich raw/local due properties. Legacy Dashboard arrays, capped read handlers, resource read menu and generic palette bulk-read action are absent. The `today` internal route mounts Inbox; legacy TodayView remains unmounted. History's loaded read operation and independently confirmed permanent deletion retain their distinct scopes.

The same App retains material-policy inspector actions, saved-copy lookup generations, duplicate-safe `downloadAndOpen`, explicit source opening, preview/reveal/copy actions, palette inspection and complete Library query transfer, Settings navigation guards, appearance ownership, and updater install/relaunch. There was one conflicted file, App; the dated wiki index merged automatically and retains all previous entries.

[MaterialResourceRow](https://github.com/Akshay-VK/quanta-pulse/blob/e8b0302cc9e18a363faa94bca68cd3f6148aad15/src/components/MaterialResourceRow.tsx) adapts current resources or recorded-only events to the existing `materialActions` policy for actual Inbox, Agenda and extracted ActivityCalendar callers. It passes supported actions to ResourceRow's optional `destinations` interface, bypassing legacy local/open inference. App executes preview, local open, download-and-open and source open; recorded-only rows never fabricate downloadable resource identities. Source warnings remain independent of saved-copy state. Policy-driven controls and overflow remain visible without hover. The measured 800px compact breakpoint, full accessible status labels, token styling, detection-day calendar semantics, shared DetailsAdapter and MirrorProvider interfaces remain intact.

## Integration regression and rendered evidence

Three real-App regressions failed before row wiring (`/tmp/quanta-integration-red.log`): Inbox's mislabeled download opened a source rather than downloading; saved Agenda rows lacked the explicit saved-copy destination; orphan Activity rows lacked the recorded-source label. The added suite exercises download/open execution and deduplication, exact date/source/saved-copy separation, nonacknowledging preview, and orphan recorded destinations through the existing application fixture. The Agenda menu uses Radix keyboard activation; tests retain actual menu behavior and controlled Date.

Assembled gates passed:

- `npm run lint`: exit 0, zero warnings (`/tmp/quanta-integration-lint-final.log`).
- `npm test -- --maxWorkers=2 --minWorkers=1`: exit 0, 47 files / 459 tests (`/tmp/quanta-integration-tests.log`). This includes grouped unread/snapshot scopes, Agenda contexts, all four integrated material tests, palette inspection/query transfer, Settings dirty navigation, appearance, focus/keyboard and stale-result races. Expected jsdom canvas, React act and release negative-case diagnostics remain.
- `npm run build`: exit 0, TypeScript and Vite; existing chunk-size advisory remains (main JS 519.35kB, `/tmp/quanta-integration-build.log`).
- `git diff --check` and staged whitespace checks: exit 0 (`/tmp/quanta-integration-diff.log`).

No Rust files changed, so no additional Cargo check is required for this integration.

Actual integrated App captures use external illustrative adapters only, on own fixture port 1443:

- `/tmp/quanta-ui-progress-20261114/integration/inbox-inspector-dark.png`
- `/tmp/quanta-ui-progress-20261114/integration/agenda-dark.png`
- `/tmp/quanta-ui-progress-20261114/integration/agenda-inspector-dark.png`
- `/tmp/quanta-ui-progress-20261114/integration/agenda-narrow-dark.png`
- `browser-evidence.json` in the same directory records API calls, Chromium version, zero runtime errors, no desktop document overflow, and visible policy controls.

Shared preview failed twice with missing `libnspr4.so`, `libnss3.so`, and `libnssutil3.so`; the user-authorized existing Playwright/extracted-library fallback captured the real assembled source at desktop 1440×960 and narrow 820×760. All browser contexts were closed. Fixture code, CSP removal for that external browser adapter, and illustrative course identities stay outside production. These screenshots verify the browser adapter, not native opening, shipped CSP, real login, or student data.

## Exact seams for subsequent completed-branch merges

- App imports/owners/refresh: retain the complete Inbox/due/resource inventories and grouped counts. Keep `refreshCollections.current()` in background/manual refresh and never restore Dashboard read/bulk handlers. Preserve updater event installation/relaunch and settings navigation generations when the Settings worker merges.
- App `peekDetails`: retain policy primary actions and guarded local lookup plus enriched Due property and source-unavailable note; an inspector read action would need captured grouped event IDs. Existing `downloadAndOpen` remains the shared duplicate guard. Material completion may improve its selected-local completion behavior, without dropping those owners.
- App mounted callers: Inbox and Calendar now receive `onDownloadOpen` and `onPreview`; Calendar forwards both to Agenda and ActivityCalendar. Material completion must extend Library/History/tree handlers independently and retain these new callers. Pending Settings changes should reconcile labels to Inbox and leave `today` compatibility intact.
- ResourceRow: preserve the 800px compact threshold, optional `destinations` array, policy primary/preview/menu rendering, `row-material` marker, and `.row-material .row-actions` visibility rule. Legacy callers keep their existing interface until the material-completion worker converts them. If that branch introduces an equivalent execution interface, reconcile the adapter rather than retaining two conflicting destination policies.
- New views: MaterialResourceRow owns action derivation; Inbox owns displayed grouped event IDs and immutable snapshot actions; Agenda owns due contexts and selected resource validity; ActivityCalendar owns detection-day grid/keyboard/focus behavior. Do not put these actions back into legacy TodayView or replace Agenda with the old calendar.
- `details.ts` retains raw Due; App enriches it. `events.ts` timezone arguments, Sidebar grouped badge placement and stable aria-labels, nav Inbox alias, full StatusTag labels and attention/agenda CSS must survive material row styling changes.
- Tests: retain the complete `appAttention`, controlled `agenda`, `appIntegratedMaterial`, Settings dirty-navigation, appearance, palette inspect/query-transfer, keyboard, focus, race and History distinctions. Existing baseline harness defaults are adapters for old tests, not production Dashboard requests.
- Wiki index: keep all dated entries, including Inbox implementation and this integration evidence, alongside future material/Settings evidence.

Remaining acceptance: material-completion conversion of Library/History/tree and inspect-return context; Settings organization/recovery completion; assembled final accessibility/layout matrix and native AC9 smoke. No live signed-in Quanta, OS file opening/offline, Windows WebView2/macOS WKWebView, installer or packaged application was exercised. Existing History/Activity browse caps remain distinct from complete Inbox/due contracts; inventory materialization does not establish unlimited-scale performance. The overall overhaul is not complete.
