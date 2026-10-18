-- メンバー登録・登録内容変更の承認結果を、Bot Workerから確実にDM送信する。

CREATE TABLE member_notification_deliveries (
  notification_id INTEGER PRIMARY KEY AUTOINCREMENT,
  idempotency_key TEXT NOT NULL UNIQUE,
  request_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  notification_type TEXT NOT NULL
    CHECK (notification_type IN ('registration_approved', 'update_approved')),
  destination_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  display_name_kana TEXT NOT NULL,
  grade TEXT NOT NULL
    CHECK (grade IN ('A', 'B', 'C', 'D', 'E', 'F', 'beginner')),
  rank INTEGER NOT NULL CHECK (rank BETWEEN 0 AND 10),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed')),
  discord_message_id TEXT,
  error_message TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at TEXT,
  last_attempt_at TEXT,
  lease_until TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  sent_at TEXT,
  FOREIGN KEY (request_id) REFERENCES member_registration_requests(request_id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  FOREIGN KEY (member_id) REFERENCES members(member_id)
    ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE INDEX idx_member_notifications_due
  ON member_notification_deliveries(
    status, next_attempt_at, lease_until, attempt_count
  );

CREATE INDEX idx_member_notifications_member
  ON member_notification_deliveries(member_id, created_at);

PRAGMA optimize;
