# Quanta Pulse UI overhaul proposal

Prepared 14 November 2026. Scope: a source-based UI and UX audit plus a proposed design system and implementation sequence. No application code changed. The companion `design-specimen.html` illustrates the direction using invented course content; it is not a working application or a recording of the current app.

Integration note, 14 November 2026: this audit inspected the parent checkout at `967333b`, before the newer workspace redesign on main was reconciled into it. Several interaction and layout findings below have since been fixed on main. The [detailed implementation specification](../../docs/specs/2026-11-14-ui-themes-and-workflows.md) distinguishes those completed foundations from the remaining overhaul; use that specification for future implementation scope.

## Recommendation

Make Quanta Pulse a quiet academic workspace: Linear's compact navigation and triage, Notion's readable course pages and contextual inspection, and T3 Code's neutral surfaces. The distinctive element should be the relationship between a course, its latest changes, its actual deadlines, and its locally saved material.

The primary jobs are:

1. Understand what changed since I last checked.
2. See what is due, with trustworthy dates.
3. Find and open course material quickly, including saved copies.
4. Know whether monitoring is working without inspecting a technical log.

Keep these jobs visible before adding new product features. A calmer palette helps, but predictable actions and a clearer information hierarchy will do as much for perceived quality.

## Audit boundaries

Reviewed the application shell, all five views, login and session recovery, course list and course tree, shared rows, tables, command palette, peek and preview components, theme hook, CSS layers, and relevant tests. Findings below distinguish code-confirmed interaction problems from design judgments and validation work.

This is not a live desktop usability study. I did not run the packaged app, inspect a signed-in session, measure task completion with students, or verify native PDF rendering. Visual judgments come from the implemented CSS and component structure. Exact optical balance, OS titlebar integration, and real content overflow still need rendered review during implementation.

## What is already worth keeping

- Local storage and SQLite ownership, direct Quanta authentication, and a first scan that does not flood the user with new items.
- An existing token system with separate light and dark values, CSS layers, and first-paint theme application.
- Search/command palette, sidebar rail, course aliases, course tree, sorting, filtering, virtualized lists, contextual details, and file previews.
- Radix-based controls, visible focus styles, reduced-motion rules, forced-color support, calendar keyboard navigation, and tree keyboard tests.
- Separate concepts for a scan and downloading files. The UI should explain their relationship more clearly.

This calls for a coordinated evolution of the current frontend, not a framework rewrite.

## Findings and priorities

P0 means a misleading or blocked core interaction. P1 means a substantial daily-use problem. P2 means polish or optional enhancement. These priorities are design recommendations, not measured incident severity.

