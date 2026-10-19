-- 主催者への一括振込状況と、担当者向け振込通知を管理する。

ALTER TABLE tournament_participant_guidance
  ADD COLUMN organizer_payment_status TEXT NOT NULL DEFAULT 'unpaid'
  CHECK (organizer_payment_status IN ('unpaid', 'paid'));

ALTER TABLE tournament_participant_guidance
  ADD COLUMN organizer_paid_at TEXT;

ALTER TABLE tournament_participant_guidance
  ADD COLUMN organizer_payment_status_updated_by TEXT;

ALTER TABLE tournament_participant_guidance
  ADD COLUMN organizer_payment_status_updated_at TEXT;

CREATE TABLE organizer_payment_status_history (
  payment_change_id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_key TEXT NOT NULL,
  previous_status TEXT CHECK (previous_status IS NULL OR previous_status IN ('unpaid', 'paid')),
  new_status TEXT NOT NULL CHECK (new_status IN ('unpaid', 'paid')),
  changed_by_email TEXT NOT NULL,
  changed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (group_key) REFERENCES tournament_participant_guidance(group_key)
    ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE INDEX idx_organizer_payment_status_history_group
  ON organizer_payment_status_history(group_key, changed_at);

CREATE TABLE post_deadline_deliveries_v2 (
  delivery_id INTEGER PRIMARY KEY AUTOINCREMENT,
  idempotency_key TEXT NOT NULL UNIQUE,
  group_key TEXT NOT NULL,
  tournament_id TEXT NOT NULL,
  member_id TEXT,
  delivery_kind TEXT NOT NULL CHECK (delivery_kind IN (
    'confirmation_roster_dm',
    'lottery_result_channel',
    'organizer_payment_info_channel',
    'payment_reminder_dm',
    'payment_reminder_channel',
    'organizer_payment_overdue_channel'
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

INSERT INTO post_deadline_deliveries_v2 (
  delivery_id, idempotency_key, group_key, tournament_id, member_id,
  delivery_kind, destination_type, destination_id, payload_revision,
  discord_message_id, status, attempt_count, next_attempt_at,
  last_attempt_at, lease_until, error_message, created_at, sent_at
)
SELECT
  delivery_id, idempotency_key, group_key, tournament_id, member_id,
  delivery_kind, destination_type, destination_id, payload_revision,
  discord_message_id, status, attempt_count, next_attempt_at,
  last_attempt_at, lease_until, error_message, created_at, sent_at
FROM post_deadline_deliveries;

DROP TABLE post_deadline_deliveries;
ALTER TABLE post_deadline_deliveries_v2 RENAME TO post_deadline_deliveries;

CREATE INDEX idx_post_deadline_deliveries_due
  ON post_deadline_deliveries(status, next_attempt_at, lease_until, attempt_count);

CREATE INDEX idx_post_deadline_deliveries_group
  ON post_deadline_deliveries(group_key, delivery_kind, status);

PRAGMA optimize;
