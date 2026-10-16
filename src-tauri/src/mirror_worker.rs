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
