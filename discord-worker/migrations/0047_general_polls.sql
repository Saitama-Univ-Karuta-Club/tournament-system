CREATE TABLE IF NOT EXISTS general_polls (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  creator_user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  anonymous INTEGER NOT NULL DEFAULT 0 CHECK (anonymous IN (0, 1)),
  multiple INTEGER NOT NULL DEFAULT 0 CHECK (multiple IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  closed_at TEXT
);

CREATE TABLE IF NOT EXISTS general_poll_options (
  poll_id TEXT NOT NULL,
  option_id INTEGER NOT NULL,
  label TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (poll_id, option_id),
  UNIQUE (poll_id, position),
  FOREIGN KEY (poll_id) REFERENCES general_polls(id) ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS general_poll_votes (
  poll_id TEXT NOT NULL,
  option_id INTEGER NOT NULL,
  voter_key TEXT NOT NULL,
  voter_discord_user_id TEXT,
  voter_display_name TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (poll_id, option_id, voter_key),
  FOREIGN KEY (poll_id, option_id)
    REFERENCES general_poll_options(poll_id, option_id)
    ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_general_poll_votes_poll_voter
  ON general_poll_votes(poll_id, voter_key);
