-- Applied explicitly with wrangler; NEVER put secrets into schema.
CREATE TABLE IF NOT EXISTS feed_state (
 source TEXT PRIMARY KEY,
 status TEXT NOT NULL DEFAULT 'unavailable',
 checked_at INTEGER,
 last_success INTEGER,
 last_error TEXT
);
CREATE TABLE IF NOT EXISTS incidents (
 id TEXT PRIMARY KEY,
 source TEXT NOT NULL,
 category TEXT NOT NULL,
 severity TEXT NOT NULL,
 title TEXT NOT NULL,
 summary TEXT NOT NULL,
 happened_at INTEGER NOT NULL,
 location TEXT NOT NULL,
 url TEXT NOT NULL,
 lat REAL,
 lon REAL,
 first_seen INTEGER NOT NULL,
 last_seen INTEGER NOT NULL,
 notify_status TEXT NOT NULL DEFAULT 'skipped',
 notify_attempts INTEGER NOT NULL DEFAULT 0,
 notify_last_error TEXT,
 notified_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_incidents_recent ON incidents(happened_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_notify ON incidents(notify_status, first_seen);
