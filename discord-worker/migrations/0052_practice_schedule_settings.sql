CREATE TABLE IF NOT EXISTS practice_schedule_settings (
  setting_id INTEGER PRIMARY KEY CHECK (setting_id = 1),
  morning_start_time TEXT NOT NULL,
  morning_end_time TEXT NOT NULL,
  afternoon_start_time TEXT NOT NULL,
  afternoon_end_time TEXT NOT NULL,
  evening_start_time TEXT NOT NULL,
  evening_end_time TEXT NOT NULL,
  default_time_band TEXT NOT NULL
    CHECK (default_time_band IN ('morning', 'afternoon', 'evening')),
  default_venue TEXT NOT NULL,
  venues_json TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
