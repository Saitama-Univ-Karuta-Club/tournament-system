-- 担当者が見る大会の運用段階を、内部的な有効・中止状態とは分けて保持する。
ALTER TABLE tournaments
ADD COLUMN workflow_stage TEXT NOT NULL DEFAULT 'registration_open'
CHECK (workflow_stage IN (
  'draft',
  'registration_open',
  'application_pending',
  'application_complete',
  'pre_lottery',
  'confirmed',
  'archive',
  'no_participants',
  'canceled'
));

-- 既存大会は、保存済みの書類・当落・公開状態から最も進んだ段階へ移行する。
UPDATE tournaments
SET workflow_stage = CASE
  WHEN status = 'canceled' THEN 'canceled'
  WHEN status = 'closed' AND closure_reason = 'no_participants' THEN 'no_participants'
  WHEN archive_published_at IS NOT NULL THEN 'archive'
  WHEN status IN ('applied', 'closed')
    AND EXISTS (
      SELECT 1
      FROM tournament_archive_documents
      WHERE tournament_archive_documents.group_key = COALESCE(
        tournaments.registration_group_id,
        tournaments.tournament_id
      )
        AND tournament_archive_documents.document_type = 'roster'
    )
    AND EXISTS (
      SELECT 1
      FROM responses
      INNER JOIN tournaments AS response_tournaments
        ON response_tournaments.tournament_id = responses.tournament_id
      WHERE COALESCE(
          response_tournaments.registration_group_id,
          response_tournaments.tournament_id
        ) = COALESCE(
          tournaments.registration_group_id,
          tournaments.tournament_id
        )
        AND responses.response = 'yes'
        AND responses.is_valid = 1
    )
    AND NOT EXISTS (
      SELECT 1
      FROM responses
      INNER JOIN tournaments AS response_tournaments
        ON response_tournaments.tournament_id = responses.tournament_id
      LEFT JOIN tournament_entries
        ON tournament_entries.tournament_id = responses.tournament_id
       AND tournament_entries.member_id = responses.member_id
      WHERE COALESCE(
          response_tournaments.registration_group_id,
          response_tournaments.tournament_id
        ) = COALESCE(
          tournaments.registration_group_id,
          tournaments.tournament_id
        )
        AND responses.response = 'yes'
        AND responses.is_valid = 1
        AND (
          tournament_entries.status IS NULL
          OR tournament_entries.status = 'submitted'
        )
    )
    THEN 'confirmed'
  WHEN status IN ('applied', 'closed')
    AND EXISTS (
      SELECT 1
      FROM tournament_confirmation_rosters
      WHERE tournament_confirmation_rosters.group_key = COALESCE(
        tournaments.registration_group_id,
        tournaments.tournament_id
      )
    )
    THEN 'pre_lottery'
  WHEN status = 'applied' THEN 'application_complete'
  WHEN status = 'draft' THEN 'draft'
  WHEN status IN ('active', 'closed')
    AND internal_deadline <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    THEN 'application_pending'
  ELSE 'registration_open'
END;

-- 廃止する「締切済み」の旧データは、保存済み情報に応じて現行の内部状態へ戻す。
-- 参加者なし終了の closed だけは、終了理由を保持するためそのまま残す。
UPDATE tournaments
SET status = CASE
  WHEN workflow_stage IN ('application_complete', 'pre_lottery', 'confirmed', 'archive')
    THEN 'applied'
  ELSE 'active'
END
WHERE status = 'closed'
  AND COALESCE(closure_reason, '') <> 'no_participants';

CREATE INDEX idx_tournaments_workflow_stage
ON tournaments(workflow_stage, internal_deadline, true_deadline);
