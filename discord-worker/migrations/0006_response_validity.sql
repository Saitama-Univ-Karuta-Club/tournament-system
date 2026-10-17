-- 級変更後も回答履歴は残し、現在の集計からのみ除外できるようにする。

ALTER TABLE responses
  ADD COLUMN is_valid INTEGER NOT NULL DEFAULT 1 CHECK (is_valid IN (0, 1));

ALTER TABLE responses
  ADD COLUMN invalidated_at TEXT;

ALTER TABLE responses
  ADD COLUMN invalidated_reason TEXT;

CREATE INDEX idx_responses_tournament_valid_response
  ON responses(tournament_id, is_valid, response);

-- 移行時点でメンバーの現在級と一致しない回答も無効化する。
UPDATE responses
SET
  is_valid = 0,
  invalidated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  invalidated_reason = 'member_grade_changed'
WHERE is_valid = 1
  AND EXISTS (
    SELECT 1
    FROM members
    INNER JOIN tournaments
      ON tournaments.tournament_id = responses.tournament_id
    WHERE members.member_id = responses.member_id
      AND members.grade <> tournaments.grade
  );

PRAGMA optimize;
