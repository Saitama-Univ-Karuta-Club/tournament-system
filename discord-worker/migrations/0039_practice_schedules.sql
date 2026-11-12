ALTER TABLE practice_discord_settings ADD COLUMN schedule_channel_id TEXT;

CREATE TABLE practice_schedules (
  schedule_id TEXT PRIMARY KEY,
  practice_date TEXT NOT NULL,
  start_time TEXT,
  end_time TEXT,
  title TEXT NOT NULL DEFAULT '通常練習',
  location TEXT,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'canceled', 'completed')),
  created_by_member_id TEXT NOT NULL,
  announcement_message_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (created_by_member_id) REFERENCES members(member_id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CHECK (end_time IS NULL OR start_time IS NULL OR end_time > start_time)
);

CREATE INDEX idx_practice_schedules_date
  ON practice_schedules(practice_date, status);

CREATE TABLE practice_schedule_responses (
  schedule_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  response TEXT NOT NULL CHECK (response IN ('yes', 'maybe', 'no')),
  source TEXT NOT NULL DEFAULT 'discord' CHECK (source IN ('discord', 'web')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (schedule_id, member_id),
  FOREIGN KEY (schedule_id) REFERENCES practice_schedules(schedule_id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  FOREIGN KEY (member_id) REFERENCES members(member_id)
    ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE INDEX idx_practice_schedule_responses_member
  ON practice_schedule_responses(member_id, updated_at DESC);

CREATE TABLE practice_schedule_notification_queue (
  delivery_id INTEGER PRIMARY KEY AUTOINCREMENT,
  idempotency_key TEXT NOT NULL UNIQUE,
  schedule_id TEXT NOT NULL,
  notification_type TEXT NOT NULL CHECK (notification_type IN ('announcement', 'reminder')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  discord_message_id TEXT,
  error_message TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (schedule_id) REFERENCES practice_schedules(schedule_id)
    ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE INDEX idx_practice_schedule_notification_pending
  ON practice_schedule_notification_queue(status, next_attempt_at, created_at);

PRAGMA optimize;
