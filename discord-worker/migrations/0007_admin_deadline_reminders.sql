-- 管理者用チャンネルに、締切リマインダーだけを配信できるようにする。

ALTER TABLE discord_settings
  ADD COLUMN admin_reminder_channel_id TEXT;

ALTER TABLE notification_deliveries
  ADD COLUMN reminder_kind TEXT
    CHECK (reminder_kind IN ('internal_deadline', 'organizer_deadline'));

CREATE INDEX idx_notification_deliveries_reminder
  ON notification_deliveries(notification_type, reminder_kind, tournament_id);

PRAGMA optimize;
