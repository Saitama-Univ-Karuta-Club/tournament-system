-- 管理画面の期限自動入力と未回答リマインダーの既定値。

CREATE TABLE deadline_automation_settings (
  setting_id INTEGER PRIMARY KEY CHECK (setting_id = 1),
  internal_deadline_days_before INTEGER NOT NULL
    CHECK (internal_deadline_days_before BETWEEN 0 AND 30),
  organizer_payment_days_before INTEGER NOT NULL
    CHECK (organizer_payment_days_before BETWEEN 0 AND 30),
  organizer_payment_time TEXT NOT NULL
    CHECK (organizer_payment_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  payment_deadline_days_before INTEGER NOT NULL
    CHECK (payment_deadline_days_before BETWEEN 1 AND 30),
  payment_deadline_time TEXT NOT NULL
    CHECK (payment_deadline_time GLOB '[0-2][0-9]:[0-5][0-9]'),
  response_reminder_days_before INTEGER NOT NULL
    CHECK (response_reminder_days_before BETWEEN 0 AND 30),
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
