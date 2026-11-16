-- Per-scan observed course diagnostics. Existing scan rows remain legacy/null.
CREATE TABLE IF NOT EXISTS scan_details (
  scan_id INTEGER PRIMARY KEY REFERENCES scan_runs(id) ON DELETE CASCADE,
  payload TEXT NOT NULL
);

CREATE TRIGGER IF NOT EXISTS delete_scan_details_with_scan
AFTER DELETE ON scan_runs
BEGIN
  DELETE FROM scan_details WHERE scan_id = OLD.id;
END;
