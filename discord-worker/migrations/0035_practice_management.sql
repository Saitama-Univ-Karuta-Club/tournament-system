-- サークル内練習、外部練習会、対戦結果、Discord通知を管理する。

CREATE TABLE practice_sessions (
  session_id TEXT PRIMARY KEY,
  practice_date TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '通常練習',
  location TEXT,
  pairing_mode TEXT NOT NULL DEFAULT 'near_grade'
    CHECK (pairing_mode IN ('near_grade', 'mixed')),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'open', 'in_progress', 'completed', 'canceled')),
  card_scheme TEXT
    CHECK (card_scheme IS NULL OR card_scheme IN (
      'number_ones',
      'number_tens',
      'hiragana',
      'katakana',
      'kanji',
      'alphabet'
    )),
  card_selection_json TEXT,
  created_by_member_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (created_by_member_id) REFERENCES members(member_id)
    ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE TABLE practice_attendance (
  session_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  grade_snapshot TEXT NOT NULL
    CHECK (grade_snapshot IN ('A', 'B', 'C', 'D', 'E', 'F', 'beginner')),
  attendance_status TEXT NOT NULL DEFAULT 'attending'
    CHECK (attendance_status IN ('attending', 'left', 'absent')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (session_id, member_id),
  FOREIGN KEY (session_id) REFERENCES practice_sessions(session_id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  FOREIGN KEY (member_id) REFERENCES members(member_id)
    ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE TABLE practice_matches (
  match_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  round_number INTEGER NOT NULL CHECK (round_number BETWEEN 1 AND 30),
  player1_member_id TEXT NOT NULL,
  player2_member_id TEXT,
  player1_grade_snapshot TEXT NOT NULL
    CHECK (player1_grade_snapshot IN ('A', 'B', 'C', 'D', 'E', 'F', 'beginner')),
  player2_grade_snapshot TEXT
    CHECK (player2_grade_snapshot IS NULL OR player2_grade_snapshot IN (
      'A', 'B', 'C', 'D', 'E', 'F', 'beginner'
    )),
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'completed', 'canceled', 'bye')),
  winner_member_id TEXT,
  score_difference INTEGER
    CHECK (score_difference IS NULL OR score_difference BETWEEN 0 AND 50),
  result_note TEXT,
  recorded_by_member_id TEXT,
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
    ON UPDATE CASCADE ON DELETE SET NULL,
  CHECK (player2_member_id IS NULL OR player1_member_id <> player2_member_id),
  CHECK (
    winner_member_id IS NULL
    OR winner_member_id = player1_member_id
    OR winner_member_id = player2_member_id
  ),
  CHECK (
    (status = 'bye' AND player2_member_id IS NULL AND winner_member_id IS NULL)
    OR (status = 'completed' AND player2_member_id IS NOT NULL AND winner_member_id IS NOT NULL)
    OR (status IN ('scheduled', 'canceled') AND player2_member_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX idx_practice_matches_round_player1
  ON practice_matches(session_id, round_number, player1_member_id);

CREATE UNIQUE INDEX idx_practice_matches_round_player2
  ON practice_matches(session_id, round_number, player2_member_id)
  WHERE player2_member_id IS NOT NULL;

CREATE INDEX idx_practice_matches_player1_history
  ON practice_matches(player1_member_id, created_at);

CREATE INDEX idx_practice_matches_player2_history
  ON practice_matches(player2_member_id, created_at)
  WHERE player2_member_id IS NOT NULL;

CREATE TABLE external_practice_matches (
  external_match_id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  played_on TEXT NOT NULL,
  event_name TEXT NOT NULL,
  opponent_name TEXT NOT NULL,
  opponent_affiliation TEXT,
  opponent_grade TEXT NOT NULL
    CHECK (opponent_grade IN ('A', 'B', 'C', 'D', 'E', 'F', 'beginner')),
  member_grade_snapshot TEXT NOT NULL
    CHECK (member_grade_snapshot IN ('A', 'B', 'C', 'D', 'E', 'F', 'beginner')),
  outcome TEXT NOT NULL CHECK (outcome IN ('win', 'loss')),
  score_difference INTEGER
    CHECK (score_difference IS NULL OR score_difference BETWEEN 0 AND 50),
  result_note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (member_id) REFERENCES members(member_id)
    ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE INDEX idx_external_practice_matches_member_date
  ON external_practice_matches(member_id, played_on DESC);

CREATE TABLE practice_discord_settings (
  guild_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  manager_role_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE practice_notification_queue (
  delivery_id INTEGER PRIMARY KEY AUTOINCREMENT,
  idempotency_key TEXT NOT NULL UNIQUE,
  session_id TEXT NOT NULL,
  round_number INTEGER,
  notification_type TEXT NOT NULL
    CHECK (notification_type IN ('session', 'cards', 'pairings', 'results')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  discord_message_id TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  sent_at TEXT,
  FOREIGN KEY (session_id) REFERENCES practice_sessions(session_id)
    ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE INDEX idx_practice_notification_queue_pending
  ON practice_notification_queue(status, next_attempt_at, created_at)
  WHERE status IN ('pending', 'failed');

PRAGMA optimize;
