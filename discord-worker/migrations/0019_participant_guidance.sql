-- 出場確定者へ事前送付する案内本文・添付ファイルとDM配信履歴を保存する。

CREATE TABLE tournament_participant_guidance (
  group_key TEXT PRIMARY KEY,
  representative_tournament_id TEXT NOT NULL,
  body_text TEXT,
  document_url TEXT,
  file_name TEXT,
  file_size INTEGER CHECK (file_size IS NULL OR file_size > 0),
  content_type TEXT,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_by_email TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (body_text IS NOT NULL OR document_url IS NOT NULL),
  FOREIGN KEY (representative_tournament_id) REFERENCES tournaments(tournament_id)
    ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE TABLE participant_guidance_deliveries (
  delivery_id INTEGER PRIMARY KEY AUTOINCREMENT,
  idempotency_key TEXT NOT NULL UNIQUE,
  group_key TEXT NOT NULL,
  tournament_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  destination_id TEXT NOT NULL,
  guidance_revision INTEGER NOT NULL CHECK (guidance_revision > 0),
  discord_message_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at TEXT,
  last_attempt_at TEXT,
  lease_until TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  sent_at TEXT,
  FOREIGN KEY (group_key) REFERENCES tournament_participant_guidance(group_key)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  FOREIGN KEY (tournament_id) REFERENCES tournaments(tournament_id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  FOREIGN KEY (member_id) REFERENCES members(member_id)
    ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE INDEX idx_participant_guidance_deliveries_due
  ON participant_guidance_deliveries(status, next_attempt_at, lease_until, attempt_count);

CREATE INDEX idx_participant_guidance_deliveries_group
  ON participant_guidance_deliveries(group_key, guidance_revision, status);

PRAGMA optimize;
