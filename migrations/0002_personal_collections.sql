ALTER TABLE entries ADD COLUMN shared_added_at INTEGER;
UPDATE entries SET shared_added_at = created_at;

CREATE TABLE personal_records (
  entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES user(id),
  completed_on TEXT,
  created_at INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  removed_at INTEGER,
  PRIMARY KEY (entry_id, user_id)
);

CREATE TABLE recommendations (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL REFERENCES user(id),
  recipient_id TEXT NOT NULL REFERENCES user(id),
  note TEXT NOT NULL DEFAULT '' CHECK(length(note) <= 300),
  status TEXT NOT NULL CHECK(status IN ('pending', 'accepted', 'dismissed', 'withdrawn', 'resolved')),
  revision INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK(sender_id <> recipient_id),
  UNIQUE(entry_id, sender_id, recipient_id)
);
