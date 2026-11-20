//! Contract tests through the same SQLite seam used by commands.
use super::*;
use crate::db;

fn fixture() -> (tempfile::TempDir, Connection) {
    let dir = tempfile::tempdir().unwrap();
    let conn = db::open(&dir.path().join("attention.db")).unwrap();
    conn.execute_batch("INSERT INTO courses(id, external_course_id, name, url, first_seen_at) VALUES(1,'c1','Physics','https://example.com','2026-01-01T00:00:00Z');
        INSERT INTO courses(id, external_course_id, name, url, first_seen_at, monitoring_status) VALUES(2,'c2','Paused','https://example.com','2026-01-01T00:00:00Z','paused');").unwrap();
    (dir, conn)
}
fn resource(conn: &Connection, id: i64, course: i64, due: Option<&str>) {
    conn.execute("INSERT INTO resources(id,external_resource_id,course_id,title,url,resource_type,first_seen_at,due_at) VALUES(?1,?2,?3,?4,'https://example.com','assignment','2026-01-01T00:00:00Z',?5)", params![id,format!("r{id}"),course,format!("Assignment {id}"),due]).unwrap();
}
fn event(conn: &Connection, id: i64, resource: Option<i64>, kind: &str) {
    conn.execute("INSERT INTO change_events(id,resource_id,course_id,change_type,title,detected_at,deduplication_key) VALUES(?1,?2,1,?3,?4,'2026-11-14T12:00:00Z',?4)", params![id,resource,kind,format!("Event {id}")]).unwrap();
}
#[test]
fn grouped_counts_filters_and_orphans_agree() {
    let (_dir, conn) = fixture();
    resource(&conn, 1, 1, None);
    event(&conn, 1, Some(1), "new");
    event(&conn, 2, Some(1), "updated");
    event(&conn, 3, None, "announcement");
    event(&conn, 4, None, "baseline");
    let page = inbox(&conn, &InboxFilter::default()).unwrap();
    assert_eq!(
        (
            page.total,
            page.unread_total,
            page.course_counts[0].unread_total
        ),
        (2, 2, 2)
    );
    assert_eq!(page.items[0].key, "event:3");
    let f = InboxFilter {
        change_type: Some("new".into()),
        ..Default::default()
    };
    let page = inbox(&conn, &f).unwrap();
    assert_eq!(page.items[0].event_ids, vec![2, 1]); // type matches group, actions cover group
    assert_eq!(snapshot_inbox(&conn, &f).unwrap(), vec![1, 2]);
    set_event_read_state(&conn, &[1, 2], true, "2026-11-14T13:00:00Z").unwrap();
    assert_eq!(
        inbox(
            &conn,
            &InboxFilter {
                attention: Attention::Unread,
                ..f
            }
        )
        .unwrap()
        .total,
        0
    );
    assert_eq!(
        inbox(
            &conn,
            &InboxFilter {
                search: Some("PHYSICS".into()),
                ..Default::default()
            }
        )
        .unwrap()
        .total,
        2
    );
    assert_eq!(
        inbox(
            &conn,
            &InboxFilter {
                search: Some("%".into()),
                ..Default::default()
            }
        )
        .unwrap()
        .total,
        0
    );
}
#[test]
fn complete_inventory_pagination_and_snapshot_exceed_legacy_caps() {
    let (_dir, conn) = fixture();
    let tx = conn.unchecked_transaction().unwrap();
    for id in 1..=5105 {
        resource(&tx, id, 1, Some("2026-12-01T12:00:00Z"));
        event(&tx, id, Some(id), "new");
    }
    tx.commit().unwrap();
    let page = inbox(
        &conn,
        &InboxFilter {
            offset: 5100,
            limit: 10,
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(
        (page.total, page.unread_total, page.items.len()),
        (5105, 5105, 5)
    );
    assert_eq!(page.items[0].key, "resource:5");
    let ids = snapshot_inbox(&conn, &InboxFilter::default()).unwrap();
    assert_eq!(ids.len(), 5105);
    event(&conn, 5106, None, "new");
    set_event_read_state(&conn, &ids, true, "2026-11-14T13:00:00Z").unwrap();
    assert_eq!(
        inbox(&conn, &InboxFilter::default()).unwrap().unread_total,
        1
    );
    let due = due_resources(
        &conn,
        &DueFilter {
            offset: 5100,
            limit: 10,
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!((due.total, due.items.len()), (5105, 5));
}

#[test]
fn resource_unread_snapshot_is_complete_and_independent_of_inbox_and_history_visibility() {
    let (_dir, conn) = fixture();
    resource(&conn, 1, 1, None);
    resource(&conn, 2, 1, None);
    for id in 1..=1_205 {
        event(&conn, id, Some(1), "new");
    }
    set_event_read_state(&conn, &[1], true, "2026-11-14T13:00:00Z").unwrap();
    dismiss_inbox(&conn, &[2], "2026-11-14T13:00:00Z").unwrap();
    conn.execute(
        "UPDATE change_events SET calendar_suppressed=1 WHERE id=3",
        [],
    )
    .unwrap();
    event(&conn, 1_206, Some(1), "baseline");
    event(&conn, 1_207, Some(2), "new");
    db::clear_history_activity(&conn).unwrap();

    let ids = snapshot_resource_unread_event_ids(&conn, 1).unwrap();
    assert_eq!(ids.len(), 1_203);
    assert_eq!(
        ids.first(),
        Some(&2),
        "Inbox dismissal does not acknowledge the event"
    );
    assert_eq!(ids.last(), Some(&1_205));
    assert_eq!(
        snapshot_resource_unread_event_ids(&conn, 2).unwrap(),
        vec![1_207]
    );
}

#[test]
fn resource_event_snapshot_captures_complete_eligible_membership_for_many_resources() {
    let (_dir, conn) = fixture();
    for resource_id in 1..=1_005 {
        resource(&conn, resource_id, 1, None);
    }
    for id in 1..=1_205 {
        event(&conn, id, Some(1), "new");
    }
    event(&conn, 1_206, Some(1), "new");
    event(&conn, 1_207, Some(2), "new");
    event(&conn, 1_208, Some(1), "baseline");
    event(&conn, 1_209, Some(1_005), "updated");
    set_event_read_state(&conn, &[1, 1_209], true, "2026-11-14T13:00:00Z").unwrap();
    dismiss_inbox(&conn, &[2], "2026-11-14T13:00:00Z").unwrap();
    conn.execute(
        "UPDATE change_events SET calendar_suppressed=1 WHERE id=3",
        [],
    )
    .unwrap();
    db::clear_history_activity(&conn).unwrap();

    let mut selected_resource_ids = (1..=1_005).collect::<Vec<_>>();
    selected_resource_ids.extend([1, 1]);
    let ids = snapshot_resource_event_ids(&conn, &selected_resource_ids).unwrap();
    assert_eq!(ids.len(), 1_207);
    assert_eq!(ids.first(), Some(&1));
    assert_eq!(
        ids.get(1),
        Some(&2),
        "dismissal does not acknowledge events"
    );
    assert_eq!(ids.last(), Some(&1_209));
    assert!(!ids.contains(&3), "suppressed events are excluded");
    assert!(!ids.contains(&1_208), "baseline events are excluded");
    assert!(ids.contains(&1_207));
    assert_eq!(
        snapshot_resource_event_ids(&conn, &[1, 1_005])
            .unwrap()
            .len(),
        1_206,
        "resources outside this narrower selection are excluded"
    );
    assert_eq!(
        snapshot_resource_event_ids(&conn, &[2]).unwrap(),
        vec![1_207]
    );
    event(&conn, 1_210, Some(1), "new");
    assert!(!ids.contains(&1_210), "later arrivals stay outside the captured IDs");
    assert_eq!(
        snapshot_resource_event_ids(&conn, &[]).unwrap(),
        Vec::<i64>::new()
    );
    assert!(snapshot_resource_event_ids(&conn, &[1, 0]).is_err());
    assert!(snapshot_resource_event_ids(&conn, &[-1]).is_err());

    let read_at: Option<String> = conn
        .query_row("SELECT read_at FROM change_events WHERE id=1", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(read_at.as_deref(), Some("2026-11-14T13:00:00Z"));
    let event_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM change_events", [], |row| row.get(0))
        .unwrap();
    let dismissal_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM inbox_dismissals", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(event_count, 1_210);
    assert_eq!(dismissal_count, 1);
}
#[test]
fn state_is_idempotent_validated_and_atomic() {
    let (_dir, conn) = fixture();
    event(&conn, 1, None, "new");
    event(&conn, 2, None, "new");
    set_event_read_state(&conn, &[1, 1, 999], true, "2026-11-14T13:00:00Z").unwrap();
    set_event_read_state(&conn, &[1], true, "2026-11-14T14:00:00Z").unwrap();
    let at: String = conn
        .query_row("SELECT read_at FROM change_events WHERE id=1", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(at, "2026-11-14T13:00:00Z");
    assert!(set_event_read_state(&conn, &[1, 0], false, "2026-11-14T14:00:00Z").is_err());
    conn.execute_batch("CREATE TRIGGER fail_read BEFORE UPDATE ON change_events WHEN OLD.id=2 BEGIN SELECT RAISE(ABORT,'test failure'); END;").unwrap();
    assert!(set_event_read_state(&conn, &[1, 2], false, "2026-11-14T14:00:00Z").is_err());
    assert_eq!(
        inbox(&conn, &InboxFilter::default()).unwrap().unread_total,
        1
    );
    conn.execute_batch("DROP TRIGGER fail_read").unwrap();
    set_event_read_state(&conn, &[1], false, "2026-11-14T14:00:00Z").unwrap();
    assert_eq!(
        inbox(&conn, &InboxFilter::default()).unwrap().unread_total,
        2
    );
}
#[test]
fn dismissal_persists_reappears_and_history_delete_cleans_ledger() {
    let (dir, conn) = fixture();
    resource(&conn, 1, 1, Some("2026-11-15"));
    event(&conn, 1, Some(1), "new");
    event(&conn, 2, Some(1), "updated");
    dismiss_inbox(&conn, &[1, 2, 2, 999], "2026-11-14T13:00:00Z").unwrap();
    assert_eq!(db::count_events(&conn), 2);
    assert_eq!(inbox(&conn, &InboxFilter::default()).unwrap().total, 0);
    assert_eq!(
        due_resources(&conn, &DueFilter::default()).unwrap().total,
        1
    );
    drop(conn);
    let conn = db::open(&dir.path().join("attention.db")).unwrap();
    assert_eq!(inbox(&conn, &InboxFilter::default()).unwrap().total, 0);
    event(&conn, 3, Some(1), "updated");
    assert_eq!(
        inbox(&conn, &InboxFilter::default()).unwrap().items[0].event_ids,
        vec![3]
    );
    delete_history(&conn, true).unwrap();
    let n: i64 = conn
        .query_row("SELECT COUNT(*) FROM inbox_dismissals", [], |r| r.get(0))
        .unwrap();
    assert_eq!(n, 0);
    assert_eq!(db::count_resources(&conn), 1);
    conn.execute_batch(include_str!("../migrations/0005_inbox_dismissals.down.sql"))
        .unwrap();
    db::migrate(&conn).unwrap();
}
#[test]
fn due_dates_are_complete_valid_and_independent() {
    let (_dir, conn) = fixture();
    resource(&conn, 1, 1, Some("2026-11-15T01:00:00+02:00"));
    resource(&conn, 2, 1, Some("2026-11-15"));
    resource(&conn, 3, 1, Some("invalid"));
    resource(&conn, 4, 2, Some("2026-11-14"));
    resource(&conn, 5, 1, Some("2026-11-14T23:30:00Z"));
    db::clear_dashboard_activity(&conn).unwrap();
    let due = due_resources(&conn, &DueFilter::default()).unwrap();
    assert_eq!(
        due.items.iter().map(|i| i.resource.id).collect::<Vec<_>>(),
        vec![1, 5, 2]
    );
    assert_eq!(due.items[2].date_kind, DueDateKind::Date);
    assert_eq!(
        due.items[0].resource.due_at.as_deref(),
        Some("2026-11-15T01:00:00+02:00")
    );
    assert!(
        due_resources(
            &conn,
            &DueFilter {
                course_id: Some(2),
                ..Default::default()
            }
        )
        .unwrap()
        .items[0]
            .course_paused
    );
    assert_eq!(
        due_resources(
            &conn,
            &DueFilter {
                from: Some("2026-11-15".into()),
                ..Default::default()
            }
        )
        .unwrap()
        .total,
        1
    );
    assert!(due_resources(
        &conn,
        &DueFilter {
            from: Some("bad".into()),
            ..Default::default()
        }
    )
    .is_err());
}

#[test]
fn filters_pagination_failures_and_legacy_state_stay_independent() {
    let (_dir, conn) = fixture();
    resource(&conn, 1, 1, Some("2026-11-15"));
    event(&conn, 1, Some(1), "new");
    event(&conn, 2, Some(1), "updated");
    event(&conn, 3, None, "restored");
    conn.execute(
        "UPDATE change_events SET calendar_suppressed=1 WHERE id=3",
        [],
    )
    .unwrap();
    db::mark_read(&conn, &[1], "2026-11-14T13:00:00Z").unwrap();
    db::clear_dashboard_activity(&conn).unwrap();
    db::clear_history_activity(&conn).unwrap();
    let page = inbox(&conn, &InboxFilter::default()).unwrap();
    assert_eq!((page.total, page.unread_total), (1, 1));
    assert_eq!(page.items[0].event_ids, vec![2, 1]);
    assert!(inbox(
        &conn,
        &InboxFilter {
            limit: 0,
            ..Default::default()
        }
    )
    .is_err());
    assert!(snapshot_inbox(
        &conn,
        &InboxFilter {
            change_type: Some("baseline".into()),
            ..Default::default()
        }
    )
    .is_err());
    assert_eq!(
        inbox(
            &conn,
            &InboxFilter {
                course_id: Some(2),
                ..Default::default()
            }
        )
        .unwrap()
        .total,
        0
    );
    assert_eq!(
        due_resources(
            &conn,
            &DueFilter {
                resource_type: Some("quiz".into()),
                ..Default::default()
            }
        )
        .unwrap()
        .total,
        0
    );
    assert_eq!(
        due_resources(
            &conn,
            &DueFilter {
                search: Some("assignment".into()),
                ..Default::default()
            }
        )
        .unwrap()
        .total,
        1
    );
}

#[test]
fn dismissal_and_history_failure_roll_back_and_scans_are_explicit() {
    let (_dir, conn) = fixture();
    event(&conn, 1, None, "new");
    event(&conn, 2, None, "new");
    conn.execute_batch("INSERT INTO scan_runs(started_at,status) VALUES('2026-11-14T12:00:00Z','ok');
        CREATE TRIGGER fail_dismiss BEFORE INSERT ON inbox_dismissals WHEN NEW.event_id=2 BEGIN SELECT RAISE(ABORT,'test failure'); END;").unwrap();
    assert!(dismiss_inbox(&conn, &[1, 2], "2026-11-14T13:00:00Z").is_err());
    assert_eq!(inbox(&conn, &InboxFilter::default()).unwrap().total, 2);
    conn.execute_batch("DROP TRIGGER fail_dismiss").unwrap();
    dismiss_inbox(&conn, &[1], "2026-11-14T13:00:00Z").unwrap();
    conn.execute_batch("CREATE TRIGGER fail_delete BEFORE DELETE ON scan_runs BEGIN SELECT RAISE(ABORT,'test failure'); END;").unwrap();
    assert!(delete_history(&conn, true).is_err());
    assert_eq!(db::count_events(&conn), 2);
    assert_eq!(inbox(&conn, &InboxFilter::default()).unwrap().total, 1);
    delete_history(&conn, false).unwrap();
    assert_eq!(db::list_scans(&conn, 10).unwrap().len(), 1);
    conn.execute_batch("DROP TRIGGER fail_delete").unwrap();
    delete_history(&conn, true).unwrap();
    assert!(db::list_scans(&conn, 10).unwrap().is_empty());
}

#[test]
fn history_deletion_snapshot_is_authoritative_and_applies_only_frozen_ids() {
    let (_dir, conn) = fixture();
    let tx = conn.unchecked_transaction().unwrap();
    for id in 1..=1_205 {
        event(&tx, id, None, "new");
        if id % 2 == 0 {
            tx.execute(
                "UPDATE change_events SET calendar_suppressed=1 WHERE id=?1",
                [id],
            )
            .unwrap();
        }
    }
    for id in 1..=1_205 {
        tx.execute(
            "INSERT INTO scan_runs(id,started_at,status) VALUES(?1,'2026-11-14T12:00:00Z','ok')",
            [id],
        )
        .unwrap();
    }
    tx.commit().unwrap();
    db::clear_history_activity(&conn).unwrap();

    let all = snapshot_history_deletion(&conn, true).unwrap();
    assert_eq!(
        all.event_ids.len(),
        1_205,
        "includes hidden suppressed rows"
    );
    assert_eq!(all.scan_ids.len(), 1_205, "does not apply legacy scan caps");
    let events_only = snapshot_history_deletion(&conn, false).unwrap();
    assert_eq!(events_only.event_ids.len(), 1_205);
    assert!(events_only.scan_ids.is_empty());

    event(&conn, 1_206, None, "new");
    conn.execute(
        "INSERT INTO scan_runs(started_at,status) VALUES('2026-11-15T12:00:00Z','ok')",
        [],
    )
    .unwrap();
    let result = delete_history_snapshot(&conn, &all).unwrap();
    assert_eq!(
        (result.events_deleted, result.scans_deleted),
        (1_205, 1_205)
    );
    assert_eq!(db::count_events(&conn), 1);
    assert_eq!(db::list_scans(&conn, 10).unwrap().len(), 1);
}

#[test]
fn history_deletion_without_scans_keeps_scan_rows_and_rejects_stale_scan_ids() {
    let (_dir, conn) = fixture();
    event(&conn, 1, None, "new");
    conn.execute_batch("INSERT INTO scan_runs(id,started_at,status) VALUES(1,'2026-11-14T12:00:00Z','ok');").unwrap();
    let scope = snapshot_history_deletion(&conn, false).unwrap();
    assert_eq!(scope.event_ids, vec![1]);
    assert!(scope.scan_ids.is_empty());
    assert_eq!(delete_history_snapshot(&conn, &scope).unwrap(), HistoryDeletionResult { events_deleted: 1, scans_deleted: 0 });
    assert_eq!(db::list_scans(&conn, 10).unwrap().len(), 1);

    event(&conn, 2, None, "new");
    let stale_scan_scope = HistoryDeletionScope { event_ids: vec![2], scan_ids: vec![1] };
    conn.execute("DELETE FROM scan_runs WHERE id=1", []).unwrap();
    assert_eq!(delete_history_snapshot(&conn, &stale_scan_scope).unwrap_err(), "HISTORY_SCOPE_CHANGED");
    assert_eq!(db::count_events(&conn), 1, "event is not deleted when captured scan is stale");
}

#[test]
fn history_deletion_rejects_changed_or_malformed_scope_without_partial_mutation() {
    let (_dir, conn) = fixture();
    event(&conn, 1, None, "new");
    event(&conn, 2, None, "new");
    conn.execute_batch(
        "INSERT INTO scan_runs(id,started_at,status) VALUES(1,'2026-11-14T12:00:00Z','ok');",
    )
    .unwrap();
    let scope = snapshot_history_deletion(&conn, true).unwrap();
    conn.execute("DELETE FROM change_events WHERE id=2", [])
        .unwrap();
    let error = delete_history_snapshot(&conn, &scope).unwrap_err();
    assert_eq!(error, "HISTORY_SCOPE_CHANGED");
    assert_eq!(
        db::count_events(&conn),
        1,
        "event 1 remains after stale scope rejection"
    );
    assert_eq!(
        db::list_scans(&conn, 10).unwrap().len(),
        1,
        "scan remains after stale scope rejection"
    );

    for invalid in [
        HistoryDeletionScope {
            event_ids: vec![0],
            scan_ids: vec![],
        },
        HistoryDeletionScope {
            event_ids: vec![1, 1],
            scan_ids: vec![],
        },
        HistoryDeletionScope {
            event_ids: vec![],
            scan_ids: vec![-1],
        },
        HistoryDeletionScope {
            event_ids: vec![],
            scan_ids: vec![1, 1],
        },
    ] {
        assert!(delete_history_snapshot(&conn, &invalid).is_err());
    }
    assert_eq!(db::count_events(&conn), 1);
    assert_eq!(db::list_scans(&conn, 10).unwrap().len(), 1);
}

#[test]
fn history_deletion_transaction_rolls_back_and_preserves_nonhistory_state() {
    let (_dir, conn) = fixture();
    resource(&conn, 1, 1, None);
    event(&conn, 1, Some(1), "baseline");
    event(&conn, 2, Some(1), "new");
    conn.execute("INSERT INTO local_files(resource_id,rel_path,sha256,size_bytes,mime,status) VALUES(1,'saved.bin','abc',3,'application/octet-stream','kept')", []).unwrap();
    db::set_kv(&conn, "baseline_marker", "keep-me").unwrap();
    db::set_kv(&conn, "unrelated_marker", "also-keep").unwrap();
    conn.execute_batch(
        "INSERT INTO scan_runs(id,started_at,status) VALUES(1,'2026-11-14T12:00:00Z','ok');
        INSERT INTO scan_details(scan_id,payload) VALUES(1,'{\"scanId\":1,\"courses\":[]}');",
    )
    .unwrap();
    let scope = snapshot_history_deletion(&conn, true).unwrap();
    conn.execute_batch("CREATE TRIGGER fail_snapshot_delete BEFORE DELETE ON scan_runs BEGIN SELECT RAISE(ABORT,'test failure'); END;").unwrap();
    assert!(delete_history_snapshot(&conn, &scope).is_err());
    assert_eq!(db::count_events(&conn), 2);
    assert!(db::scan_details(&conn, 1).unwrap().is_some());
    conn.execute_batch("DROP TRIGGER fail_snapshot_delete")
        .unwrap();

    let empty_scope = HistoryDeletionScope {
        event_ids: vec![],
        scan_ids: vec![],
    };
    assert_eq!(
        delete_history_snapshot(&conn, &empty_scope).unwrap(),
        HistoryDeletionResult {
            events_deleted: 0,
            scans_deleted: 0
        }
    );
    assert_eq!(
        delete_history_snapshot(&conn, &scope).unwrap(),
        HistoryDeletionResult {
            events_deleted: 2,
            scans_deleted: 1
        }
    );
    assert_eq!(db::count_resources(&conn), 1);
    assert_eq!(
        db::mirror_get(&conn, 1).unwrap().unwrap().rel_path,
        "saved.bin"
    );
    assert_eq!(db::get_kv(&conn, "baseline_marker").unwrap(), "keep-me");
    assert_eq!(db::get_kv(&conn, "unrelated_marker").unwrap(), "also-keep");
    assert!(db::scan_details(&conn, 1).unwrap().is_none());
}

#[test]
fn wire_defaults_and_payloads_use_camel_case() {
    let (_dir, conn) = fixture();
    resource(&conn, 1, 1, Some("2026-11-15"));
    event(&conn, 1, Some(1), "new");
    let f: InboxFilter =
        serde_json::from_str(r#"{"attention":"unread","changeType":"new"}"#).unwrap();
    assert_eq!(f.limit, 100);
    let json = serde_json::to_value(inbox(&conn, &f).unwrap()).unwrap();
    assert_eq!(json["unreadTotal"], 1);
    assert_eq!(json["items"][0]["eventIds"], serde_json::json!([1]));
    assert_eq!(
        json["items"][0]["latestEvent"]["detectedAt"],
        "2026-11-14T12:00:00Z"
    );
    let due: DueFilter = serde_json::from_str("{}").unwrap();
    let json = serde_json::to_value(due_resources(&conn, &due).unwrap()).unwrap();
    assert_eq!(json["items"][0]["dateKind"], "date");
    assert_eq!(json["items"][0]["coursePaused"], false);
}

#[test]
fn due_refresh_retains_original_instants_and_unavailable_sources() {
    let (_dir, conn) = fixture();
    resource(&conn, 1, 1, Some("2026-11-15T10:00:00Z"));
    resource(&conn, 2, 1, None);
    event(&conn, 1, Some(1), "deadline");
    conn.execute("UPDATE resources SET due_at='2026-11-16T12:00:00+02:00', availability_status='unavailable' WHERE id=1",[]).unwrap();
    let page = due_resources(
        &conn,
        &DueFilter {
            from: Some("2026-11-16T10:00:00Z".into()),
            until: Some("2026-11-16T10:00:01Z".into()),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(page.total, 1);
    assert_eq!(
        page.items[0].resource.due_at.as_deref(),
        Some("2026-11-16T12:00:00+02:00")
    );
    assert_eq!(page.items[0].resource.availability_status, "unavailable");
    assert_eq!(db::count_events(&conn), 1);
}

#[test]
fn date_only_bounds_respect_local_days_without_inventing_source_times() {
    let (_dir, conn) = fixture();
    resource(&conn, 1, 1, Some("2026-11-01"));
    resource(&conn, 2, 1, Some("2026-11-02"));
    resource(&conn, 3, 1, Some("2026-11-02T04:30:00Z"));
    resource(&conn, 4, 1, Some("2026-11-02T05:00:00Z"));
    // New York's fall-back day spans 25 hours. The UI supplies resolved instant
    // bounds plus calendar bounds; date-only values never acquire a source time.
    let page = due_resources(
        &conn,
        &DueFilter {
            from: Some("2026-11-01T04:00:00Z".into()),
            until: Some("2026-11-02T05:00:00Z".into()),
            date_from: Some("2026-11-01".into()),
            date_until: Some("2026-11-02".into()),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(
        page.items.iter().map(|i| i.resource.id).collect::<Vec<_>>(),
        vec![1, 3]
    );
    assert!(due_resources(
        &conn,
        &DueFilter {
            date_from: Some("2026-11-01T04:00:00Z".into()),
            ..Default::default()
        }
    )
    .is_err());
}

#[test]
fn historical_dangling_resource_ids_fall_back_to_individual_events() {
    let (_dir, conn) = fixture();
    conn.pragma_update(None, "foreign_keys", "OFF").unwrap();
    event(&conn, 1, Some(999), "new");
    event(&conn, 2, Some(999), "updated");
    conn.pragma_update(None, "foreign_keys", "ON").unwrap();
    let page = inbox(&conn, &InboxFilter::default()).unwrap();
    assert_eq!(page.total, 2);
    assert_eq!(page.items[0].key, "event:2");
    assert_eq!(page.items[0].resource_id, None);
    assert_eq!(page.items[0].latest_event.resource_id, None);
    assert_eq!(page.items[0].latest_event.resource_url, None);
}

#[test]
fn read_state_survives_relaunch_and_detection_order_compares_instants() {
    let (dir, conn) = fixture();
    event(&conn, 1, None, "new");
    event(&conn, 2, None, "announcement");
    conn.execute(
        "UPDATE change_events SET detected_at='2026-11-14T13:00:00+02:00' WHERE id=2",
        [],
    )
    .unwrap();
    let page = inbox(
        &conn,
        &InboxFilter {
            limit: 1,
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(page.items[0].latest_event.id, 1); // 12:00Z > 11:00Z
    assert_eq!(page.total, 2);
    set_event_read_state(&conn, &[1], true, "2026-11-14T13:00:00Z").unwrap();
    drop(conn);
    let conn = db::open(&dir.path().join("attention.db")).unwrap();
    assert_eq!(
        inbox(&conn, &InboxFilter::default()).unwrap().unread_total,
        1
    );
    set_event_read_state(&conn, &[1], false, "2026-11-14T14:00:00Z").unwrap();
    drop(conn);
    let conn = db::open(&dir.path().join("attention.db")).unwrap();
    assert_eq!(
        inbox(&conn, &InboxFilter::default()).unwrap().unread_total,
        2
    );
}

#[test]
fn pure_selector_is_independent_of_input_order() {
    let (_dir, conn) = fixture();
    resource(&conn, 1, 1, None);
    event(&conn, 1, Some(1), "new");
    event(&conn, 2, Some(1), "updated");
    event(&conn, 3, None, "announcement");
    let events = db::list_events(&conn, false, 10).unwrap();
    let filter = InboxFilter {
        change_type: Some("new".into()),
        attention: Attention::Unread,
        search: Some("assignment".into()),
        ..Default::default()
    };
    let first = select_inbox(events.clone(), &filter);
    let second = select_inbox(events.into_iter().rev().collect(), &filter);
    assert_eq!(first.len(), 1);
    assert_eq!(first[0].event_ids, vec![2, 1]);
    assert_eq!(
        serde_json::to_value(first).unwrap(),
        serde_json::to_value(second).unwrap()
    );
}

#[test]
fn history_snapshot_ignored_deletes_roll_back_every_captured_row() {
    for table in ["change_events", "scan_runs"] {
        let (_dir, conn) = fixture();
        event(&conn, 1, None, "new");
        event(&conn, 2, None, "updated");
        db::start_scan(&conn, "2026-11-16T10:00:00Z").unwrap();
        let scope = snapshot_history_deletion(&conn, true).unwrap();
        let ignored_id = if table == "change_events" { 2 } else { scope.scan_ids[0] };
        conn.execute_batch(&format!("CREATE TRIGGER ignore_history_delete BEFORE DELETE ON {table} WHEN OLD.id={ignored_id} BEGIN SELECT RAISE(IGNORE); END;")).unwrap();
        assert_eq!(delete_history_snapshot(&conn, &scope).unwrap_err(), "HISTORY_DELETE_INCOMPLETE");
        let remaining = snapshot_history_deletion(&conn, true).unwrap();
        assert_eq!(remaining.event_ids, scope.event_ids, "ignored {table} delete rolls back earlier event deletions");
        assert_eq!(remaining.scan_ids, scope.scan_ids);
    }
}
