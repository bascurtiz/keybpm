CREATE TABLE users (
  discord_id TEXT PRIMARY KEY NOT NULL,
  username TEXT NOT NULL,
  avatar TEXT,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'trusted', 'mod')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE submissions (
  id TEXT PRIMARY KEY NOT NULL,
  discord_id TEXT NOT NULL REFERENCES users(discord_id),
  kind TEXT NOT NULL CHECK (kind IN ('add', 'correct')),
  track_id TEXT,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'applied')),
  reviewer_id TEXT REFERENCES users(discord_id),
  reject_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at TEXT
);

CREATE INDEX idx_submissions_status ON submissions(status);
CREATE INDEX idx_submissions_discord ON submissions(discord_id);
