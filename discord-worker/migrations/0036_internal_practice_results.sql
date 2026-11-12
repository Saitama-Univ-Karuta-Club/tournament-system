-- 自動生成した参考組み合わせと、実際に行った対戦結果を分離する。

CREATE TABLE internal_practice_results (
  result_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  player1_member_id TEXT NOT NULL,
  player2_member_id TEXT NOT NULL,
  player1_grade_snapshot TEXT NOT NULL
    CHECK (player1_grade_snapshot IN ('A', 'B', 'C', 'D', 'E', 'F', 'beginner')),
  player2_grade_snapshot TEXT NOT NULL
    CHECK (player2_grade_snapshot IN ('A', 'B', 'C', 'D', 'E', 'F', 'beginner')),
  winner_member_id TEXT NOT NULL,
  score_difference INTEGER
    CHECK (score_difference IS NULL OR score_difference BETWEEN 0 AND 50),
  result_note TEXT,
  recorded_by_member_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (session_id) REFERENCES practice_sessions(session_id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  FOREIGN KEY (player1_member_id) REFERENCES members(member_id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  FOREIGN KEY (player2_member_id) REFERENCES members(member_id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  FOREIGN KEY (winner_member_id) REFERENCES members(member_id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  FOREIGN KEY (recorded_by_member_id) REFERENCES members(member_id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CHECK (player1_member_id <> player2_member_id),
  CHECK (
    winner_member_id = player1_member_id
    OR winner_member_id = player2_member_id
  )
);

CREATE INDEX idx_internal_practice_results_session
  ON internal_practice_results(session_id, created_at);

CREATE INDEX idx_internal_practice_results_player1
  ON internal_practice_results(player1_member_id, created_at DESC);

CREATE INDEX idx_internal_practice_results_player2
  ON internal_practice_results(player2_member_id, created_at DESC);

PRAGMA optimize;
