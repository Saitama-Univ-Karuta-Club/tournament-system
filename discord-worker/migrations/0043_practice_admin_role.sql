ALTER TABLE discord_settings
  ADD COLUMN practice_role_id TEXT;

PRAGMA optimize;
