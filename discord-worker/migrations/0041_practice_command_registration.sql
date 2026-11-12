ALTER TABLE practice_discord_settings
  ADD COLUMN practice_commands_version TEXT;

PRAGMA optimize;