| Priority | Finding and evidence | Proposed change |
| --- | --- | --- |
| P0 | Calendar and History pass no-op handlers into a shared row whose title button announces “Show details.” `src/views/CalendarView.tsx:429`, `src/views/HistoryView.tsx:409`, `src/components/ResourceRow.tsx:127`. | Make title selection open the same resource inspector everywhere. Historical events without a surviving resource need an event-detail fallback. |
| P0 | Settings exposes `onDirtyChange`, but App does not supply it; route changes can unmount a dirty draft. `src/views/SettingsView.tsx:200`, `src/App.tsx:744`. Saving also has a `finally` without a user-facing error path at `SettingsView.tsx:259`. | Guard every route-changing entry point when a draft is dirty. Offer Save, Discard, and Stay; keep the draft and show an inline error when saving fails. |
| P0 | “Mark as unread” uses a callback that selects only unread event IDs and calls `markRead`; when already read, it returns without doing anything. `src/App.tsx:370`, `src/App.tsx:538`, `src/views/TodayView.tsx`. | Implement an explicit read-state command through the API and backend, or remove the unsupported action until it exists. Test actual state transitions. |
| P1 | Calendar loads events by detection date and displays an activity digest. An assignment reminder date is not necessarily the assignment due date. `src/views/CalendarView.tsx`, `src/lib/events.ts`. | Default Calendar to an agenda based on resource `dueAt`. Keep detection-date browsing under Activity calendar. Label both date meanings explicitly. |
| P1 | Warm canvas/sidebar colors, serif 42px page titles, dense 14px utility rows, and many colored markers create competing visual languages. `src/styles/tokens.css`, `src/styles/components/shell.css:316`, `src/styles/components/content.css`. | Use a single restrained sans-serif hierarchy and neutral surfaces. Keep semantic color small and purposeful. |
| P1 | Every page inherits a 900px outer cap with 48px side padding. At its cap, usable width is 804px. The desktop calendar requires at least 520px + 320px + 24px gap before stacking only below 960px. `src/styles/layout.css:100`, `src/styles/tokens.css:93`, `src/styles/components/screens.css:25`, `:169`, `:193`. | Give work lists and Calendar their own fluid layouts. Choose stacking based on available work-column width; a wide window can still have a narrow column with sidebar and inspector open. Validate the predicted overflow in rendered layouts. |
| P1 | Sidebar course order changes with unread counts and only eight courses appear. The global unread badge belongs to History. `src/components/Sidebar.tsx:152`, `:191`. | Stable alphabetical or pinned course ordering; put the unread badge on Inbox. Keep paused courses available in a quieter section. Pinning is a small new persisted preference. |
| P1 | Course rows label unread events as “new.” `src/views/library/CourseList.tsx:192`. | Use “unread” for attention state; use “new file” only for the corresponding change type. |
| P1 | File destinations vary: details from Today, a course tree action, direct remote URLs from search, a separate preview modal, and local actions in the inspector. `src/App.tsx`, `src/components/CommandPalette.tsx`, `src/views/library/TreeRow.tsx`, `src/views/library/AllFiles.tsx`. | One action policy shared by every surface: Inspect, Preview, Open saved copy / Download and open, and Open in Quanta. Labels must describe the destination and actual behavior. |
| P1 | Table rows open details via `tr.onClick` without a corresponding row keyboard activation mechanism. `src/components/DataTable.tsx:131`. | Add a real title button per row so keyboard users can reach the same inspector. Preserve native table semantics. |
| P1 | Row actions are hidden until hover, focus, or selection. This is keyboard-aware but poor for first-use and touch discovery. `src/styles/components/content.css:79`. | Always show overflow. Reveal secondary shortcuts on hover/focus; show them persistently for coarse pointers. |
| P1 | Empty-state copy conflates different conditions. A filtered course list says courses will appear after a first scan. Today can say “No matches” when only baseline content exists. `src/views/library/CourseList.tsx:150`, `src/views/TodayView.tsx:211`. | Distinguish first scan, no changes, no search results, no monitored courses, and fetch failure. Give each its own next action. |
| P1 | The palette returns the first eight substring matches, without a relevance ranking or a route to all results. Filtered view results show shortcuts derived from their new array index. `src/components/CommandPalette.tsx:55`, `:108`. | Rank exact title/course matches first, show context and local availability, add “See all results,” and derive shortcut hints from the canonical navigation map. |
| P1 | Existing axe tests disable color contrast because jsdom cannot measure it. `tests/axeViews.test.tsx:345`. | Preserve semantic accessibility tests and add real color-pair validation plus rendered keyboard, zoom, and platform checks. Passing the current tests does not prove readable colors. |
| P2 | Appearance is only System/Light/Dark; the topbar toggle turns System into an explicit choice. `src/hooks/useTheme.ts`, `src/views/SettingsView.tsx:425`. | Add named palettes and calibrated accents, with mode independent of palette. Expose an appearance popover that retains an obvious Follow system option. |
| P2 | Settings is one long anchored page spanning account, appearance, notifications, Telegram, monitoring, files, updates, and data tools. `src/views/SettingsView.tsx`. | Make settings a small navigable workspace with focused sections. Put dangerous maintenance actions in Data & recovery. |
| P2 | Normal sync, downloading, connection failures, expired authentication, and per-course failures have several presentation locations. `SyncStatus.tsx`, `SessionRefreshBanner.tsx`, `DownloadsPopover.tsx`, `HistoryView.tsx`. | Consolidate healthy status into the sidebar footer; use one actionable message for attention states and details on demand. Keep scan health separate from download progress. |

## Visual direction

### A compact workspace with readable course pages

Choose Linear as the primary structural influence. It matches a tracker: lists, changing state, keyboard navigation, and fast inspection. Use Notion's page hierarchy inside a course, where context and material organization matter. Do not recreate either product's full feature model.

