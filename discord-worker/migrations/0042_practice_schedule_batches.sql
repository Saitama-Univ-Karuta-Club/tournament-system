ALTER TABLE practice_schedules
  ADD COLUMN registration_batch_id TEXT;

CREATE INDEX idx_practice_schedules_registration_batch
  ON practice_schedules(registration_batch_id, practice_date);

PRAGMA optimize;
