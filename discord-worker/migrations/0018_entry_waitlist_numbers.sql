-- 抽選落選者をキャンセル待ちとして扱い、主催者が付与した待ち番号を保存する。

ALTER TABLE tournament_entries
  ADD COLUMN waitlist_number INTEGER
    CHECK (waitlist_number IS NULL OR waitlist_number > 0);

ALTER TABLE tournament_entry_history
  ADD COLUMN previous_waitlist_number INTEGER
    CHECK (previous_waitlist_number IS NULL OR previous_waitlist_number > 0);

ALTER TABLE tournament_entry_history
  ADD COLUMN new_waitlist_number INTEGER
    CHECK (new_waitlist_number IS NULL OR new_waitlist_number > 0);

PRAGMA optimize;
