CREATE TABLE IF NOT EXISTS general_discord_settings (
  guild_id TEXT PRIMARY KEY,
  commands_version TEXT,
  last_registration_error TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
