# Quanta Pulse · UI implementation spec

Linear × T3 redesign · handoff for the implementing agent

## 0. How to use this

- **Visual source of truth:** the canvas at https://claude.ai/artifact/LewN6KVEERnkXT9FofEcSP holds 20 full screens: Inbox with inspector, Inbox in 8 states (filtered, item menu, bulk-read dialog, dismiss dialog, caught up, no matches, refresh failure, count failure), Agenda, Library with course tree, Command palette, Settings, Quick Look, Sign in and first run (5 states on one card), light versions of Inbox, Agenda and Course, and a Foundations sheet.
- **Everything not drawn** is a recomposition of the patterns in sections 3 and 4. Section 5 gives the recipe for each remaining state: shell, components, copy.
- **Stack:** Tauri 2, React 18, TypeScript, Vite. Tokens are plain CSS variables. Use Radix primitives for Dialog, DropdownMenu, Popover, Tooltip and Switch, and cmdk for the palette, all restyled with these tokens (no stock component look). Bundle Geist and Geist Mono locally (@fontsource packages); the app must work offline.
- **Build order:** tokens, shell, Row plus J/K navigation, Inspector, Inbox, banners/menus/dialogs, Calendar, Library and Course, palette and Quick Look, Settings, History, sign-in, responsive, light mode.

## 1. Tokens

```css
:root{
 --w:#09090A; --p:#0F0F11; --h:#141417; --s:#1B1B20; --r:#161619;
 --b1:#1C1C20; --b2:#2B2B31;
 --t1:#EDEDEF; --t2:#A1A1AA; --t3:#84848D;
 --ac:#5E6AD2; --acs:#1A1C35; --act:#9AA2F0;
 --ok:#4CB782; --wn:#F2994A; --wns:#221A12; --er:#EB5757;
 --cs:#4EA7FC; --ma:#BB87FC; --ph:#F2C94C;
 --scrim:rgba(0,0,0,.6);
 --shadow-pop:0 12px 32px rgba(0,0,0,.5);
 --shadow-modal:0 24px 48px rgba(0,0,0,.55);
}
[data-theme=light]{
 --w:#F3F3F5; --p:#FFFFFF; --h:#F7F7F8; --s:#EBEBEE; --r:#FFFFFF;
 --b1:#EDEDF0; --b2:#DADADF;
 --t1:#17171A; --t2:#4F4F57; --t3:#6A6A72;
 --ac:#5E6AD2; --acs:#EEF0FC; --act:#4650B5;
 --ok:#2F9E6B; --wn:#C4620B; --wns:#FDF2E8; --er:#D13B3B;
 --cs:#2B87D8; --ma:#9B5BD6; --ph:#C99A0A;
 --scrim:rgba(0,0,0,.35);
 --shadow-pop:0 12px 32px rgba(0,0,0,.12);
 --shadow-modal:0 24px 48px rgba(0,0,0,.18);
}
```

| Token | Use |
| --- | --- |
| --w | Window background, sidebar |
| --p | Main panel, inspector |
| --h | Row focus/hover, group headers |
| --s | Selected row, active nav, active tab, track of progress bars |
| --r | Popovers, menus, dialogs, inputs, keycaps |
| --b1 / --b2 | Hairline dividers / control and panel borders |
| --t1 / --t2 / --t3 | Primary / secondary / metadata text (--t3 passes 4.5:1 on --p) |
| --ac, --acs, --act | Accent fill / accent soft background / accent text |
| --ok, --wn, --er, --cs | Success, warning, danger, info |
| --cs, --ma, --ph | Course dots: first, second, third course (assign by course order, cycle) |

Tint recipe for tags and banners: background color-mix(in srgb, COLOR 10 to 14%, transparent), border 30 to 35%, text COLOR. Use the accent only for unread dots, the focus bar, focus rings, primary buttons and active tab/nav indicators. Nothing else is purple.

