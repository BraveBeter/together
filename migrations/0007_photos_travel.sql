CREATE TABLE trips (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
 cover_photo_id TEXT, created_by TEXT NOT NULL REFERENCES user(id),
 revision INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
);
CREATE TABLE photos (
 id TEXT PRIMARY KEY, asset_id TEXT NOT NULL UNIQUE REFERENCES assets(id),
 content_hash TEXT NOT NULL UNIQUE, caption TEXT NOT NULL DEFAULT '',
 width INTEGER NOT NULL, height INTEGER NOT NULL,
 taken_on TEXT, original_metadata TEXT NOT NULL DEFAULT '{}',
 latitude REAL, longitude REAL, place TEXT NOT NULL DEFAULT '',
 location_source TEXT CHECK(location_source IN ('exif','manual','amap')),
 trip_id TEXT REFERENCES trips(id), uploaded_by TEXT NOT NULL REFERENCES user(id),
 revision INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER,
 CHECK ((latitude IS NULL AND longitude IS NULL) OR (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180))
);
CREATE INDEX photos_date ON photos(deleted_at, taken_on DESC, created_at DESC, id DESC);
CREATE INDEX photos_location ON photos(deleted_at, latitude, longitude);
CREATE INDEX photos_trip ON photos(trip_id, deleted_at);
CREATE TABLE photo_participants (
 photo_id TEXT NOT NULL REFERENCES photos(id), user_id TEXT NOT NULL REFERENCES members(user_id),
 PRIMARY KEY(photo_id, user_id)
);
CREATE INDEX photo_participant_user ON photo_participants(user_id, photo_id);
CREATE TABLE photo_comments (
 id TEXT PRIMARY KEY, photo_id TEXT NOT NULL REFERENCES photos(id), author_id TEXT NOT NULL REFERENCES members(user_id),
 body TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
);
CREATE INDEX photo_comments_photo ON photo_comments(photo_id, deleted_at, created_at, id);
