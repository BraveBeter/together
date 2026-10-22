-- Historical start dates are unknown; never substitute the time of this migration.
ALTER TABLE reading_progress ADD COLUMN started_at INTEGER;
