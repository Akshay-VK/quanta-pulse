# B05A bounded review

## Findings

No blocking defect found in the requested scope.

## Verified claims

- Rust and TypeScript expose matching event/scan page shapes, filters, and snapshot API. `lib.rs` registers all three Tauri commands; `api.ts` sends the corresponding command names and camelCase arguments. Existing list wrappers remain registered and implemented.
- Event queries compute totals after watermark, suppression, requested filters, and case-insensitive substring search over title, description, course name, and resource title, then paginate with `detected_at DESC, id DESC`. Scan queries count above the scan watermark and page with `started_at DESC, id DESC`. The limits are 1–1000; offsets must fit SQLite's signed integer range.
- Event bounds parse RFC 3339, normalize offsets to UTC, and compare `>= since` / `< until`. Invalid timestamps, non-increasing bounds, unknown change types, nonpositive course IDs, and invalid limits return string errors.
- Resource snapshots query all unread IDs for one resource without pagination or dismissal/history-watermark filtering, while excluding baseline and calendar-suppressed events. The focused attention test covers >1,000 IDs, read, dismissed, suppressed, baseline, history clear, and resource isolation.
- The Rust regression covers 1,205 visible events and 605 scans, full totals/pages beyond legacy caps, descending-ID ties, event watermark, suppression, read/dismissed visibility, type/course/search filters, and date-bound endpoints. The API test checks the three command names and arguments.

## Remaining limits

- Focused Rust tests could not run: Cargo stopped in `libdbus-sys` because this host lacks `dbus-1` development files (`dbus-1.pc`). No test result is claimed.
- Tests do not exercise offset-form RFC 3339 inputs, malformed/reversed filters, each individual search field, or limit/offset rejection. The implementation paths are present, but these semantics lack direct regression proof. The API test is a command-wrapper contract test; it does not independently validate Rust serialization or command error behavior.
