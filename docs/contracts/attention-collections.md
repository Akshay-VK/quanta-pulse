# Attention and due collections (14 November 2026)

These backend contracts implement the data slice of the [approved overhaul](../specs/2026-11-14-ui-themes-and-workflows.md). Consumers use `api` in `src/lib/api.ts`; wire types are in `src/lib/types.ts`. This does not wire the new views.

## Inbox

```ts
const filter: InboxFilter = {
  attention: "unread", courseId: 7, changeType: "announcement",
  search: "tutorial", offset: 0, limit: 50,
};
const page = await api.queryInbox(filter);
// Example shape (latestEvent is the existing complete ChangeEvent wire model):
// {
//   items: [{ key: "resource:42", resourceId: 42, courseId: 7,
//     latestEvent: { id: 109, resourceId: 42, courseId: 7, ... },
//     eventIds: [109, 101], changeTypes: ["updated", "announcement"], unread: true }],
//   total: 1, unreadTotal: 1,
//   courseCounts: [{ courseId: 7, total: 1, unreadTotal: 1 }]
// }
```

Defaults: attention `all`, no course/type/search filter, offset 0, limit 100. Limit must be 1–1000; offsets are nonnegative integers. Course IDs must be positive. Valid change types: `new`, `updated`, `announcement`, `deadline`, `unavailable`, `restored`; unknown types fail. Enum/deserialization failures reject the command. Baseline and incident-suppressed events never enter Inbox. Inbox includes paused-course historical attention, preserving course access; the agenda's monitored-course default is separate.

One resource ID produces one group. Events without a resource ID produce individual `event:<id>` groups, preserving recorded metadata without inventing a resource or downloadable URL. `latestEvent` is the newest non-dismissed event, using parsed detection instants descending, then event ID descending. Item ordering uses that same ordering, then the stable key. Source upload dates are not detection dates. `eventIds` and `changeTypes` follow event recency; types are unique. A group is unread if any represented event is unread.

Grouping precedes filtering. Type matches if **any** represented event has that type. Case-insensitive literal substring search matches recorded titles, resource titles, course names, or section paths on any represented event. `%` and `_` have no wildcard meaning. A matching group always represents **all** its non-dismissed relevant events, so type filtering never partially acknowledges an item. Course/type/search/attention filters apply together.

`total`, `unreadTotal`, and `courseCounts` describe that complete matching set **before** pagination. Course counts sort by course ID (null bucket first); absent buckets mean zero. Fetch `{}` for global/sidebar badges, and active filters for filtered result counts. Do not use legacy `unreadCount` or `syncStatus.unreadNew` for new Inbox badges: those retain their existing raw-event contracts.

```ts
// Single-item explicit acknowledgment; inspecting/previewing must not call it.
await api.setEventReadState(item.eventIds, true);
await api.setEventReadState(item.eventIds, false);

// Capture at activation, before confirmation/mutation. Pagination is ignored.
const eventIds = await api.snapshotInboxEventIds(filter);
await api.setEventReadState(eventIds, true);
// Or, after confirmation describing this captured scope:
await api.dismissInboxEvents(eventIds);
```

Snapshot returns unique ascending event IDs across all matching groups, including results beyond every loaded page. Capture the active filter object at activation; do not query a second scope after confirmation. A failed snapshot must stop the action. Newly arriving IDs after the snapshot remain untouched. Empty snapshots are valid no-ops. Per-item actions use the displayed item's captured IDs.

Mutations accept positive integer IDs, deduplicate duplicates, ignore missing historical IDs, bind SQL values, and commit atomically. Already-read rows keep their original acknowledgment timestamp; mark unread clears `read_at`. Invalid input or SQLite failure rejects the promise and leaves no partial operation. Disable duplicate activation; after success refresh the collection and badges. Retain prior data with error/stale feedback on failure; never claim optimistic success without recovery.

Dismissal persists one ledger entry per event, independent of read state, baseline, legacy watermarks, resources, and History. A later event for the same resource creates attention again, with only the new non-dismissed event IDs represented. Migration `0005_inbox_dismissals.sql` is idempotent; `.down.sql` removes only the ledger, making retained events visible again. Foreign keys are enabled by `db::open`; deleting events cascades ledger cleanup.

```ts
// Separately named, destructive operation; confirm the exact retention effect.
await api.deleteHistory(false); // Permanently remove all recorded changes; keep scans.
await api.deleteHistory(true);  // Permanently remove changes AND scan diagnostics.
```

Resources, saved files, and baseline settings remain intact. Legacy `markRead`, `markAllRead`, `clearDashboardActivity`, and `clearHistoryActivity` remain available with their historical meanings. In particular, old History clear is a view watermark, **not** permanent deletion. Do not repurpose those callers before migrating their UI.

## Due inventory

```ts
const due = await api.queryDueResources({ offset: 0, limit: 100 });
// { total: 3, items: [{ resource: <complete Resource>,
//                     dateKind: "instant" | "date", coursePaused: false }] }
```

