-- Attention state only: recorded History and resources remain intact.
CREATE TABLE IF NOT EXISTS inbox_dismissals (
  event_id INTEGER PRIMARY KEY REFERENCES change_events(id) ON DELETE CASCADE,
  dismissed_at TEXT NOT NULL
);
