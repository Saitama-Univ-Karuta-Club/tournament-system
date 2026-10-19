-- Word・Excelの原本と、ブラウザ閲覧用PDFの対応および変換状態を管理する。

CREATE TABLE stored_documents (
  document_id TEXT PRIMARY KEY,
  source_key TEXT NOT NULL UNIQUE,
  source_file_name TEXT NOT NULL,
  source_content_type TEXT NOT NULL,
  preferred_key TEXT NOT NULL,
  preferred_file_name TEXT NOT NULL,
  preferred_content_type TEXT NOT NULL,
  preview_key TEXT,
  conversion_status TEXT NOT NULL DEFAULT 'not_required'
    CHECK (conversion_status IN ('not_required', 'converting', 'ready', 'failed')),
  conversion_error TEXT,
  uploaded_by_email TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_stored_documents_conversion_status
  ON stored_documents(conversion_status, updated_at);
