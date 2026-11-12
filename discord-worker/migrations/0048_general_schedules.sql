CREATE TABLE IF NOT EXISTS general_schedules (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT,
  creator_user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  closed_at TEXT
);

CREATE TABLE IF NOT EXISTS general_schedule_candidates (
  schedule_id TEXT NOT NULL,
  candidate_id INTEGER NOT NULL,
  label TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (schedule_id, candidate_id),
  UNIQUE (schedule_id, position),
  FOREIGN KEY (schedule_id) REFERENCES general_schedules(id)
    ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS general_schedule_responses (
  schedule_id TEXT NOT NULL,
  candidate_id INTEGER NOT NULL,
  discord_user_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  response TEXT NOT NULL CHECK (response IN ('yes', 'maybe', 'no')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (schedule_id, candidate_id, discord_user_id),
  FOREIGN KEY (schedule_id, candidate_id)
    REFERENCES general_schedule_candidates(schedule_id, candidate_id)
    ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_general_schedule_responses_user
  ON general_schedule_responses(schedule_id, discord_user_id);
