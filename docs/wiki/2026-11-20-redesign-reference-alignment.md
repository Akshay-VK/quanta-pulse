# 2026-11-20 redesign reference alignment

On 2026-11-20, the reference alignment pass used the [Pulse HTML exports](../research/redesign/pulse-design/index.html) for composition and the [implementation decisions](../research/redesign/implementation-plan/decisions.md) for resolved conflicts. The app changes landed in `Akshay-VK/quanta-pulse@b067cf0`.

- The pass aligned the route headers, sidebar, toolbar, status bar, and inspector with the workspace geometry. It updated Inbox, Agenda, Activity, History, Courses, All files, and the Course Materials folder rail and file table.
- The Settings work aligned the section rail, appearance controls, save bar, leave dialog, and update states. The app retained D03's Soft Graphite default and D08's Agenda and Activity tabs.
- The overlay work aligned sign-in and baseline progress, the command palette, downloads, session recovery, toast positioning, and Quick Look. Quick Look bundled PDF.js with its matching worker for local canvas rendering, thumbnails, and text search.

## Rendered evidence

On 2026-11-20, Chromium rendered all five primary routes with deterministic fixtures at 1440, 1280, 1100, 1099, 960, 959, 820, and 720 CSS pixels. The desktop sidebar, panel, header, search, inspector, and status-bar bounds matched the corresponding measured export elements. The course fixture matched the measured desktop file table and narrow course panel geometry, and folder selection showed the expected files.

The browser pass also exercised light appearance, Settings section navigation and dirty-draft focus, the responsive drawer and inspector, and 200% Chromium tab zoom. A separate two-page PDF fixture rendered with the worker and exercised thumbnail navigation and text search.

This pass verified the sampled layouts and interactions. The [98-screen acceptance matrix](../research/redesign/implementation-plan/screen-coverage.md) still requires complete per-state rendered comparisons, and the native WebView, live Quanta, and signed updater flows require separate verification.
