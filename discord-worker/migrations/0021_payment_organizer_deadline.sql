-- 大会申込締切とは別に、主催者への参加費支払期限を保存する。

ALTER TABLE tournament_participant_guidance
  ADD COLUMN organizer_payment_deadline TEXT;

PRAGMA optimize;
