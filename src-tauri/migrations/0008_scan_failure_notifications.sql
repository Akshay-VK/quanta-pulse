-- Durable at-most-once claim for native alerts about finalized incomplete scans.
ALTER TABLE scan_runs ADD COLUMN failure_notified_at TEXT;
