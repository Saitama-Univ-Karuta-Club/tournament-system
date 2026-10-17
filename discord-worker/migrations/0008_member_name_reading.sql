-- リマインダーに氏名のよみがなを表示するため、表示名と対応する読みを保存する。

ALTER TABLE members
  ADD COLUMN display_name_kana TEXT NOT NULL DEFAULT '';

UPDATE members
SET display_name_kana = trim(last_name_kana || ' ' || first_name_kana)
WHERE trim(last_name_kana || ' ' || first_name_kana) <> '';

ALTER TABLE member_registration_requests
  ADD COLUMN requested_display_name_kana TEXT NOT NULL DEFAULT '';

ALTER TABLE member_change_history
  ADD COLUMN previous_display_name_kana TEXT NOT NULL DEFAULT '';

ALTER TABLE member_change_history
  ADD COLUMN new_display_name_kana TEXT NOT NULL DEFAULT '';

PRAGMA optimize;
