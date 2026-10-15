# Quanta Pulse — Design Handoff Spec

Version 1.0 · 13 Oct 2026 · Applies to the Calm redesign, light and dark. Visual reference: the Calm artboards on the Quanta Pulse Rework canvas.

## 1. How to read this spec

This spec turns the approved Calm design into build instructions for the existing Tauri 2 + React 18 + TypeScript + Vite app. It covers every screen (Today, Calendar, Library, History, Settings, Login and the system states), not just Today.

- **Tokens, not values.** Every measurement names a token from section 4. Raw px values appear only in the token tables.
- **Nothing changes under the hood.** `lib/api.ts`, the Tauri commands, the `change_events` model, the event bridge, the baseline-scan rule and the Vitest invariants (`dashboard-consistency`, `courses`) stay as they are. This is a presentation-layer change plus a few new interactions.
- **Where this spec is silent,** follow the nearest pattern in section 6 and flag it in the PR.
- **Prototype caveat.** The canvas prototype used inline SVG, CDN fonts and invented rows to show the look. Production uses the icon library, bundled fonts and real data from the `api` object.

## 2. Design principles

1. **Quiet by default.** Chrome is neutral. Colour is reserved for meaning. Only the unread dot, focus ring and sync bar use the accent.
2. **Rows, not cards.** Lists are dense rows with properties as inline tags. No card grids and no shadows on in-page content.
3. **Details on demand.** Selecting a row opens a peek panel instead of crowding the list.
4. **Every state is visible.** Syncing, unread, unavailable, paused and expired session each have a distinct indicator, and none rely on colour alone.
5. **Never invent data.** A missing upload date reads 'Upload date unavailable' (`lib/format.ts:describeUpload`).
6. **Keyboard first.** Every action is reachable without a mouse. Ctrl/Cmd+K opens search and commands.
7. **Motion answers an action.** 120 to 220 ms, no decorative or looping animation except the sync indicators.

## 3. Stack and dependencies

**Keep:** Tauri 2, React 18, TypeScript 5.7, Vite 6, plain CSS with custom properties, props-down state in `App.tsx` (no global store), Vitest + jsdom, `lib/api.ts` as the only `invoke()` caller, the fixed `NAV` array with no router.

**Add:**

| Package | Purpose | Used by | Notes |
| --- | --- | --- | --- |
| `@radix-ui/react-dialog` | Modal behaviour, focus trap, scroll lock | ConfirmDialog, ResourcePreviewPanel | Unstyled. Replaces `.confirm-backdrop` and `.preview-backdrop` |
| `@radix-ui/react-dropdown-menu` | Overflow menus | Course row menu, History row menu | Roving focus and typeahead included |
| `@radix-ui/react-popover` | Anchored panels | Filters popover, date popover |  |
| `@radix-ui/react-select` | Styled select | Course filter, type filter, sort, sync interval | Replaces native `<select>` so menus match the theme |
| `@radix-ui/react-switch`, `-checkbox`, `-toggle-group` | Form controls | Settings toggles, theme and view switchers | ToggleGroup replaces `.chips` |
| `@radix-ui/react-tooltip` | Hints | Icon buttons, collapsed sidebar | 400 ms open delay |
| `@radix-ui/react-toast` | Toasts | Replaces the single 6 s error string | Supports queue, swipe-dismiss, pause on hover |
| `@radix-ui/react-scroll-area` | Themed scrollbars | Peek panel, sidebar | Optional, native scrollbars are acceptable |
| `@radix-ui/react-collapsible` | Disclosure | Course library folders, Settings sections |  |
| `cmdk` | Command palette | Global search | Fuzzy match over courses, files, views, actions |
| `lucide-react` | Icons | Everywhere | Size 16, `strokeWidth` 1.75, tree-shaken per icon |
| `@tanstack/react-virtual` | List virtualisation | Library (up to 2000 files), History | Required above 200 rows |
| `tinykeys` | Shortcuts | `useHotkey` hook in `lib/` | About 700 bytes |
| `@fontsource-variable/geist`, `/geist-mono`, `/newsreader` | Bundled fonts | `main.tsx` | The app is offline-first. No CDN fonts in production |

**Rejected:** Tailwind and the shadcn CLI (the system is already token-driven and a second styling system would split it; use shadcn only as a reference for how to wrap Radix), MUI and Chakra (opinionated visuals), Framer Motion (all motion is CSS), Redux and Zustand (no global store by design), a router (one window, six views).

**Wrapper rule.** Radix is imported only inside `src/components/ui/`. Each wrapper is thin, exports one named component and styles itself with the classes in section 6 and Radix `data-state` attributes. This mirrors the `api.ts` rule: one place to change a dependency.

**Install:** pin exact versions. All packages are MIT or OFL licensed.

```
npm i @radix-ui/react-dialog @radix-ui/react-dropdown-menu @radix-ui/react-popover @radix-ui/react-select @radix-ui/react-switch @radix-ui/react-checkbox @radix-ui/react-toggle-group @radix-ui/react-tooltip @radix-ui/react-toast @radix-ui/react-scroll-area @radix-ui/react-collapsible cmdk lucide-react @tanstack/react-virtual tinykeys @fontsource-variable/geist @fontsource-variable/geist-mono @fontsource-variable/newsreader
```

**CSS organisation.** Split the single `styles.css` into `src/styles/` and import in `main.tsx`: `tokens.css`, `base.css`, `layout.css`, `components/*.css`. Declare `@layer tokens, base, layout, components;` at the top of `tokens.css`. The system stays plain CSS and stays token-only: no component hardcodes a colour.

**Webview guardrail.** macOS 10.15 is the minimum, and its WebKit tops out around Safari 15.6. Do not use CSS nesting, `color-mix()`, container queries or `text-wrap: balance`. `@layer`, custom properties, `:focus-visible` and `:has()` are safe. Theme tint tokens are therefore explicit hex values, not computed.

## 4. Design tokens

Themes are set on `:root[data-theme='light' | 'dark']`. The dark block only redefines variables. `main.tsx` keeps setting the first-paint theme from `quanta-pulse-theme`, with `system` following `prefers-color-scheme`.

### 4.1 Colour

| Token | Light | Dark | Usage |
| --- | --- | --- | --- |
| `--bg` | #FAF9F6 | #262624 | Page background |
| `--side` | #F3F1EB | #1F1E1D | Sidebar, table headers |
| `--raised` | #FFFFFF | #2E2D2B | Peek panel, popovers, dialogs, inputs, secondary buttons |
| `--hover` | rgba(55,53,47,.06) | rgba(255,255,255,.06) | Row and item hover |
| `--selected` | rgba(55,53,47,.09) | rgba(255,255,255,.09) | Selected row, active nav item (new) |
| `--ink` | #2B2A27 | #ECEAE4 | Primary text, primary button fill |
| `--muted` | #6B685F | #A19E95 | Secondary text, icons, placeholders |
| `--faint` | #9A978E | #6F6D66 | Decorative only: dividers in text, disabled glyphs. Never for readable text |
| `--line` | rgba(55,53,47,.12) | rgba(255,255,255,.10) | Hairlines, input borders |
| `--line-strong` | rgba(55,53,47,.22) | rgba(255,255,255,.18) | Hovered input border, calendar today ring |
| `--accent` | #2383E2 | #5AA2F0 | Unread dot, focus ring, sync bar, selected checkbox. Never as text colour |
| `--link` | #0F63B8 | #7DB4F5 | Text links such as 'Open Quanta page' |
| `--overlay` | rgba(25,24,22,.40) | rgba(0,0,0,.55) | Dialog scrim |
| `--dot-ok` | #3FA46A | #4FBE7E | Healthy sync dot |
| `--dot-warn` | #D99628 | #E3A63C | Syncing dot, paused dot |
| `--dot-danger` | #D9473B | #F0705F | Error and expired-session dot |

