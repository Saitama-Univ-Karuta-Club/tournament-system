PRAGMA foreign_keys = OFF;

CREATE TABLE practice_schedules_rebuilt (
  schedule_id TEXT PRIMARY KEY,
  practice_date TEXT NOT NULL,
  start_time TEXT,
  end_time TEXT,
  title TEXT NOT NULL DEFAULT '通常練習',
  location TEXT,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'canceled', 'completed')),
  created_by_member_id TEXT,
  created_by_admin_identity TEXT,
  announcement_message_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (created_by_member_id) REFERENCES members(member_id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CHECK (created_by_member_id IS NOT NULL OR created_by_admin_identity IS NOT NULL),
  CHECK (end_time IS NULL OR start_time IS NULL OR end_time > start_time)
);

INSERT INTO practice_schedules_rebuilt (
  schedule_id, practice_date, start_time, end_time, title, location, note,
  status, created_by_member_id, announcement_message_id, created_at, updated_at
)
SELECT schedule_id, practice_date, start_time, end_time, title, location, note,
       status, created_by_member_id, announcement_message_id, created_at, updated_at
FROM practice_schedules;

DROP TABLE practice_schedules;
ALTER TABLE practice_schedules_rebuilt RENAME TO practice_schedules;

CREATE INDEX idx_practice_schedules_date
  ON practice_schedules(practice_date, status);

PRAGMA foreign_keys = ON;
PRAGMA foreign_key_check;
PRAGMA optimize;
