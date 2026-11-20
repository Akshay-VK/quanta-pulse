# Quanta Pulse: feature and desktop UI references

Research date: 2026-11-14. Repository baseline: `1bd0e8b5a24b05733295b5751a7bc42de7b90b43` (current-checkout code review). External evidence below comes only from official product pages and documentation actually read. **Verified** describes documented behavior, not hands-on testing; **Study / recommendation** is subjective design judgment. This is an unranked reference set, not a popularity comparison or a claim of shared architecture.

Quanta Pulse's constraints remain Tauri on Windows/macOS, private local SQLite, and no Quanta Pulse cloud or account; Moodle authentication is separate. Today digest, Inbox read/dismiss, course library, previews, mirrored downloads and version retention, Agenda, history, search/filter, command palette, themes, quiet hours, health, and Telegram already exist. They are context for refinement, not proposed additions.

## Seven references

### Linear — dense lists and contextual attention

**Verified.** Linear offers macOS and Windows desktop clients. Its account/workspace model includes login and access controls; it is a hosted-service reference, not evidence for a private local-only architecture. [Desktop availability](https://linear.app/docs/get-the-app), [security and identity](https://linear.app/security).

Its Inbox supports keyboard list navigation, notification-specific detail, contextual actions, and snoozing until a selected time. Custom Views save filtered lists or boards and can be favorited into the sidebar. [Inbox](https://linear.app/docs/inbox), [Custom Views](https://linear.app/docs/custom-views).

**Study / recommendation.** Examine the Inbox screenshot, notification detail, display-options menu, and filtered-list “Save view” affordance. Borrow alignment, restrained metadata, clear selected-row treatment, and the distinction between acting on a notification and acting on its underlying material. Keep Quanta's recorded change separate from current material properties. A smaller student workflow should not inherit Linear's team hierarchy or administrative chrome.

### Readwise Reader — reading context and offline confidence

**Verified.** Reader has Mac and Windows desktop apps, authenticates through Readwise, and supports offline use with later synchronization. Its privacy policy says it collects account details, saved content, and usage/error data; private-by-default content is not the same as local-only storage. [Desktop apps](https://docs.readwise.io/get-started/desktop-apps), [account/offline FAQ](https://docs.readwise.io/reader/docs/faqs), [privacy](https://readwise.io/privacy-policy).

Filtered Views support named saved queries and configurable status tabs, including a Later/Shortlist/Archive arrangement. Offline settings expose section selection and download progress. [Filtered Views](https://docs.readwise.io/reader/docs/faqs/filtered-views), [offline coverage](https://docs.readwise.io/reader/docs/faqs#can-i-select-which-documents-are-cached-for-offline-reading).

**Study / recommendation.** Inspect the product's Inbox/reading screenshots, filtered-view title menu, document information, and Offline Documents settings. Use a readable content column with secondary facts nearby; make saved-copy coverage explicit before travel. Separate “noticed this update” from “intend to study this.” Borrow that information structure without importing cloud synchronization or automatic reading-progress measurement. [Official product tour](https://readwise.io/read).

### NetNewsWire — a focused source/list/content workspace

**Verified.** NetNewsWire is free/open source for Mac, iPhone, and iPad; the current desktop download requires macOS 15+. It supports direct feed downloading alongside iCloud and third-party sync services. Its older Mac help documents an “On My Mac” account separately from syncing accounts: that is a local collection, not a required vendor-cloud login. [Current product/platforms](https://netnewswire.com/), [versioned account help](https://netnewswire.com/help/mac/5.0/en/syncing-accounts.html).

The privacy policy describes opt-in crash logs and aggregate website traffic logging. Those qualifications matter: avoid treating it as proof of zero network services or identical telemetry policy to Quanta. [Privacy](https://netnewswire.com/privacypolicy.html).

**Study / recommendation.** Use the official light/dark Mac screenshots to examine the source sidebar, article list, reading pane, toolbar, and selection contrast. This is a useful reference for giving existing course navigation and preview content distinct jobs within one window. Keep source counts subordinate to titles, and test whether long Moodle names remain legible at minimum width. Translate the hierarchy to Windows conventions instead of copying Mac controls literally. [Mac screenshots](https://netnewswire.com/screenshots-mac-7.html).

### Reeder — continuity without counter pressure

**Verified.** The new Reeder lists macOS 14+ and iOS 17+, uses a unified timeline, and synchronizes timeline position rather than unread counts. It fetches content directly and uses the user's iCloud account for synced subscriptions, position, and tagged items. Its policy says Reeder collects no data, except Apple-controlled collection; optional Shared Feeds are publicly hosted. [Product and privacy](https://reederapp.com/).

Reeder Classic remains a distinct traditional RSS app. The new app's help says refresh waits for completion before displaying new items to avoid jumping the user's scroll position. [Classic distinction](https://reederapp.com/classic/), [refresh behavior](https://reederapp.com/help/).

**Study / recommendation.** Examine the new Reeder's timeline, filter controls, and refresh behavior; use Classic's Mac screenshot specifically for its traditional reading layout. Borrow calm spacing and continuity while new scan results arrive. Keep Quanta's explicit read/dismiss and baseline semantics: timeline-position tracking is a design alternative to understand, not a replacement recommendation. Neither Reeder's Apple-only platform scope nor its iCloud model matches Quanta's deployment constraints.

### Things 3 — personal intent and precise scheduling

**Verified.** Things is sold for Apple platforms, with no Windows or browser app. Single-device use works without Things Cloud; synchronization requires a Things Cloud account. Its policy describes crash/device information and collection of submitted content when Cloud is used. [Platforms](https://culturedcode.com/things/support/articles/2803552/), [optional Cloud](https://culturedcode.com/things/support/articles/2803586/), [privacy](https://culturedcode.com/privacy/).

Today, Anytime, Upcoming, and Someday distinguish when work becomes actionable. The scheduling documentation explicitly separates start dates from deadlines. [Scheduling](https://culturedcode.com/things/support/articles/2803579/).

**Study / recommendation.** Inspect Today/This Evening, project headings, and the compact Jump Start date picker. Borrow whitespace, predictable inline expansion, and clear labels for personal scheduling. For Quanta, a student's chosen study time must remain distinguishable from a Moodle deadline and from whether an update has been read. Use these patterns to refine existing Today/Agenda presentation and a bounded personal queue, without turning Quanta into a full task manager. [Feature screens](https://culturedcode.com/things/features/).

### Raycast — actions attached to a selected result

**Verified.** Raycast offers Mac and Windows apps; the Windows page documents offline core features. Its FAQ's no-web-account statement is Mac-specific, so it should not establish Windows onboarding requirements. The FAQ acknowledges anonymous interaction/error tracking; the privacy policy distinguishes local operation from cloud/account/AI processing. [Windows](https://www.raycast.com/windows), [FAQ](https://www.raycast.com/faq), [privacy](https://www.raycast.com/privacy).

The Action Panel exposes contextual actions for the selected item, a primary Enter action, searchable alternatives, shortcut hints, and Escape navigation. [Action Panel](https://manual.raycast.com/action-panel).

**Study / recommendation.** Examine Root Search with a file selected, its Action Panel, and nested action navigation. Improve Quanta's existing palette by keeping the selected material's identity visible while switching from finding to acting. Show only capabilities valid for that material and distinguish opening the Moodle source from opening a saved file. This interaction pattern is useful independently of Raycast's extension ecosystem, subscriptions, or AI features.

### Eagle — a library of tangible local assets

**Verified.** Eagle supports Windows and macOS and presents tags, folders, smart folders, and multiple-format browsing. Its privacy policy says app database content stays on the local drive, while also disclosing Google Analytics for anonymized app usage. Its license recovery uses purchase/activation email. Local content therefore does not imply Quanta's no-telemetry/no-account model. [Product](https://eagle.cool/), [privacy](https://en.eagle.cool/privacy), [licensing](https://en.eagle.cool/license-retrieval).

**Evidence limit.** Current support article fetches exposed headings/navigation without explanatory bodies. Exact account-login and offline activation requirements were not established; do not infer perpetual offline operation from local storage. [Activation topics](https://en.eagle.cool/support/licensing-and-purchase/activation).

**Study / recommendation.** Examine the official collection/organization/browsing demonstrations and Inspector entry point: the useful question is how selection, preview, file facts, and personal organization fit together. Borrow the sense of a concrete local object for Quanta's materials and saved copies. Keep a document-oriented list as the default; a designer's thumbnail wall is less useful for similarly named lecture PDFs. [Product demonstrations](https://eagle.cool/), [Inspector reference](https://en.eagle.cool/support/article/interface-inspector).

## Seven incremental proposals — inferences, not implemented claims

These bounded ideas derive from a quick code review at the baseline SHA above. The [integration record](../wiki/2026-11-14-final-ui-integration.md#deferred-feature-discovery) already defers study queue, scoped offline preparation, and local notes/tags. Nothing here changes that decision or claims accepted implementation scope.

1. **Persistent named views.** Save current course/type/sort choices from [AllFiles](../../src/views/library/AllFiles.tsx) (line 74 onward); [session views](../../src/hooks/useSessionViews.tsx) are explicitly memory-only. Add local naming, recall, rename, and delete, bounded to existing filters. Inspiration: [Linear views](https://linear.app/docs/custom-views) and [Reader views](https://docs.readwise.io/reader/docs/faqs/filtered-views).

2. **Personal study queue.** Add a local per-material study state; [Resource/InboxItem types](../../src/lib/types.ts) lack it. Keep it independent of read/dismiss and Moodle submission. Start with queue, working, and done rather than general task management. Inspiration: [Things Today/Anytime](https://culturedcode.com/things/support/articles/2803579/) and [Reader Shortlist](https://docs.readwise.io/reader/docs/faqs/filtered-views).

3. **Snooze and resurface.** Defer an Inbox item's attention until a chosen local time. Preserve captured event IDs, history, and new-event snapshot semantics in [InboxView](../../src/views/InboxView.tsx) and [useAttention](../../src/hooks/useAttention.ts); later changes must not be silently acknowledged. Inspiration: [Linear snooze](https://linear.app/docs/inbox#snooze).

4. **Scoped offline preparation.** Select materials/course scope and show eligible, saved, pending, and failed coverage. Build on existing `mirrorStartBackfill`, `mirrorStats`, and `mirrorLocalFile` in [API](../../src/lib/api.ts), aggregate retry in [DownloadsPopover](../../src/components/DownloadsPopover.tsx), and [AllFiles](../../src/views/library/AllFiles.tsx). This extends existing downloads. Inspiration: [Reader offline selection](https://docs.readwise.io/reader/docs/faqs).

5. **Local notes/tags.** Extend the properties/local-copy [PeekPanel](../../src/components/PeekPanel.tsx) and [types](../../src/lib/types.ts) with plain-text notes and small personal tags per material. Bound scope to local metadata, excluding full PDF annotation. Inspiration: [Reader](https://readwise.io/read) and [Eagle organization](https://eagle.cool/).

6. **Selected-item palette actions and recents.** Extend [CommandPalette](../../src/components/CommandPalette.tsx), which already searches views/courses/top-eight materials and global actions, with selected-material actions and recent local items. Reuse [materialActions capability policy](../../src/lib/materialActions.ts). Inspiration: [Raycast Action Panel](https://manual.raycast.com/action-panel).

7. **Retained-version browser.** Show retained copies' timestamps, sizes, and open/reveal actions in [PeekPanel](../../src/components/PeekPanel.tsx). Retention already exists through `mirrorKeepVersions` in [types](../../src/lib/types.ts); [API](../../src/lib/api.ts) currently resolves the current local file. This exposes existing retention, without promising content diffs or new retention behavior. Eagle supplies the asset-inspector analogy, not evidence of a matching version feature.
