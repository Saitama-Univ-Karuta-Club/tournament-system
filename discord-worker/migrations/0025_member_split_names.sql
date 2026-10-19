-- Discordのメンバー登録申請で、姓・名とそれぞれのよみがなを分けて保存する。

ALTER TABLE member_registration_requests
  ADD COLUMN requested_last_name TEXT NOT NULL DEFAULT '';

ALTER TABLE member_registration_requests
  ADD COLUMN requested_first_name TEXT NOT NULL DEFAULT '';

ALTER TABLE member_registration_requests
  ADD COLUMN requested_last_name_kana TEXT NOT NULL DEFAULT '';

ALTER TABLE member_registration_requests
  ADD COLUMN requested_first_name_kana TEXT NOT NULL DEFAULT '';

-- 既存メンバーの更新申請は、現在の分割済み氏名を初期値に使う。
UPDATE member_registration_requests
SET
  requested_last_name = COALESCE(
    (SELECT last_name FROM members
     WHERE members.member_id = member_registration_requests.member_id),
    requested_display_name
  ),
  requested_first_name = COALESCE(
    (SELECT first_name FROM members
     WHERE members.member_id = member_registration_requests.member_id),
    ''
  ),
  requested_last_name_kana = COALESCE(
    (SELECT last_name_kana FROM members
     WHERE members.member_id = member_registration_requests.member_id),
    requested_display_name_kana
  ),
  requested_first_name_kana = COALESCE(
    (SELECT first_name_kana FROM members
     WHERE members.member_id = member_registration_requests.member_id),
    ''
  );

PRAGMA optimize;