**Status tags** (background / text). Each tag always pairs with a text label.

| Tag | Token prefix | Light | Dark | Meaning |
| --- | --- | --- | --- | --- |
| New | `--t-new` | #DDEBF1 / #183347 | #1D3A52 / #9CC4E8 | New upload |
| Updated | `--t-upd` | #FBEBC4 / #402C1B | #4A3A12 / #E8C872 | File changed |
| Deadline | `--t-red` | #FFE2DD / #5D1715 | #4D2420 / #F0A89E | Upcoming deadline, errors |
| Announcement | `--t-note` | #E8DEEE / #412454 | #3A2A52 / #C9B0E8 | Forum or notice post |
| Unavailable | `--t-gone` | #E8E6E1 / #4A4740 | #383733 / #A5A39C | Missing for 2 scans |
| Restored | `--t-ok` | #DBEDDB / #1C3829 | #1F3D2B / #8FD1A5 | Returned after unavailable |

Suffixes are `-bg` and `-fg`. Alerts reuse them: error uses `--t-red`, info uses `--t-new`, success uses `--t-ok`.

**Course dots.** Eight fixed hues assigned by a stable hash of `courseId`: #9065B0, #2B9A8C, #C77B30, #CD4A7A, #4F7DF3, #7A8F2B, #B5533C, #5B6C8F. The dot is always followed by the course code, so it never carries meaning alone.

**Contrast.** `--muted` on `--bg` is 5.3:1 in light and 5.6:1 in dark. Every tag pair meets 4.5:1. `--accent` is for non-text use only (3:1 required); text links use `--link` (6.0:1 on `--bg`).

### 4.2 Typography

| Token | Family | Size / line | Weight | Use |
| --- | --- | --- | --- | --- |
| `--type-display` | Newsreader | 42 / 46 | 400 | Page title, tracking -0.01em |
| `--type-title` | Newsreader | 24 / 29 | 400 | Peek panel and Login title |
| `--type-dialog` | Newsreader | 20 / 26 | 400 | Dialog title |
| `--type-lead` | Geist | 15 / 22 | 400 | Page summary line |
| `--type-ui` | Geist | 14 / 20 | 400 | Body, rows, buttons |
| `--type-ui-strong` | Geist | 14 / 20 | 500 | Unread titles, buttons, active tab |
| `--type-small` | Geist | 13 / 18 | 400 | Properties, helper text, table cells |
| `--type-caption` | Geist | 12 / 16 | 500 | Tags, group headers, section labels |
| `--type-mono` | Geist Mono | 12 / 16 | 400 | Counts, shortcuts, sizes, timestamps in tables |

Rules: minimum size 12. Numerics use `font-variant-numeric: tabular-nums`. Body line length stays under 70ch. Serif is for titles only, never for UI controls or table text.

### 4.3 Spacing and layout constants

Keep the 4px scale `--sp-1` (4) to `--sp-8` (32) and add `--sp-10` (40), `--sp-12` (48), `--sp-16` (64).

| Token | Value | Use |
| --- | --- | --- |
| `--sidebar-w` | 248 | Sidebar |
| `--sidebar-rail` | 56 | Collapsed sidebar |
| `--topbar-h` | 48 | Top bar |
| `--row-h` | 40 | List rows (was 46) |
| `--peek-w` | 340 | Peek panel |
| `--content-max` | 900 | Centred content column |
| `--page-pad-x` | 48 | Content side padding, 24 under 760 |
| `--control-h-sm` / `-h` / `-h-lg` | 28 / 32 / 36 | Control heights |

### 4.4 Shape, elevation, motion, z-index

| Token | Value | Use |
| --- | --- | --- |
| `--radius-xs` | 4 | Tags, kbd |
| `--radius-sm` | 6 | Buttons, inputs, rows, nav items |
| `--radius-md` | 8 | Menus, popovers, toasts, banners |
| `--radius-lg` | 12 | Dialogs, preview |
| `--radius-pill` | 999 | Course pills, status pill |
| `--shadow-pop` | 0 4px 16px rgba(0,0,0,.08), 0 0 0 1px var(--line) | Menus, popovers, toasts (dark: .40 alpha) |
| `--shadow-dialog` | 0 16px 48px rgba(0,0,0,.16), 0 0 0 1px var(--line) | Dialogs (dark: .50 alpha) |
| `--dur-fast` / `-base` / `-slow` | 120 / 160 / 220 ms | Hover, small state change, panel entrance |
| `--ease-out` | cubic-bezier(.2,.8,.2,1) | Entrances |
| `--ease-inout` | cubic-bezier(.4,0,.2,1) | Colour and size changes |
| `--z-sticky` / `-sidebar` / `-popover` / `-dialog` / `-toast` | 10 / 20 / 50 / 60 / 70 | Stacking |

In-page content never has a shadow. Separation comes from `--line`.

### 4.5 Migration map from the current tokens

| Current | New |
| --- | --- |
| `--surface` | `--raised` |
| `--surface-2` | `--side` (chrome) or `--hover` (interactive) |
| `--text` | `--ink` |
| `--cyan`, `-soft`, `-border` | `--accent` (non-text) and `--t-new-bg` / `-fg` |
| `--green`, `--amber`, `--red`, `--violet` | `--t-ok`, `--t-upd`, `--t-red`, `--t-note` |
| `--radius` (6), `--radius-sm` (4) | `--radius-sm`, `--radius-xs` |
| `--fs-ui` 14, `--fs-meta` 13, `--fs-label` 13, `--fs-title` 22 | `--type-ui`, `--type-small`, `--type-caption` (12), `--type-display` |
| `--row-h` 46 | `--row-h` 40 |
| `--accent`, `--ok`, `--warn`, `--danger` aliases | Keep for one release, then remove |

`lib/filetype.ts` keeps its mapping but returns token names: PDF and docs `--t-red-fg`, sheets `--t-ok-fg`, slides `--t-upd-fg`, links `--t-note-fg`, text `--t-new-fg`, other `--muted`. It renders as a 6px dot plus the type name, only in Library tables. Row icons stay neutral.

## 5. Layout and shell

```
┌──────────┬───────────────────────────────────────────┬─────────┐
│ Sidebar  │ Top bar: breadcrumb · actions             │         │
│ 248      ├───────────────────────────────────────────┤  Peek   │
│ brand    │ Page header: date, title, summary         │  340    │
│ search   │ Tabs                                      │ (opens  │
│ nav      │ List: groups > rows                       │  on row │
│ courses  │                                           │  select)│
│ sync     │                              [toast]      │         │
└──────────┴───────────────────────────────────────────┴─────────┘
```

- **Window.** Default 1040x720, minimum 820x540 (unchanged). On macOS use `titleBarStyle: Overlay` with a hidden title, and add `data-tauri-drag-region` to the sidebar header and top bar. Keep a 76px left inset in the sidebar header on macOS only (`[data-platform='macos']`) for the traffic lights. Windows keeps the native title bar.
- **Sidebar.** Width `--sidebar-w`, background `--side`, right border `--line`. Header: 26px logo mark, app name in `--type-ui-strong`. Then the Search trigger, the five nav items, the Courses section, and a footer that holds the sync block.
- **Top bar.** Height `--topbar-h`, no border (the page header carries the hierarchy). Left: breadcrumb. Right: contextual actions, then the theme icon button.
- **Content.** Centred column, max `--content-max`, side padding `--page-pad-x`, top padding `--sp-7`. Scrolls inside `<main>`, the sidebar never scrolls with it.
- **Peek panel.** Docked at `--peek-w` with `--raised` background and a left `--line` border when the window is 1180px or wider. Below that it becomes an overlay sheet anchored right, with `--shadow-pop`, and below 760px it is full width.
- **Sync bar.** 2px high at the very top of `<main>`, only while syncing.
- **Toast region.** Bottom centre, 28px from the bottom, one visible at a time with the rest queued.

