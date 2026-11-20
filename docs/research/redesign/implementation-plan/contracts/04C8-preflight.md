# 04C8 Courses hub navigation preflight — 2026-11-16

Docs/tracker-only inspection: accepted shared foundation `18b323f` plus docs and concurrent work; observed HEAD `43e4408af7d668a6c4787d027572f040a9aaf6d3`. B05C/API source is frozen; History Changes is active. Neither is a prerequisite for this surface. Root alone owns Git, adapter integration, dispatch and acceptance.

## Approved requirement and native evidence

[Spec §4](../../quanta-pulse-ui-implementation-spec.md#4-interaction-motion-keyboard) requires J/K or arrows to move focus in any list. [§5.4](../../quanta-pulse-ui-implementation-spec.md#54-library-and-courses) names the Courses hub separately from Course Materials/Activity; [§6](../../quanta-pulse-ui-implementation-spec.md#6-responsive-zoom-focus-light-mode) requires visible focus. Additional navigation is therefore required, even though native activation already works. Task10 retains course visual redesign, grouping, rows and course action work.

`src/views/library/CourseList.tsx` already renders stable `course.id` keyed divs, each with a native `.course-row-main` button and a sibling Radix Menu/IconButton. The primary button calls onOpenCourse(course); native Enter/Space supplies its click. The menu owns monitoring, rename, source-open and baseline-reset actions and dialogs. Preserve these handlers, labels, markup roles, native activation and native Tab/Shift+Tab order. Do not convert the hub to DataTable, listbox, grid or selectable resource rows. No course multiselection, inspected-course state or resource DetailsAdapter context is needed.

`LibraryView.tsx` conditionally mounts CoursePage or Courses/AllFiles. Courses receives the entire App courses array and current search. `App.tsx` refresh publishes api.listCourses() directly with setCourses(c); no hub paging or slice exists. CourseList's existing alias/name/shortName/external-ID filter preserves incoming order; it does not sort. Navigation must derive all IDs from exactly that visible array, never resources, badges, DOM queries or a capped subset. Preserve upstream order, including any future owner-provided sorting; do not add attention grouping here.

Existing activation chain: CourseList onOpenCourse → LibraryView onNavigate(selected.id) → App navigateToCourse → go({view:'library', courseId, folderPath}). Enter/Space must use this chain once through the existing button click. No independent Enter inspect handler or App/global key registry. Navigation alone never opens a course, reads events or changes inspection.

## Exact behavior contract

Local refs keyed by numeric course.id point to the primary buttons; policy IDs use `course:<id>`. Use accepted getListNavigationIntent only for J/K/ArrowDown/ArrowUp focus results, with empty selectedIds/completeEventIds and inspectedId null. Focused identity follows native onFocus as well as pointer/keyboard focus. Clamp first/last; focus the actual surviving button and scroll it into view when needed. Keep every primary and menu button in its existing Tab sequence: roving DOM focus is additional navigation, not a tabIndex=-1 conversion or a keyboard trap. Do not intercept Tab, Enter or Space.

Only a keydown targeted directly at the primary button can move hub focus (event.target === event.currentTarget). Other buttons, nested menu controls, inputs/textareas/selects/contenteditable, filters, menus/listboxes/dialogs/alertdialogs/palette/drawer yield to their owners. Reject defaultPrevented, repeat, composition/native isComposing or keyCode229, and every Shift/Ctrl/Alt/Meta modifier. Check mounted/connected hub and document overlay presence before moving; LibraryView conditional mounting excludes All files and CoursePage, and App conditional routing excludes other pages. No document/window key listener. Stop/default only a handled focus movement. Existing native activation and overlay focus trapping remain responsible for their own keys.

E/U/Delete/X/Shift+A produce no course operation. Space retains native course-button activation, never material preview. No shortcut calls read/unread/dismiss/history deletion/resource preview/file APIs, monitoring, rename, baseline reset or external open; explicit existing menu actions retain their own native behavior. Do not suppress native activation globally in an attempt to enforce list guards.

Use recoverFocusedId(previousVisibleIds, nextVisibleIds, focusedId): retain surviving identity; otherwise next surviving old neighbor, previous, then first; empty → null. Update bookkeeping without stealing DOM focus from search, menu, inspector or any overlay. Record ownership from focus/blur so removal of the active button can be distinguished from focus elsewhere; only list-owned removal can focus a survivor or request empty fallback. Reorder/refresh alone must not focus a list entered from elsewhere. Guard removal recovery against mount/route/tab changes and overlays; no delayed restoration after departure. Existing Radix/ConfirmDialog close restoration remains primary; do not add a course-inspector restore protocol. If an origin disappears during an overlay, no background recovery may steal focus; explicit later list re-entry uses current identities. There is no virtualizer to convert or enable.

## Essential root proposals before dispatch

Root LibraryView adapter (not worker-owned): add optional CourseListProps `onFocusSearch?: () => void`; pass `onFocusSearch={() => searchRef.current?.focus()}` at the Courses call site, using the same existing ref/adapter as AllFiles. Invoke only for list-owned removal leaving zero visible courses with no overlay, before the empty state returns. No App change. Root must integrate this seam before assigning the two-file worker lease; the worker's CourseList destructuring/usage may consume it.

Existing base.css :focus-visible supplies a 2px var(--focus) outline at 1px offset; screens.css .course-row-main has no focused bar/inset ring. Proposed root-only scoped rule, adjacent to that selector, for §6 focus proof:

```css
.course-row-main:focus-visible {
  outline-offset: 2px;
  box-shadow: inset 0 0 0 2px var(--focus), inset 4px 0 0 var(--focus);
}
```

Reuse tokens and native focus visibility; no focused/selected resource classes or geometry changes. Root verifies cascade/rendering and integrates or returns an equivalent scoped focus treatment before dispatch. This proposal is not an implemented or accepted style. No shared component/API/backend/policy change is essential.

## Publication, lease and stop

Native child of #35, blocked by accepted policy #33 and accepted Library integration #48 only. Retain those prerequisite edges even while accepted issues remain open. No B05C, History Changes #51, Activity #53 or Scans #54 dependency. Fully specified packet still awaits root adapter/CSS integration and a fresh exact dispatch base; do not apply ready-for-agent before those actual prerequisites are met. CourseList currently has no active lease; root may dispatch independently of History after integrating seams. Root decides scheduling.

Exact future lease: `src/views/library/CourseList.tsx` and new `tests/appCoursesKeyboard.test.tsx` only. No current implementation, source/test/style/Git/wiki edits or gates. Remaining collapse, Activity, Scans and task04/04C acceptance are incomplete. B05C/API freeze is untouched. Preserve 58 prior task records except appended 04C dependency, all 98 coverage bytes and the acyclic DAG. Coverage baseline SHA-256: `0f4a09a03c0ab3437b894bc366b60c2c7bb741e9a9828827e5f990f2ba90002e`.

## Publication verification

Published [#55](https://github.com/Akshay-VK/quanta-pulse/issues/55) after explicit-repository Issues-enabled check and empty all-state 04C8 / Courses-hub-title duplicate searches. Readback confirms OPEN, enhancement only, no ready-for-agent, native parent #35 and exactly blocked-by #33/#48. Repository API endpoints explicitly targeted Akshay-VK/quanta-pulse; this gh version rejects --repo on repo view, so the repository check used the explicit repos/Akshay-VK/quanta-pulse API endpoint. No existing issue body, labels or state changed.

Validation PASS: 59-node DAG has no cycles/missing references; all 58 prior records match except appending 04C8 to 04C dependencies; all 98 coverage ownership bytes match the baseline hash. Four leased documents pass trailing-whitespace and single-final-newline checks. Source/test comparison across this preflight: only concurrent external changes to src/views/HistoryView.tsx, tests/appHistoryKeyboard.test.tsx. This pass wrote only four docs and the new native tracker child/edges. No source/test/style/Git/wiki edits, delegates, implementation, browser verification or command gates.
