-- サークル内締切と未回答リマインダーの時刻を個別設定できるようにする。

ALTER TABLE deadline_automation_settings
  ADD COLUMN internal_deadline_time TEXT NOT NULL DEFAULT '23:59'
  CHECK (internal_deadline_time GLOB '[0-2][0-9]:[0-5][0-9]');

ALTER TABLE deadline_automation_settings
  ADD COLUMN response_reminder_time TEXT NOT NULL DEFAULT '00:00'
  CHECK (response_reminder_time GLOB '[0-2][0-9]:[0-5][0-9]');
