CREATE TABLE import_batches (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id),
  kind TEXT NOT NULL CHECK(kind IN ('movie','book')),
  label TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX import_batch_owner ON import_batches(user_id, updated_at);
CREATE TABLE import_items (
  id TEXT PRIMARY KEY NOT NULL,
  batch_id TEXT NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  input TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending',
  selected INTEGER NOT NULL DEFAULT 0,
  candidates TEXT NOT NULL DEFAULT '[]',
  catalog TEXT,
  expected TEXT,
  entry_id TEXT REFERENCES entries(id),
  outcome TEXT NOT NULL DEFAULT '',
  warning TEXT NOT NULL DEFAULT '',
  error TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 1,
  lease_until INTEGER NOT NULL DEFAULT 0,
  retry_at INTEGER NOT NULL DEFAULT 0,
  new_work INTEGER NOT NULL DEFAULT 0,
  UNIQUE(batch_id, position)
);
CREATE INDEX import_item_batch ON import_items(batch_id, position);
