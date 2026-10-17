ALTER TABLE tournaments ADD COLUMN registration_group_id TEXT;

CREATE INDEX IF NOT EXISTS idx_tournaments_registration_group_id
  ON tournaments(registration_group_id);
