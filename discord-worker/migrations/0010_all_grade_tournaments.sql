-- 既存の級別大会IDを維持したまま、全級対象の大会を表現できるようにする。
-- grade列の既存CHECK制約は変更せず、全級フラグを追加する。

ALTER TABLE tournaments
  ADD COLUMN all_grades INTEGER NOT NULL DEFAULT 0
    CHECK (all_grades IN (0, 1));

CREATE INDEX idx_tournaments_all_grades_status
  ON tournaments(all_grades, status, internal_deadline);

PRAGMA optimize;