| Breakpoint | Changes |
| --- | --- |
| 1180px and wider | Full layout, peek docked |
| 960 to 1179px | Peek becomes an overlay sheet |
| 820 to 959px | Sidebar collapses to the 56px rail: icons only with tooltips, Courses section hidden, footer shows the status dot and a Sync icon button. Ctrl/Cmd+backslash toggles it at any width |
| 760px and narrower | Page padding 24 (16 below 620), tables scroll horizontally, rows wrap the title to its own line, tree rows drop the trailing column |
| Below 820px | Not supported by the window minimum, but nothing may break |

## 6. Components

### 6.1 Shared rules

- **Focus.** Every interactive element shows `outline: 2px solid var(--accent); outline-offset: 1px` on `:focus-visible`. Never remove it.
- **Hover and press.** Colour changes fade over `--dur-fast`. Pressed uses `--selected`. Disabled is 50% opacity, `cursor: not-allowed`, no hover change, with native `disabled` or `aria-disabled`.
- **Loading.** The leading icon becomes a 14px spinner (900 ms linear rotation) and the label becomes a present participle ('Scanning', 'Saving') so the width stays stable. Under reduced motion the spinner is static and the label alone carries the state.
- **Targets.** Icon-only controls are at least 28x28. Default controls are `--control-h` high.
- **Icons.** Lucide at 16px, `currentColor`, `aria-hidden`. An icon-only button always has `aria-label` and a Tooltip.
- **Copy.** Sentence case. An action keeps its name through the flow: 'Save settings' produces the toast 'Settings saved'.
- **New tokens required by this section:** `--ink-hover` (#413F3A light, #FFFFFF dark), `--danger-solid` (#C23A2F light, #F0705F dark), `--on-danger` (#FFFFFF light, #1A0F0E dark).

### 6.2 Foundations

| Component | Variants and props | States | Notes |
| --- | --- | --- | --- |
| Button | `variant`: primary, secondary, ghost, danger. `size`: sm 28, md 32, lg 36. `leadingIcon`, `trailingIcon`, `loading`, `disabled` | default, hover, pressed, focus, disabled, loading | Primary: `--ink` fill, `--bg` text, hover `--ink-hover`. Secondary: `--raised` fill, 1px `--line`, hover adds `--hover` and `--line-strong`. Ghost: transparent, hover `--hover`. Danger: `--danger-solid` fill, `--on-danger` text. Radius `--radius-sm`, padding `--sp-3`, gap `--sp-2`. At most one primary button per region |
| IconButton | `size`: 28, 32. `label` (required), `pressed` | default, hover, pressed (`aria-pressed`, `--selected`), focus, disabled | Always wrapped in a Tooltip. Replaces `.btn-link` where the action is an icon |
| Kbd | `keys` | static | Mono 12, 1px `--line`, `--radius-xs`, padding 0 `--sp-1`. Renders the Command symbol on macOS and 'Ctrl' elsewhere |
| StatusTag | `kind`: new, updated, deadline, note, unavailable, restored. `label` override | static | Height 20, padding 0 `--sp-2`, `--radius-xs`, caption type, colours from the `--t-*` pairs. Label max 16 characters. Never interactive. Always text, never a bare colour |
| CoursePill | `courseId`, `code` | static, hover shows full course name in a Tooltip | 8px dot plus code. Height 20, `--radius-pill`, `--hover` fill, max 12 characters then ellipsis |
| UnreadDot | `unread` | unread, read | 7px `--accent` circle. The space is always reserved so titles never shift. Fades to transparent over 200 ms when read. Carries visually hidden text 'Unread' |
| FileTypeIcon | `type` | static | Lucide File, FileText, Sheet, Presentation, Link, Folder at 16px in `--muted` |
| Divider | none | static | 1px `--line` |

### 6.3 Forms

| Component | Spec |
| --- | --- |
| SearchField | Height `--control-h`, leading search icon, clear button appears when there is text, Esc clears, `/` focuses it on views that have one. 150 ms debounce. `role='searchbox'`. Placeholder in `--muted` |
| TextField, PasswordField | Label above in `--type-ui-strong`. 36px high on Login, 32px in Settings. 1px `--line` border, `--raised` fill. Focus: border `--accent` plus the shared focus outline. Invalid: border `--dot-danger` and a message below in `--t-red-fg` with an alert icon, linked by `aria-describedby`. PasswordField has a reveal IconButton inside the right edge and is cleared immediately after submit (existing behaviour) |
| Select (Radix) | Trigger looks like a secondary button with a trailing chevron. Content: `--raised`, `--shadow-pop`, `--radius-md`, items 28 high, selected item shows a check, max height 320 then scroll, typeahead. Used for course, type, sort and sync interval |
| Switch | Track 32x18, thumb 14. Off: `--line-strong` track. On: `--accent` track. Thumb moves over `--dur-base`. `role='switch'` and a real label |
| Checkbox | 16px, `--radius-xs`, checked fill `--accent` with a white check |
| ToggleGroup | Segmented control for single choice (theme, library view). Container `--hover` with 2px padding, items 28 high, active item `--raised` with a 1px `--line` border. `role='radiogroup'`, arrow keys move selection |
| TimeField | 72px wide, mono, `HH:MM`, validated with the existing `is_valid_hhmm` rule. Invalid shows the inline error pattern above. Used for quiet hours start and end |
| SettingRow | Grid of label block and control. Label in `--type-ui-strong`, description in `--type-small` and `--muted`, max 60ch. Control right-aligned. Vertical padding `--sp-4`, hairline between rows. Stacks the control under the label below 620px |

### 6.4 Navigation

| Component | Spec |
| --- | --- |
| NavItem | 32 high, icon 16, label `--type-ui`, optional mono badge. Default: `--muted` text. Hover: `--hover` and `--ink`. Active: `--selected`, `--ink`, weight 600, `aria-current='page'`. Collapsed rail: icon only with a right-side Tooltip. The History badge shows the unread count and caps at '99+' |
| CourseNavItem | 8px course dot, code, mono unread count. Click toggles the course filter (`aria-pressed`). Paused courses show a pause icon instead of the dot and use `--muted` text. Sorted by unread then code. Shows up to 8 courses, then 'All courses' which opens Library |
| Breadcrumb | `nav` with `aria-label='Breadcrumb'`. Ghost buttons 28 high, '/' separators are `aria-hidden`, the last item is plain text with `aria-current='page'` |
| FilterTabs | Row of buttons, 36 high, 2px bottom border: transparent by default, `--ink` when active. Count in mono 12 at 70% opacity. Roving tabindex with arrow keys, `aria-pressed` on each button inside a labelled group. Used when the tabs filter the same list. A zero count stays enabled but muted |
| Tabs (view) | Same visual as FilterTabs but `role='tablist'` and `role='tab'` with `aria-selected`, for views that swap content (History: Changes and Scans) |
| PageHeader | Caption line (date or context) in `--type-small` `--muted`, title in `--type-display`, optional summary in `--type-lead` `--muted`, optional actions top right. Bottom margin `--sp-6` |
| CommandPalette | `cmdk` inside a Radix Dialog. 560 wide, max 420 high, `--radius-lg`, `--shadow-dialog`. Borderless 48px input. Groups: Views, Courses, Files (best 8 matches), Actions (Sync now, Mark all read, Switch theme, Toggle sidebar). Result rows 36 high with icon, label and a trailing Kbd or CoursePill. Opens with Ctrl/Cmd+K or `/`, Esc closes and returns focus. Files are matched client-side against already loaded resources, no new backend command. Destructive actions are excluded. Empty: 'No matches for that search' |

### 6.5 Data display

**ResourceRow** (Today feed, History changes, Calendar day list)

| Part | Spec |
| --- | --- |
| Structure | CSS grid: `[select button: UnreadDot 7px, FileTypeIcon 16px, title minmax(0, 1fr)] [CoursePill + StatusTag auto] [time auto] [actions auto]`. The pill and tag are siblings of the select button, never inside it |
| Size and shape | Min height `--row-h`, `--radius-sm`, horizontal padding `--sp-2`, gap `--sp-3` |
| Density | `density='comfortable'` (Today, History, All files): title, pill and tag on one line. `density='compact'` (Calendar day panel): two lines, the title on line 1 and the CoursePill, StatusTag and time on line 2, aligned under the title. A row measured under 560px switches to compact by itself, because container queries are unavailable on the minimum webview |
| Overflow | Every track that holds text has `min-width: 0`, so only the title ellipsises. CoursePill is `flex: none` with `max-width: 16ch` and an ellipsised label; StatusTag is `flex: none`. Nothing overlaps at any window width |
| States | Hover `--hover`. Selected `--selected`. Focus ring on the select button. Unread: title weight 500. Unavailable: title struck through and `--muted` |
| Title | One line, ellipsis. Full text in the `title` attribute and in the peek panel |
| Time | Caption `--muted`, no wrap, from `lib/format.ts`. Missing date reads 'Upload date unavailable', never a substitute |
| Actions | Open and overflow buttons are visible on hover, on `:focus-within` and on the selected row. They stay in the tab order. Open label: 'Open file', 'Open course' for deadlines, 'Read post' for announcements |
| Overflow menu | Open file, Open Quanta page, Copy link, Mark as read or unread |
| Rule | The row is never a button containing another button. Selecting and opening are separate controls |

| Component | Spec |
| --- | --- |
| GroupHeader | Caption 500 `--muted` with a mono count. Padding `--sp-4` top, `--sp-1` bottom. Sticky at `--z-sticky` with `--bg` fill and a 1px `--line` bottom border while stuck. Labels come from `groupByDate`: Today, Yesterday, then weekday and date |
| DataTable | Header row `--side`, 32 high, caption `--muted`, sticky. Body rows `--row-h`, 1px `--line` bottom, hover `--hover`. Sortable headers are buttons with a chevron and set `aria-sort`. Numeric columns are right-aligned mono. Cells truncate with a `title`. Under 760px the table scrolls inside its own `overflow-x: auto` box with a sticky first column. Virtualised above 200 rows |
| PropertyList | `dl` with a 92px label column and a flexible value column. Labels `--type-small` `--muted`, values `--type-small` `--ink`, values wrap. Path and URL values reveal a copy IconButton on hover |
| StatBlock | Used in the Calendar day digest. Label in caption `--muted`, value in `--type-ui-strong` mono. Zero values render muted. No colour fills |
| EmptyState | Centred, `--sp-12` vertical padding. Title in `--type-dialog`, one explanatory line in `--type-ui` `--muted`, optional single button. No illustrations. Copy is defined per screen in section 7 |
| Skeleton | `--hover` bars matching the final row height. Shown only after a 200 ms delay to avoid flashing. 1.4 s shimmer, static under reduced motion |

### 6.6 Feedback and overlays

| Component | Spec |
| --- | --- |
| Toast (Radix) | Bottom centre. `--ink` fill, `--bg` text, `--radius-md`, padding 9px 16px, 13/500. Auto-dismiss at 4 s, errors at 6 s and styled with `--t-red`. Pauses on hover. One optional action ('Undo', 'Retry'). `role='status'`, errors `role='alert'`. Enter 220 ms (8px rise plus fade), exit 120 ms fade. Queue shows one at a time. Replaces the single toast string in `App.tsx` |
| Banner | `kind`: info, error, ok. Fill and text from the matching `--t-*` pair, `--radius-md`, padding 10px 14px, 16px icon, optional ghost action on the right, optional dismiss. Sits at the top of the content column and pushes content down |
| SessionRefreshBanner | idle: 'Your Quanta session expired' with 'Restart session'. restarting: spinner, 'Restarting session', action disabled. failed: error banner with the reason, 'Try again' and 'Sign in again'. succeeded: ok banner that removes itself after 4 s. The main UI stays usable underneath, as today |
| ConfirmDialog (Radix) | 440 wide, `--radius-lg`, `--raised`, `--shadow-dialog`, padding `--sp-6`. Title `--type-dialog`, body `--type-ui` `--muted`. Footer right-aligned: secondary 'Cancel' (initial focus) and a danger or primary confirm. The confirm label repeats the trigger verb. Scrim `--overlay` fades 160 ms, panel scales .98 to 1 with a fade over 160 ms. Esc and scrim click cancel unless an action is running. Used for Clear activity, Re-baseline course, Re-baseline all, Sign out |
| Tooltip | 12/16, `--ink` fill, `--bg` text, `--radius-xs`, padding 4px 8px. 400 ms open delay, instant when moving between tooltips. Never the only place for essential information |
| Menu (Radix) | `--raised`, `--shadow-pop`, `--radius-md`, padding 4. Items 28 high with `--radius-xs`, hover and focus `--hover`. Destructive item text uses `--t-red-fg`. Optional right-aligned mono shortcut. Arrows, Home, End and typeahead |
| SyncStatus | Dot 8px plus text. idle: green dot, 'Synced 4 min ago', relative time refreshed every 30 s, Tooltip with the exact time and next scan. syncing: amber dot with a ping ring (1.4 s), 'Scanning 7 of 12 courses' from `sync:progress`. error: red dot, 'Last scan failed', click opens History scans. paused: amber dot, 'Monitoring paused'. All with a text label |
| SyncButton | Secondary sm, full width in the sidebar. Idle 'Sync now'. Syncing: refresh icon spins, label 'Scanning', disabled, `aria-busy='true'`. Collapsed rail: IconButton |
| SyncProgress | 2px bar at the top of `<main>`. Unknown total: indeterminate sweep, 40% wide, 1.1 s ease-in-out loop. Known total: determinate fill with a 160 ms width transition. Fades out over 160 ms on `sync:done` |
| PeekPanel | `aside` labelled 'Details', width `--peek-w`, `--raised`, padding `--sp-5` `--sp-6`. Header: StatusTag left, close IconButton right. Title in `--type-title`, clamped to 3 lines. Then PropertyList, then actions. Primary 'Open file' (or 'Open course', 'Read post'), secondary 'Preview' only when `lib/preview.ts` allows it, overflow menu. Enter: 220 ms slide of 14px plus fade. Exit: 120 ms fade. Selecting another row cross-fades the content in 120 ms without re-running the slide. Keyboard open moves focus to the panel title, close returns focus to the originating row. Esc closes. Unavailable files add the note 'Missing for 2 scans in a row. It may come back.' |
| PreviewDialog | Radix Dialog, up to 960x720 and 80% of the window. Header with title, type, 'Open in Quanta' and close. Body renders per the preview decision. Loading shows a Skeleton. Failure shows an error Banner with 'Open in Quanta instead'. Preview lease behaviour in `state.rs` is unchanged |

## 7. Screens

Every screen sits in the shell from section 5. Navigation order is Today, Calendar, Library, History, Settings. This merges the current six views into five: Dashboard becomes Today, and Resources plus Courses become Library. All screens read the same `change_events` rows through `lib/events.ts`, so counts, colours and rows cannot drift between them.

### 7.1 Login

**Purpose.** Sign in to Quanta by password or BITS SSO. Shown until `auth.authenticated`, unless the session is only expired (then the main UI shows with a banner).

```
          (drag region, 48 high)

               [logo 32]
         Sign in to Quanta
   Pulse signs in as you and keeps
   everything on this computer.

   Username   [______________________]
   Password   [______________________ (eye)]

   [            Sign in             ]
   ------------- or -------------
   [     Continue with BITS SSO     ]

   Your password is never stored. Session
   cookies stay in memory only.
```

- **Layout.** Single centred column, 360 wide, vertically centred, no card and no sidebar. Title in `--type-title`, copy in `--type-small` `--muted`. Fields and both buttons use the lg size (36).
- **Components.** TextField, PasswordField, Button (primary lg, secondary lg), Banner.
- **States.** Idle. Submitting: fields disabled, primary shows 'Signing in'. SSO pending: secondary shows 'Waiting for BITS SSO' with a ghost 'Cancel'. Error: Banner above the fields, 'Wrong username or password' or 'Quanta did not respond. Check your connection and try again'. The password is cleared immediately after every submit, success or failure.
- **Keyboard.** Initial focus on Username. Enter submits. Tab order: username, password, reveal, sign in, SSO.

### 7.2 Today

**Purpose.** Answer 'what changed since I last looked?'. Data: dashboard resources and dashboard events from `refresh()`, filtered client-side.

```
[sidebar] | Today > (course)                 Mark all read  (...)  (theme)
          |
          | Tuesday 13 October
          | Today
          | 4 new files, 2 updated, and 1 deadline in 2 days.
          |
          | All 9 | New 4 | Updated 2 | Deadlines 1 | Unavailable 1   [Search]
          | -------------------------------------------------------------
          | Today                                                   4
          |  (o) [file] Lecture 14: Inheritance  (CS F213) [New]   09:12  (>) (...)
          |      ...                                               
          | Yesterday                                               5
```

- **Summary sentence.** Built from the same counts as the tabs: new files, updated files, announcements, deadlines, then unavailable files, each omitted when zero, with correct singular and plural ('1 new file'). The deadline clause names the nearest deadline inside the user's deadline window ('1 deadline in 2 days'). All zero reads 'You're all caught up.' followed by the last successful sync time.
- **Tabs.** FilterTabs: All, New, Updated, Deadlines, Unavailable. Counts respect the active course filter. A course chosen in the sidebar adds a breadcrumb segment, and clicking 'Today' clears it.
- **List.** Day groups from `groupByDate`, ResourceRows inside. Selecting a row opens the PeekPanel. A SearchField sits at the right of the tab bar (220 wide, collapses to an icon button under 960px).
- **Actions.** 'Mark all read' (ghost) and an overflow menu holding 'Clear activity', which opens the ConfirmDialog. Mark all read is optimistic: dots fade, the History badge drops immediately, then it reconciles with the backend. On failure it reverts and shows an error toast with 'Retry'.
- **Read rule.** Viewing a row's details does not mark it read. Opening the file, or pressing R, does.
- **Empty.** No resources ever: title 'Nothing tracked yet', body 'Run a scan and Pulse will list your course files here', button 'Sync now'. No current activity: 'You're all caught up', body 'New uploads appear after the next scan'. Filters match nothing: 'No matches', body 'Try a different filter', button 'Clear filters'.
- **Loading.** Six Skeleton rows after the 200 ms delay. **Error.** Banner error 'Could not load activity' with 'Try again'.
- **Edge cases.** Long titles truncate. Over 200 rows, virtualise. A deadline with no upload date shows the deadline time, never an invented one. Unavailable rows keep their strikethrough title and 'Unavailable' tag.
- **Keyboard.** Up/Down or J/K move between rows, Enter opens the peek panel, O opens the file, R toggles read, Esc closes the panel, `/` focuses search.

### 7.3 Calendar

**Purpose.** See activity by day and read a day's digest. Data: `events_range(from, to)` for the visible month, `daily_digest(date)` for the selected day. Days are always local calendar days.

```
 October 2026   (<) (>) [Today]         | Tuesday 13 October
 Mon Tue Wed Thu Fri Sat Sun            | New 4   Updated 2   Announcements 1
  .   .   .   1   2   3   4             | Deadlines 1  Unavailable 0  Failed 0
  ...                                   | Last successful sync 09:12
  12 (13) 14  15  16  17  18            | ------------------------------
  oo  ooo  .   o                        | [rows grouped by time]
 Legend: new, updated, announcement,    |
         deadline, unavailable, restored|
```

- **Layout.** Month grid left (flexible, min 520), day panel right (360, `--raised`, left `--line` border). Under 960px the panel stacks below the grid.
- **Header.** Month and year in `--type-display` at 28px, prev and next IconButtons, and a secondary sm 'Today' button.
- **Grid.** Six Monday-first weeks from `events.buildMonthGrid`. Weekday labels in caption `--muted`. Each DayCell is a button, 84 high, with `--radius-sm`. Day number top-left in mono. Today: number inside a 22px `--ink` circle with `--bg` text. Selected: `--selected` fill plus a 1px `--line-strong` ring. Days outside the month: `--muted` text at regular weight, no dots.
- **Dots.** Up to three 6px dots, priority unavailable, deadline, updated, announcement, new, restored (`dotKinds`), coloured with the `--t-*-fg` tokens. More than three events adds a mono '+n'. Each cell's `aria-label` spells out the day and counts ('13 October, 4 new, 1 deadline'), and a legend below the grid names every dot colour, so colour is never the only signal.
- **Day panel.** Date in `--type-title`, then StatBlocks in a 3x2 grid (new, updated, announcements, deadlines, unavailable, courses failed), then 'Last successful sync', then the day's ResourceRows. If courses failed, an error Banner reads 'N courses failed in the last scan' with 'View scan', which opens History scans.
- **Empty day.** 'No activity on this day'. If no scan ran that day, add 'No scans ran on this day'.
- **Loading.** The grid renders at once without dots. Dots fade in over 160 ms. The panel shows Skeleton rows. Month change cross-fades the grid over 160 ms with no slide.
- **Edge cases.** Counts above 99 show '99+'. Future days can show deadline dots. Selecting a day in an adjacent month switches to that month.
- **Keyboard (grid pattern, unchanged).** Arrows move by day and week, PageUp/PageDown change month, Home jumps to today. Roving `tabindex` with focus following selection. Enter moves focus into the day panel.

### 7.4 Library

**Purpose.** Browse everything Pulse has crawled. Merges Resources (flat table) and Courses (hub plus in-app library). PageHeader summary: '12 courses, 1,284 files'.

**Header controls.** ToggleGroup 'Courses | All files' and a SearchField. The view choice is remembered per session.

#### Courses view

- **CourseRow list** (rows, not cards). Chevron, course dot, course name in `--type-ui-strong` with the code in mono `--muted`, then an unread count, a file count in mono, last change time, and a status pill: 'Monitoring', 'Paused' or 'Last scan failed' (text, with a dot).
- **Row actions.** Overflow menu: 'Pause monitoring' or 'Resume monitoring', 'Re-baseline course...' (ConfirmDialog), 'Open Quanta course'.
- **Click** opens the course page inside Library (breadcrumb 'Library / CS F213'). This replaces the current inline `aria-expanded` expansion: a tree with up to 2000 files does not fit inside a list row, and a dedicated page gives it the width the tree and filters need. `list_resources({ courseId, limit: 2000 })` loads on entry.
- **Empty.** 'No courses found', body 'Pulse discovers your courses on the first scan', button 'Sync now'.

#### Course page (CourseLibrary)

```
 Library / CS F213 - Object Oriented Programming
 Object Oriented Programming            [Pause] [Open in Quanta] (...)
 [Search all sections....]  Sort: Newest  Type: All  Category: All   124 of 311
 ---------------------------------------------------------------------
  v [folder] Week 7                                          12
      [pdf] Lecture 14: Inheritance      PDF    2.1 MB   13 Oct   [Preview] [Open]
  > [folder] Week 6                                           9
```

- **Toolbar.** SearchField (searches every section), Selects for Sort (Newest, Oldest, Name, File type), Type and Category, plus a mono result count. Active filters show a 'Clear filters' ghost button.
- **TreeRow, folder.** Chevron toggles. Folder icon, name, mono descendant count. 'Open Quanta page' (external icon, `--link`) on hover and focus. Enter on a folder navigates into it: it becomes the root and the breadcrumb extends ('Library / CS F213 / Week 7'). Backspace goes up one level.
- **TreeRow, file.** FileTypeIcon, title, type column (6px tone dot plus name, from `lib/filetype.ts`), size in mono, upload date or 'Upload date unavailable', StatusTag if unavailable or restored. 'Preview' appears only when `lib/preview.ts` allows it, next to 'Open file'.
- **Indentation.** 16px per level, clamped visually at 6 levels with the full path in the `title`.
- **While searching.** Results flatten, each row shows its section path (from `lib/sectionPath.ts`) under the title in caption `--muted`, and matched text is highlighted with `--t-upd-bg`.
- **Virtualised** with `@tanstack/react-virtual` over the flattened visible rows.
- **Keyboard (ARIA tree).** Up/Down move, Right expands or enters, Left collapses or goes to the parent, Home/End, typeahead on names.
- **Empty.** Filters match nothing: 'No files match', button 'Clear filters'. Never scanned: 'This course has not been scanned yet', button 'Sync now'.

#### All files view

A DataTable over every resource, sharing the PeekPanel with Today.

| Column | Width | Content |
| --- | --- | --- |
| Title | flexible, min 280 | Title, with size beneath in caption mono |
| Course | 120 | CoursePill |
| Section | 160 | Section path, ellipsis |
| Type | 112 | Tone dot plus type name |
| Uploaded | 140 | Date or 'Upload date unavailable' |
| Availability | 112 | 'Available' in `--muted`, or a StatusTag for Unavailable and Restored |
| Actions | 72 | Open and overflow IconButtons |

Filters: course Select, type Select (built from the types that actually exist), SearchField. Default sort newest first, sortable by header. Below 960px the Section column hides, below 760px Availability hides too. Selecting a row opens the PeekPanel.

### 7.5 History

**Purpose.** The full log of changes and scans. Tabs (view): Changes and Scans. Page actions: 'Mark all read' (secondary sm) and an overflow menu with 'Clear history...' (ConfirmDialog).

#### Changes

- Day-grouped ResourceRows over `change_events`, the same row as Today so a change looks identical everywhere. The time shown is the detection time. Every kind appears, including Restored.
- Filters: change-type Select (All, New, Updated, Announcement, Deadline, Unavailable, Restored), course Select, SearchField.
- Unread dots, optimistic Mark all read and the sidebar badge behave as in Today.
- **Empty.** 'No changes recorded', body 'Changes appear after the first scan finishes. The first scan only sets a baseline.'

#### Scans

A DataTable over scan history.

| Column | Content |
| --- | --- |
| Started | Date and time in mono. A neutral 'Baseline' pill follows baseline scans, with a Tooltip: 'First scan of a course. It records everything as known and reports no changes.' |
| Status | Running (new tag plus spinner), Completed (ok tag), Completed with errors (updated tag), Failed (deadline tag). Always a text label |
| Found, New, Updated, Unavailable | Right-aligned mono numbers, zeros muted |
| Courses | Mono 'ok/total' |
| Errors | Mono count. A non-zero count is a button that opens the PeekPanel |

- Row click opens a PeekPanel with the scan's PropertyList (the same fields as the columns). Error text appears only if the scan record includes it, with secrets already redacted by `logging.rs`. No other fields are invented.
- **Empty.** 'No scans yet', body 'Run your first scan to set a baseline', button 'Sync now'.

### 7.6 Settings

**Purpose.** Configure appearance, account, notifications, monitoring and data. Header left-aligned, then a centred `160px minmax(0, 720px)` grid with a 48px gap: a sticky 160px section list beside the 720px content column.

```
 Settings
 [Appearance]    Appearance
  Account        Theme                          [System | Light | Dark]
  Notifications  ---------------------------------------------------
  Monitoring     Account
  Data           Status                         (o) Signed in
                 ...
 ----------------------------------------------------------------------
  You have unsaved changes              [Discard]  [Save settings]
```

- **Section list.** A sticky `nav` (top 24px) of 32px-high anchor rows, `--radius-sm`, no text-decoration, sentence-case labels. The scroll-spy active row is `--selected` with weight 600; clicking scrolls smoothly, instantly under reduced motion. Under 960px it becomes a horizontally scrolling Tabs row above the content.
- **Sections.** Sentence-case titles in `--type-dialog`, 40px above each except the first. Only SettingRows carry a hairline bottom border, and the last row in a section has none, so no line is ever doubled.
- **Draft model (unchanged).** Edits go to a local `draft`. A save bar slides up from the bottom of the content (160 ms) when the draft differs: 'You have unsaved changes', ghost 'Discard', primary 'Save settings'. Ctrl/Cmd+S saves. Save succeeds with the toast 'Settings saved'. Leaving the screen while dirty opens a ConfirmDialog, 'Discard changes?'. The one exception is Theme: it applies instantly and is not part of the draft.
- **Validation.** Follows `settings.rs` (`sanitize`, `is_valid_hhmm`). Invalid fields show the inline error, and 'Save settings' is disabled while any is invalid.

| Section | Rows |
| --- | --- |
| Appearance | Theme: ToggleGroup System, Light, Dark |
| Account | Status (dot plus 'Signed in', 'Session expired' or 'Signed out'). Sign-in method (Password or BITS SSO). Session acquired (mono time). Notification permission ('Allowed', 'Blocked' or 'Not asked') with 'Allow notifications' or 'Open system settings' and 'Send test notification'. 'Restart session' appears when expired. 'Sign out' is a danger ghost button that opens the ConfirmDialog |
| Notifications | Master Switch. Per-category Switches: New files, Updated files, Announcements, Deadlines, Unavailable files (matching the per-category gates in `notify.rs`). Deadline window Select. Quiet hours Switch with two TimeFields. When the master is off, the rest are dimmed, `aria-disabled`, with the helper 'Turn on notifications to change these' |
| Monitoring | Sync interval Select (options from the `settings.rs` limits). 'Run in background' Switch with 'Keep scanning from the menu bar after the window closes'. 'Launch at login' Switch. Timezone: read-only row with the system timezone and 'Dates are grouped by your local calendar days' |
| Data | PropertyList: database path (copy button, 'Show in folder'), size, counts for courses, resources and events, logs folder ('Open'), file cache (size and file count). 'Cached files' row pairs a size-limit Select (1–20 GB, default 2 GB) with a 'Clear cached files' button. A separated group at the bottom holds 'Re-baseline all courses' (secondary, danger text) with a ConfirmDialog: 'Records everything as known. Nothing is reported as new until the next scan.' |

### 7.7 System states

| State | Treatment |
| --- | --- |
| First run, baseline scan running | Today shows an EmptyState 'Setting your baseline' with 'Scanning 3 of 12 courses. Everything found now is recorded as known, so nothing will show as new yet.' and a determinate SyncProgress. On completion the toast reads 'Baseline set. Pulse will tell you about new uploads from now on.' |
| Session expired | SessionRefreshBanner under the top bar. SyncStatus shows a red dot and 'Session expired'. The UI stays usable with stored data |
| Scan failed or offline | SyncStatus red dot, 'Last scan failed'. Error toast with 'View scan' on first failure. History scans carries the detail |
| Course paused | CourseNavItem and CourseRow show the pause icon and 'Paused'. Its files stay listed and are excluded from scans |
| Course failed in last scan | Status pill 'Last scan failed' on the course. Calendar day panel banner |
| Missing upload date | 'Upload date unavailable' wherever a date would appear |
| Database cannot open | Full-window error, no shell: 'Pulse cannot open its database', the path in a PropertyList row, buttons 'Open logs folder' and 'Try again' |

### 7.8 Native surfaces

- **Tray menu.** Native text menu: status line ('Synced 4 min ago'), 'Sync now', 'Open Pulse', 'Settings', 'Quit'. Selecting a view item fires `ui:navigate`. No custom styling.
- **Notifications.** Title: '3 new files in CS F213'. Body: the first two titles and 'and 1 more'. Respect per-category switches and quiet hours. Clicking opens History.
- **Window close.** Follows the background setting: hides to the tray when 'Run in background' is on, otherwise quits.

## 8. Motion catalogue

Only `opacity` and `transform` animate, except collapse (height) and the determinate sync bar (width). Nothing animates on page load or view change, and nothing is staggered.

| Element | Trigger | Animation | Duration | Easing |
| --- | --- | --- | --- | --- |
| Buttons, rows, nav items | Hover, press | Background colour | `--dur-fast` | `--ease-inout` |
| FilterTabs underline | Filter change | Border and text colour | `--dur-base` | `--ease-inout` |
| UnreadDot | Row read | Fade to transparent | 200 ms | `--ease-inout` |
| PeekPanel | Open | 14px slide in from the right plus fade | `--dur-slow` | `--ease-out` |
| PeekPanel | Close | Fade out | `--dur-fast` | `--ease-inout` |
| PeekPanel content | Another row selected | Cross-fade, no slide | `--dur-fast` | `--ease-inout` |
| Dialog and palette | Open | Scrim fade, panel scale .98 to 1 plus fade | `--dur-base` | `--ease-out` |
| Dialog and palette | Close | Fade out | `--dur-fast` | `--ease-inout` |
| Menu, Select, Popover | Open | Fade plus scale .98 to 1 from the trigger | `--dur-fast` | `--ease-out` |
| Tooltip | Hover after delay | Fade | `--dur-fast` | `--ease-out` |
| Toast | Enter | 8px rise plus fade | `--dur-slow` | `--ease-out` |
| Toast | Exit | Fade | `--dur-fast` | `--ease-inout` |
| Banner | Appear, remove | Height expand and fade | `--dur-base` | `--ease-out` |
| Save bar (Settings) | Draft becomes dirty | Slide up from the bottom plus fade | `--dur-base` | `--ease-out` |
| Folder (tree) | Expand, collapse | Height, with the chevron rotating 90 degrees over `--dur-fast` | `--dur-base` | `--ease-out` |
| Sidebar | Collapse to rail | Width | `--dur-base` | `--ease-inout` |
| Calendar dots, month grid | Data loaded, month change | Fade in, cross-fade | `--dur-base` | `--ease-inout` |
| SyncStatus dot | Syncing | Ping ring grows 7px and fades, loops | 1400 ms | `--ease-out` |
| Sync icon | Syncing | Rotation, loops | 900 ms | linear |
| SyncProgress | Syncing | Indeterminate sweep loops. Determinate width follows progress | 1100 ms loop, 160 ms width | ease-in-out |
| Skeleton | Loading over 200 ms | Shimmer, loops | 1400 ms | linear |

**Reduced motion** (`prefers-reduced-motion: reduce`): transitions drop to 0.01 ms and entrances are instant. Looping animations are replaced by static equivalents: the ping ring becomes a fixed ring, the spinner becomes the static icon with the participle label, the indeterminate bar becomes a fixed 40% bar at half opacity, and skeletons stop shimmering.

## 9. Keyboard map

Single-key shortcuts are disabled while focus is in an input, select or contenteditable, and while a dialog is open. Shortcuts show in Tooltips and in the command palette. `Mod` is Cmd on macOS and Ctrl elsewhere.

| Shortcut | Action | Scope |
| --- | --- | --- |
| Mod+K | Open command palette | Global |
| `/` | Focus the screen's search field, or open the palette if there is none | Global |
| Mod+1 to Mod+5 | Today, Calendar, Library, History, Settings | Global |
| Mod+, | Open Settings | Global |
| Mod+Shift+S | Sync now | Global |
| Mod+Shift+L | Switch theme | Global |
| Mod+backslash | Toggle sidebar | Global |
| Up/Down or K/J | Previous and next row | Lists |
| Enter | Open details, or enter folder | Lists, tree |
| O | Open the file, course or post | Lists |
| R | Toggle read | Lists |
| Esc | Close panel, dialog, menu or palette. Clears a focused search field | Global |
| Backspace | Up one folder | Course page |
| Arrows, Home, End, typeahead | Tree navigation (Right expands, Left collapses) | Course page |
| Arrows, PageUp, PageDown, Home | Day, week, month, today | Calendar grid |
| Mod+S | Save settings | Settings |

## 10. Accessibility

- **Landmarks.** `nav` labelled 'Primary', `main`, `aside` labelled 'Details'. A 'Skip to content' link is the first focusable element.
- **Focus order.** Sidebar, top bar, page content, peek panel. Opening a dialog traps focus and returns it to the trigger on close. Toasts never take focus.
- **Roles.** Rows are plain containers with separate buttons. FilterTabs are a labelled group of `aria-pressed` buttons. History tabs use `tablist`. The course page uses the ARIA tree pattern. The calendar uses the grid pattern with roving `tabindex`. Switch uses `role='switch'`. Dialogs use `role='dialog'` with `aria-labelledby` and `aria-describedby`.
- **Live regions.** SyncStatus announces only 'Scan started' and 'Scan finished, N changes', never each progress step. Toasts use `role='status'` or `role='alert'` for errors. Banners that appear after load use `role='status'`.
- **Names.** UnreadDot carries hidden text 'Unread'. Row select buttons are labelled 'Show details for {title}'. Calendar cells spell out the date and counts. SyncButton sets `aria-busy`.
- **Contrast.** Body and secondary text 4.5:1 or better in both themes. Tag pairs 4.5:1 or better. Focus ring and non-text indicators 3:1 or better. `--accent` is never used for text.
- **Not colour alone.** Every status has a text label (tags, SyncStatus, Calendar legend and aria labels). Course dots always sit beside the course code.
- **Forced colours.** Under `@media (forced-colors: active)`, tags and pills get a 1px `currentColor` border, the focus ring uses `Highlight`, and dots keep `forced-color-adjust: none`.
- **Zoom.** The app supports webview zoom from 80% to 150% without clipped content down to the 820px minimum.
- **Tests.** Add `vitest-axe` checks per view, in both themes.

## 11. Content rules

**Voice.** Plain, active, sentence case. No exclamation marks. Errors say what happened and what to do, and never apologise. Empty states invite an action.

**Terminology.**

| Use | Avoid | Note |
| --- | --- | --- |
| Sync now | Refresh, Update | The user action. Status text says 'Scanning' and history says 'Scan' |
| Baseline, Re-baseline | Reset, Reindex | Existing product term |
| Unavailable | Deleted, Removed | Pulse cannot tell why a file went missing |
| Open file, Open Quanta page, Open course | Download, Go | Says exactly where it goes |
| Course | Subject, Class |  |
| Mark all read | Dismiss all | Not the same as Clear activity |
| Clear activity | Delete history | It hides rows, it does not delete data |

**Limits and truncation.**

| Element | Limit | Overflow |
| --- | --- | --- |
| StatusTag label | 16 characters | Never truncated, shorten the copy |
| CoursePill code | 12 characters | Ellipsis, full name in Tooltip |
| Row title | 1 line | Ellipsis, `title` attribute, full text in the peek panel |
| Button label | 24 characters | Never truncated |
| Toast | 80 characters | Wraps to 2 lines |
| Banner | 120 characters | Wraps |
| Dialog title / body | 40 / 160 characters | Wraps |
| Empty-state title / body | 30 / 90 characters | Wraps |

**Formats.** Use `lib/format.ts` for every date, size and relative label. Today's rows show a local time, last week shows weekday and time, older rows show the short date. Sizes use KB and MB with one decimal from 1 MB. Counts use `toLocaleString`. A missing date is 'Upload date unavailable', never the detection time.

**Longer text.** Layouts must tolerate 40% longer strings. Buttons and pills size to their content with min and max, never fixed widths.

## 12. Implementation guide

### 12.1 Folder structure

```
src/
  styles/        tokens.css  base.css  layout.css  components/*.css
  components/ui/ Button IconButton Tag Switch Select ToggleGroup Dialog Menu
                 Tooltip Toast Tabs Kbd Skeleton EmptyState Banner  (Radix wrappers)
  components/    Sidebar TopBar PageHeader ResourceRow GroupHeader PeekPanel
                 SyncStatus CommandPalette SettingRow PropertyList
  views/         TodayView CalendarView LibraryView HistoryView SettingsView LoginScreen
  views/library/ CourseList CoursePage AllFiles
  hooks/         useHotkey useTheme useMediaQuery
  lib/           unchanged, plus summary.ts (summary sentence builder)
```

Renames: `Dashboard.tsx` becomes `TodayView.tsx`. `ResourcesView.tsx` and `CoursesView.tsx` merge into `LibraryView.tsx`. The `NAV` array becomes Today, Calendar, Library, History, Settings, and `ui:navigate` payloads keep working by mapping the old names.

On the Rust side, new domain logic goes in a transport-agnostic module so the
Tauri commands, and any later HTTP or MCP server, stay thin:

```
src-tauri/src/
  core/          mod.rs  files.rs  search.rs  get_file.rs  …   (plain fns over
                 db / file store / client handles — no Tauri types)
  commands.rs    thin adapters; the only layer that knows about AppState
```

### 12.2 Reference snippets

`tokens.css` (structure only, values from section 4):

```css
@layer tokens, base, layout, components;
@layer tokens {
  :root, :root[data-theme='light'] {
    --bg: #FAF9F6; --side: #F3F1EB; --raised: #FFFFFF;
    --ink: #2B2A27; --muted: #6B685F; --accent: #2383E2;
    --t-new-bg: #DDEBF1; --t-new-fg: #183347; /* ...rest of section 4.1 */
    --radius-sm: 6px; --dur-fast: 120ms; --ease-out: cubic-bezier(.2,.8,.2,1);
  }
  :root[data-theme='dark'] {
    --bg: #262624; --side: #1F1E1D; --raised: #2E2D2B;
    --ink: #ECEAE4; --muted: #A19E95; --accent: #5AA2F0;
    --t-new-bg: #1D3A52; --t-new-fg: #9CC4E8; /* ... */
  }
}
```

Primitive API sketches:

```tsx
type StatusKind = 'new' | 'updated' | 'deadline' | 'note' | 'unavailable' | 'restored';

export function StatusTag({ kind, label }: { kind: StatusKind; label?: string }) {
  return <span className={`tag tag-${kind}`}>{label ?? DEFAULT_LABEL[kind]}</span>;
}

interface ResourceRowProps {
  event: ChangeEvent;          // from lib/types.ts, one canonical source
  selected: boolean;
  onSelect(id: string): void;  // opens the peek panel
  onOpen(id: string): void;    // opens via lib/open.ts and marks read
  onToggleRead(id: string): void;
}

// components/ui/Switch.tsx: the only file that imports Radix Switch
import * as S from '@radix-ui/react-switch';
export const Switch = (p: S.SwitchProps) => (
  <S.Root className='switch' {...p}><S.Thumb className='switch-thumb' /></S.Root>
);
```

### 12.3 Testing

Keep every existing suite, including `dashboard-consistency` and `courses`. Add:

- `summary`: the sentence builder, covering zero, singular, plural and the all-zero case.
- Extend `dashboard-consistency`: FilterTabs counts, the summary sentence, Calendar dots and History rows all derive from the same events.
- `settingsDraft`: dirty detection, validation, discard confirmation, theme applying instantly.
- `treeKeyboard` and `calendarKeyboard`: arrow, Home and End behaviour.
- `peekPanel`: focus moves in on keyboard open and returns on close, Esc closes.
- `vitest-axe` on each view in both themes.

### 12.4 Rollout

| Phase | Scope | Done when |
| --- | --- | --- |
| 1 | Split CSS into layers, new tokens, bundled fonts, theme wiring, shell (Sidebar, TopBar, SyncStatus, SyncProgress) | Both themes pass contrast, window minimum holds, rail collapse works |
| 2 | `components/ui` primitives and Today with PeekPanel | Today matches the Calm artboards in both themes, keyboard map works |
| 3 | Calendar and History | Counts match Today (consistency test), optimistic Mark all read reverts on failure |
| 4 | Library (course list, course page, all files) | 2000 files scroll smoothly, tree passes keyboard tests |
| 5 | Settings, ConfirmDialog, Toast, Banner states, Login | Draft and save bar behave, all destructive actions confirm |
| 6 | Command palette, shortcuts, empty and error states, reduced motion, forced colours | axe passes on every view, copy matches section 11 |

**Definition of done for each component.** All states in section 6 implemented, light and dark verified, keyboard operable, focus visible, reduced-motion path implemented, uses tokens only (no hex in component CSS), covered by a test.

## 13. Assumptions and open questions

- **Only Today has been drawn.** The Calm artboards cover Today in light and dark. Calendar, Library, History, Settings, Login and the system states are specified here from the existing structure in PROJECT.md, with wireframes, and have not had visual comps yet. Worth drawing before phases 3 to 5.
- **Library as pages, not inline expansion.** This is a deliberate change from the current `aria-expanded` course expansion. Confirm with the product owner.
- **Viewing does not mark read.** Opening the file or pressing R does. Confirm this matches the intended meaning of the unread flag.
- **Sync interval options** and the per-category notification list are taken from the structure described in PROJECT.md. The developer should confirm the exact values against `settings.rs` and `notify.rs`.
- **Calendar dots** are distinguished by colour plus the legend and cell labels. If testing shows this is not enough, add shape variation (circle, square, ring).
- **Windows title bar** stays native. A custom caption-button bar is out of scope.
- **Fonts** are SIL Open Font License and bundled, so offline use and distribution are fine.
