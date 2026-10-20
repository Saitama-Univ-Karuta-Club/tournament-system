-- 各期限の時刻を基準時刻と揃えるか、個別指定するかを保存する。

ALTER TABLE deadline_automation_settings
  ADD COLUMN internal_deadline_time_mode TEXT NOT NULL DEFAULT 'custom'
  CHECK (internal_deadline_time_mode IN ('same', 'custom'));

ALTER TABLE deadline_automation_settings
  ADD COLUMN organizer_payment_time_mode TEXT NOT NULL DEFAULT 'custom'
  CHECK (organizer_payment_time_mode IN ('same', 'custom'));

ALTER TABLE deadline_automation_settings
  ADD COLUMN payment_deadline_time_mode TEXT NOT NULL DEFAULT 'custom'
  CHECK (payment_deadline_time_mode IN ('same', 'custom'));

ALTER TABLE deadline_automation_settings
  ADD COLUMN response_reminder_time_mode TEXT NOT NULL DEFAULT 'custom'
  CHECK (response_reminder_time_mode IN ('same', 'custom'));
