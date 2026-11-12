ALTER TABLE general_amida_drafts
  ADD COLUMN selected_member_ids_json TEXT NOT NULL DEFAULT '[]';
