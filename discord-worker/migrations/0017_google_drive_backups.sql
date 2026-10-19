-- D1とR2のGoogle Driveバックアップ実行履歴・PDF複製状態を管理する。

CREATE TABLE backup_runs (
  backup_run_id TEXT PRIMARY KEY,
  trigger_source TEXT NOT NULL
    CHECK (trigger_source IN ('scheduled', 'manual')),
  status TEXT NOT NULL
    CHECK (status IN ('running', 'succeeded', 'failed')),
  database_file_id TEXT,
  database_file_name TEXT,
  documents_scanned INTEGER NOT NULL DEFAULT 0
    CHECK (documents_scanned >= 0),
  documents_uploaded INTEGER NOT NULL DEFAULT 0
    CHECK (documents_uploaded >= 0),
  expired_database_backups_trashed INTEGER NOT NULL DEFAULT 0
    CHECK (expired_database_backups_trashed >= 0),
  error_message TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  alert_attempt_count INTEGER NOT NULL DEFAULT 0
    CHECK (alert_attempt_count >= 0),
  alert_next_attempt_at TEXT,
  alert_last_attempt_at TEXT,
  alert_sent_at TEXT,
  alert_error_message TEXT
);

CREATE INDEX idx_backup_runs_status_started
  ON backup_runs(status, started_at);

CREATE INDEX idx_backup_runs_alert_due
  ON backup_runs(status, alert_sent_at, alert_next_attempt_at, alert_attempt_count);

CREATE TABLE backup_document_copies (
  r2_key TEXT PRIMARY KEY,
  r2_etag TEXT NOT NULL,
  r2_size INTEGER NOT NULL CHECK (r2_size >= 0),
  google_drive_file_id TEXT NOT NULL,
  google_drive_file_name TEXT NOT NULL,
  backed_up_at TEXT NOT NULL,
  last_verified_at TEXT NOT NULL
);

CREATE INDEX idx_backup_document_copies_backed_up
  ON backup_document_copies(backed_up_at);

PRAGMA optimize;
