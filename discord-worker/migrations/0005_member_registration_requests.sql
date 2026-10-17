-- Discordからの新規登録・登録内容変更を、管理者承認前の申請として保存する。
CREATE TABLE member_registration_requests (
  request_id TEXT PRIMARY KEY,
  member_id TEXT,
  discord_user_id TEXT NOT NULL,
  request_type TEXT NOT NULL CHECK (request_type IN ('new', 'update')),
  requested_display_name TEXT NOT NULL,
  requested_grade TEXT NOT NULL
    CHECK (requested_grade IN ('A', 'B', 'C', 'D', 'E', 'F', 'beginner')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  submitted_at TEXT NOT NULL,
  decided_at TEXT,
  decided_by_email TEXT,
  FOREIGN KEY (member_id) REFERENCES members(member_id)
    ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE UNIQUE INDEX idx_member_registration_requests_pending_discord
  ON member_registration_requests(discord_user_id)
  WHERE status = 'pending';

CREATE INDEX idx_member_registration_requests_status_submitted
  ON member_registration_requests(status, submitted_at);