Defaults: monitored courses (also unassigned resources), all resource types, no search or range, offset 0, limit 100. Explicit `courseId` includes a paused course, flagged by `coursePaused`. Optional `resourceType` is an exact stored type; search is literal case-insensitive title/course/section metadata matching. This query reads the complete resource inventory independently of baseline, recorded events, Dashboard clears, Inbox dismissal, source availability, and local download state. Invalid/absent due dates are omitted. No detection timestamp substitutes for a due date. Resource identity is the canonical external ID already unique in SQLite; equal titles never merge unrelated resources.

`from` is inclusive and `until` exclusive. RFC 3339 bounds compare absolute instants; YYYY-MM-DD bounds mean UTC midnight. Optional `dateFrom`/`dateUntil` accept only YYYY-MM-DD and override those bounds for **date-only** source values. Supply both instant and calendar bounds for a local range; this avoids assigning a fabricated timezone/time to date-only sources. For example, the 25-hour New York fall-back day:

```ts
await api.queryDueResources({
  from: "2026-11-01T04:00:00Z", until: "2026-11-02T05:00:00Z",
  dateFrom: "2026-11-01", dateUntil: "2026-11-02", limit: 100,
});
```

Stored due strings are returned unchanged. Ordering is parsed due ascending (date-only values use their calendar date at UTC midnight solely as an internal sort key), case-insensitive readable course/title, then canonical external identity. `total` is the complete matching count. No source time or submission state is inferred. Resolve the configured valid IANA timezone, OS fallback, and UTC fallback in the frontend's controlled date selectors. Group Today/Tomorrow/This week/Past due dates there, preserve `dateKind`, and show date-only deadlines without a time. Resource details retain their existing known dates and source warning even when unavailable.

## Integration and limits

All six commands are registered in `src-tauri/src/lib.rs`; only the existing frontend bridge invokes them. The `attention` deep module owns grouping, complete selection/counts, captured IDs, read state, dismissal, and due inventory at the existing SQLite seam. Rust's pure `select_inbox` is the deterministic fixture selector used by persisted queries. Commands hold the shared connection lock once, and never call a second locking command.

Page/count results are coherent within a command. Offset pagination is deterministic for an unchanged dataset; background changes can move offsets. Refresh from page zero when the dataset changes and use request-generation guards so late responses cannot overwrite the active filter. Agenda refresh failures should retain the prior snapshot as stale, distinct from an initial failure/empty result.

Selection currently materializes the complete matching inventory in Rust before slicing: O(n) memory and O(n log n) ordering. This deliberately avoids silent legacy caps; contract tests cover 5,105 resources/items and a later event outside captured scope. It is not a benchmark for arbitrarily large inventories. No cloud service, indexing, scraper change, baseline rewrite, or MISS_THRESHOLD change is introduced.

## Complete illustrative wire payloads

These are fixture identities and URLs, not live course data. A grouped Inbox response:

```json
{
  "items": [
    {
      "key": "resource:42",
      "resourceId": 42,
      "courseId": 7,
      "latestEvent": {
        "id": 109,
        "resourceId": 42,
        "courseId": 7,
        "courseName": "Physics",
        "resourceTitle": "Tutorial",
        "resourceUrl": "https://example.test/material/42",
        "sourcePageUrl": null,
        "sectionPath": [
          "Week 3"
        ],
        "resourceType": "assignment",
        "uploadedAt": null,
        "changeType": "updated",
        "title": "Tutorial updated",
        "description": null,
        "detectedAt": "2026-11-14T12:00:00Z",
        "read": false
      },
      "eventIds": [
        109,
        101
      ],
      "changeTypes": [
        "updated",
        "announcement"
      ],
      "unread": true
    }
  ],
  "total": 1,
  "unreadTotal": 1,
  "courseCounts": [
    {
      "courseId": 7,
      "total": 1,
      "unreadTotal": 1
    }
  ]
}
```

A due response for a date-only source with no inferred time or submission state:

```json
{
  "items": [
    {
      "resource": {
        "id": 42,
        "externalResourceId": "fixture:42",
        "courseId": 7,
        "courseName": "Physics",
        "title": "Tutorial",
        "url": "https://example.test/material/42",
        "sourcePageUrl": null,
        "resourceType": "assignment",
        "uploadedAt": null,
        "publishedAt": null,
        "modifiedAt": null,
        "dueAt": "2026-11-15",
        "firstSeenAt": "2026-11-01T12:00:00Z",
        "lastSeenAt": null,
        "lastCheckedAt": null,
        "contentFingerprint": null,
        "availabilityStatus": "unavailable",
        "sizeBytes": null,
        "section": "Week 3",
        "sectionPath": [
          "Week 3"
        ],
        "isExternal": false
      },
      "dateKind": "date",
      "coursePaused": false
    }
  ],
  "total": 1
}
```
