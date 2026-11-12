import { recordParticipantPaymentResponse } from "../participant-guidance";
import type { PortalEnv, PortalMemberRow, ResponseValue } from "./types";

export const RESPONSE_LABELS = {
  yes: "参加希望",
  maybe: "未定・条件付き",
  no: "不参加",
} as const;

const SAFE_TOURNAMENT_ID = /^T-[0-9a-f-]{36}$/;

interface PortalTournamentRow {
  tournament_id: string;
  registration_group_id: string | null;
  title: string;
  event_start_date: string;
  grade: string;
  all_grades: number;
  tournament_type: string;
  venue: string | null;
  true_deadline: string;
  internal_deadline: string;
  document_url: string | null;
  status: string;
  workflow_stage: string;
  closure_reason: string | null;
  created_at: string;
  eligible: number;
  own_response: ResponseValue | null;
  own_entry_status: string | null;
  own_waitlist_number: number | null;
  archive_published_at: string | null;
}

interface ParticipantRow {
  tournament_id: string;
  display_name: string;
  display_name_kana: string;
  grade: string;
  entry_status: string | null;
  waitlist_number: number | null;
  result_text: string | null;
}

interface PortalArchiveDocumentRow {
  group_key: string;
  document_type: "roster" | "results";
  file_name: string;
}

interface PortalConfirmationRosterRow {
  group_key: string;
  file_name: string;
}

interface PortalOverduePaymentRow {
  tournament_id: string;
  payment_deadline: string;
}

interface PortalGuidanceRow {
  group_key: string;
  body_text: string | null;
  document_url: string | null;
  file_name: string | null;
}

export class PortalError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function listPortalTournaments(
  env: PortalEnv,
  member: PortalMemberRow,
): Promise<unknown> {
  const tournaments = await env.DB.prepare(
    `SELECT
      tournaments.tournament_id,
      tournaments.registration_group_id,
      tournaments.title,
      tournaments.event_start_date,
      tournaments.grade,
      tournaments.all_grades,
      tournaments.tournament_type,
      tournaments.venue,
      tournaments.true_deadline,
      tournaments.internal_deadline,
      tournaments.document_url,
      tournaments.status,
      tournaments.workflow_stage,
      tournaments.closure_reason,
      tournaments.archive_published_at,
      tournaments.created_at,
      CASE WHEN tournaments.all_grades = 1 OR tournaments.grade = ? THEN 1 ELSE 0 END AS eligible,
      (SELECT responses.response
       FROM responses
       WHERE responses.tournament_id = tournaments.tournament_id
         AND responses.member_id = ?
         AND responses.is_valid = 1
       LIMIT 1) AS own_response,
      (SELECT tournament_entries.status
       FROM tournament_entries
       WHERE tournament_entries.tournament_id = tournaments.tournament_id
         AND tournament_entries.member_id = ?
       LIMIT 1) AS own_entry_status,
      (SELECT tournament_entries.waitlist_number
       FROM tournament_entries
       WHERE tournament_entries.tournament_id = tournaments.tournament_id
         AND tournament_entries.member_id = ?
       LIMIT 1) AS own_waitlist_number
     FROM tournaments
     WHERE tournaments.status NOT IN ('draft', 'deleted')
     ORDER BY tournaments.internal_deadline ASC, tournaments.event_start_date ASC`,
  ).bind(
    member.grade,
    member.member_id,
    member.member_id,
    member.member_id,
  ).all<PortalTournamentRow>();

  const participants = await env.DB.prepare(
    `SELECT
      responses.tournament_id,
      COALESCE(tournament_entries.archive_display_name, members.display_name) AS display_name,
      COALESCE(
        NULLIF(tournament_entries.archive_display_name_kana, ''),
        NULLIF(members.display_name_kana, ''),
        NULLIF(TRIM(members.last_name_kana || ' ' || members.first_name_kana), ''),
        ''
      ) AS display_name_kana,
      COALESCE(tournament_entries.archive_grade, members.grade) AS grade,
      tournament_entries.status AS entry_status,
      tournament_entries.waitlist_number,
      tournament_entries.result_text
     FROM responses
     INNER JOIN members ON members.member_id = responses.member_id
     INNER JOIN tournaments ON tournaments.tournament_id = responses.tournament_id
     LEFT JOIN tournament_entries
       ON tournament_entries.tournament_id = responses.tournament_id
      AND tournament_entries.member_id = responses.member_id
     WHERE responses.response = 'yes'
       AND responses.is_valid = 1
       AND (members.status = 'active' OR tournaments.archive_published_at IS NOT NULL)
       AND tournaments.status NOT IN ('draft', 'deleted')
     ORDER BY members.grade, display_name_kana, members.display_name`,
  ).all<ParticipantRow>();

  const overduePayments = await env.DB.prepare(
    `SELECT tournament_entries.tournament_id,
            tournament_participant_guidance.payment_deadline
     FROM tournament_entries
     INNER JOIN tournaments
       ON tournaments.tournament_id = tournament_entries.tournament_id
     INNER JOIN tournament_participant_guidance
       ON tournament_participant_guidance.group_key =
          COALESCE(tournaments.registration_group_id, tournaments.tournament_id)
     LEFT JOIN tournament_entry_payments
       ON tournament_entry_payments.tournament_id = tournament_entries.tournament_id
      AND tournament_entry_payments.member_id = tournament_entries.member_id
     WHERE tournament_entries.member_id = ?
       AND tournament_entries.status = 'selected'
       AND tournaments.status = 'applied'
       AND tournament_participant_guidance.payment_collection_method = 'advance_manager'
       AND tournament_participant_guidance.payment_deadline IS NOT NULL
       AND tournament_participant_guidance.payment_deadline < ?
       AND COALESCE(tournament_entry_payments.status, 'unpaid') = 'unpaid'`,
  ).bind(member.member_id, new Date().toISOString()).all<PortalOverduePaymentRow>();

  const archiveDocuments = await env.DB.prepare(
    `SELECT tournament_archive_documents.group_key,
            tournament_archive_documents.document_type,
            tournament_archive_documents.file_name
     FROM tournament_archive_documents
     WHERE tournament_archive_documents.document_type = 'roster'
        OR EXISTS (
          SELECT 1 FROM tournaments
          WHERE COALESCE(tournaments.registration_group_id, tournaments.tournament_id)
            = tournament_archive_documents.group_key
            AND tournaments.archive_published_at IS NOT NULL
        )
     ORDER BY tournament_archive_documents.document_type`,
  ).all<PortalArchiveDocumentRow>();

  const confirmationRosters = await env.DB.prepare(
    `SELECT group_key, file_name
     FROM tournament_confirmation_rosters`,
  ).all<PortalConfirmationRosterRow>();

  const participantGuidance = await env.DB.prepare(
    `SELECT tournament_participant_guidance.group_key,
            tournament_participant_guidance.body_text,
            tournament_participant_guidance.document_url,
            tournament_participant_guidance.file_name
     FROM tournament_participant_guidance
     WHERE EXISTS (
       SELECT 1
       FROM tournaments
       INNER JOIN tournament_entries
         ON tournament_entries.tournament_id = tournaments.tournament_id
       WHERE COALESCE(tournaments.registration_group_id, tournaments.tournament_id)
         = tournament_participant_guidance.group_key
         AND tournament_entries.status = 'selected'
     )`,
  ).all<PortalGuidanceRow>();

  const byTournament = new Map<string, ParticipantRow[]>();
  for (const participant of participants.results) {
    const current = byTournament.get(participant.tournament_id) ?? [];
    current.push(participant);
    byTournament.set(participant.tournament_id, current);
  }
  const documentsByGroup = new Map<string, PortalArchiveDocumentRow[]>();
  for (const document of archiveDocuments.results) {
    const current = documentsByGroup.get(document.group_key) ?? [];
    current.push(document);
    documentsByGroup.set(document.group_key, current);
  }
  const guidanceByGroup = new Map(
    participantGuidance.results.map((guidance) => [guidance.group_key, {
      has_text: Boolean(guidance.body_text),
      has_document: Boolean(guidance.document_url),
      file_name: guidance.file_name,
    }]),
  );
  const confirmationRosterByGroup = new Map(
    confirmationRosters.results.map((roster) => [roster.group_key, roster]),
  );
  const overduePaymentByTournament = new Map(
    overduePayments.results.map((payment) => [payment.tournament_id, payment.payment_deadline]),
  );
  return tournaments.results.map((tournament) => ({
    ...tournament,
    eligible: Number(tournament.eligible) === 1,
    all_grades: Number(tournament.all_grades),
    participants: byTournament.get(tournament.tournament_id) ?? [],
    has_document: Boolean(tournament.document_url),
    document_url: undefined,
    archive_documents: documentsByGroup.get(
      tournament.registration_group_id ?? tournament.tournament_id,
    ) ?? [],
    confirmation_roster: confirmationRosterByGroup.get(
      tournament.registration_group_id ?? tournament.tournament_id,
    ) ?? null,
    own_payment_overdue: overduePaymentByTournament.has(tournament.tournament_id),
    own_payment_deadline: overduePaymentByTournament.get(tournament.tournament_id) ?? null,
    participant_guidance: guidanceByGroup.get(
      tournament.registration_group_id ?? tournament.tournament_id,
    ) ?? null,
  }));
}

