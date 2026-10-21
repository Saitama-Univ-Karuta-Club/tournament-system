-- 大会情報の重要な変更だけを告知し、変更前後の内容を通知へ保持する。

ALTER TABLE notification_deliveries
  ADD COLUMN change_details TEXT;

-- 旧デフォルトをそのまま保存している場合だけ新しい本文へ追従させる。
UPDATE bot_message_settings
SET content = '【大会情報更新】
重要な大会情報を変更しました。',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE message_key = 'announcement_update'
  AND content = '【大会情報更新】
変更後の内容を対象者のDMへ再送します。';

UPDATE bot_message_settings
SET content = '【回答締切リマインダー】
サークル内締切がもうすぐです。
まだ回答が登録されていません。締切までに参加意思を選択してください。',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE message_key = 'response_reminder_dm'
  AND content = '【回答締切リマインダー】まだ回答が登録されていません。サークル内締切までに参加意思を選択してください。';

DELETE FROM bot_message_settings
WHERE message_key = 'attendance_update';

PRAGMA optimize;
