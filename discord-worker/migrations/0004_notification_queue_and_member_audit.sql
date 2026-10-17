-- D1を永続通知キューとして使い、送信のリースと再試行を管理する。
ALTER TABLE notification_deliveries
  ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0);
ALTER TABLE notification_deliveries ADD COLUMN next_attempt_at TEXT;
ALTER TABLE notification_deliveries ADD COLUMN last_attempt_at TEXT;
ALTER TABLE notification_deliveries ADD COLUMN lease_until TEXT;

CREATE INDEX idx_notification_deliveries_due
  ON notification_deliveries(status, next_attempt_at, lease_until, attempt_count);

-- 管理画面からのメンバー情報変更を監査できるようにする。
CREATE TABLE member_change_history (
  member_change_id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id TEXT NOT NULL,
  previous_display_name TEXT NOT NULL,
  new_display_name TEXT NOT NULL,
  previous_grade TEXT NOT NULL,
  new_grade TEXT NOT NULL,
  previous_status TEXT NOT NULL,
  new_status TEXT NOT NULL,
  previous_dm_enabled INTEGER NOT NULL,
  new_dm_enabled INTEGER NOT NULL,
  changed_by_email TEXT NOT NULL,
  changed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (member_id) REFERENCES members(member_id)
    ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE INDEX idx_member_change_history_member
  ON member_change_history(member_id, changed_at);
