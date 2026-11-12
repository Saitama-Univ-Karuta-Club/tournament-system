ALTER TABLE practice_sessions ADD COLUMN reader_member_id TEXT
  REFERENCES members(member_id) ON UPDATE CASCADE ON DELETE RESTRICT;

CREATE INDEX idx_practice_sessions_reader
  ON practice_sessions(reader_member_id, practice_date DESC);

PRAGMA optimize;
