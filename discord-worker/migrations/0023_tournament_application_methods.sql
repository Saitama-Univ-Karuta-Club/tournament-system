CREATE TABLE tournament_application_methods (
  group_key TEXT PRIMARY KEY,
  application_method TEXT NOT NULL
    CHECK (application_method IN ('excel_email', 'excel_form', 'direct_form')),
  roster_document_url TEXT,
  roster_file_name TEXT,
  roster_file_size INTEGER,
  roster_content_type TEXT,
  form_url TEXT,
  created_by_email TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (
    (application_method = 'excel_email'
      AND roster_document_url IS NOT NULL
      AND roster_file_name IS NOT NULL
      AND form_url IS NULL)
    OR
    (application_method = 'excel_form'
      AND roster_document_url IS NOT NULL
      AND roster_file_name IS NOT NULL
      AND form_url IS NOT NULL)
    OR
    (application_method = 'direct_form'
      AND roster_document_url IS NULL
      AND roster_file_name IS NULL
      AND form_url IS NOT NULL)
  )
);
