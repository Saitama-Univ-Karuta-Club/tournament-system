-- 参加希望と主催者への申込・抽選結果を分離して管理する。
-- 参加希望者が0人のままサークル内締切を過ぎた大会は、closedの理由で判別する。

ALTER TABLE tournaments
  ADD COLUMN closure_reason TEXT
    CHECK (closure_reason IS NULL OR closure_reason IN ('no_participants'));

CREATE TABLE tournament_entries (
  tournament_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'selected', 'not_selected', 'withdrawn')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_by_email TEXT,
  PRIMARY KEY (tournament_id, member_id),
  FOREIGN KEY (tournament_id) REFERENCES tournaments(tournament_id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  FOREIGN KEY (member_id) REFERENCES members(member_id)
    ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE TABLE tournament_entry_history (
  entry_change_id INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  previous_status TEXT,
  new_status TEXT NOT NULL,
  changed_by_email TEXT NOT NULL,
  changed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (tournament_id) REFERENCES tournaments(tournament_id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  FOREIGN KEY (member_id) REFERENCES members(member_id)
    ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE INDEX idx_tournament_entries_status
  ON tournament_entries(tournament_id, status);

CREATE INDEX idx_tournament_entry_history_target
  ON tournament_entry_history(tournament_id, member_id, changed_at);

-- すでに申込完了となっている大会も、新しい管理画面ですぐ扱えるようにする。
INSERT OR IGNORE INTO tournament_entries (
  tournament_id,
  member_id,
  status,
  created_at,
  updated_at,
  updated_by_email
)
SELECT
  responses.tournament_id,
  responses.member_id,
  'submitted',
  COALESCE(tournaments.applied_at, responses.updated_at),
  COALESCE(tournaments.applied_at, responses.updated_at),
  'system:migration'
FROM responses
INNER JOIN tournaments ON tournaments.tournament_id = responses.tournament_id
WHERE tournaments.status = 'applied'
  AND responses.response = 'yes'
  AND responses.is_valid = 1;

PRAGMA optimize;
