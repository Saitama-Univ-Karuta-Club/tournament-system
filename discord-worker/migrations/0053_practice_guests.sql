-- 登録済みの日程と練習を関連付け、会員ではないゲストも組み合わせに含める。

ALTER TABLE practice_sessions ADD COLUMN schedule_id TEXT
  REFERENCES practice_schedules(schedule_id)
  ON UPDATE CASCADE ON DELETE SET NULL;

CREATE INDEX idx_practice_sessions_schedule
  ON practice_sessions(schedule_id);

CREATE TABLE practice_guests (
  guest_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  grade_snapshot TEXT NOT NULL
    CHECK (grade_snapshot IN ('A', 'B', 'C', 'D', 'E', 'F', 'beginner')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (session_id) REFERENCES practice_sessions(session_id)
    ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE INDEX idx_practice_guests_session
  ON practice_guests(session_id, created_at);

-- player*_member_id は会員への外部キーだったため、ゲストIDも保存できる
-- participant_idへ置き換える。既存データはそのまま会員IDとして移行する。
CREATE TABLE practice_matches_new (
  match_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  round_number INTEGER NOT NULL CHECK (round_number BETWEEN 1 AND 30),
  player1_participant_id TEXT NOT NULL,
  player2_participant_id TEXT,
  player1_grade_snapshot TEXT NOT NULL
    CHECK (player1_grade_snapshot IN ('A', 'B', 'C', 'D', 'E', 'F', 'beginner')),
  player2_grade_snapshot TEXT
    CHECK (player2_grade_snapshot IS NULL OR player2_grade_snapshot IN (
      'A', 'B', 'C', 'D', 'E', 'F', 'beginner'
    )),
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'completed', 'canceled', 'bye')),
  winner_participant_id TEXT,
  score_difference INTEGER
    CHECK (score_difference IS NULL OR score_difference BETWEEN 0 AND 50),
  result_note TEXT,
  recorded_by_member_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (session_id) REFERENCES practice_sessions(session_id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  FOREIGN KEY (recorded_by_member_id) REFERENCES members(member_id)
    ON UPDATE CASCADE ON DELETE SET NULL,
  CHECK (player2_participant_id IS NULL OR player1_participant_id <> player2_participant_id),
  CHECK (
    winner_participant_id IS NULL
    OR winner_participant_id = player1_participant_id
    OR winner_participant_id = player2_participant_id
  ),
  CHECK (
    (status = 'bye' AND player2_participant_id IS NULL AND winner_participant_id IS NULL)
    OR (status = 'completed' AND player2_participant_id IS NOT NULL AND winner_participant_id IS NOT NULL)
    OR (status IN ('scheduled', 'canceled') AND player2_participant_id IS NOT NULL)
  )
);

INSERT INTO practice_matches_new (
  match_id, session_id, round_number,
  player1_participant_id, player2_participant_id,
  player1_grade_snapshot, player2_grade_snapshot,
  status, winner_participant_id, score_difference, result_note,
  recorded_by_member_id, created_at, updated_at
)
SELECT
  match_id, session_id, round_number,
  player1_member_id, player2_member_id,
  player1_grade_snapshot, player2_grade_snapshot,
  status, winner_member_id, score_difference, result_note,
  recorded_by_member_id, created_at, updated_at
FROM practice_matches;

DROP TABLE practice_matches;
ALTER TABLE practice_matches_new RENAME TO practice_matches;

CREATE UNIQUE INDEX idx_practice_matches_round_player1
  ON practice_matches(session_id, round_number, player1_participant_id);

CREATE UNIQUE INDEX idx_practice_matches_round_player2
  ON practice_matches(session_id, round_number, player2_participant_id)
  WHERE player2_participant_id IS NOT NULL;

CREATE INDEX idx_practice_matches_player1_history
  ON practice_matches(player1_participant_id, created_at);

CREATE INDEX idx_practice_matches_player2_history
  ON practice_matches(player2_participant_id, created_at)
  WHERE player2_participant_id IS NOT NULL;

PRAGMA optimize;
