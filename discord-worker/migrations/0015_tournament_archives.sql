-- 大会終了後の要項・選手名簿・結果ファイル・個人成績を一つの記録として公開する。

ALTER TABLE tournament_entries
  ADD COLUMN result_text TEXT;

ALTER TABLE tournament_entries
  ADD COLUMN result_updated_at TEXT;

ALTER TABLE tournament_entries
  ADD COLUMN result_updated_by_email TEXT;

ALTER TABLE tournaments
  ADD COLUMN archive_published_at TEXT;

ALTER TABLE tournaments
  ADD COLUMN archive_published_by_email TEXT;

CREATE TABLE tournament_archive_documents (
  group_key TEXT NOT NULL,
  document_type TEXT NOT NULL CHECK (document_type IN ('roster', 'results')),
  representative_tournament_id TEXT NOT NULL,
  document_url TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size INTEGER NOT NULL CHECK (file_size > 0),
  uploaded_by_email TEXT NOT NULL,
  uploaded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (group_key, document_type),
  FOREIGN KEY (representative_tournament_id) REFERENCES tournaments(tournament_id)
    ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE TABLE tournament_entry_result_history (
  result_change_id INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  previous_result TEXT,
  new_result TEXT NOT NULL,
  changed_by_email TEXT NOT NULL,
  changed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (tournament_id) REFERENCES tournaments(tournament_id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  FOREIGN KEY (member_id) REFERENCES members(member_id)
    ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE INDEX idx_tournament_archives_published
  ON tournaments(archive_published_at, event_start_date);

CREATE INDEX idx_tournament_entry_results_target
  ON tournament_entry_result_history(tournament_id, member_id, changed_at);

PRAGMA optimize;
