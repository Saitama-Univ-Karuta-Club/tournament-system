-- Discord版大会管理システムの初期スキーマ。
-- 日時はUTCのISO 8601文字列で保存し、表示時にAsia/Tokyoへ変換する。

CREATE TABLE members (
  member_id TEXT PRIMARY KEY,
  discord_user_id TEXT UNIQUE,
  last_name TEXT NOT NULL,
  last_name_kana TEXT NOT NULL,
  first_name TEXT NOT NULL,
  first_name_kana TEXT NOT NULL,
  display_name TEXT NOT NULL,
  rank INTEGER NOT NULL CHECK (rank BETWEEN 0 AND 10),
  grade TEXT NOT NULL CHECK (grade IN ('A', 'B', 'C', 'D', 'E', 'F', 'beginner')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'pending', 'rejected')),
  dm_enabled INTEGER NOT NULL DEFAULT 1 CHECK (dm_enabled IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE discord_settings (
  guild_id TEXT PRIMARY KEY,
  announcement_channel_id TEXT NOT NULL,
  admin_role_id TEXT,
  timezone TEXT NOT NULL DEFAULT 'Asia/Tokyo',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE tournaments (
  tournament_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  event_start_date TEXT NOT NULL,
  event_end_date TEXT NOT NULL,
  grade TEXT NOT NULL CHECK (grade IN ('A', 'B', 'C', 'D', 'E', 'F', 'beginner')),
  tournament_type TEXT NOT NULL DEFAULT 'official'
    CHECK (tournament_type IN ('official', 'support', 'event')),
  is_official INTEGER NOT NULL DEFAULT 1 CHECK (is_official IN (0, 1)),
  venue TEXT,
  true_deadline TEXT NOT NULL,
  internal_deadline TEXT NOT NULL,
  document_url TEXT,
  manager_member_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'applied', 'closed', 'canceled', 'deleted')),
  created_by_discord_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  applied_at TEXT,
  deleted_at TEXT,
  FOREIGN KEY (manager_member_id) REFERENCES members(member_id) ON UPDATE CASCADE ON DELETE SET NULL,
  CHECK (event_end_date >= event_start_date)
);

CREATE TABLE responses (
  tournament_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  response TEXT NOT NULL CHECK (response IN ('yes', 'maybe', 'no')),
  comment TEXT,
  source TEXT NOT NULL DEFAULT 'discord' CHECK (source IN ('discord', 'web', 'import')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (tournament_id, member_id),
  FOREIGN KEY (tournament_id) REFERENCES tournaments(tournament_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  FOREIGN KEY (member_id) REFERENCES members(member_id) ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE TABLE notification_deliveries (
  notification_id INTEGER PRIMARY KEY AUTOINCREMENT,
  idempotency_key TEXT NOT NULL UNIQUE,
  tournament_id TEXT NOT NULL,
  member_id TEXT,
  notification_type TEXT NOT NULL
    CHECK (notification_type IN (
      'announcement',
      'invitation_dm',
      'deadline_reminder',
      'response_confirmation',
      'application_completed'
    )),
  destination_type TEXT NOT NULL CHECK (destination_type IN ('channel', 'dm')),
  destination_id TEXT NOT NULL,
  discord_message_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  sent_at TEXT,
  FOREIGN KEY (tournament_id) REFERENCES tournaments(tournament_id) ON UPDATE CASCADE ON DELETE RESTRICT,
  FOREIGN KEY (member_id) REFERENCES members(member_id) ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE INDEX idx_members_status_grade
  ON members(status, grade);

CREATE INDEX idx_tournaments_status_grade_deadline
  ON tournaments(status, grade, internal_deadline);

CREATE INDEX idx_tournaments_event_start_date
  ON tournaments(event_start_date);

CREATE INDEX idx_responses_member_id
  ON responses(member_id);

CREATE INDEX idx_notification_deliveries_tournament
  ON notification_deliveries(tournament_id, notification_type);

CREATE INDEX idx_notification_deliveries_pending
  ON notification_deliveries(status, created_at)
  WHERE status = 'pending';

PRAGMA optimize;
