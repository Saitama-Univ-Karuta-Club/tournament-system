-- 大会編集後の再通知と、複数級をまとめた申込完了通知を既存キューで扱う。
ALTER TABLE notification_deliveries
  ADD COLUMN delivery_context TEXT NOT NULL DEFAULT 'initial';

ALTER TABLE notification_deliveries
  ADD COLUMN related_tournament_ids TEXT;

-- 大会情報を誰がどの内容へ変更したか追跡する。
CREATE TABLE tournament_change_history (
  tournament_change_id INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id TEXT NOT NULL,
  previous_data TEXT NOT NULL,
  new_data TEXT NOT NULL,
  changed_by_email TEXT NOT NULL,
  changed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (tournament_id) REFERENCES tournaments(tournament_id)
    ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE INDEX idx_tournament_change_history_tournament
  ON tournament_change_history(tournament_id, changed_at);

PRAGMA optimize;
