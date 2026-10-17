-- 管理画面からの大会ステータス変更を監査できるようにする。
CREATE TABLE tournament_status_history (
  status_change_id INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id TEXT NOT NULL,
  previous_status TEXT NOT NULL,
  new_status TEXT NOT NULL,
  changed_by_email TEXT NOT NULL,
  changed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (tournament_id) REFERENCES tournaments(tournament_id)
    ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE INDEX idx_tournament_status_history_tournament
  ON tournament_status_history(tournament_id, changed_at);

