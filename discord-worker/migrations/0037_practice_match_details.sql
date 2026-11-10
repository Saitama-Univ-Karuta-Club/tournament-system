ALTER TABLE internal_practice_results ADD COLUMN fault_count INTEGER
  CHECK (fault_count IS NULL OR fault_count BETWEEN 0 AND 50);

ALTER TABLE internal_practice_results ADD COLUMN cards_taken INTEGER
  CHECK (cards_taken IS NULL OR cards_taken BETWEEN 0 AND 50);

ALTER TABLE internal_practice_results ADD COLUMN opponent_right_taken INTEGER
  CHECK (opponent_right_taken IS NULL OR opponent_right_taken BETWEEN 0 AND 50);

ALTER TABLE internal_practice_results ADD COLUMN opponent_left_taken INTEGER
  CHECK (opponent_left_taken IS NULL OR opponent_left_taken BETWEEN 0 AND 50);

ALTER TABLE internal_practice_results ADD COLUMN own_right_taken INTEGER
  CHECK (own_right_taken IS NULL OR own_right_taken BETWEEN 0 AND 50);

ALTER TABLE internal_practice_results ADD COLUMN own_left_taken INTEGER
  CHECK (own_left_taken IS NULL OR own_left_taken BETWEEN 0 AND 50);

ALTER TABLE external_practice_matches ADD COLUMN fault_count INTEGER
  CHECK (fault_count IS NULL OR fault_count BETWEEN 0 AND 50);

ALTER TABLE external_practice_matches ADD COLUMN cards_taken INTEGER
  CHECK (cards_taken IS NULL OR cards_taken BETWEEN 0 AND 50);

ALTER TABLE external_practice_matches ADD COLUMN opponent_right_taken INTEGER
  CHECK (opponent_right_taken IS NULL OR opponent_right_taken BETWEEN 0 AND 50);

ALTER TABLE external_practice_matches ADD COLUMN opponent_left_taken INTEGER
  CHECK (opponent_left_taken IS NULL OR opponent_left_taken BETWEEN 0 AND 50);

ALTER TABLE external_practice_matches ADD COLUMN own_right_taken INTEGER
  CHECK (own_right_taken IS NULL OR own_right_taken BETWEEN 0 AND 50);

ALTER TABLE external_practice_matches ADD COLUMN own_left_taken INTEGER
  CHECK (own_left_taken IS NULL OR own_left_taken BETWEEN 0 AND 50);

PRAGMA optimize;
