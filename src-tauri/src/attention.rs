//! Complete local attention and deadline collections behind the SQLite seam.
//!
//! One deterministic selector owns grouping, matching, counts and bulk scope.
//! Reads are uncapped internally; pagination only slices the resulting collection.
//! Commands hold the shared connection lock once, so each response is coherent.
use crate::{db, models::*};
use rusqlite::{params, Connection};
use std::collections::{BTreeMap, BTreeSet};

fn validate_page(limit: usize) -> Result<(), String> {
    if !(1..=1000).contains(&limit) {
        return Err("limit must be between 1 and 1000".into());
    }
    Ok(())
}
fn validate_inbox(f: &InboxFilter) -> Result<(), String> {
    if f.course_id.is_some_and(|id| id <= 0) {
        return Err("courseId must be positive".into());
    }
    if f.change_type.as_deref().is_some_and(|t| {
        !matches!(
            t,
            "new" | "updated" | "announcement" | "deadline" | "unavailable" | "restored"
        )
    }) {
        return Err("Unknown Inbox changeType".into());
    }
    Ok(())
}
fn contains(search: Option<&str>, fields: &[&str]) -> bool {
    let query = search.unwrap_or("").trim().to_lowercase();
    query.is_empty()
        || fields
            .iter()
            .any(|field| field.to_lowercase().contains(&query))
}
fn instant(raw: &str) -> Option<chrono::DateTime<chrono::Utc>> {
    chrono::DateTime::parse_from_rfc3339(raw)
        .ok()
        .map(|dt| dt.with_timezone(&chrono::Utc))
}

