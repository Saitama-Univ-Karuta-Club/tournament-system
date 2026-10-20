-- Discord Botが送信する固定本文の管理者向け設定。

CREATE TABLE bot_message_settings (
  message_key TEXT PRIMARY KEY,
  content TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 2000),
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
