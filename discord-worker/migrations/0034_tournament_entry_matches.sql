-- 大会結果ファイルから抽出した選手ごとの各対戦結果を保存する。

CREATE TABLE tournament_entry_matches (
  tournament_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  round_number INTEGER NOT NULL CHECK (round_number BETWEEN 1 AND 12),
  outcome TEXT NOT NULL CHECK (outcome IN ('win', 'loss')),
  score_difference INTEGER CHECK (
    score_difference IS NULL OR score_difference BETWEEN 0 AND 50
  ),
  result_note TEXT,
  opponent_name TEXT,
  opponent_affiliation TEXT,
  source_sheet_name TEXT,
  source_cell_reference TEXT,
  updated_by_email TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (tournament_id, member_id, round_number),
  FOREIGN KEY (tournament_id, member_id)
    REFERENCES tournament_entries(tournament_id, member_id)
    ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE INDEX idx_tournament_entry_matches_member
  ON tournament_entry_matches(member_id, tournament_id, round_number);

PRAGMA optimize;
