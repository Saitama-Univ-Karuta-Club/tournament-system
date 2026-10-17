-- Discord申請と管理画面から段位を登録・変更できるようにする。

ALTER TABLE member_registration_requests
  ADD COLUMN requested_rank INTEGER NOT NULL DEFAULT 0
    CHECK (requested_rank BETWEEN 0 AND 10);

ALTER TABLE member_change_history
  ADD COLUMN previous_rank INTEGER NOT NULL DEFAULT 0;

ALTER TABLE member_change_history
  ADD COLUMN new_rank INTEGER NOT NULL DEFAULT 0;

PRAGMA optimize;