**Type.** Geist for UI, Geist Mono for times, course codes, counts, keycaps and file types. Tight line-heights (1.4).

| Role | Spec |
| --- | --- |
| Page title (Settings, Auth) | 20 / 600 |
| Section / dialog title | 15 / 600 |
| Inspector title | 17 / 600, 1.3 line height |
| Body, rows, nav | 13 / 400 (500 for unread rows and active nav) |
| Label, tabs, buttons | 12 / 500 |
| Meta | Geist Mono 11 / 400, --t3 |
| Caps label | Geist Mono 10 / 500, letter-spacing .06em, --t3 |

**Radii:** 4 keycaps, 5 tabs/chips/tags, 6 buttons/inputs/nav items, 8 menus/banners/cards, 10 main panel, 12 dialogs/palette/auth card. **Spacing scale:** 4, 8, 12, 16, 24, 32. Horizontal gutter inside the panel is always 16.

## 2. Layout and sizes

| Element | Size |
| --- | --- |
| Window | Min 820 × 540. Design size 1280 × 800 (works at 1440 × 960). Background --w |
| Sidebar | 224 wide. Collapsed rail 48. Narrow drawer 224 over a scrim |
| Main panel | Inset 8px from top, right and bottom, 0 from the sidebar. Radius 10, 1px --b2 border, overflow hidden |
| Header | 44 high: title, tabs, search button (200 wide, right) |
| Toolbar / filter bar | 40 high |
| Inline banner | 36 (due soon) or 40 to 48 (status), full width, under toolbar |
| Group header | 28, --h background |
| Rows | Material 36 (compact 30), table row 34, agenda row 40, course tree row 26, nav item 28 |
| Status bar | 30, bottom of the panel: left metadata in mono, right keyboard hints |
| Inspector | 340 wide, right side of the panel, 1px --b1 left border |
| Command palette | 640 wide, top 96, centered, radius 12 |
| Dialog | 480 wide (520 when listing scope), centered, padding 20 |
| Menu | 230 to 250 wide, padding 4, item 34 high |
| Popover | 320 wide |
| Toast | 330 wide, bottom right, 16 from edges |
| Quick Look | 980 × 712, top 44, centered |
| Auth card | 400 wide, padding 28 |
| Settings | Left nav 216; content column 640, padding 32 / 48 |

## 3. Components

**Nav item** (28 high, radius 6, 16px icon, label 13, count right in mono). Active: --s background, --t1 text, icon --t1. Course item: 8px dot in the course colour instead of an icon.

**Header tabs:** 24 high, radius 5, 12 / 500. Active: --s and --t1. Count in mono --t3.

**Filter chip:** 24 high, border --b2, radius 5: key in --t3, value in --t1 500, x icon. The Filter button is ghost, 26 high.

**Material row (36):** \[8px unread slot\] \[16px file icon\] \[name, flex, ellipsis\] \[change tag\] \[course chip\] \[section mono 52\] \[time mono 40, right aligned\].

| Row state | Rule |
| --- | --- |
| Unread | Accent dot, name --t1 500 |
| Read | Empty slot, name --t2 400 |
| Focused (keyboard) | --h background, 2px accent bar on the left edge, E keycap replaces the time |
| Selected (inspector open) | --s background, accent bar, dot removed (opening marks read) |
| Source unavailable | Row at 62% opacity, warning tag 'Source unavailable' |
| Saved | 14px green check at the right |
| Not saved | Ghost button with download icon |
| Downloading | 80 × 4 progress bar (--cs) plus percent in mono |
| Failed | Danger tag plus ghost Retry button |

**Course chip:** 20 high, border --b1, radius 5, 6px course dot, mono 11 code. **Tags:** 20 high, radius 5, 11 / 500: New (--ac), Updated (--cs), Removed (--t3), Saved (--ok), Not saved (--t2), Downloading (--cs), Failed (--er), Unavailable (--wn). **File type badge:** 28 × 20 mono 9 text on --s (PDF, IMG, DOC, MP3, MP4, URL).

