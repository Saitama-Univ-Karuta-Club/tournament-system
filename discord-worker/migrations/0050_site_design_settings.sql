CREATE TABLE IF NOT EXISTS site_design_settings (
  setting_id INTEGER PRIMARY KEY CHECK (setting_id = 1),
  primary_color TEXT NOT NULL,
  banner_key TEXT,
  banner_content_type TEXT,
  banner_version TEXT,
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
