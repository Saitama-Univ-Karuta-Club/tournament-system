-- サークル内締切後の名簿確認、抽選、振込、結果登録を段階別に管理する。

CREATE TABLE tournament_confirmation_rosters (
  group_key TEXT PRIMARY KEY,
  representative_tournament_id TEXT NOT NULL,
  document_url TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size INTEGER NOT NULL CHECK (file_size > 0),
  content_type TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  uploaded_by_email TEXT NOT NULL,
  uploaded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (representative_tournament_id) REFERENCES tournaments(tournament_id)
    ON UPDATE CASCADE ON DELETE RESTRICT
);

ALTER TABLE tournament_participant_guidance ADD COLUMN payment_details TEXT;
ALTER TABLE tournament_participant_guidance ADD COLUMN payment_deadline TEXT;

CREATE TABLE tournament_entry_payments (
  tournament_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unpaid' CHECK (status IN ('unpaid', 'paid')),
  paid_at TEXT,
  updated_by_email TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (tournament_id, member_id),
  FOREIGN KEY (tournament_id, member_id)
    REFERENCES tournament_entries(tournament_id, member_id)
    ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE TABLE tournament_entry_payment_history (
  payment_change_id INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  previous_status TEXT,
  new_status TEXT NOT NULL CHECK (new_status IN ('unpaid', 'paid')),
  changed_by_email TEXT NOT NULL,
  changed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (tournament_id, member_id)
    REFERENCES tournament_entries(tournament_id, member_id)
    ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE TABLE post_deadline_deliveries (
  delivery_id INTEGER PRIMARY KEY AUTOINCREMENT,
  idempotency_key TEXT NOT NULL UNIQUE,
  group_key TEXT NOT NULL,
  tournament_id TEXT NOT NULL,
  member_id TEXT,
  delivery_kind TEXT NOT NULL CHECK (delivery_kind IN (
    'confirmation_roster_dm',
    'lottery_result_channel',
    'payment_reminder_dm',
    'payment_reminder_channel'
  )),
  destination_type TEXT NOT NULL CHECK (destination_type IN ('channel', 'dm')),
  destination_id TEXT NOT NULL,
  payload_revision INTEGER NOT NULL DEFAULT 1 CHECK (payload_revision > 0),
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
  FOREIGN KEY (tournament_id) REFERENCES tournaments(tournament_id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  FOREIGN KEY (member_id) REFERENCES members(member_id)
    ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE INDEX idx_entry_payments_status
  ON tournament_entry_payments(tournament_id, status);

CREATE INDEX idx_post_deadline_deliveries_due
  ON post_deadline_deliveries(status, next_attempt_at, lease_until, attempt_count);

CREATE INDEX idx_post_deadline_deliveries_group
  ON post_deadline_deliveries(group_key, delivery_kind, status);

PRAGMA optimize;
