-- Personal lists are the only source of progress from v3 onward.
-- Legacy common tables remain intact for backup compatibility; they are no longer read.
ALTER TABLE personal_records ADD COLUMN status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('planned', 'in_progress', 'completed'));
ALTER TABLE personal_records ADD COLUMN started_on TEXT;
ALTER TABLE personal_records ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE personal_records ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
UPDATE personal_records SET updated_at = created_at;
CREATE TABLE together_confirmations (
  entry_id TEXT PRIMARY KEY NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  completed_on TEXT,
  recorded_by TEXT NOT NULL REFERENCES user(id),
  created_at INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  revoked_at INTEGER
);
CREATE INDEX personal_list_lookup ON personal_records(user_id, removed_at, status);
CREATE TRIGGER personal_movie_status_insert BEFORE INSERT ON personal_records
WHEN NEW.status = 'in_progress' AND (SELECT kind FROM entries WHERE id = NEW.entry_id) = 'movie'
BEGIN SELECT RAISE(ABORT, 'Movies only support planned or completed'); END;
CREATE TRIGGER personal_movie_status_update BEFORE UPDATE OF status ON personal_records
WHEN NEW.status = 'in_progress' AND (SELECT kind FROM entries WHERE id = NEW.entry_id) = 'movie'
BEGIN SELECT RAISE(ABORT, 'Movies only support planned or completed'); END;
