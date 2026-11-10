CREATE TABLE IF NOT EXISTS general_amida_drafts (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  creator_user_id TEXT NOT NULL,
  participants_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_general_amida_drafts_expires_at
  ON general_amida_drafts(expires_at);