/// Pure deterministic selector. Input contains only relevant non-dismissed events.
/// Group first, then match type/search/attention, so actions always cover the
/// represented attention group rather than an accidentally filtered subset.
pub fn select_inbox(events: Vec<ChangeEvent>, f: &InboxFilter) -> Vec<InboxItem> {
    let mut events = events;
    events.sort_by(|a, b| {
        instant(&b.detected_at)
            .cmp(&instant(&a.detected_at))
            .then(b.id.cmp(&a.id))
    });
    let mut groups: BTreeMap<String, InboxItem> = BTreeMap::new();
    let mut matches_search = BTreeSet::new();
    for event in events {
        let key = event
            .resource_id
            .map(|id| format!("resource:{id}"))
            .unwrap_or_else(|| format!("event:{}", event.id));
        if contains(
            f.search.as_deref(),
            &[
                &event.title,
                event.resource_title.as_deref().unwrap_or(""),
                event.course_name.as_deref().unwrap_or(""),
                &event.section_path.join(" "),
            ],
        ) {
            matches_search.insert(key.clone());
        }
        let item = groups.entry(key.clone()).or_insert_with(|| InboxItem {
            key,
            resource_id: event.resource_id,
            course_id: event.course_id,
            latest_event: event.clone(),
            event_ids: Vec::new(),
            change_types: Vec::new(),
            unread: false,
        });
        item.event_ids.push(event.id);
        if !item.change_types.contains(&event.change_type) {
            item.change_types.push(event.change_type);
        }
        item.unread |= !event.read;
    }
    let mut items: Vec<_> = groups
        .into_values()
        .filter(|item| {
            f.course_id.map_or(true, |id| item.course_id == Some(id))
                && f.change_type
                    .as_ref()
                    .map_or(true, |t| item.change_types.contains(t))
                && (f.attention == Attention::All || item.unread)
                && matches_search.contains(&item.key)
        })
        .collect();
    items.sort_by(|a, b| {
        instant(&b.latest_event.detected_at)
            .cmp(&instant(&a.latest_event.detected_at))
            .then(b.latest_event.id.cmp(&a.latest_event.id))
            .then(a.key.cmp(&b.key))
    });
    items
}
fn matching_inbox(conn: &Connection, f: &InboxFilter) -> Result<Vec<InboxItem>, String> {
    validate_inbox(f)?;
    let sql = format!(
        "{} WHERE e.calendar_suppressed = 0
        AND e.change_type IN ('new','updated','announcement','deadline','unavailable','restored')
        AND NOT EXISTS (SELECT 1 FROM inbox_dismissals d WHERE d.event_id=e.id)",
        db::EVENT_SELECT
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let events = stmt
        .query_map([], |row| {
            let mut event = db::map_event(row)?;
            // A historical/dangling foreign key is not a surviving resource.
            // resources.title is NOT NULL, so a missing joined title is exact.
            if event.resource_title.is_none() {
                event.resource_id = None;
            }
            Ok(event)
        })
        .map_err(|e| e.to_string())?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())?;
    Ok(select_inbox(events, f))
}
/// Counts and course counts describe the complete matching set, before pagination.
pub fn inbox(conn: &Connection, f: &InboxFilter) -> Result<InboxPage, String> {
    validate_page(f.limit)?;
    let items = matching_inbox(conn, f)?;
    let mut counts: BTreeMap<Option<i64>, InboxCourseCount> = BTreeMap::new();
    for item in &items {
        let count = counts.entry(item.course_id).or_insert(InboxCourseCount {
            course_id: item.course_id,
            total: 0,
            unread_total: 0,
        });
        count.total += 1;
        count.unread_total += usize::from(item.unread);
    }
    Ok(InboxPage {
        total: items.len(),
        unread_total: items.iter().filter(|i| i.unread).count(),
        course_counts: counts.into_values().collect(),
        items: items.into_iter().skip(f.offset).take(f.limit).collect(),
    })
}
/// Freeze full matching IDs at activation; new events cannot join this snapshot.
pub fn snapshot_inbox(conn: &Connection, f: &InboxFilter) -> Result<Vec<i64>, String> {
    let ids: BTreeSet<_> = matching_inbox(conn, f)?
        .into_iter()
        .flat_map(|item| item.event_ids)
        .collect();
    Ok(ids.into_iter().collect())
}
fn validate_ids(ids: &[i64]) -> Result<(), String> {
    if ids.iter().any(|id| *id <= 0) {
        return Err("eventIds must contain positive integers".into());
    }
    Ok(())
}
/// Atomic desired-state mutation. Missing IDs/duplicates are harmless; an
/// already-read event retains its original acknowledgment timestamp.
pub fn set_event_read_state(
    conn: &Connection,
    event_ids: &[i64],
    desired_read: bool,
    now: &str,
) -> Result<(), String> {
    validate_ids(event_ids)?;
    if instant(now).is_none() {
        return Err("Invalid acknowledgment timestamp".into());
    }
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    {
        let mut stmt = tx.prepare("UPDATE change_events SET read_at = CASE WHEN ?1 THEN COALESCE(read_at,?2) ELSE NULL END WHERE id=?3").map_err(|e| e.to_string())?;
        for id in event_ids.iter().collect::<BTreeSet<_>>() {
            stmt.execute(params![desired_read, now, id])
                .map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())
}
/// Dismiss exactly the captured IDs, preserving History, read state and resources.
pub fn dismiss_inbox(conn: &Connection, event_ids: &[i64], now: &str) -> Result<(), String> {
    validate_ids(event_ids)?;
    if instant(now).is_none() {
        return Err("Invalid dismissal timestamp".into());
    }
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    for id in event_ids.iter().collect::<BTreeSet<_>>() {
        tx.execute("INSERT OR IGNORE INTO inbox_dismissals(event_id,dismissed_at) SELECT id,?1 FROM change_events WHERE id=?2",params![now,id]).map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())
}
/// Explicit permanent event deletion, optionally including scan diagnostics.
/// Foreign-key cascade cleans dismissal state. Legacy view clears stay separate.
pub fn delete_history(conn: &Connection, include_scans: bool) -> Result<(), String> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM change_events", [])
        .map_err(|e| e.to_string())?;
    if include_scans {
        tx.execute("DELETE FROM scan_runs", [])
            .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())
}
fn due_value(raw: &str) -> Option<(chrono::DateTime<chrono::Utc>, DueDateKind)> {
    if let Some(dt) = instant(raw) {
        return Some((dt, DueDateKind::Instant));
    }
    // Round trip rejects noncanonical dates and never invents a source time.
    let date = chrono::NaiveDate::parse_from_str(raw, "%Y-%m-%d").ok()?;
    if date.to_string() != raw {
        return None;
    }
    Some((date.and_hms_opt(0, 0, 0)?.and_utc(), DueDateKind::Date))
}
/// Complete due inventory, including baseline and unavailable resources. Paused
/// courses appear only when explicitly selected. Source timestamps stay intact.
pub fn due_resources(conn: &Connection, f: &DueFilter) -> Result<DuePage, String> {
    validate_page(f.limit)?;
    if f.course_id.is_some_and(|id| id <= 0) {
        return Err("courseId must be positive".into());
    }
    let bound = |raw: &Option<String>| -> Result<_, String> {
        raw.as_ref()
            .map(|s| {
                due_value(s)
                    .map(|v| v.0)
                    .ok_or_else(|| "Invalid due range bound".to_string())
            })
            .transpose()
    };
    let from = bound(&f.from)?;
    let until = bound(&f.until)?;
    let date_bound = |raw: &Option<String>| -> Result<_, String> {
        raw.as_ref()
            .map(|s| {
                due_value(s)
                    .filter(|(_, kind)| *kind == DueDateKind::Date)
                    .map(|v| v.0)
                    .ok_or_else(|| "Date-only bounds must be YYYY-MM-DD".to_string())
            })
            .transpose()
    };
    let date_from = date_bound(&f.date_from)?;
    let date_until = date_bound(&f.date_until)?;
    if date_from.zip(date_until).is_some_and(|(a, b)| a >= b) {
        return Err("dateFrom must precede dateUntil".into());
    }
    if from.zip(until).is_some_and(|(a, b)| a >= b) {
        return Err("from must precede until".into());
    }
    let resources = db::list_resources(
        conn,
        &db::ResourceFilter {
            limit: Some(i64::MAX),
            ..Default::default()
        },
    )
    .map_err(|e| e.to_string())?;
    let paused: BTreeSet<_> = db::list_courses(conn)
        .map_err(|e| e.to_string())?
        .into_iter()
        .filter(|c| c.monitoring_status == "paused")
        .map(|c| c.id)
        .collect();
    let mut items = Vec::new();
    for resource in resources {
        let Some((due, kind)) = resource.due_at.as_deref().and_then(due_value) else {
            continue;
        };
        let (lower, upper) =
            if kind == DueDateKind::Date && (date_from.is_some() || date_until.is_some()) {
                (date_from, date_until)
            } else {
                (from, until)
            };
        let course_paused = resource.course_id.is_some_and(|id| paused.contains(&id));
        if f.course_id
            .map_or(course_paused, |id| resource.course_id != Some(id))
            || f.resource_type
                .as_ref()
                .is_some_and(|t| t != &resource.resource_type)
            || !contains(
                f.search.as_deref(),
                &[
                    &resource.title,
                    resource.course_name.as_deref().unwrap_or(""),
                    &resource.section_path.join(" "),
                ],
            )
            || lower.is_some_and(|v| due < v)
            || upper.is_some_and(|v| due >= v)
        {
            continue;
        }
        items.push((
            due,
            DueResource {
                resource,
                date_kind: kind,
                course_paused,
            },
        ));
    }
    items.sort_by(|(a, x), (b, y)| {
        a.cmp(b)
            .then(
                x.resource
                    .course_name
                    .as_deref()
                    .unwrap_or("")
                    .to_lowercase()
                    .cmp(
                        &y.resource
                            .course_name
                            .as_deref()
                            .unwrap_or("")
                            .to_lowercase(),
                    ),
            )
            .then(
                x.resource
                    .title
                    .to_lowercase()
                    .cmp(&y.resource.title.to_lowercase()),
            )
            .then(
                x.resource
                    .external_resource_id
                    .cmp(&y.resource.external_resource_id),
            )
    });
    Ok(DuePage {
        total: items.len(),
        items: items
            .into_iter()
            .skip(f.offset)
            .take(f.limit)
            .map(|(_, item)| item)
            .collect(),
    })
}

#[cfg(test)]
#[path = "attention_tests.rs"]
mod tests;
