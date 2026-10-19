-- 公開後にメンバーの氏名・級が変わっても、当時の大会記録を維持する。

ALTER TABLE tournament_entries
  ADD COLUMN archive_display_name TEXT;

ALTER TABLE tournament_entries
  ADD COLUMN archive_display_name_kana TEXT;

ALTER TABLE tournament_entries
  ADD COLUMN archive_grade TEXT
    CHECK (archive_grade IS NULL OR archive_grade IN ('A', 'B', 'C', 'D', 'E', 'F', 'beginner'));

PRAGMA optimize;