export async function saveWebResponse(
  env: PortalEnv,
  member: PortalMemberRow,
  tournamentId: string,
  response: unknown,
): Promise<ResponseValue> {
  if (!SAFE_TOURNAMENT_ID.test(tournamentId)) throw new PortalError("大会IDが不正です。", 400);
  if (
    typeof response !== "string" ||
    !Object.prototype.hasOwnProperty.call(RESPONSE_LABELS, response)
  ) {
    throw new PortalError("回答を選択してください。", 400);
  }
  const tournament = await env.DB.prepare(
    `SELECT tournament_id, internal_deadline
     FROM tournaments
     WHERE tournament_id = ?
       AND status = 'active'
       AND (all_grades = 1 OR grade = ?)
     LIMIT 1`,
  ).bind(tournamentId, member.grade).first<{ tournament_id: string; internal_deadline: string }>();
  if (!tournament) throw new PortalError("この大会への回答権限を確認できません。", 403);
  if (new Date(tournament.internal_deadline).getTime() < Date.now()) {
    throw new PortalError("サークル内締切を過ぎています。", 409);
  }
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO responses (
      tournament_id, member_id, response, source, is_valid, created_at, updated_at
    ) VALUES (?, ?, ?, 'web', 1, ?, ?)
    ON CONFLICT(tournament_id, member_id) DO UPDATE SET
      response = excluded.response,
      source = 'web',
      is_valid = 1,
      invalidated_at = NULL,
      invalidated_reason = NULL,
      updated_at = excluded.updated_at`,
  ).bind(tournamentId, member.member_id, response, now, now).run();
  return response as ResponseValue;
}

export async function saveParticipantPayment(
  env: PortalEnv,
  member: PortalMemberRow,
  tournamentId: string,
): Promise<void> {
  await recordParticipantPaymentResponse(env, {
    tournamentId,
    discordUserId: member.discord_user_id,
    status: "paid",
    changedBy: `portal:${member.discord_user_id}`,
  });
}