**Buttons** (28 high, radius 6, 12 / 500): Primary (--ac fill, white text), Secondary (--b2 border), Ghost (no border), Danger (--er text and 40% border), Icon (28 square). Keycap sits inside the button at the right when a shortcut exists. Disabled 40% opacity. **Inputs:** 32 high, --r fill, --b2 border; focus = --ac border plus 3px --acs ring; error = --er border plus message in --er below.

**Toggle** 32 × 18 (on = --ac, knob right). **Checkbox** 16, radius 4 (checked/mixed = --ac fill, white mark). **Select** = secondary button with chevron. **Segmented** = bordered group, active segment --s. **Keycap:** 18 high, mono 10 / 500, --r fill, --b2 border, radius 4.

**Banner** (radius 8 inside a 16px gutter, icon + text + optional action): info (--cs), warning (--wn), danger (--er), success (--ok). **Toast:** raised card with icon, text, ghost action; auto-dismiss 6s, Undo where reversible. **Skeleton:** --s bars, 10 high, 4 radius, same row skeleton as the row layout.

**Menu:** item = icon 16 + label + keycaps at right. Hover/active --s. Dividers --b1. Danger item in --er. **Tooltip:** --s background, --b2 border, label plus keycap.

**Dialog:** title 15 / 600, body --t2 at 1.5, buttons right aligned (Cancel secondary, confirm primary or danger). Scope lists (what will be affected) go in a bordered 32-high-row list under the body.

**Empty state:** centered in the list area: 44 icon tile (radius 12, --b2 border), title 15 / 600, description --t2 (max 360), up to two buttons.

**Inspector:** header 44 (label 'Material', Esc keycap, close icon), body padding 16, gap 14: type, title, action buttons, divider, property rows (26 high, label 88 --t3), divider, 'File information' disclosure. See 5.6 for variants.

## 4. Interaction, motion, keyboard

| Key | Action |
| --- | --- |
| J / K or arrows | Move focus in any list |
| Enter | Open inspector / confirm |
| Space | Quick Look preview (Space again or Esc closes) |
| E / U | Mark read / unread |
| Del | Dismiss (opens dialog) |
| X | Multi-select |
| ⌘K | Command palette. G then I / C / L / H goes to Inbox / Calendar / Library / History |
| ⌘O | Open saved copy |
| / | Focus search in the current view |
| T | Agenda: jump to today |
| ⇧A | Mark all read (opens bulk dialog) |
| ⌘R | Rescan now |
| ? | Shortcut cheat sheet |

Show hint keycaps in the status bar and inside buttons and menus. **Motion:** 120 to 150ms ease-out only. Selection bar slides between rows; inspector slides 8px and fades; palette and dialogs scale .98 to 1 with fade; toast slides up 8px. Mark-read is optimistic (dot fades, row dims). Honor prefers-reduced-motion by removing all transforms.

## 5. Screen and state recipes

Name in bold = drawn on the canvas. Everything else: use the stated shell and components.

### 5.1 Sign in and first run

**Sign in and first run** is drawn (one card, five states). Card is centered on --w, no sidebar. Failure is inline on the same card (danger banner, danger border on the password field, Try again primary, Use BITS SSO instead ghost). SSO pending: spinner, Open browser again, Cancel. First scan running: progress bar plus four steps, button Keep running in background. Complete: stats row (courses, materials, new = 0), primary Open Library, ghost Go to Inbox. Baseline copy: 'Everything already on Quanta is saved as your starting point. From now on, only new changes reach your Inbox.' Never list baseline items as new.

### 5.2 Inbox

