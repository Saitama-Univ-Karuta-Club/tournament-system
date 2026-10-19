-- 参加者へ通知する級別参加費と、大会担当者だけが参照する主催者振込情報を分離する。

ALTER TABLE tournament_participant_guidance
  ADD COLUMN organizer_payment_source TEXT NOT NULL DEFAULT 'text'
  CHECK (organizer_payment_source IN ('text', 'file', 'guidance'));

ALTER TABLE tournament_participant_guidance
  ADD COLUMN payment_collection_method TEXT NOT NULL DEFAULT 'advance_manager'
  CHECK (payment_collection_method IN ('advance_manager', 'onsite_cash'));

ALTER TABLE tournament_participant_guidance
  ADD COLUMN organizer_payment_document_url TEXT;

ALTER TABLE tournament_participant_guidance
  ADD COLUMN organizer_payment_file_name TEXT;

ALTER TABLE tournament_participant_guidance
  ADD COLUMN organizer_payment_file_size INTEGER
  CHECK (organizer_payment_file_size IS NULL OR organizer_payment_file_size > 0);

ALTER TABLE tournament_participant_guidance
  ADD COLUMN organizer_payment_content_type TEXT;

CREATE TABLE tournament_participation_fees (
  group_key TEXT NOT NULL,
  grade TEXT NOT NULL
    CHECK (grade IN ('A', 'B', 'C', 'D', 'E', 'F', 'beginner')),
  amount_yen INTEGER NOT NULL CHECK (amount_yen >= 0 AND amount_yen <= 1000000),
  updated_by_email TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (group_key, grade),
  FOREIGN KEY (group_key) REFERENCES tournament_participant_guidance(group_key)
    ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE INDEX idx_tournament_participation_fees_group
  ON tournament_participation_fees(group_key, grade);

PRAGMA optimize;