Linear documents notification triage and keyboard traversal in its [Inbox](https://linear.app/docs/inbox). Notion documents multiple database views and contextual opening in its [view and layout guidance](https://www.notion.com/help/views-filters-and-sorts). Those patterns inform this recommendation; their workflows are not evidence that students need every corresponding feature.

The initial editorial direction in this project already gives course pages warmth, but its serif titles are at odds with the requested tool-like direction. I would replace that treatment, keep Geist, and reserve personality for the course-to-change-to-file relationship. A palette-only reskin would leave the interaction inconsistencies intact; a full task-management workspace would exceed the brief. The proposal below stays between those extremes.

### Color and themes

T3 Code's [upstream palette definitions](https://github.com/pingdotgg/t3code/blob/main/packages/shared/src/themePalettes.ts) are the reference, not a guessed purple or pink brand palette. Its default dark colors include canvas `#0A0A0A`, surface `#111111`, text `#F5F5F5`, muted text `#818181`, border `#191919`, and blue accent `#346BF1`. Its light counterpart uses canvas `#FCFCFC`, surface `#FFFFFF`, text `#27272A`, muted text `#71717B`, border `#E4E4E7`, and accent `#1B4ED8`.

Offer both **T3 Neutral**, following that reference, and **Soft Graphite**, a proposed comfort adaptation with less extreme dark surfaces. Recommend Soft Graphite for the calmer first impression requested here. These are proposals, not a claim about the user's currently selected T3 Code theme.

Core Soft Graphite dark palette:

| Role | Proposed value | Use |
| --- | --- | --- |
| Canvas | `#18191B` | Main workspace |
| Sidebar | `#151618` | Quiet navigation |
| Raised surface | `#202125` | Inspector, menus, inputs |
| Primary text | `#E6E7EA` | Titles and content |
| Secondary text | `#A1A4AC` | Readable metadata |
| Accent | `#86A9FF` | Focus, selection cue, primary action |

Use a separate border token around `#303238`, a dark foreground on a light accent fill, and mode-specific link colors. The six colors above define the direction, not the complete accessibility-ready token set.

Launch palette families, each with a deliberately authored light and dark variant:

| Palette | Character | Dark canvas / light canvas | Default dark accent |
| --- | --- | --- | --- |
| T3 Neutral | Closest reference | `#0A0A0A` / `#FCFCFC` | `#346BF1` |
| Soft Graphite | Recommended comfort option | `#18191B` / `#F7F8FA` | `#86A9FF` |
| Slate | Cooler, restrained | `#1A1D23` / `#F5F7FA` | `#9FB4D8` |
| Ocean | Subtle blue surfaces | `#171D24` / `#F4F8FB` | `#82B9DC` |
| Forest | Muted green surfaces | `#191E1B` / `#F5F8F5` | `#94B99E` |
| Iris | Restrained violet surfaces | `#1D1A23` / `#F8F6FB` | `#B7A4E1` |

Except for the T3 Neutral reference, these names and values describe Quanta Pulse proposals. They are not copied upstream theme definitions. Light accents must be separately calibrated, not reused from the dark column.

Appearance controls:

- Mode: System / Light / Dark.
- Palette: the six families above, shown as small previews containing actual rows and text.
- Accent: Default / Blue / Violet / Teal / Rose / Amber. Each choice maps to authored light and dark foreground, fill, tint, link, and focus values.
- Density: Comfortable / Compact, independent of screen-width adaptation.
- Live application and local persistence for appearance; Reset appearance restores a known readable configuration. Operational settings retain explicit Save.

Changing the accent must not change the meanings of errors, deadlines, course identities, and saved-file states. Start with curated choices; arbitrary color editing, importing themes, and a theme marketplace are deferred.

Color discipline:

- Most chrome and rows stay neutral. Use small course dots, readable names, and one modest selected-row treatment.
- New and updated content need an icon/text label, not a saturated badge on every item.
- Amber means a time-sensitive condition or warning. Red means a failure needing intervention or an actual overdue date; unavailable source material is not automatically a critical failure.
- Saved material uses a quiet check/icon in lists. Expose more detail in the inspector or on hover/focus.
- Soften surfaces and borders without dimming essential text or making focus invisible.

### Type, geometry, and motion

- Keep locally bundled Geist Variable for all application UI. It fits the brief and avoids adding a font dependency. Use Geist Mono only for paths or technical details; ordinary counts use tabular numerals in Geist.
- Page titles: 24px/32px, weight 600. Section titles: 16px/24px, weight 600. Row text: 14px/20px. Metadata: 12–13px/18px. No 42px serif page headers.
- Left-align navigation, headings, titles, and explanatory prose. Right-align timestamps, sizes, and numeric columns. Cap explanatory prose around 65–75 characters.
- Sidebar: about 232px, collapsible to a 56px rail. Topbar: 44–48px. Main horizontal padding: 24–32px on desktop, 16px at narrow widths.
- Comfortable rows: around 44px; Compact: around 36px. Narrow rows can become two lines regardless of density preference. Controls must retain adequate hit areas.
- Inspector: approximately 360–420px with a later resize affordance if real use justifies it. Open docked only if the remaining list width stays usable; otherwise overlay or a dedicated detail screen.
- Controls: 6px corners. Panels/dialogs: 10px. No shadow on every list item. Use borders to separate surfaces and shadows for floating layers.
- Motion answers actions: 120–180ms opening, selection, or expansion. No cascading row entrances. Healthy idle sync does not pulse; reduced motion has static equivalents.

## Information architecture and screen proposals

### Shell

```text
┌─────────────────┬───────────────────────────────────┬───────────────────┐
│ Quanta Pulse    │ Inbox                         ⋯   │ Lecture 14        │
│ Search   Ctrl K ├───────────────────────────────────┤ OOP / Week 7      │
│                 │ All   Unread       Course  Filter │                   │
│ Inbox        6  │                                   │ Preview           │
│ Calendar        │ Due soon                          │ Details           │
│ Library         │ Assignment 3       Tomorrow 17:00 │                   │
│                 │                                   │ Saved on device   │
│ Courses         │ Latest changes                    │ Open saved copy   │
│ OOP          3  │ Lecture 14            New  10:42  │ Open in Quanta    │
│ Mathematics  2  │ Tutorial 6         Updated 09:10  │                   │
│ Mechanics    1  │ Lab announcement          08:55  │                   │
│                 │                                   │                   │
│ Settings        │                                   │                   │
│ Synced 4m ago   │                                   │                   │
└─────────────────┴───────────────────────────────────┴───────────────────┘
```

Compare this with a Notion-led alternative: a centered course home, generous page heading, and separate linked views for changes, files, and dates. That is good for reading inside a course but adds navigation and uses more vertical space for daily triage. Recommend the workspace above for global views and the page approach inside a course.

### Inbox, replacing Today

“Today” currently contains older groups as well as today's activity. Rename it Inbox so its promise matches the content. Preserve date grouping under Latest changes.

- Show All and Unread as attention filters; keep event type and course in secondary filters.
- Give announcements an explicit filter instead of hiding them within New.
- Put a compact Due soon group above changes, sourced from actual due dates across tracked resources, including baseline resources. Show exact local time as well as “Tomorrow.”
- Deduplicate by resource in Inbox and show its latest relevant state. Preserve every event in Activity history.
- Use read/unread state only for attention. Opening, selecting, and previewing should not silently mark content read in the initial overhaul; explicit Mark read stays predictable.
- “Mark all read” must state its scope. Prefer “Mark filtered results read” when filters are active; implement the required ID-scoped command rather than presenting a global operation as scoped.
- Keep course identity visible, but prioritize title, change, and time. Move URL/path/fingerprint-level details into the inspector.
- After baseline: “Tracking 8 courses. Existing material is in Library. Future changes appear here.” Provide Open Library, and never enumerate baseline material as new.
- Retain distinct errors and no-result states. A failed refresh must not be presented as “You're caught up.”

### Calendar

Default to an agenda of due dates: Today, Tomorrow, This week, Later. Retain month view as an alternative. A student should see “Assignment 3, Tuesday at 17:00” rather than decode a colored dot.

Provide a separate Activity mode for the existing detection-date calendar. Clearly distinguish “Due Tuesday” from “Detected Monday.” Changing due dates should move an agenda item while retaining its history.

Avoid implying submission status. Quanta Pulse does not currently provide a reliable submitted/completed state in the reviewed resource model. A past due date can be labeled “Past due date,” with a reminder to confirm submission in Quanta. Add a genuine overdue workflow only if source data supports it.

Keep existing calendar keyboard behavior, but reduce its six-block statistical digest to concise activity counts and show failed scans in diagnostics. Rendered widths should decide side-by-side vs stacked mode.

### Library and courses

Keep Courses and All files as two views of the same material. Course lists show course name, code as secondary context, unread changes, and last successful check. Healthy monitoring is implicit; errors and paused states get clear labels.

Course page:

- Small course heading, readable full name, Quanta link, and a restrained monitoring menu.
- Tabs: Materials and Activity initially. Due dates can be a filtered calendar link before becoming a separate tab.
- Preserve Moodle section hierarchy. Show a tree for browsing and flat results while searching; explain which view is active.
- Keep filters in a consistent toolbar. Remember sort, query, filters, section expansion, selection, and scroll position on returning from inspection or course navigation.
- Make aliases easy to find. Stable colors are secondary recognition aids; course names remain sufficient.
- Show source availability and local availability separately. A resource removed from Quanta may still have a usable saved copy.

Favorites, bulk downloads, richer saved views, and configurable columns are useful candidates after the core experience is coherent. They are not prerequisites for the visual overhaul.

### Inspector and preview

One selected-resource model owns one inspector across Inbox, Library, Calendar, and history. Avoid per-view action definitions drifting apart.

Suggested order: title and course context → readable preview or preview action → source/change/due dates → local availability → primary action → secondary source links. Keep path, size, and technical data expandable.

| User intent | Label and behavior |
| --- | --- |
| Inspect | Click title or activate its keyboard button; stay in context. |
| Preview | Use an in-app preview if supported; expand to the existing modal when reading needs room. |
| Use a saved file | “Open saved copy,” opening the existing local file. |
| Use a downloadable unsaved file | “Download and open,” actually invoking the local-file path with visible progress and failure recovery. |
| Use the source | “Open in Quanta,” explicitly leaving the app for the source page. |
| Preview is unsupported | Neutral explanation and a source/local fallback; this is a capability limit, not an alarming error. |

Network errors, expired authentication, unsupported formats, and oversize files need different recovery messages. Do not assume PDF iframes or embedded authenticated pages work identically in Windows WebView2 and macOS WKWebView.

### Activity and diagnostics

Keep an accessible Activity history destination through Inbox's menu or a secondary sidebar item. Put scans under Connection details / Scan history. This separates “what my courses changed” from “what the software did.”

Do not make clearing activity delete audit history implicitly. Preserve the user's ability to dismiss/clear a feed, but name its exact effect and separate it from Delete history. An undo can be added only if the underlying operation becomes reversible.

### Settings

Use focused sections: Appearance; Account & connection; Notifications; Files & storage; Integrations; Data & recovery; About.

Appearance applies immediately and saves locally. Operational settings retain one draft and an explicit save bar, with visible success and failure. Navigation guards must cover sidebar, palette, hotkeys, and course links, not just an individual back button.

Move Telegram to Integrations. Distinguish preview cache from saved course files. Use plain “Saved files folder” in user-facing copy instead of “mirror root,” and explain retention before deletion. Move re-baselining and deletion into Data & recovery with impact-specific confirmation.

### First run, login, and recovery

Keep both supported login methods. Give BITS SSO clear prominence if validated as the common successful path; keep password login directly available. Show what will happen next without adding a long onboarding wizard.

After authentication, show baseline discovery as a real state with progress only when progress is known. Let the user browse material already discovered. Explain that existing files are being recorded, not reported as new.

Expired session: “Reconnect to check for new material. Your saved files are still available.” Keep cached course data accessible, present one Reconnect action, and show whether a browser sign-in is pending. Avoid raw backend strings as the only recovery instruction; retain technical detail behind a disclosure.

## Implementation design

### Theme ownership

Extend the existing hook and tokens rather than introduce another styling stack. Proposed frontend-owned preference:

```ts
type AppearancePreference = {
  version: 1;
  mode: "system" | "light" | "dark";
  palette: "t3-neutral" | "soft-graphite" | "slate" | "ocean" | "forest" | "iris";
  accent: "default" | "blue" | "violet" | "teal" | "rose" | "amber";
  density: "comfortable" | "compact";
};
```

Keep preference resolution and validation pure in `src/lib/`. `useTheme` owns subscription/application. First-paint startup and React must call the same resolver so they cannot disagree. Migrate the existing `quanta-pulse-theme` mode; do not silently reset an explicit dark or light preference. Invalid or unavailable storage falls back safely.

Use separate HTML data attributes for resolved mode, palette, accent, and density. Keep existing token names as aliases during migration. Add missing roles for focus, selection, muted content, disabled content, danger, and foreground-on-fill. Components consume semantic roles; no per-view palette branches.

Author explicit hex/RGBA values compatible with the documented minimum webview. Do not introduce `color-mix`, container queries, subgrid, or modern CSS dependencies without deliberately revisiting that compatibility requirement.

Appearance can remain frontend-local as it is today. New server-owned behavior such as changing event read state still needs matching Rust/TypeScript wire models and API wrappers. All `invoke` calls remain in `src/lib/api.ts`.

### Interaction ownership

- A shared resource action policy decides valid destinations from resource type, preview support, source availability, and local-file state. Views supply context, not competing action logic.
- App-level navigation owns dirty-draft checks and selection/return behavior.
- Pure selectors derive Inbox groups and due-date agenda from resources/events without changing baseline or scan-diff rules.
- Keep resource state and event history distinct. Do not lose an event merely because Inbox deduplicates a resource.
- Audit provider scope before unifying file actions: App currently calls `useMirror` above the `MirrorProvider` it renders. Verify and correct the scope so app-level inspector actions receive the same local status as child views.

## Delivery sequence and stop conditions

| Slice | Work | Reviewable completion condition |
| --- | --- | --- |
| 1. Correct misleading interactions | Dead title actions, unread action, save errors/guards, palette shortcut hints, keyboard table entry points. | Each visible action works from all relevant input methods; failed saves preserve draft; navigation cannot silently drop it. |
| 2. Theme and visual foundation | Mode/palette/accent/density model, migration, preview chooser, type scale, neutral rows and chrome. | Existing preferences survive; all launch palettes have light/dark variants; changing appearance does not alter course or activity state. |
| 3. Daily workflow | Inbox hierarchy, truthful badge counts, stable courses, shared inspector/actions, persistent return context, fluid layouts. | User can inspect changes and open a saved file from every main view with the same action labels and behavior. |
| 4. Dates and supporting screens | Due-date agenda, Activity calendar distinction, settings sections, baseline and reconnect states, separated diagnostics. | Date labels have explicit meaning; no submission-state claims without data; empty/error/recovery states have tested next actions. |
| 5. Visual and native verification | Representative content, window sizes, themes, keyboard, zoom, reduced motion, platform previews. | Acceptance checks below pass and the existing regression suite remains green. |

Slice 2 yields a useful visual refresh without requiring the entire navigation redesign to ship at once. Avoid estimating a fixed day count before real preview and native behavior are checked; the highest uncertainty lies in shared file opening and due-date completeness.

## Acceptance and validation

Write behavior tests before wiring new behavior, as required by this repository. Reuse and extend existing suites rather than build a parallel test stack.

- Theme tests cover legacy preference migration, invalid values, unavailable storage, first-paint agreement, System changes, and palette/accent persistence.
- Contrast checks enumerate every authored theme/accent pair: ordinary text at least 4.5:1; qualifying large text 3:1; meaningful focus/control boundaries 3:1 where required. Do not require every decorative separator to meet control contrast. Validate representative composed states in a real renderer as well.
- Keyboard walkthrough covers title inspection, table access, row overflow, sorting/filtering, calendar, tree, palette, dialogs, Escape dismissal, focus return, and dirty navigation.
- Keep keyboard shortcuts inactive while editing text and scoped to the active modal/panel. Verify this behavior rather than relying on a library comment.
- Test no data, baseline only, all read, no filter matches, partial scan failure, expired session, offline cached data, missing source with saved copy, download failed, unsupported preview, and large files.
- Use short/long course names, many courses, long filenames, repeated names, many events, and actual resource limit boundaries.
- Test minimum supported desktop size, 960px, 1280px, and 1440px widths, plus 200% zoom. Include open inspector and expanded/collapsed sidebar states; breakpoints must respect remaining content width.
- Run `npm run lint`, `npm test`, and `npm run build` after implementation. Run `cargo check` in `src-tauri/` for Rust changes and targeted backend tests for new state-changing commands. Do not run the packaged app during development.
- Verify native development flows on Windows and macOS for login, PDF/media previews, source opening, local opening, reconnect, and OS theme changes.
- Conduct short student tasks: find the next due date; explain which changes are unread; locate a lecture by course and week; open saved material while offline; reconnect after session expiry. Record completion, wrong turns, and misunderstood labels without adding product telemetry.

## Deliberate exclusions

No block editor, kanban task system, AI summarization, social features, cloud accounts, new analytics, theme marketplace, or arbitrary theme scripting. No fabricated task completion or grade/submission status. These do not help prove this overhaul succeeds.

The desired outcome is concrete: opening Pulse should immediately explain what needs attention, keep reading comfortable, and make every material-opening action predictable.
