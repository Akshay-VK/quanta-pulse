//! The mirror's worker loop.
//!
//! Two tasks, both owned by the app:
//!
//! - **A forwarder.** Subscribes to the mirror's events and re-emits them as
//!   `mirror:progress` / `mirror:file` on the webview. The UI never polls for
//!   state; the worker pushes.
//! - **The driver.** Drains the queue a few items at a time, then waits. The
//!   wait is short and interruptible, so an on-demand download that enqueues at
//!   priority 0 starts promptly while a backfill keeps a steady cadence.
//!
//! Deliberately no timeouts here: the whole queue can outlive a sleep, and a
//! download that outlives a tick is awaited inside the tick, not abandoned.

use std::sync::atomic::Ordering;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::core::mirror::MirrorEvent;
use crate::models::MirrorDownloadProgress;
use crate::state::AppState;

/// How often the driver looks at the queue when idle.
const TICK: Duration = Duration::from_secs(5);

/// What the webview receives when one resource's status changes.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FileEvent {
    resource_id: i64,
    status: String,
    error: Option<String>,
}

pub fn start(app: AppHandle) {
    let mirror = app.state::<AppState>().mirror.clone();
    let forwarder = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut events = mirror.subscribe();
        while let Ok(event) = events.recv().await {
            match event {
                MirrorEvent::Progress(stats) => {
                    let _ = forwarder.emit("mirror:progress", &*stats);
                }
                MirrorEvent::File {
                    resource_id,
                    status,
                    error,
                } => {
                    let _ = forwarder.emit(
                        "mirror:file",
                        FileEvent {
                            resource_id,
                            status,
                            error,
                        },
                    );
                }
            }
        }
    });

    // Keep per-file progress on its own bounded broadcast channel. A slow UI
    // must not stop the mirror worker or the aggregate mirror event relay. If
    // the receiver falls behind, skip the missed deltas and continue: the
    // frontend can reconcile against mirror_download_progress snapshots.
    let mirror = app.state::<AppState>().mirror.clone();
    let forwarder = app.clone();
    tauri::async_runtime::spawn(async move {
        forward_download_progress(
            mirror.subscribe_download_progress(),
            |event_name, event| {
                let _ = forwarder.emit(event_name, event);
            },
            || {
                forwarder
                    .try_state::<AppState>()
                    .is_some_and(|state| state.sync.shutdown.load(Ordering::SeqCst))
            },
        )
        .await;
    });

    tauri::async_runtime::spawn(async move {
        loop {
            if app.state::<AppState>().sync.shutdown.load(Ordering::SeqCst) {
                break;
            }

            {
                let state = app.state::<AppState>();
                state.mirror.tick(&state.mirror_ctx()).await;
            }

            // Either arm firing is fine; `idle_wait` resolving early is how an
            // enqueued on-demand download gets picked up without waiting.
            let mirror = app.state::<AppState>().mirror.clone();
            tokio::select! {
                _ = tokio::time::sleep(TICK) => {}
                _ = mirror.idle_wait(TICK) => {}
            }
        }
    });
}

/// Forwards per-file mirror updates until the channel closes or shutdown starts.
async fn forward_download_progress(
    mut progress: tokio::sync::broadcast::Receiver<MirrorDownloadProgress>,
    mut emit: impl FnMut(&'static str, &MirrorDownloadProgress),
    mut should_shutdown: impl FnMut() -> bool,
) {
    loop {
        if should_shutdown() {
            break;
        }
        tokio::select! {
            received = progress.recv() => match received {
                Ok(event) => emit("mirror:file-progress", &event),
                Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                    tracing::debug!(skipped, "mirror progress relay lagged; UI snapshot can reconcile");
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            },
            _ = tokio::time::sleep(Duration::from_secs(1)) => {}
        }
    }
}

#[cfg(test)]
mod progress_forwarder_tests {
    use super::forward_download_progress;
    use crate::models::MirrorDownloadProgress;
    use serde_json::{json, Value};
    use std::sync::{Arc, Mutex};
    use tokio::sync::broadcast;

    fn progress(attempt_id: &str, bytes_done: u64) -> MirrorDownloadProgress {
        MirrorDownloadProgress {
            resource_id: 42,
            attempt_id: attempt_id.to_owned(),
            state: "downloading".to_owned(),
            bytes_done,
            bytes_total: None,
            error: None,
        }
    }

    #[tokio::test]
    async fn forwards_exact_event_name_and_camel_case_payload() {
        let (sender, receiver) = broadcast::channel(4);
        sender.send(progress("attempt-7", 11)).unwrap();
        drop(sender);
        let emitted = Arc::new(Mutex::new(Vec::<(String, Value)>::new()));
        let captured = Arc::clone(&emitted);

        forward_download_progress(
            receiver,
            move |name, event| captured.lock().unwrap().push((name.to_owned(), json!(event))),
            || false,
        )
        .await;

        assert_eq!(
            *emitted.lock().unwrap(),
            vec![(
                "mirror:file-progress".to_owned(),
                json!({
                    "resourceId": 42,
                    "attemptId": "attempt-7",
                    "state": "downloading",
                    "bytesDone": 11,
                    "bytesTotal": null,
                    "error": null
                })
            )]
        );
    }

    #[tokio::test]
    async fn lagged_receiver_continues_and_forwards_latest_event() {
        let (sender, receiver) = broadcast::channel(1);
        sender.send(progress("old-attempt", 1)).unwrap();
        sender.send(progress("latest-attempt", 9)).unwrap();
        drop(sender);
        let emitted = Arc::new(Mutex::new(Vec::new()));
        let captured = Arc::clone(&emitted);

        forward_download_progress(
            receiver,
            move |_, event| {
                captured
                    .lock()
                    .unwrap()
                    .push((event.attempt_id.clone(), event.bytes_done));
            },
            || false,
        )
        .await;

        assert_eq!(
            *emitted.lock().unwrap(),
            vec![("latest-attempt".to_owned(), 9)]
        );
    }

    #[tokio::test]
    async fn closed_channel_exits() {
        let (sender, receiver) = broadcast::channel(1);
        drop(sender);
        let emitted = Arc::new(Mutex::new(Vec::<MirrorDownloadProgress>::new()));
        let captured = Arc::clone(&emitted);

        forward_download_progress(
            receiver,
            move |_, event| captured.lock().unwrap().push(event.clone()),
            || false,
        )
        .await;

        assert!(emitted.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn shutdown_exits_after_forwarding_current_event() {
        let (sender, receiver) = broadcast::channel(2);
        let emitted = Arc::new(Mutex::new(Vec::<(String, u64)>::new()));
        let captured = Arc::clone(&emitted);
        let shutdown = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let shutdown_after_emit = Arc::clone(&shutdown);

        let task = tokio::spawn(async move {
            forward_download_progress(
                receiver,
                move |_, event| {
                    captured
                        .lock()
                        .unwrap()
                        .push((event.attempt_id.clone(), event.bytes_done));
                    shutdown_after_emit.store(true, std::sync::atomic::Ordering::SeqCst);
                },
                move || shutdown.load(std::sync::atomic::Ordering::SeqCst),
            )
            .await;
        });
        sender.send(progress("attempt-shutdown", 5)).unwrap();

        task.await.unwrap();
        assert_eq!(
            *emitted.lock().unwrap(),
            vec![("attempt-shutdown".to_owned(), 5)]
        );
    }
}
