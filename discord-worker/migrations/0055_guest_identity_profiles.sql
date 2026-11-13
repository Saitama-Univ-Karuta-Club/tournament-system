-- 練習ごとに作られていたゲストを、再利用できる人物プロフィールへ関連付ける。
-- 対戦記録の guest_id は変更せず、後から会員へ紐付けても当時の表示名と級を保持する。

CREATE TABLE practice_guest_profiles (
  guest_profile_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  last_used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_practice_guest_profiles_name
  ON practice_guest_profiles(normalized_name, status);

ALTER TABLE practice_guests ADD COLUMN guest_profile_id TEXT
  REFERENCES practice_guest_profiles(guest_profile_id)
  ON UPDATE CASCADE ON DELETE RESTRICT;

-- 既存ゲストは一旦1参加につき1プロフィールへ移す。
-- 管理画面で同一人物だと確認できたプロフィールは、後から同じ会員へ複数紐付けられる。
INSERT INTO practice_guest_profiles (
  guest_profile_id, display_name, normalized_name, last_used_at, created_at, updated_at
)
SELECT
  'GP-' || substr(practice_guests.guest_id, 3),
  practice_guests.display_name,
  lower(replace(replace(trim(practice_guests.display_name), ' ', ''), '　', '')),
  practice_guests.created_at,
  practice_guests.created_at,
  practice_guests.created_at
FROM practice_guests;

UPDATE practice_guests
SET guest_profile_id = 'GP-' || substr(guest_id, 3)
WHERE guest_profile_id IS NULL;

CREATE INDEX idx_practice_guests_profile
  ON practice_guests(guest_profile_id, created_at);

CREATE UNIQUE INDEX idx_practice_guests_session_profile
  ON practice_guests(session_id, guest_profile_id)
  WHERE guest_profile_id IS NOT NULL;

-- 1プロフィールは同時に1会員へだけ紐付く。
-- 同じ会員に複数プロフィールを紐付けることは許可する。
CREATE TABLE practice_guest_member_links (
  guest_profile_id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  linked_by_email TEXT NOT NULL,
  linked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (guest_profile_id) REFERENCES practice_guest_profiles(guest_profile_id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  FOREIGN KEY (member_id) REFERENCES members(member_id)
    ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE INDEX idx_practice_guest_member_links_member
  ON practice_guest_member_links(member_id, linked_at);

CREATE TABLE practice_guest_member_link_events (
  event_id TEXT PRIMARY KEY,
  guest_profile_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('link', 'unlink')),
  acted_by_email TEXT NOT NULL,
  acted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (guest_profile_id) REFERENCES practice_guest_profiles(guest_profile_id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  FOREIGN KEY (member_id) REFERENCES members(member_id)
    ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE INDEX idx_practice_guest_member_link_events_profile
  ON practice_guest_member_link_events(guest_profile_id, acted_at);

CREATE INDEX idx_practice_guest_member_link_events_member
  ON practice_guest_member_link_events(member_id, acted_at);

PRAGMA optimize;
