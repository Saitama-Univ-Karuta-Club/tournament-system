-- Web管理画面から登録した管理者を監査できるようにする。
ALTER TABLE tournaments ADD COLUMN created_by_email TEXT;

