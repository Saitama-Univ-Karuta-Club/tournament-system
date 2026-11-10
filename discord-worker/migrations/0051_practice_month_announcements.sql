ALTER TABLE practice_schedule_notification_queue ADD COLUMN target_month TEXT;

CREATE TABLE practice_schedule_month_announcements (
  guild_id TEXT NOT NULL,
  practice_month TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (guild_id, practice_month),
  CHECK (practice_month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]')
);

INSERT OR IGNORE INTO practice_schedule_month_announcements (
  guild_id, practice_month, channel_id, message_id, created_at, updated_at
)
SELECT settings.guild_id,
       substr(schedules.practice_date, 1, 7),
       settings.schedule_channel_id,
       schedules.announcement_message_id,
       schedules.updated_at,
       schedules.updated_at
FROM practice_schedules AS schedules
CROSS JOIN practice_discord_settings AS settings
WHERE schedules.announcement_message_id IS NOT NULL
  AND settings.schedule_channel_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM practice_schedules AS newer
    WHERE substr(newer.practice_date, 1, 7) = substr(schedules.practice_date, 1, 7)
      AND newer.announcement_message_id IS NOT NULL
      AND newer.updated_at > schedules.updated_at
  );

PRAGMA optimize;