Drawn: **Inbox · inspector open**, and the 8 state frames. Layout order inside the panel: header, filter bar, status banner (optional), due-soon banner (optional), group header, rows, status bar. A status banner (refresh failure, count failure, session expired) always sits directly under the filter bar and above the due-soon banner. Empty states replace only the list area; sidebar, header and filters stay. Refresh failure keeps old rows and turns the sidebar status dot red ('Scan failed'). Count failure shows '–' in counts and tabs and says the list is current.

### 5.3 Calendar

Drawn: **Agenda** (week strip, groups Today, Tomorrow, This week, Later, collapsed Past dates). Today in the strip is a solid --t1 circle with dark text; no accent. Deadline dot under a day is --wn.

| State | Recipe |
| --- | --- |
| Agenda with inspector | Agenda plus 340 inspector, Deadline variant (5.6) |
| Filtered agenda | Filter chip Course = MATH F111; a paused course shows a 'Paused' tag in the chip and a banner 'Monitoring is paused for MATH F111. Dates shown may be out of date.' with a Resume button |
| Empty agenda | Empty state: 'No known deadlines'. Description: 'Pulse shows due dates found on Quanta. Check Quanta directly if you expect one.' |
| Agenda refresh failure | Status banner (warning): 'Showing dates from 09:42. Couldn't refresh.' plus Retry; rows stay, small 'stale' mono tag next to the status-bar timestamp |
| Activity calendar | Tab Activity. Month grid: 7 columns, rows 96 high, 1px --b1 gridlines. Each day shows its date number top left and up to 3 mono 'N changes' pills (neutral, never orange). Today = solid --t1 circle. Selected day = --s fill plus --b2 border. Outside-month days at 40% opacity |
| Selected-day activity | Grid shrinks to fill; right 340 panel titled with the date: summary line (3 new · 2 updated), then event rows (file icon, name, tag, course chip, mono time) |
| Activity event inspected | Same layout; the right panel switches to the Inspector, Historical variant |

Due dates and detection dates must look different everywhere. Due = ring/clock icon, --wn when under 24h, label 'due'. Detected = file icon, neutral, label 'detected'. Never show 'submitted', 'missing' or 'late'. Add a line in the Agenda status bar: 'Submission status is not tracked.'

### 5.4 Library and courses

Drawn: **Library** (course tree plus table, header 'CS F111 · Computer Programming', tabs Materials / Activity).

| State | Recipe |
| --- | --- |
| Library · Courses | Tab Courses. Rows 48 high: course dot, code (mono), full name, unread count, last change (mono), monitoring tag (Active, Paused, Error). A 'Needs attention' group at the top lists paused or failing courses first |
| Library · All files | Tab All files. Columns: Name, Course (chip), Section, Detected, Saved. Sortable headers (caps label with arrow); chips for Type, Course, Saved |
| Search results | Same table, query chip active; each row's second line shows 'CS F111 / Week 04 / Lectures' in mono --t3; matched text in --act 600 |
| All files with inspector | Table plus Inspector |
| Course · Materials | Drawn |
| Expanded folders | Tree indent 16 per level, chevrons rotate, long names ellipsize with full name in a tooltip; breadcrumb in the status bar |
| Course · Search results | Tree hidden; flat list with each row's original section path under the name |
| Course · Activity | Tab Activity: History-style list scoped to the course |
| Course actions menu | Menu from the header dots button: Rename, Pause monitoring / Resume monitoring, Open in Quanta, divider, Reset baseline… (danger) |
| Rename course dialog | Input prefilled; helper 'Only changes how this course appears in Pulse.'; Cancel / Save |
| Reset-baseline dialog | 'Reset the baseline for CS F111?' Body: 'The next scan records everything currently on Quanta as your starting point. Those items will not be reported as new. History and saved files are kept.' Cancel / Reset baseline (danger) |
| Empty / failure | Three distinct empty states: no material ('Nothing here yet. This course has no materials on Quanta.'), no matches ('No files match your search' plus Clear), failed loading (danger banner plus Retry, with last known data kept) |

### 5.5 Quick Look and previews

Drawn: **Quick Look** (PDF: thumbnails, in-document search, footer hints). Same shell for all types; only the stage changes.

| Type | Stage |
| --- | --- |
| PDF | Page canvas on #0B0B0C, thumbnail rail, search with N / P |
| Image | Fit-to-stage, zoom control (+, minus, 100%), no rail |
| Text or announcement | Reading column 640, 15 / 1.6, --p background, Open in Quanta at right of header |
| Audio / video | Stage plus control bar: play, scrubber, mono time, speed select, volume |
| Loading | Skeleton page plus 20px spinner, label 'Opening Lecture 04…' |
| Unsupported / oversized | Empty state: 'Preview isn't available for this file' (or 'This file is too large to preview'), buttons Open saved copy and Show in folder |
| Network or auth failure | Empty state with danger icon: 'Couldn't load the preview', Retry; for auth, button is Reconnect |

### 5.6 Inspector variants (one component, 340 wide)

Header and property rows stay identical. Only the banner, status row and actions change.

| Variant | Changes |
| --- | --- |
| Saved file | Status 'Saved on this device' (green dot). Primary Preview, secondary Open saved copy |
| Unsaved, downloadable | Status 'Not saved'. Primary 'Download and open', secondary Download |
| Downloading | Progress bar with percent and size; actions disabled; Cancel ghost |
| Download failed | Danger banner with the reason; primary Retry |
| Source unavailable, saved | Warning banner 'No longer on Quanta. Your saved copy still works.' Primary Preview |
| External link / announcement | No file icon; body shows the announcement text; primary 'Open in Quanta' |
| Historical event, resource gone | Neutral banner 'The original resource no longer exists.' Metadata only; secondary 'Show in History' |
| Deadline | Rows: Due (as stored on Quanta), Local time (with timezone), Countdown, Course. Note 'Submission status is not tracked.' Action 'Open in Quanta' |
| Technical info | 'File information' expanded: file name, type, size, SHA-256 (first 12 chars plus copy), Quanta URL, saved path |

### 5.7 History

Shell: Inbox pattern. Header 'History', tabs Activity / Scans.

| State | Recipe |
| --- | --- |
| Activity | Rows grouped by day; filters Type, Course, Date range, search |
| Activity with inspector | Inspector, Historical variant |
| Scans | Table: Started (mono), Duration, Result tag (Success, Partial, Failed), Courses scanned, New / Updated / Removed counts |
| Scan details | Inspector: step timeline per course (check or x, mono time), failure message, buttons 'Retry scan' and 'Copy diagnostics' |
| Delete history | Header menu 'Delete history…' opens a danger dialog: 'Delete 214 events and 38 scan records? Saved files and your baseline are not affected. This can't be undone.' |
| Empty | Empty state 'No history yet' with 'History fills in after your first scan' |

### 5.8 Settings

Drawn: **Settings** (Appearance, Notifications, Files, Account, About as one scrolling page with sticky left nav). Keep one page; sections:

| Section | Controls |
| --- | --- |
| Appearance | Theme tiles with mini previews, palette select, accent swatches (24px, ring on selected), density segmented, monospace toggle, Reset appearance |
| Account and connection | Account row (username, SSO or password, session status tag), monitoring interval select (5, 10, 15, 30, 60 min), keep running in tray toggle, start at login toggle |
| Notifications | Toggles: new material, updates, deadline reminders, scan failures. OS permission row with status tag plus 'Open system settings'. Quiet hours range. Reminder window select |
| Files and storage | Folder path (mono) plus Change, automatic download toggle, max file size select, retention select, active downloads list with progress, failures list with Retry |
| Integrations | Telegram: bot token (masked), chat ID, status tag, Test button with inline result row (success or failure message) |
| Data and recovery | Preview cache size plus Clear cache; Reset all baselines (danger); Delete saved files (danger, scoped dialog) |
| About | Version, auto-check toggle, Check for updates button |

Shared states: **Unsaved changes** = sticky 48-high save bar at the bottom of the panel ('Unsaved changes', Discard, Save changes). **Saving** = primary button shows a 14px spinner and 'Saving…'. **Save failed** = bar turns danger-tinted: 'Couldn't save. Your changes are kept.' with Retry. **Leave dialog:** 'Leave without saving?' with Stay (primary) and Discard changes. **Destructive confirmation:** danger dialog with a scope list; Delete saved files also requires typing DELETE. **Update states** (About): available (info banner, Download), downloading (progress), installing (spinner), failed (danger banner, Retry), restart required (success banner, Restart now).

### 5.9 Global overlays and recovery

Drawn: **Command palette** (default). Others:

| State | Recipe |
| --- | --- |
| Palette results | Query typed: sections Files, Courses, Actions, then a last row 'See all results for X' with Enter keycap. Matches in --act 600. Query tokens course:, type:, is:, due: render as accent tokens |
| Palette no matches | Inside the palette: empty text 'No results for X' plus two suggestions (clear filters, search all files) |
| Appearance popover | 320 wide, anchored to the sidebar footer: segmented mode, palette select, accent swatches, density |
| Downloads popover | 320 wide under a download icon in the header (with count badge): active rows with progress, failed rows with Retry, footer 'Open folder' |
| Session expired | Status banner (danger) above the header: 'Session expired. Sign in again to keep monitoring.' \[Reconnect\]. Sidebar status turns red |
| Reconnecting | Neutral banner with spinner: 'Waiting for sign-in…' \[Cancel\] |
| Reconnect succeeded | Success banner 'Reconnected. Monitoring resumed.', auto-dismiss after 4s |
| Reconnect failed or cancelled | Danger banner 'Couldn't reconnect.' \[Try again\] \[Dismiss\] |
| Toasts | Success 'Marked 6 as read' \[Undo\]; error 'Couldn't refresh Inbox' \[Retry\] |

## 6. Responsive, zoom, focus, light mode

- **Below 1100 px wide:** the inspector becomes an overlay (320 wide, right, scrim, Esc closes). **Below 960:** sidebar collapses to the 48 rail; a menu button opens the 224 drawer over a scrim and traps focus. Header search becomes an icon button. Rows drop the section column first, then the time. Tables drop Section, then Detected. Settings nav becomes a select at the top of the content. Minimum window 820 × 540.
- **200% zoom** (about 720 × 480 CSS px): single column, no horizontal scroll, header wraps to two lines, filter bar scrolls horizontally inside itself, dialogs become full width minus 16.
- **Focus:** every control shows a 2px --ac outline with 2px offset (inputs also get the 3px --acs ring). List rows show the focus bar plus an inset 2px ring. Menu items show --s fill plus ring. Dialogs trap focus; the primary action is focused first, except destructive dialogs, which focus Cancel. Theme and accent choosers are radio groups with arrow-key navigation. Skip link at the top of the panel.
- **Contrast:** body text at least 4.5:1, including --t3 metadata; colours that must be told apart also differ in lightness or shape (tags carry text, dots sit next to labels).
- **Light mode:** swap tokens via data-theme. Key screens to verify: Inbox, Agenda, Course, Appearance. Semantic colours are darker in light mode (see tokens); shadows are lighter; the scrim is .35.

## 7. Product rules

- Opening an unread item in the inspector marks it read. Bulk read always shows its captured scope and ignores items that arrived after the dialog opened.
- Dismiss removes from Inbox only. History and saved files stay.
- Baseline: first scan and Reset baseline record existing files silently. They never appear as new.
- Never imply Pulse knows submission status. Never describe fresh rows as stale when only counts failed; never present retained rows after a failed refresh as fresh.
- Every destructive action states exactly what is and is not affected.
- Local files: each item is saved on disk as soon as it is detected (when automatic download is on); the inspector must always show whether the file is saved.
