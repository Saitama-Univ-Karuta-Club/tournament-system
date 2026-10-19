import {
  createTournaments,
  enqueueApplicationCompletedNotification,
  enqueueTournamentUpdateNotifications,
  normalizeTournamentGrades,
  normalizeTournamentInput,
  type TournamentEnv,
  type TournamentInput,
  type TournamentRow,
} from "./tournaments";
import {
  countPendingMemberRegistrations,
  decideMemberRegistration,
  listAdminMembers,
  listPendingMemberRegistrations,
  MemberAdminError,
  updateAdminMember,
  type AdminMember,
  type AdminMemberRegistrationRequest,
  type MemberRegistrationDecision,
  type MemberUpdateInput,
} from "./admin-members";
import {
  buildArchivePdfFilename,
  buildConfirmationRosterFilename,
  buildGuidanceFilename,
  buildOrganizerPaymentFilename,
  DocumentUploadError,
  storeParticipantGuidanceDocument,
  storeTournamentPdf,
  uploadApplicationRoster,
  uploadTournamentDocument,
  type ArchiveDocumentType,
  type DocumentEnv,
} from "./documents";
import {
  handleAdminAuthRequest,
  readAdminDiscordPrincipal,
  type AdminAuthEnv,
} from "./admin-auth";
import {
  enqueueParticipantGuidance,
  type GuidanceEnqueueResult,
} from "./participant-guidance";
import {
  enqueueConfirmationRosterDms,
  enqueueLotteryResultAnnouncement,
} from "./post-deadline";

export interface AdminEnv extends TournamentEnv, DocumentEnv, AdminAuthEnv {}

type AdminContext = Pick<ExecutionContext, "waitUntil"> &
  Partial<Pick<ExecutionContext, "access">>;
type TournamentCreator = (
  env: AdminEnv,
  inputs: TournamentInput[],
) => Promise<TournamentRow[]>;
type TournamentLister = (env: AdminEnv) => Promise<AdminTournament[]>;
type TournamentStatusUpdater = (
  env: AdminEnv,
  tournamentId: string,
  status: string,
  changedByEmail: string,
) => Promise<TournamentStatusUpdate>;
type TournamentStatusesUpdater = (
  env: AdminEnv,
  tournamentIds: string[],
  status: string,
  changedByEmail: string,
) => Promise<TournamentStatusBatchUpdate>;
type TournamentEditor = (
  env: AdminEnv,
  tournamentIds: string[],
  input: TournamentEditInput,
  changedByEmail: string,
) => Promise<TournamentEditResult>;
type TournamentEntryStatusUpdater = (
  env: AdminEnv,
  tournamentId: string,
  memberId: string,
  status: string,
  waitlistNumber: number | null,
  changedByEmail: string,
) => Promise<TournamentEntryStatusUpdate>;
type TournamentEntryResultUpdater = (
  env: AdminEnv,
  tournamentId: string,
  memberId: string,
  resultText: string,
  changedByEmail: string,
) => Promise<TournamentEntryResultUpdate>;
type TournamentArchivePublisher = (
  env: AdminEnv,
  tournamentIds: string[],
  published: boolean,
  changedByEmail: string,
) => Promise<TournamentArchivePublishResult>;
type MemberLister = (env: AdminEnv) => Promise<AdminMember[]>;
type MemberUpdater = (
  env: AdminEnv,
  memberId: string,
  input: MemberUpdateInput,
  changedByEmail: string,
) => Promise<AdminMember>;
type MemberRegistrationLister = (
  env: AdminEnv,
) => Promise<AdminMemberRegistrationRequest[]>;
type MemberRegistrationDecider = (
  env: AdminEnv,
  requestId: string,
  decision: string,
  decidedByEmail: string,
) => Promise<MemberRegistrationDecision>;
type MemberRegistrationCounter = (env: AdminEnv) => Promise<number>;

interface AdminTournamentRow extends TournamentRow {
  status: string;
  closure_reason: "no_participants" | null;
  archive_published_at: string | null;
  created_at: string;
  announcements_sent: number;
  invitation_dms_sent: number;
  notifications_queued: number;
  notification_failures: number;
  application_method: "excel_email" | "excel_form" | "direct_form" | null;
  application_roster_url: string | null;
  application_roster_file_name: string | null;
  application_form_url: string | null;
  application_email: string | null;
}

interface AdminResponseRow {
  tournament_id: string;
  member_id: string;
  response: string;
  display_name: string;
  display_name_kana: string;
  grade: string;
  is_eligible: number;
  updated_at: string;
  entry_status: string | null;
  waitlist_number: number | null;
  payment_status: "unpaid" | "paid" | null;
  result_text: string | null;
}

interface AdminArchiveDocumentRow {
  group_key: string;
  document_type: ArchiveDocumentType;
  document_url: string;
  file_name: string;
  file_size: number;
  uploaded_at: string;
}

interface AdminParticipantGuidanceRow {
  group_key: string;
  body_text: string | null;
  document_url: string | null;
  file_name: string | null;
  file_size: number | null;
  content_type: string | null;
  payment_details: string | null;
  payment_collection_method: "advance_manager" | "onsite_cash";
  organizer_payment_source: "text" | "file" | "guidance";
  organizer_payment_document_url: string | null;
  organizer_payment_file_name: string | null;
  organizer_payment_file_size: number | null;
  organizer_payment_content_type: string | null;
  organizer_payment_deadline: string | null;
  payment_deadline: string | null;
  revision: number;
  updated_at: string;
  sent_count: number;
  pending_count: number;
  failed_count: number;
}

interface AdminParticipationFeeRow {
  group_key: string;
  grade: string;
  amount_yen: number;
}

interface AdminConfirmationRosterRow {
  group_key: string;
  document_url: string;
  file_name: string;
  file_size: number;
  content_type: string;
  revision: number;
  uploaded_at: string;
}

export interface AdminTournament extends AdminTournamentRow {
  response_yes: number;
  response_maybe: number;
  response_no: number;
  eligible_members: number;
  response_total: number;
  response_pending: number;
  responses: AdminResponseRow[];
  archive_documents: AdminArchiveDocumentRow[];
  participant_guidance: AdminParticipantGuidanceRow | null;
  participation_fees: AdminParticipationFeeRow[];
  confirmation_roster: AdminConfirmationRosterRow | null;
}

export interface TournamentStatusUpdate {
  tournamentId: string;
  previousStatus: string;
  status: string;
  changed: boolean;
}

export interface TournamentStatusBatchUpdate {
  tournamentIds: string[];
  status: string;
  changedCount: number;
  completionNotificationQueued: boolean;
}

export interface TournamentEditInput {
  title: string;
  eventStartDate: string;
  eventDatesByTournament?: Record<string, string>;
  tournamentType: string;
  venue?: string;
  trueDeadline: string;
  internalDeadline: string;
  documentUrl?: string;
}

export interface TournamentEditResult {
  tournaments: TournamentRow[];
  notificationsQueued: number;
}

export interface TournamentEntryStatusUpdate {
  tournamentId: string;
  memberId: string;
  previousStatus: string | null;
  previousWaitlistNumber: number | null;
  status: string;
  waitlistNumber: number | null;
  changed: boolean;
}

export interface TournamentEntryResultUpdate {
  tournamentId: string;
  memberId: string;
  resultText: string;
  changed: boolean;
}

export interface TournamentArchivePublishResult {
  tournamentIds: string[];
  published: boolean;
  publishedAt: string | null;
}

export interface ParticipantGuidanceSaveResult {
  groupKey: string;
  bodyText: string | null;
  documentUrl: string | null;
  fileName: string | null;
  fileSize: number | null;
  contentType: string | null;
  paymentCollectionMethod: "advance_manager" | "onsite_cash";
  organizerPaymentSource: "text" | "file" | "guidance";
  organizerPaymentDetails: string | null;
  organizerPaymentDocumentUrl: string | null;
  organizerPaymentFileName: string | null;
  feesByGrade: Record<string, number>;
  organizerPaymentDeadline: string | null;
  paymentDeadline: string | null;
  revision: number;
  updatedAt: string;
}

export interface LotteryNotificationQueueResult {
  channelQueued: number;
  dmQueued: number;
  dmUnavailable: number;
}

export interface EntryPaymentUpdateResult {
  tournamentId: string;
  memberId: string;
  previousStatus: "unpaid" | "paid" | null;
  status: "unpaid" | "paid";
  changed: boolean;
}

export interface TournamentEntryBatchInput {
  tournamentId: string;
  memberId: string;
  status: string;
  waitlistNumber: number | null;
  paymentStatus: "unpaid" | "paid" | null;
}

export interface TournamentEntryBatchUpdateResult {
  entryCount: number;
  changedCount: number;
}

class AdminRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const MANAGEABLE_STATUSES = new Set([
  "draft",
  "active",
  "applied",
  "closed",
  "canceled",
]);
const ENTRY_STATUSES = new Set([
  "submitted",
  "selected",
  "not_selected",
  "withdrawn",
]);
const ENTRY_RESULT_OPTIONS = new Set([
  "1回戦敗退",
  "2回戦敗退",
  "3回戦敗退",
  "4回戦敗退",
  "4位入賞",
  "3位入賞",
  "準優勝",
  "優勝",
]);

export function defaultPaymentDeadline(organizerDeadline: string): string {
  const organizer = new Date(organizerDeadline);
  if (Number.isNaN(organizer.getTime())) {
    throw new AdminRequestError("主催者締切日が不正です。", 400);
  }
  const jst = new Date(organizer.getTime() + 9 * 60 * 60 * 1000);
  const candidate = new Date(Date.UTC(
    jst.getUTCFullYear(),
    jst.getUTCMonth(),
    jst.getUTCDate() - 2,
  ));
  while (candidate.getUTCDay() === 0 || candidate.getUTCDay() === 6) {
    candidate.setUTCDate(candidate.getUTCDate() - 1);
  }
  return new Date(Date.UTC(
    candidate.getUTCFullYear(),
    candidate.getUTCMonth(),
    candidate.getUTCDate(),
    14,
    59,
  )).toISOString();
}

interface EditableTournamentRow extends TournamentRow {
  status: string;
  closure_reason?: "no_participants" | null;
}

function normalizeTournamentIds(rawIds: string[]): string[] {
  const tournamentIds = [...new Set(rawIds)];
  if (
    tournamentIds.length === 0 ||
    tournamentIds.length > 7 ||
    tournamentIds.some((id) => !/^T-[0-9a-f-]{36}$/.test(id))
  ) {
    throw new AdminRequestError("大会IDが不正です。", 400);
  }
  return tournamentIds;
}

async function loadEditableTournaments(
  env: AdminEnv,
  rawIds: string[],
  requireCompleteGroup = false,
): Promise<EditableTournamentRow[]> {
  const tournamentIds = normalizeTournamentIds(rawIds);
  const placeholders = tournamentIds.map(() => "?").join(", ");
  const rows = await env.DB.prepare(
    `SELECT
      tournament_id,
      registration_group_id,
      title,
      event_start_date,
      event_end_date,
      grade,
      all_grades,
      tournament_type,
      venue,
      true_deadline,
      internal_deadline,
      document_url,
      status,
      closure_reason
     FROM tournaments
     WHERE tournament_id IN (${placeholders})
       AND status <> 'deleted'
     ORDER BY grade`,
  ).bind(...tournamentIds).all<EditableTournamentRow>();
  if (rows.results.length !== tournamentIds.length) {
    throw new AdminRequestError("対象の大会が見つかりません。", 404);
  }
  if (requireCompleteGroup && rows.results.length > 1) {
    const groupId = rows.results[0].registration_group_id;
    if (
      !groupId ||
      rows.results.some((tournament) => tournament.registration_group_id !== groupId)
    ) {
      throw new AdminRequestError("同時登録された大会だけを一括変更できます。", 400);
    }
    const groupCount = await env.DB.prepare(
      `SELECT COUNT(*) AS count
       FROM tournaments
       WHERE registration_group_id = ? AND status <> 'deleted'`,
    ).bind(groupId).first<{ count: number }>();
    if (Number(groupCount?.count ?? 0) !== rows.results.length) {
      throw new AdminRequestError("大会グループの一部が選択されていません。", 400);
    }
  }
  return rows.results;
}

async function editFingerprint(input: unknown): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(input)),
  );
  return Array.from(new Uint8Array(digest))
    .slice(0, 12)
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export async function listAdminTournaments(
  env: AdminEnv,
): Promise<AdminTournament[]> {
  const tournaments = await env.DB.prepare(
    `SELECT
      tournaments.tournament_id,
      tournaments.registration_group_id,
      tournaments.title,
      tournaments.event_start_date,
      tournaments.event_end_date,
      tournaments.grade,
      tournaments.all_grades,
      tournaments.tournament_type,
      tournaments.venue,
      tournaments.true_deadline,
      tournaments.internal_deadline,
      tournaments.document_url,
      tournament_application_methods.application_method,
      tournament_application_methods.roster_document_url AS application_roster_url,
      tournament_application_methods.roster_file_name AS application_roster_file_name,
      tournament_application_methods.form_url AS application_form_url,
      tournament_application_methods.application_email,
      tournaments.status,
      tournaments.closure_reason,
      tournaments.archive_published_at,
      tournaments.created_at,
      (SELECT COUNT(*) FROM notification_deliveries
        WHERE notification_deliveries.tournament_id = tournaments.tournament_id
          AND notification_deliveries.notification_type = 'announcement'
          AND notification_deliveries.delivery_context <> 'response_reminder'
          AND notification_deliveries.status = 'sent') AS announcements_sent,
      (SELECT COUNT(*) FROM notification_deliveries
        WHERE notification_deliveries.tournament_id = tournaments.tournament_id
          AND notification_deliveries.notification_type = 'invitation_dm'
          AND notification_deliveries.delivery_context <> 'response_reminder'
          AND notification_deliveries.status = 'sent') AS invitation_dms_sent,
      (SELECT COUNT(*) FROM notification_deliveries
        WHERE notification_deliveries.tournament_id = tournaments.tournament_id
          AND (
            notification_deliveries.status = 'pending'
            OR (
              notification_deliveries.status = 'failed'
              AND notification_deliveries.attempt_count < 5
            )
          )) AS notifications_queued,
      (SELECT COUNT(*) FROM notification_deliveries
        WHERE notification_deliveries.tournament_id = tournaments.tournament_id
          AND notification_deliveries.status = 'failed'
          AND notification_deliveries.attempt_count >= 5) AS notification_failures
    FROM tournaments
    LEFT JOIN tournament_application_methods
      ON tournament_application_methods.group_key = COALESCE(
        tournaments.registration_group_id,
        tournaments.tournament_id
      )
    WHERE tournaments.status <> 'deleted'
    ORDER BY tournaments.created_at DESC
    LIMIT 100`,
  ).all<AdminTournamentRow>();

  const responseRows = await env.DB.prepare(
    `SELECT
      tournaments.tournament_id,
      members.member_id,
      COALESCE(responses.response, 'pending') AS response,
      members.display_name,
      COALESCE(
        NULLIF(members.display_name_kana, ''),
        NULLIF(TRIM(members.last_name_kana || ' ' || members.first_name_kana), ''),
        ''
      ) AS display_name_kana,
      members.grade,
      CASE WHEN
        members.status = 'active'
        AND members.dm_enabled = 1
        AND members.discord_user_id IS NOT NULL
        AND (
          tournaments.all_grades = 1
          OR members.grade = tournaments.grade
        )
      THEN 1 ELSE 0 END AS is_eligible,
      COALESCE(responses.updated_at, members.updated_at) AS updated_at,
      tournament_entries.status AS entry_status,
      tournament_entries.waitlist_number,
      tournament_entry_payments.status AS payment_status,
      tournament_entries.result_text
    FROM tournaments
    INNER JOIN members
      ON (
        (
          members.status = 'active'
          AND members.dm_enabled = 1
          AND members.discord_user_id IS NOT NULL
          AND (
            tournaments.all_grades = 1
            OR members.grade = tournaments.grade
          )
        )
        OR EXISTS (
          SELECT 1 FROM responses AS valid_response
          WHERE valid_response.tournament_id = tournaments.tournament_id
            AND valid_response.member_id = members.member_id
            AND valid_response.is_valid = 1
        )
      )
    LEFT JOIN responses
      ON responses.tournament_id = tournaments.tournament_id
      AND responses.member_id = members.member_id
      AND responses.is_valid = 1
    LEFT JOIN tournament_entries
      ON tournament_entries.tournament_id = tournaments.tournament_id
      AND tournament_entries.member_id = members.member_id
    LEFT JOIN tournament_entry_payments
      ON tournament_entry_payments.tournament_id = tournaments.tournament_id
      AND tournament_entry_payments.member_id = members.member_id
    WHERE tournaments.status <> 'deleted'
    ORDER BY
      tournaments.tournament_id,
      members.grade,
      display_name_kana,
      members.display_name`,
  ).all<AdminResponseRow>();

  const archiveDocuments = await env.DB.prepare(
    `SELECT group_key, document_type, document_url, file_name, file_size, uploaded_at
     FROM tournament_archive_documents
     ORDER BY uploaded_at`,
  ).all<AdminArchiveDocumentRow>();
  const documentsByGroup = new Map<string, AdminArchiveDocumentRow[]>();
  for (const document of archiveDocuments.results) {
    const current = documentsByGroup.get(document.group_key) ?? [];
    current.push(document);
    documentsByGroup.set(document.group_key, current);
  }

  const participantGuidance = await env.DB.prepare(
    `SELECT
      tournament_participant_guidance.group_key,
      tournament_participant_guidance.body_text,
      tournament_participant_guidance.document_url,
      tournament_participant_guidance.file_name,
      tournament_participant_guidance.file_size,
      tournament_participant_guidance.content_type,
      tournament_participant_guidance.payment_details,
      tournament_participant_guidance.payment_collection_method,
      tournament_participant_guidance.organizer_payment_source,
      tournament_participant_guidance.organizer_payment_document_url,
      tournament_participant_guidance.organizer_payment_file_name,
      tournament_participant_guidance.organizer_payment_file_size,
      tournament_participant_guidance.organizer_payment_content_type,
      tournament_participant_guidance.organizer_payment_deadline,
      tournament_participant_guidance.payment_deadline,
      tournament_participant_guidance.revision,
      tournament_participant_guidance.updated_at,
      (SELECT COUNT(*) FROM participant_guidance_deliveries
       WHERE participant_guidance_deliveries.group_key = tournament_participant_guidance.group_key
         AND participant_guidance_deliveries.guidance_revision = tournament_participant_guidance.revision
         AND participant_guidance_deliveries.status = 'sent') AS sent_count,
      (SELECT COUNT(*) FROM participant_guidance_deliveries
       WHERE participant_guidance_deliveries.group_key = tournament_participant_guidance.group_key
         AND participant_guidance_deliveries.guidance_revision = tournament_participant_guidance.revision
         AND participant_guidance_deliveries.status IN ('pending', 'failed')
         AND participant_guidance_deliveries.attempt_count < 5) AS pending_count,
      (SELECT COUNT(*) FROM participant_guidance_deliveries
       WHERE participant_guidance_deliveries.group_key = tournament_participant_guidance.group_key
         AND participant_guidance_deliveries.guidance_revision = tournament_participant_guidance.revision
         AND participant_guidance_deliveries.status = 'failed'
         AND participant_guidance_deliveries.attempt_count >= 5) AS failed_count
     FROM tournament_participant_guidance`,
  ).all<AdminParticipantGuidanceRow>();
  const guidanceByGroup = new Map(
    participantGuidance.results.map((guidance) => [guidance.group_key, {
      ...guidance,
      revision: Number(guidance.revision),
      sent_count: Number(guidance.sent_count),
      pending_count: Number(guidance.pending_count),
      failed_count: Number(guidance.failed_count),
    }]),
  );
  const participationFees = await env.DB.prepare(
    `SELECT group_key, grade, amount_yen
     FROM tournament_participation_fees
     ORDER BY grade`,
  ).all<AdminParticipationFeeRow>();
  const feesByGroup = new Map<string, AdminParticipationFeeRow[]>();
  for (const fee of participationFees.results) {
    const current = feesByGroup.get(fee.group_key) ?? [];
    current.push({ ...fee, amount_yen: Number(fee.amount_yen) });
    feesByGroup.set(fee.group_key, current);
  }
  const confirmationRosters = await env.DB.prepare(
    `SELECT group_key, document_url, file_name, file_size,
      content_type, revision, uploaded_at
     FROM tournament_confirmation_rosters`,
  ).all<AdminConfirmationRosterRow>();
  const confirmationRosterByGroup = new Map(
    confirmationRosters.results.map((roster) => [roster.group_key, {
      ...roster,
      revision: Number(roster.revision),
    }]),
  );

  const responsesByTournament = new Map<string, AdminResponseRow[]>();
  for (const response of responseRows.results) {
    const current = responsesByTournament.get(response.tournament_id) ?? [];
    current.push(response);
    responsesByTournament.set(response.tournament_id, current);
  }

  return tournaments.results.map((tournament) => {
    const responses = responsesByTournament.get(tournament.tournament_id) ?? [];
    const responseYes = responses.filter((item) => item.response === "yes").length;
    const responseMaybe = responses.filter((item) => item.response === "maybe").length;
    const responseNo = responses.filter((item) => item.response === "no").length;
    const responsePending = responses.filter((item) => item.response === "pending").length;
    const responseTotal = responseYes + responseMaybe + responseNo;
    return {
      ...tournament,
      response_yes: responseYes,
      response_maybe: responseMaybe,
      response_no: responseNo,
      eligible_members: responses.filter((item) => Number(item.is_eligible) === 1).length,
      announcements_sent: Number(tournament.announcements_sent),
      invitation_dms_sent: Number(tournament.invitation_dms_sent),
      notifications_queued: Number(tournament.notifications_queued),
      notification_failures: Number(tournament.notification_failures),
      response_total: responseTotal,
      response_pending: responsePending,
      responses,
      archive_documents: documentsByGroup.get(
        tournament.registration_group_id ?? tournament.tournament_id,
      ) ?? [],
      participant_guidance: guidanceByGroup.get(
        tournament.registration_group_id ?? tournament.tournament_id,
      ) ?? null,
      participation_fees: feesByGroup.get(
        tournament.registration_group_id ?? tournament.tournament_id,
      ) ?? [],
      confirmation_roster: confirmationRosterByGroup.get(
        tournament.registration_group_id ?? tournament.tournament_id,
      ) ?? null,
    };
  });
}

export async function updateTournamentStatus(
  env: AdminEnv,
  tournamentId: string,
  status: string,
  changedByEmail: string,
): Promise<TournamentStatusUpdate> {
  const [existing] = await loadEditableTournaments(env, [tournamentId]);
  const result = await updateTournamentStatuses(
    env,
    [tournamentId],
    status,
    changedByEmail,
  );

  return {
    tournamentId,
    previousStatus: existing.status,
    status,
    changed: result.changedCount > 0,
  };
}

export async function updateTournamentStatuses(
  env: AdminEnv,
  rawTournamentIds: string[],
  status: string,
  changedByEmail: string,
): Promise<TournamentStatusBatchUpdate> {
  if (!MANAGEABLE_STATUSES.has(status)) {
    throw new AdminRequestError("変更先のステータスが不正です。", 400);
  }
  const tournaments = await loadEditableTournaments(
    env,
    rawTournamentIds,
    rawTournamentIds.length > 1,
  );
  if (
    status === "applied" &&
    tournaments.some((tournament) =>
      tournament.status === "canceled" ||
      (tournament.status === "closed" && tournament.closure_reason === "no_participants")
    )
  ) {
    throw new AdminRequestError(
      "中止または参加者なし終了の大会は申込完了にできません。先に大会ステータスを変更してください。",
      409,
    );
  }
  const changed = tournaments.filter((tournament) => tournament.status !== status);
  if (changed.length > 0) {
    const now = new Date().toISOString();
    await env.DB.batch(
      changed.flatMap((tournament) => [
        env.DB.prepare(
          `UPDATE tournaments
           SET status = ?, closure_reason = NULL, updated_at = ?,
             applied_at = CASE WHEN ? = 'applied' THEN ? ELSE applied_at END
           WHERE tournament_id = ? AND status = ?`,
        ).bind(
          status,
          now,
          status,
          now,
          tournament.tournament_id,
          tournament.status,
        ),
        env.DB.prepare(
          `INSERT INTO tournament_status_history (
            tournament_id, previous_status, new_status, changed_by_email, changed_at
          ) VALUES (?, ?, ?, ?, ?)`,
        ).bind(
          tournament.tournament_id,
          tournament.status,
          status,
          changedByEmail,
          now,
        ),
      ]),
    );
  }

  if (status === "applied") {
    const now = new Date().toISOString();
    await env.DB.batch(
      tournaments.map((tournament) =>
        env.DB.prepare(
          `INSERT OR IGNORE INTO tournament_entries (
            tournament_id, member_id, status, created_at, updated_at, updated_by_email
          )
          SELECT ?, responses.member_id, 'submitted', ?, ?, ?
          FROM responses
          WHERE responses.tournament_id = ?
            AND responses.response = 'yes'
            AND responses.is_valid = 1`,
        ).bind(
          tournament.tournament_id,
          now,
          now,
          changedByEmail,
          tournament.tournament_id,
        ),
      ),
    );
  }

  let completionNotificationQueued = false;
  if (status === "applied") {
    const completed = tournaments.map((tournament) => ({
      ...tournament,
      status: "applied",
    }));
    const queued = await enqueueApplicationCompletedNotification(env, completed);
    completionNotificationQueued = queued > 0;
  }
  return {
    tournamentIds: tournaments.map((tournament) => tournament.tournament_id),
    status,
    changedCount: changed.length,
    completionNotificationQueued,
  };
}

export async function updateTournamentEntryStatus(
  env: AdminEnv,
  tournamentId: string,
  memberId: string,
  status: string,
  rawWaitlistNumber: number | null,
  changedByEmail: string,
): Promise<TournamentEntryStatusUpdate> {
  if (!/^T-[0-9a-f-]{36}$/.test(tournamentId) || !/^M-[0-9a-f-]{36}$/.test(memberId)) {
    throw new AdminRequestError("大会またはメンバーIDが不正です。", 400);
  }
  if (!ENTRY_STATUSES.has(status)) {
    throw new AdminRequestError("申込・抽選結果が不正です。", 400);
  }
  const waitlistNumber = status === "not_selected" ? rawWaitlistNumber : null;
  if (
    status === "not_selected" &&
    (!Number.isInteger(waitlistNumber) || Number(waitlistNumber) < 1 || Number(waitlistNumber) > 9999)
  ) {
    throw new AdminRequestError("キャンセル待ち番号は1〜9999の整数で入力してください。", 400);
  }
  const target = await env.DB.prepare(
    `SELECT
      tournament_entries.status AS entry_status,
      tournament_entries.waitlist_number
     FROM tournaments
     INNER JOIN responses
       ON responses.tournament_id = tournaments.tournament_id
      AND responses.member_id = ?
      AND responses.response = 'yes'
      AND responses.is_valid = 1
     LEFT JOIN tournament_entries
       ON tournament_entries.tournament_id = tournaments.tournament_id
      AND tournament_entries.member_id = responses.member_id
     WHERE tournaments.tournament_id = ?
       AND tournaments.status IN ('applied', 'closed')
     LIMIT 1`,
  ).bind(memberId, tournamentId).first<{
    entry_status: string | null;
    waitlist_number: number | null;
  }>();
  if (!target) {
    throw new AdminRequestError(
      "申込完了済み大会の有効な参加希望者を確認できません。",
      404,
    );
  }
  const previousStatus = target.entry_status ?? null;
  const previousWaitlistNumber = target.waitlist_number ?? null;
  if (previousStatus === status && previousWaitlistNumber === waitlistNumber) {
    return {
      tournamentId,
      memberId,
      previousStatus,
      previousWaitlistNumber,
      status,
      waitlistNumber,
      changed: false,
    };
  }

  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO tournament_entries (
        tournament_id, member_id, status, waitlist_number,
        created_at, updated_at, updated_by_email
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tournament_id, member_id) DO UPDATE SET
        status = excluded.status,
        waitlist_number = excluded.waitlist_number,
        updated_at = excluded.updated_at,
        updated_by_email = excluded.updated_by_email`,
    ).bind(tournamentId, memberId, status, waitlistNumber, now, now, changedByEmail),
    env.DB.prepare(
      `INSERT INTO tournament_entry_history (
        tournament_id, member_id, previous_status, new_status,
        previous_waitlist_number, new_waitlist_number,
        changed_by_email, changed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      tournamentId,
      memberId,
      previousStatus,
      status,
      previousWaitlistNumber,
      waitlistNumber,
      changedByEmail,
      now,
    ),
  ]);
  return {
    tournamentId,
    memberId,
    previousStatus,
    previousWaitlistNumber,
    status,
    waitlistNumber,
    changed: true,
  };
}

export async function updateTournamentEntryResult(
  env: AdminEnv,
  tournamentId: string,
  memberId: string,
  rawResultText: string,
  changedByEmail: string,
): Promise<TournamentEntryResultUpdate> {
  if (!/^T-[0-9a-f-]{36}$/.test(tournamentId) || !/^M-[0-9a-f-]{36}$/.test(memberId)) {
    throw new AdminRequestError("大会またはメンバーIDが不正です。", 400);
  }
  const resultText = rawResultText.trim();
  if (!ENTRY_RESULT_OPTIONS.has(resultText)) {
    throw new AdminRequestError("個人成績を選択肢から選んでください。", 400);
  }
  const target = await env.DB.prepare(
    `SELECT tournament_entries.result_text
     FROM tournament_entries
     INNER JOIN tournaments
       ON tournaments.tournament_id = tournament_entries.tournament_id
     WHERE tournament_entries.tournament_id = ?
       AND tournament_entries.member_id = ?
       AND tournament_entries.status IN ('submitted', 'selected')
       AND tournaments.status <> 'deleted'
     LIMIT 1`,
  ).bind(tournamentId, memberId).first<{ result_text: string | null }>();
  if (!target) {
    throw new AdminRequestError("出場者として登録されたメンバーを確認できません。", 404);
  }
  if ((target.result_text ?? "") === resultText) {
    return { tournamentId, memberId, resultText, changed: false };
  }
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE tournament_entries
       SET result_text = ?, result_updated_at = ?, result_updated_by_email = ?
       WHERE tournament_id = ? AND member_id = ?`,
    ).bind(resultText, now, changedByEmail, tournamentId, memberId),
    env.DB.prepare(
      `INSERT INTO tournament_entry_result_history (
        tournament_id, member_id, previous_result, new_result,
        changed_by_email, changed_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(
      tournamentId,
      memberId,
      target.result_text,
      resultText,
      changedByEmail,
      now,
    ),
  ]);
  return { tournamentId, memberId, resultText, changed: true };
}

function archiveGroupKey(tournaments: EditableTournamentRow[]): string {
  return tournaments[0].registration_group_id ?? tournaments[0].tournament_id;
}

async function tournamentIdsFromForm(
  form: FormData,
  env: AdminEnv,
): Promise<EditableTournamentRow[]> {
  let tournamentIds: string[];
  try {
    const parsed = JSON.parse(String(form.get("tournamentIds") ?? "")) as unknown;
    if (!Array.isArray(parsed)) throw new Error();
    tournamentIds = parsed.map(String);
  } catch {
    throw new DocumentUploadError("対象大会が不正です。");
  }
  try {
    return await loadEditableTournaments(env, tournamentIds, tournamentIds.length > 1);
  } catch (error) {
    if (error instanceof AdminRequestError) throw new DocumentUploadError(error.message);
    throw error;
  }
}

export async function saveConfirmationRoster(
  env: AdminEnv,
  request: Request,
  uploadedBy: string,
): Promise<AdminConfirmationRosterRow> {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    throw new DocumentUploadError("申込確認名簿を選択してください。");
  }
  const extensionMatch = file.name.toLowerCase().match(/\.(pdf|doc|docx|xls|xlsx)$/);
  if (!extensionMatch) {
    throw new DocumentUploadError("申込確認名簿はPDF・Word・Excel（.xls/.xlsx）のみ登録できます。");
  }
  const tournaments = await tournamentIdsFromForm(form, env);
  const groupKey = archiveGroupKey(tournaments);
  const current = await env.DB.prepare(
    `SELECT revision FROM tournament_confirmation_rosters WHERE group_key = ?`,
  ).bind(groupKey).first<{ revision: number }>();
  const grades = tournaments.some((item) => item.all_grades === 1)
    ? ["all"]
    : tournaments.map((item) => item.grade);
  const eventDates = [...new Set(tournaments.map((item) => item.event_start_date))];
  const fileName = buildConfirmationRosterFilename(
    tournaments[0].title,
    grades,
    eventDates,
    extensionMatch[1] as "pdf" | "doc" | "docx" | "xls" | "xlsx",
  );
  const stored = await storeParticipantGuidanceDocument(file, env, uploadedBy, fileName);
  const revision = Number(current?.revision ?? 0) + 1;
  const uploadedAt = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO tournament_confirmation_rosters (
      group_key, representative_tournament_id, document_url,
      file_name, file_size, content_type, revision,
      uploaded_by_email, uploaded_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(group_key) DO UPDATE SET
      representative_tournament_id = excluded.representative_tournament_id,
      document_url = excluded.document_url,
      file_name = excluded.file_name,
      file_size = excluded.file_size,
      content_type = excluded.content_type,
      revision = excluded.revision,
      uploaded_by_email = excluded.uploaded_by_email,
      uploaded_at = excluded.uploaded_at`,
  ).bind(
    groupKey,
    tournaments[0].tournament_id,
    stored.url,
    stored.fileName,
    stored.size,
    stored.contentType,
    revision,
    uploadedBy,
    uploadedAt,
  ).run();
  return {
    group_key: groupKey,
    document_url: stored.url,
    file_name: stored.fileName,
    file_size: stored.size,
    content_type: stored.contentType,
    revision,
    uploaded_at: uploadedAt,
  };
}

export async function queueConfirmationRoster(
  env: AdminEnv,
  rawTournamentIds: string[],
): Promise<{ queued: number; unavailable: number }> {
  const tournaments = await loadEditableTournaments(
    env,
    rawTournamentIds,
    rawTournamentIds.length > 1,
  );
  return enqueueConfirmationRosterDms(
    env,
    archiveGroupKey(tournaments),
    tournaments.map((tournament) => tournament.tournament_id),
  );
}

export async function uploadTournamentArchiveDocument(
  env: AdminEnv,
  request: Request,
  uploadedBy: string,
): Promise<AdminArchiveDocumentRow> {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    throw new DocumentUploadError("ファイルを選択してください。");
  }
  const documentType = String(form.get("documentType") ?? "") as ArchiveDocumentType;
  if (documentType !== "roster" && documentType !== "results") {
    throw new DocumentUploadError("書類の種類が不正です。");
  }
  const extensionMatch = file.name.toLowerCase().match(/\.([a-z0-9]+)$/);
  const extension = extensionMatch?.[1] ?? "";
  if (documentType === "roster" && !["pdf", "xls", "xlsx"].includes(extension)) {
    throw new DocumentUploadError("確定名簿はPDF・Excel（.xls/.xlsx）のみ登録できます。");
  }
  if (documentType === "results" && !["pdf", "xls", "xlsx"].includes(extension)) {
    throw new DocumentUploadError("大会結果はPDF・Excel（.xls/.xlsx）のみ登録できます。");
  }
  let tournamentIds: string[];
  try {
    const parsed = JSON.parse(String(form.get("tournamentIds") ?? "")) as unknown;
    if (!Array.isArray(parsed)) throw new Error();
    tournamentIds = parsed.map(String);
  } catch {
    throw new DocumentUploadError("対象大会が不正です。");
  }
  let tournaments: EditableTournamentRow[];
  try {
    tournaments = await loadEditableTournaments(env, tournamentIds, tournamentIds.length > 1);
  } catch (error) {
    if (error instanceof AdminRequestError) throw new DocumentUploadError(error.message);
    throw error;
  }
  const grades = tournaments.some((item) => item.all_grades === 1)
    ? ["all"]
    : tournaments.map((item) => item.grade);
  const eventDates = [...new Set(tournaments.map((item) => item.event_start_date))];
  const pdfFileName = buildArchivePdfFilename(
    tournaments[0].title,
    grades,
    eventDates,
    documentType,
  );
  const fileName = extension === "pdf"
    ? pdfFileName
    : pdfFileName.replace(/\.pdf$/i, `.${extension}`);
  const stored = extension === "pdf"
    ? await storeTournamentPdf(file, env, uploadedBy, fileName)
    : await storeParticipantGuidanceDocument(file, env, uploadedBy, fileName);
  const uploadedAt = new Date().toISOString();
  const groupKey = archiveGroupKey(tournaments);
  await env.DB.prepare(
    `INSERT INTO tournament_archive_documents (
      group_key, document_type, representative_tournament_id,
      document_url, file_name, file_size, uploaded_by_email, uploaded_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(group_key, document_type) DO UPDATE SET
      representative_tournament_id = excluded.representative_tournament_id,
      document_url = excluded.document_url,
      file_name = excluded.file_name,
      file_size = excluded.file_size,
      uploaded_by_email = excluded.uploaded_by_email,
      uploaded_at = excluded.uploaded_at`,
  ).bind(
    groupKey,
    documentType,
    tournaments[0].tournament_id,
    stored.url,
    stored.fileName,
    stored.size,
    uploadedBy,
    uploadedAt,
  ).run();
  return {
    group_key: groupKey,
    document_type: documentType,
    document_url: stored.url,
    file_name: stored.fileName,
    file_size: stored.size,
    uploaded_at: uploadedAt,
  };
}

export async function saveParticipantGuidance(
  env: AdminEnv,
  request: Request,
  updatedBy: string,
): Promise<ParticipantGuidanceSaveResult> {
  const form = await request.formData();
  const bodyText = String(form.get("bodyText") ?? "").trim();
  const paymentCollectionMethod = String(form.get("paymentCollectionMethod") ?? "").trim();
  const organizerPaymentSource = String(form.get("organizerPaymentSource") ?? "").trim();
  const organizerPaymentDetails = String(form.get("organizerPaymentDetails") ?? "").trim();
  const organizerPaymentDeadline = String(form.get("organizerPaymentDeadline") ?? "").trim();
  const paymentDeadline = String(form.get("paymentDeadline") ?? "").trim();
  if (bodyText.length > 3500) {
    throw new DocumentUploadError("参加者向け案内の本文は3500文字以内にしてください。");
  }
  if (!new Set(["advance_manager", "onsite_cash"]).has(paymentCollectionMethod)) {
    throw new DocumentUploadError("参加費の支払い方法を選択してください。");
  }
  if (!new Set(["text", "file", "guidance"]).has(organizerPaymentSource)) {
    throw new DocumentUploadError("主催者への振込情報の形式を選択してください。");
  }
  if (organizerPaymentDetails.length > 3500) {
    throw new DocumentUploadError("主催者への振込先情報は3500文字以内にしてください。");
  }
  let feesByGrade: Record<string, number>;
  try {
    const parsed = JSON.parse(String(form.get("feesByGrade") ?? "")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    feesByGrade = Object.fromEntries(Object.entries(parsed).map(([grade, amount]) => {
      const numericAmount = Number(amount);
      if (
        !new Set(["A", "B", "C", "D", "E", "F", "beginner"]).has(grade) ||
        !Number.isInteger(numericAmount) || numericAmount < 500 || numericAmount > 3000 ||
        numericAmount % 500 !== 0
      ) throw new Error();
      return [grade, numericAmount];
    }));
    if (Object.keys(feesByGrade).length === 0) throw new Error();
  } catch {
    throw new DocumentUploadError("級別参加費を500〜3,000円の500円刻みで選択してください。");
  }
  const advancePayment = paymentCollectionMethod === "advance_manager";
  const parsedOrganizerPaymentDeadline = organizerPaymentDeadline
    ? new Date(organizerPaymentDeadline)
    : null;
  const parsedPaymentDeadline = paymentDeadline ? new Date(paymentDeadline) : null;
  if (
    advancePayment &&
    (!parsedOrganizerPaymentDeadline || Number.isNaN(parsedOrganizerPaymentDeadline.getTime()))
  ) {
    throw new DocumentUploadError("主催者への振込期限を入力してください。");
  }
  if (advancePayment && (!parsedPaymentDeadline || Number.isNaN(parsedPaymentDeadline.getTime()))) {
    throw new DocumentUploadError("サークル内支払期限を入力してください。");
  }
  if (
    advancePayment && parsedOrganizerPaymentDeadline && parsedPaymentDeadline &&
    parsedOrganizerPaymentDeadline.getTime() - parsedPaymentDeadline.getTime() < 2 * 86400000
  ) {
    throw new DocumentUploadError("サークル内支払期限は主催者への振込期限の2日以上前にしてください。");
  }
  let tournamentIds: string[];
  try {
    const parsed = JSON.parse(String(form.get("tournamentIds") ?? "")) as unknown;
    if (!Array.isArray(parsed)) throw new Error();
    tournamentIds = parsed.map(String);
  } catch {
    throw new DocumentUploadError("対象大会が不正です。");
  }
  let tournaments: EditableTournamentRow[];
  try {
    tournaments = await loadEditableTournaments(env, tournamentIds, tournamentIds.length > 1);
  } catch (error) {
    if (error instanceof AdminRequestError) throw new DocumentUploadError(error.message);
    throw error;
  }
  const groupKey = archiveGroupKey(tournaments);
  const existing = await env.DB.prepare(
    `SELECT document_url, file_name, file_size, content_type, revision,
      organizer_payment_document_url, organizer_payment_file_name,
      organizer_payment_file_size, organizer_payment_content_type
     FROM tournament_participant_guidance
     WHERE group_key = ?`,
  ).bind(groupKey).first<{
    document_url: string | null;
    file_name: string | null;
    file_size: number | null;
    content_type: string | null;
    revision: number;
    organizer_payment_document_url: string | null;
    organizer_payment_file_name: string | null;
    organizer_payment_file_size: number | null;
    organizer_payment_content_type: string | null;
  }>();

  let documentUrl = existing?.document_url ?? null;
  let fileName = existing?.file_name ?? null;
  let fileSize = existing?.file_size ?? null;
  let contentType = existing?.content_type ?? null;
  const file = form.get("file");
  if (file instanceof File && file.size > 0) {
    const extensionMatch = file.name.toLowerCase().match(/\.(pdf|doc|docx)$/);
    if (!extensionMatch) {
      throw new DocumentUploadError("案内ファイルはPDF・Word（.doc/.docx）のみ登録できます。");
    }
    const grades = tournaments.some((item) => item.all_grades === 1)
      ? ["all"]
      : tournaments.map((item) => item.grade);
    const eventDates = [...new Set(tournaments.map((item) => item.event_start_date))];
    fileName = buildGuidanceFilename(
      tournaments[0].title,
      grades,
      eventDates,
      extensionMatch[1] as "pdf" | "doc" | "docx",
    );
    const stored = await storeParticipantGuidanceDocument(
      file,
      env,
      updatedBy,
      fileName,
    );
    documentUrl = stored.url;
    fileSize = stored.size;
    contentType = stored.contentType;
  }
  if (!bodyText && !documentUrl) {
    throw new DocumentUploadError("案内本文または案内ファイルを登録してください。");
  }
  let organizerPaymentDocumentUrl = existing?.organizer_payment_document_url ?? null;
  let organizerPaymentFileName = existing?.organizer_payment_file_name ?? null;
  let organizerPaymentFileSize = existing?.organizer_payment_file_size ?? null;
  let organizerPaymentContentType = existing?.organizer_payment_content_type ?? null;
  const organizerPaymentFile = form.get("organizerPaymentFile");
  if (organizerPaymentFile instanceof File && organizerPaymentFile.size > 0) {
    const extensionMatch = organizerPaymentFile.name.toLowerCase().match(/\.(pdf|doc|docx)$/);
    if (!extensionMatch) {
      throw new DocumentUploadError("主催者振込情報はPDF・Word（.doc/.docx）のみ登録できます。");
    }
    const grades = tournaments.some((item) => item.all_grades === 1)
      ? ["all"]
      : tournaments.map((item) => item.grade);
    const eventDates = [...new Set(tournaments.map((item) => item.event_start_date))];
    organizerPaymentFileName = buildOrganizerPaymentFilename(
      tournaments[0].title,
      grades,
      eventDates,
      extensionMatch[1] as "pdf" | "doc" | "docx",
    );
    const stored = await storeParticipantGuidanceDocument(
      organizerPaymentFile,
      env,
      updatedBy,
      organizerPaymentFileName,
    );
    organizerPaymentDocumentUrl = stored.url;
    organizerPaymentFileSize = stored.size;
    organizerPaymentContentType = stored.contentType;
  }
  if (advancePayment && organizerPaymentSource === "text" && !organizerPaymentDetails) {
    throw new DocumentUploadError("主催者への振込先情報を入力してください。");
  }
  if (advancePayment && organizerPaymentSource === "file" && !organizerPaymentDocumentUrl) {
    throw new DocumentUploadError("主催者振込情報のPDFまたはWordを登録してください。");
  }
  if (advancePayment && organizerPaymentSource === "guidance" && !bodyText && !documentUrl) {
    throw new DocumentUploadError("振込情報を含む当日案内を登録してください。");
  }
  const revision = Number(existing?.revision ?? 0) + 1;
  const updatedAt = new Date().toISOString();
  const statements: D1PreparedStatement[] = [env.DB.prepare(
    `INSERT INTO tournament_participant_guidance (
      group_key, representative_tournament_id, body_text,
      document_url, file_name, file_size, content_type,
      payment_details, organizer_payment_deadline, payment_deadline,
      payment_collection_method, organizer_payment_source, organizer_payment_document_url,
      organizer_payment_file_name, organizer_payment_file_size,
      organizer_payment_content_type,
      revision, updated_by_email, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(group_key) DO UPDATE SET
      representative_tournament_id = excluded.representative_tournament_id,
      body_text = excluded.body_text,
      document_url = excluded.document_url,
      file_name = excluded.file_name,
      file_size = excluded.file_size,
      content_type = excluded.content_type,
      payment_details = excluded.payment_details,
      organizer_payment_deadline = excluded.organizer_payment_deadline,
      payment_deadline = excluded.payment_deadline,
      payment_collection_method = excluded.payment_collection_method,
      organizer_payment_source = excluded.organizer_payment_source,
      organizer_payment_document_url = excluded.organizer_payment_document_url,
      organizer_payment_file_name = excluded.organizer_payment_file_name,
      organizer_payment_file_size = excluded.organizer_payment_file_size,
      organizer_payment_content_type = excluded.organizer_payment_content_type,
      revision = excluded.revision,
      updated_by_email = excluded.updated_by_email,
      updated_at = excluded.updated_at`,
  ).bind(
    groupKey,
    tournaments[0].tournament_id,
    bodyText || null,
    documentUrl,
    fileName,
    fileSize,
    contentType,
    organizerPaymentDetails || null,
    advancePayment ? parsedOrganizerPaymentDeadline!.toISOString() : null,
    advancePayment ? parsedPaymentDeadline!.toISOString() : null,
    paymentCollectionMethod,
    organizerPaymentSource,
    organizerPaymentDocumentUrl,
    organizerPaymentFileName,
    organizerPaymentFileSize,
    organizerPaymentContentType,
    revision,
    updatedBy,
    updatedAt,
  ), env.DB.prepare(
    `DELETE FROM tournament_participation_fees WHERE group_key = ?`,
  ).bind(groupKey)];
  for (const [grade, amount] of Object.entries(feesByGrade)) {
    statements.push(env.DB.prepare(
      `INSERT INTO tournament_participation_fees (
        group_key, grade, amount_yen, updated_by_email, updated_at
      ) VALUES (?, ?, ?, ?, ?)`,
    ).bind(groupKey, grade, amount, updatedBy, updatedAt));
  }
  await env.DB.batch(statements);
  return {
    groupKey,
    bodyText: bodyText || null,
    documentUrl,
    fileName,
    fileSize,
    contentType,
    paymentCollectionMethod: paymentCollectionMethod as "advance_manager" | "onsite_cash",
    organizerPaymentSource: organizerPaymentSource as "text" | "file" | "guidance",
    organizerPaymentDetails: organizerPaymentDetails || null,
    organizerPaymentDocumentUrl,
    organizerPaymentFileName,
    feesByGrade,
    organizerPaymentDeadline: advancePayment ? parsedOrganizerPaymentDeadline!.toISOString() : null,
    paymentDeadline: advancePayment ? parsedPaymentDeadline!.toISOString() : null,
    revision,
    updatedAt,
  };
}

export async function queueParticipantGuidance(
  env: AdminEnv,
  rawTournamentIds: string[],
): Promise<GuidanceEnqueueResult> {
  const tournaments = await loadEditableTournaments(
    env,
    rawTournamentIds,
    rawTournamentIds.length > 1,
  );
  return enqueueParticipantGuidance(
    env,
    archiveGroupKey(tournaments),
    tournaments.map((tournament) => tournament.tournament_id),
  );
}

export async function queueLotteryResultsAndGuidance(
  env: AdminEnv,
  rawTournamentIds: string[],
  changedByEmail: string,
): Promise<LotteryNotificationQueueResult> {
  const tournaments = await loadEditableTournaments(
    env,
    rawTournamentIds,
    rawTournamentIds.length > 1,
  );
  const groupKey = archiveGroupKey(tournaments);
  const placeholders = tournaments.map(() => "?").join(", ");
  const entries = await env.DB.prepare(
    `SELECT tournament_entries.tournament_id, tournament_entries.member_id,
      tournament_entries.status, tournament_entries.waitlist_number,
      CASE WHEN tournaments.all_grades = 1 THEN members.grade ELSE tournaments.grade END AS fee_grade
     FROM tournament_entries
     INNER JOIN tournaments ON tournaments.tournament_id = tournament_entries.tournament_id
     INNER JOIN members ON members.member_id = tournament_entries.member_id
     WHERE tournament_entries.tournament_id IN (${placeholders})`,
  ).bind(...tournaments.map((tournament) => tournament.tournament_id)).all<{
    tournament_id: string;
    member_id: string;
    status: string;
    waitlist_number: number | null;
    fee_grade: string;
  }>();
  if (entries.results.some((entry) => entry.status === "submitted")) {
    throw new AdminRequestError("全員の出場確定・キャンセル待ち・辞退を登録してください。", 409);
  }
  if (entries.results.some((entry) => entry.status === "not_selected" && !entry.waitlist_number)) {
    throw new AdminRequestError("キャンセル待ちの全員に待ち番号を登録してください。", 409);
  }
  const selected = entries.results.filter((entry) => entry.status === "selected");
  if (selected.length === 0) {
    throw new AdminRequestError("出場確定者が登録されていません。", 409);
  }
  const roster = await env.DB.prepare(
    `SELECT document_url FROM tournament_archive_documents
     WHERE group_key = ? AND document_type = 'roster'`,
  ).bind(groupKey).first<{ document_url: string }>();
  if (!roster) throw new AdminRequestError("確定名簿を登録してください。", 409);
  const guidance = await env.DB.prepare(
    `SELECT revision, body_text, document_url, payment_details,
      payment_collection_method, organizer_payment_source, organizer_payment_document_url,
      organizer_payment_deadline, payment_deadline
     FROM tournament_participant_guidance WHERE group_key = ?`,
  ).bind(groupKey).first<{
    revision: number;
    body_text: string | null;
    document_url: string | null;
    payment_details: string | null;
    payment_collection_method: "advance_manager" | "onsite_cash";
    organizer_payment_source: "text" | "file" | "guidance";
    organizer_payment_document_url: string | null;
    organizer_payment_deadline: string | null;
    payment_deadline: string | null;
  }>();
  if (
    !guidance ||
    (!guidance.body_text && !guidance.document_url)
  ) {
    throw new AdminRequestError("当日案内を保存してください。", 409);
  }
  if (
    guidance.payment_collection_method === "advance_manager" &&
    (
      !guidance.organizer_payment_deadline ||
      !guidance.payment_deadline ||
      (guidance.organizer_payment_source === "text" && !guidance.payment_details) ||
      (guidance.organizer_payment_source === "file" && !guidance.organizer_payment_document_url)
    )
  ) {
    throw new AdminRequestError("主催者振込情報と支払期限を保存してください。", 409);
  }
  const feeRows = await env.DB.prepare(
    `SELECT grade, amount_yen FROM tournament_participation_fees WHERE group_key = ?`,
  ).bind(groupKey).all<{ grade: string; amount_yen: number }>();
  const feeGrades = new Set(feeRows.results.map((fee) => fee.grade));
  const missingFeeGrades = [...new Set(selected.map((entry) => entry.fee_grade))]
    .filter((grade) => !feeGrades.has(grade));
  if (missingFeeGrades.length > 0) {
    throw new AdminRequestError(
      `${missingFeeGrades.join("・")}級の参加費を登録してください。`,
      409,
    );
  }
  if (guidance.payment_collection_method === "advance_manager") {
    const now = new Date().toISOString();
    await env.DB.batch(selected.map((entry) => env.DB.prepare(
      `INSERT INTO tournament_entry_payments (
        tournament_id, member_id, status, updated_by_email, updated_at
      ) VALUES (?, ?, 'unpaid', ?, ?)
      ON CONFLICT(tournament_id, member_id) DO NOTHING`,
    ).bind(entry.tournament_id, entry.member_id, changedByEmail, now)));
  }
  const channelQueued = await enqueueLotteryResultAnnouncement(
    env,
    groupKey,
    tournaments[0].tournament_id,
    Number(guidance.revision),
  );
  const dms = await enqueueParticipantGuidance(
    env,
    groupKey,
    tournaments.map((tournament) => tournament.tournament_id),
  );
  return {
    channelQueued,
    dmQueued: dms.queued,
    dmUnavailable: dms.unavailable,
  };
}

export async function updateTournamentEntryPayment(
  env: AdminEnv,
  tournamentId: string,
  memberId: string,
  rawStatus: string,
  changedByEmail: string,
): Promise<EntryPaymentUpdateResult> {
  if (!/^T-[0-9a-f-]{36}$/.test(tournamentId) || !/^M-[0-9a-f-]{36}$/.test(memberId)) {
    throw new AdminRequestError("大会またはメンバーIDが不正です。", 400);
  }
  if (rawStatus !== "unpaid" && rawStatus !== "paid") {
    throw new AdminRequestError("入金状態が不正です。", 400);
  }
  const entry = await env.DB.prepare(
    `SELECT tournament_entry_payments.status AS payment_status
     FROM tournament_entries
     INNER JOIN tournaments ON tournaments.tournament_id = tournament_entries.tournament_id
     LEFT JOIN tournament_entry_payments
       ON tournament_entry_payments.tournament_id = tournament_entries.tournament_id
      AND tournament_entry_payments.member_id = tournament_entries.member_id
     WHERE tournament_entries.tournament_id = ?
       AND tournament_entries.member_id = ?
       AND tournament_entries.status = 'selected'
       AND tournaments.status NOT IN ('canceled', 'deleted')
     LIMIT 1`,
  ).bind(tournamentId, memberId).first<{ payment_status: "unpaid" | "paid" | null }>();
  if (!entry) throw new AdminRequestError("出場確定者を確認できません。", 404);
  const previousStatus = entry.payment_status ?? null;
  if ((previousStatus ?? "unpaid") === rawStatus) {
    return { tournamentId, memberId, previousStatus, status: rawStatus, changed: false };
  }
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO tournament_entry_payments (
        tournament_id, member_id, status, paid_at, updated_by_email, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(tournament_id, member_id) DO UPDATE SET
        status = excluded.status,
        paid_at = excluded.paid_at,
        updated_by_email = excluded.updated_by_email,
        updated_at = excluded.updated_at`,
    ).bind(
      tournamentId,
      memberId,
      rawStatus,
      rawStatus === "paid" ? now : null,
      changedByEmail,
      now,
    ),
    env.DB.prepare(
      `INSERT INTO tournament_entry_payment_history (
        tournament_id, member_id, previous_status, new_status,
        changed_by_email, changed_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(tournamentId, memberId, previousStatus, rawStatus, changedByEmail, now),
  ]);
  return { tournamentId, memberId, previousStatus, status: rawStatus, changed: true };
}

export async function updateTournamentEntriesBatch(
  env: AdminEnv,
  rawEntries: TournamentEntryBatchInput[],
  changedByEmail: string,
): Promise<TournamentEntryBatchUpdateResult> {
  if (!Array.isArray(rawEntries) || rawEntries.length === 0 || rawEntries.length > 200) {
    throw new AdminRequestError("保存対象は1〜200人で指定してください。", 400);
  }
  const entries = rawEntries.map((entry) => {
    if (
      !/^T-[0-9a-f-]{36}$/.test(entry.tournamentId) ||
      !/^M-[0-9a-f-]{36}$/.test(entry.memberId) ||
      !ENTRY_STATUSES.has(entry.status)
    ) {
      throw new AdminRequestError("大会・メンバー・抽選結果の指定が不正です。", 400);
    }
    const waitlistNumber = entry.status === "not_selected" ? entry.waitlistNumber : null;
    if (
      entry.status === "not_selected" &&
      (!Number.isInteger(waitlistNumber) || Number(waitlistNumber) < 1 || Number(waitlistNumber) > 9999)
    ) {
      throw new AdminRequestError("キャンセル待ち番号は1〜9999の整数で入力してください。", 400);
    }
    const paymentStatus = entry.status === "selected" ? entry.paymentStatus : null;
    if (entry.status === "selected" && paymentStatus !== "unpaid" && paymentStatus !== "paid") {
      throw new AdminRequestError("出場確定者の入金状態が不正です。", 400);
    }
    return { ...entry, waitlistNumber, paymentStatus };
  });
  const keys = entries.map((entry) => `${entry.tournamentId}:${entry.memberId}`);
  if (new Set(keys).size !== keys.length) {
    throw new AdminRequestError("同じ選手が重複して指定されています。", 400);
  }

  const requestedValues = entries.map(() => "(?, ?)").join(", ");
  const targets = await env.DB.prepare(
    `WITH requested(tournament_id, member_id) AS (VALUES ${requestedValues})
     SELECT requested.tournament_id, requested.member_id,
       tournament_entries.status AS entry_status,
       tournament_entries.waitlist_number,
       tournament_entry_payments.status AS payment_status
     FROM requested
     INNER JOIN tournaments
       ON tournaments.tournament_id = requested.tournament_id
      AND tournaments.status IN ('applied', 'closed')
     INNER JOIN responses
       ON responses.tournament_id = requested.tournament_id
      AND responses.member_id = requested.member_id
      AND responses.response = 'yes'
      AND responses.is_valid = 1
     LEFT JOIN tournament_entries
       ON tournament_entries.tournament_id = requested.tournament_id
      AND tournament_entries.member_id = requested.member_id
     LEFT JOIN tournament_entry_payments
       ON tournament_entry_payments.tournament_id = requested.tournament_id
      AND tournament_entry_payments.member_id = requested.member_id`,
  ).bind(...entries.flatMap((entry) => [entry.tournamentId, entry.memberId])).all<{
    tournament_id: string;
    member_id: string;
    entry_status: string | null;
    waitlist_number: number | null;
    payment_status: "unpaid" | "paid" | null;
  }>();
  if (targets.results.length !== entries.length) {
    throw new AdminRequestError("保存対象に無効な参加希望者が含まれています。", 409);
  }
  const targetByKey = new Map(
    targets.results.map((target) => [`${target.tournament_id}:${target.member_id}`, target]),
  );
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];
  let changedCount = 0;
  for (const entry of entries) {
    const target = targetByKey.get(`${entry.tournamentId}:${entry.memberId}`)!;
    let changed = false;
    if (
      target.entry_status !== entry.status ||
      (target.waitlist_number ?? null) !== entry.waitlistNumber
    ) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO tournament_entries (
            tournament_id, member_id, status, waitlist_number,
            created_at, updated_at, updated_by_email
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(tournament_id, member_id) DO UPDATE SET
            status = excluded.status,
            waitlist_number = excluded.waitlist_number,
            updated_at = excluded.updated_at,
            updated_by_email = excluded.updated_by_email`,
        ).bind(
          entry.tournamentId,
          entry.memberId,
          entry.status,
          entry.waitlistNumber,
          now,
          now,
          changedByEmail,
        ),
        env.DB.prepare(
          `INSERT INTO tournament_entry_history (
            tournament_id, member_id, previous_status, new_status,
            previous_waitlist_number, new_waitlist_number,
            changed_by_email, changed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          entry.tournamentId,
          entry.memberId,
          target.entry_status,
          entry.status,
          target.waitlist_number,
          entry.waitlistNumber,
          changedByEmail,
          now,
        ),
      );
      changed = true;
    }
    if (entry.status === "selected" && target.payment_status !== entry.paymentStatus) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO tournament_entry_payments (
            tournament_id, member_id, status, paid_at, updated_by_email, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(tournament_id, member_id) DO UPDATE SET
            status = excluded.status,
            paid_at = excluded.paid_at,
            updated_by_email = excluded.updated_by_email,
            updated_at = excluded.updated_at`,
        ).bind(
          entry.tournamentId,
          entry.memberId,
          entry.paymentStatus,
          entry.paymentStatus === "paid" ? now : null,
          changedByEmail,
          now,
        ),
        env.DB.prepare(
          `INSERT INTO tournament_entry_payment_history (
            tournament_id, member_id, previous_status, new_status,
            changed_by_email, changed_at
          ) VALUES (?, ?, ?, ?, ?, ?)`,
        ).bind(
          entry.tournamentId,
          entry.memberId,
          target.payment_status,
          entry.paymentStatus,
          changedByEmail,
          now,
        ),
      );
      changed = true;
    }
    if (changed) changedCount += 1;
  }
  if (statements.length > 0) await env.DB.batch(statements);
  return { entryCount: entries.length, changedCount };
}

export async function setTournamentArchivePublished(
  env: AdminEnv,
  rawTournamentIds: string[],
  published: boolean,
  changedByEmail: string,
): Promise<TournamentArchivePublishResult> {
  const tournaments = await loadEditableTournaments(
    env,
    rawTournamentIds,
    rawTournamentIds.length > 1,
  );
  const groupKey = archiveGroupKey(tournaments);
  if (published) {
    if (!tournaments.some((item) => Boolean(item.document_url))) {
      throw new AdminRequestError("大会要項を登録してから公開してください。", 409);
    }
    const documents = await env.DB.prepare(
      `SELECT document_type
       FROM tournament_archive_documents
       WHERE group_key = ?`,
    ).bind(groupKey).all<{ document_type: string }>();
    const documentTypes = new Set(documents.results.map((item) => item.document_type));
    if (!documentTypes.has("roster") || !documentTypes.has("results")) {
      throw new AdminRequestError("選手名簿と結果ファイルを登録してから公開してください。", 409);
    }
    const placeholders = tournaments.map(() => "?").join(", ");
    const summary = await env.DB.prepare(
      `SELECT
        COUNT(*) AS participant_count,
        SUM(CASE WHEN TRIM(COALESCE(result_text, '')) = '' THEN 1 ELSE 0 END) AS missing_results
       FROM tournament_entries
       WHERE tournament_id IN (${placeholders})
         AND status IN ('submitted', 'selected')`,
    ).bind(...tournaments.map((item) => item.tournament_id)).first<{
      participant_count: number;
      missing_results: number;
    }>();
    if (Number(summary?.participant_count ?? 0) === 0) {
      throw new AdminRequestError("出場者が登録されていません。", 409);
    }
    if (Number(summary?.missing_results ?? 0) > 0) {
      throw new AdminRequestError("全出場者の個人成績を登録してから公開してください。", 409);
    }
  }

  const publishedAt = published ? new Date().toISOString() : null;
  await env.DB.batch(
    tournaments.flatMap((tournament) => [
      ...(published ? [env.DB.prepare(
        `UPDATE tournament_entries
         SET
           archive_display_name = COALESCE(
             archive_display_name,
             (SELECT members.display_name FROM members
              WHERE members.member_id = tournament_entries.member_id)
           ),
           archive_display_name_kana = COALESCE(
             archive_display_name_kana,
             (SELECT members.display_name_kana FROM members
              WHERE members.member_id = tournament_entries.member_id)
           ),
           archive_grade = COALESCE(
             archive_grade,
             (SELECT CASE WHEN tournaments.all_grades = 1
                THEN members.grade ELSE tournaments.grade END
              FROM tournaments
              INNER JOIN members ON members.member_id = tournament_entries.member_id
              WHERE tournaments.tournament_id = tournament_entries.tournament_id)
           )
         WHERE tournament_id = ? AND status IN ('submitted', 'selected')`,
      ).bind(tournament.tournament_id)] : []),
      env.DB.prepare(
        `UPDATE tournaments
         SET archive_published_at = ?, archive_published_by_email = ?, updated_at = ?
         WHERE tournament_id = ? AND status <> 'deleted'`,
      ).bind(
        publishedAt,
        published ? changedByEmail : null,
        new Date().toISOString(),
        tournament.tournament_id,
      ),
    ]),
  );
  return {
    tournamentIds: tournaments.map((item) => item.tournament_id),
    published,
    publishedAt,
  };
}

export async function editTournaments(
  env: AdminEnv,
  rawTournamentIds: string[],
  rawInput: TournamentEditInput,
  changedByEmail: string,
): Promise<TournamentEditResult> {
  const tournaments = await loadEditableTournaments(
    env,
    rawTournamentIds,
    rawTournamentIds.length > 1,
  );
  const suppliedDates = rawInput.eventDatesByTournament;
  if (
    suppliedDates !== undefined &&
    (typeof suppliedDates !== "object" || suppliedDates === null || Array.isArray(suppliedDates))
  ) {
    throw new AdminRequestError("級別の開催日が不正です。", 400);
  }
  const tournamentIds = new Set(tournaments.map((tournament) => tournament.tournament_id));
  if (
    suppliedDates &&
    Object.keys(suppliedDates).some((tournamentId) => !tournamentIds.has(tournamentId))
  ) {
    throw new AdminRequestError("対象外の大会の開催日は変更できません。", 400);
  }
  const eventDatesByTournament = Object.fromEntries(
    tournaments.map((tournament) => [
      tournament.tournament_id,
      suppliedDates?.[tournament.tournament_id] ?? rawInput.eventStartDate,
    ]),
  );
  const normalized = normalizeTournamentInput({
    ...rawInput,
    eventStartDate: eventDatesByTournament[tournaments[0].tournament_id],
    eventEndDate: eventDatesByTournament[tournaments[0].tournament_id],
    grade: tournaments[0].all_grades === 1 ? "all" : tournaments[0].grade,
    createdByEmail: changedByEmail,
  });
  const editableData = {
    title: normalized.title,
    tournamentType: normalized.tournamentType,
    venue: normalized.venue || "",
    trueDeadline: normalized.trueDeadline,
    internalDeadline: normalized.internalDeadline,
    documentUrl: normalized.documentUrl || "",
  };
  const normalizedEventDates = Object.fromEntries(
    tournaments.map((tournament) => {
      const date = eventDatesByTournament[tournament.tournament_id];
      const normalizedDate = normalizeTournamentInput({
        ...normalized,
        grade: tournament.all_grades === 1 ? "all" : tournament.grade,
        eventStartDate: date,
        eventEndDate: date,
      }).eventStartDate;
      return [tournament.tournament_id, normalizedDate];
    }),
  );
  const changed = tournaments.filter((tournament) =>
    tournament.title !== editableData.title ||
    tournament.event_start_date !== normalizedEventDates[tournament.tournament_id] ||
    tournament.event_end_date !== normalizedEventDates[tournament.tournament_id] ||
    tournament.tournament_type !== editableData.tournamentType ||
    (tournament.venue ?? "") !== editableData.venue ||
    tournament.true_deadline !== editableData.trueDeadline ||
    tournament.internal_deadline !== editableData.internalDeadline ||
    (tournament.document_url ?? "") !== editableData.documentUrl
  );
  if (changed.length === 0) {
    return { tournaments, notificationsQueued: 0 };
  }

  const now = new Date().toISOString();
  await env.DB.batch(
    changed.flatMap((tournament) => {
      const eventStartDate = normalizedEventDates[tournament.tournament_id];
      const previousData = {
        title: tournament.title,
        eventStartDate: tournament.event_start_date,
        tournamentType: tournament.tournament_type,
        venue: tournament.venue ?? "",
        trueDeadline: tournament.true_deadline,
        internalDeadline: tournament.internal_deadline,
        documentUrl: tournament.document_url ?? "",
      };
      const newData = { ...editableData, eventStartDate };
      return [
        env.DB.prepare(
          `UPDATE tournaments
           SET title = ?, event_start_date = ?, event_end_date = ?,
             tournament_type = ?, is_official = ?, venue = ?,
             true_deadline = ?, internal_deadline = ?, document_url = ?,
             updated_at = ?
           WHERE tournament_id = ? AND status <> 'deleted'`,
        ).bind(
          editableData.title,
          eventStartDate,
          eventStartDate,
          editableData.tournamentType,
          editableData.tournamentType === "official" ? 1 : 0,
          editableData.venue || null,
          editableData.trueDeadline,
          editableData.internalDeadline,
          editableData.documentUrl || null,
          now,
          tournament.tournament_id,
        ),
        env.DB.prepare(
          `INSERT INTO tournament_change_history (
            tournament_id, previous_data, new_data, changed_by_email, changed_at
          ) VALUES (?, ?, ?, ?, ?)`,
        ).bind(
          tournament.tournament_id,
          JSON.stringify(previousData),
          JSON.stringify(newData),
          changedByEmail,
          now,
        ),
      ];
    }),
  );

  const updated = tournaments.map((tournament) => ({
    ...tournament,
    title: editableData.title,
    event_start_date: normalizedEventDates[tournament.tournament_id],
    event_end_date: normalizedEventDates[tournament.tournament_id],
    tournament_type: editableData.tournamentType,
    venue: editableData.venue || null,
    true_deadline: editableData.trueDeadline,
    internal_deadline: editableData.internalDeadline,
    document_url: editableData.documentUrl || null,
  }));
  const revision = await editFingerprint({ editableData, normalizedEventDates });
  let notificationsQueued = 0;
  for (const tournament of updated) {
    if (tournament.status === "active") {
      notificationsQueued += await enqueueTournamentUpdateNotifications(
        env,
        tournament,
        revision,
      );
    }
  }
  return { tournaments: updated, notificationsQueued };
}

const securityHeaders = {
  "Cache-Control": "no-store",
  "Content-Security-Policy":
    "default-src 'none'; connect-src 'self'; img-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: securityHeaders });
}

function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("Origin");
  return origin === new URL(request.url).origin;
}

type AdminPage = "register" | "tournaments" | "members";

function adminHtml(page: AdminPage): string {
  const pageTitle = {
    register: "大会登録",
    tournaments: "大会一覧・回答集計",
    members: "メンバー管理",
  }[page];
  const tabClass = (tab: AdminPage): string =>
    tab === page ? "tab active" : "tab";
  const currentPage = (tab: AdminPage): string =>
    tab === page ? ' aria-current="page"' : "";
  const hiddenPage = (tab: AdminPage): string =>
    tab === page ? "" : " hidden";

  return String.raw`<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${pageTitle} | 埼玉大学かるた会</title>
  <style>
    :root { color-scheme: light; font-family: system-ui, -apple-system, "Hiragino Sans", "Yu Gothic UI", sans-serif; color: #172033; background: #f4f6fa; }
    * { box-sizing: border-box; }
    body { margin: 0; }
    header { background: #293c74; color: white; padding: 18px 24px; box-shadow: 0 2px 8px #17203322; }
    .header-inner { max-width: 1080px; margin: auto; display: flex; align-items: baseline; justify-content: space-between; gap: 16px; }
    h1 { margin: 0; font-size: 1.25rem; }
    h2 { margin: 0 0 20px; font-size: 1.15rem; }
    h3 { margin: 0; font-size: 1.05rem; }
    .identity-wrap { display: inline-flex; align-items: center; gap: 10px; font-size: .82rem; }
    #identity { opacity: .85; }
    #logout { color: white; text-underline-offset: 3px; }
    .tab-bar { background: white; border-bottom: 1px solid #dce1eb; box-shadow: 0 2px 8px #1720330a; }
    .tabs { max-width: 1080px; margin: auto; padding: 0 18px; display: flex; gap: 4px; overflow-x: auto; }
    .tab { position: relative; display: inline-flex; align-items: center; color: #596579; text-decoration: none; font-weight: 700; white-space: nowrap; padding: 15px 18px 12px; border-bottom: 3px solid transparent; }
    .tab:hover { color: #294796; background: #f6f8ff; }
    .tab.active { color: #294796; border-bottom-color: #3658b2; }
    .request-badge { position: absolute; top: 2px; right: 1px; min-width: 20px; height: 20px; padding: 0 5px; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center; color: white; background: #d92d20; box-shadow: 0 0 0 2px white; font-size: .72rem; font-weight: 800; line-height: 1; }
    main { max-width: 1080px; margin: 24px auto; padding: 0 18px 48px; }
    .notice { border-left: 4px solid #da8c10; background: #fff7e8; padding: 12px 16px; margin-bottom: 18px; line-height: 1.7; }
    .panel { background: white; border: 1px solid #dce1eb; border-radius: 12px; padding: 24px; box-shadow: 0 8px 24px #1720330c; }
    .panel + .panel { margin-top: 26px; }
    [hidden] { display: none !important; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
    .grid > label, .grid > fieldset, .grade-date-grid > label { width: 100%; min-width: 0; }
    label { display: grid; gap: 7px; font-weight: 650; font-size: .9rem; }
    .wide { grid-column: 1 / -1; }
    .optional { color: #697386; font-size: .78rem; font-weight: 500; }
    input, select, textarea { width: 100%; min-width: 0; max-width: 100%; border: 1px solid #b9c1d0; border-radius: 8px; padding: 11px 12px; font: inherit; color: inherit; background: white; }
    input:focus, select:focus, textarea:focus { outline: 3px solid #7c9cff3b; border-color: #526fc4; }
    .grade-picker { min-width: 0; margin: 0; padding: 0; border: 0; }
    .grade-picker legend { margin-bottom: 7px; padding: 0; font-size: .9rem; font-weight: 650; }
    .grade-options { display: flex; flex-wrap: wrap; gap: 8px; padding: 9px; border: 1px solid #b9c1d0; border-radius: 8px; background: #fff; }
    .grade-option { display: inline-flex; grid-template-columns: none; align-items: center; gap: 6px; padding: 3px 7px; border-radius: 6px; font-weight: 600; white-space: nowrap; }
    .grade-option:has(input:checked) { color: #294796; background: #edf1ff; }
    .grade-option input { width: auto; margin: 0; }
    .grade-date-settings { grid-column: 1 / -1; padding: 14px; border-radius: 9px; background: #f5f7fb; }
    .grade-date-settings > strong { display: block; margin-bottom: 10px; font-size: .9rem; }
    .grade-date-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .file-note { color: #697386; font-size: .78rem; font-weight: 500; }
    .application-method { min-width: 0; margin: 0; padding: 14px; border: 1px solid #d7dfef; border-radius: 9px; background: #f8faff; }
    .application-method legend { padding: 0 5px; font-size: .9rem; font-weight: 750; }
    .application-method-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 12px; }
    .application-method-fields > .wide { grid-column: 1 / -1; }
    .actions { margin-top: 24px; display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
    button { border: 0; border-radius: 8px; padding: 12px 20px; background: #3658b2; color: white; font: inherit; font-weight: 700; cursor: pointer; }
    button:hover { background: #294796; }
    button:disabled { opacity: .55; cursor: wait; }
    button.secondary { padding: 9px 14px; color: #294796; background: #edf1ff; }
    button.secondary:hover { background: #dfe6ff; }
    #result { min-height: 1.5em; font-weight: 650; }
    #result.ok { color: #17643a; }
    #result.error { color: #b42318; }
    .footnote { margin-top: 16px; color: #697386; font-size: .84rem; line-height: 1.6; }
    .list-heading, .card-heading, .status-row { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
    .list-controls { display: flex; align-items: end; gap: 12px; margin: 4px 0 14px; padding: 12px; border-radius: 9px; background: #f5f7fb; flex-wrap: wrap; }
    .list-controls label { min-width: 190px; }
    .list-controls select { padding: 9px 10px; }
    #list-status { color: #697386; margin-bottom: 12px; }
    #tournament-list { display: grid; gap: 14px; }
    .tournament-card { border: 1px solid #dce1eb; border-radius: 10px; padding: 18px; }
    .card-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 10px 0 4px; }
    .card-status-select { width: auto; min-width: 145px; padding: 8px 10px; }
    button.success { padding: 9px 14px; background: #18794e; }
    button.success:hover { background: #12633f; }
    .meta { color: #596579; margin: 8px 0 14px; font-size: .88rem; line-height: 1.6; }
    .application-summary { display: flex; align-items: center; gap: 8px 12px; flex-wrap: wrap; margin: -4px 0 12px; padding: 9px 11px; border-radius: 8px; color: #465166; background: #f5f7fb; font-size: .8rem; }
    .application-summary strong { color: #263550; }
    .application-summary a { color: #294796; font-weight: 700; }
    .badge { display: inline-flex; align-items: center; border-radius: 999px; padding: 5px 10px; font-size: .78rem; font-weight: 750; white-space: nowrap; }
    .badge.active { color: #17643a; background: #e4f7ec; }
    .badge.applied { color: #2452a4; background: #e7efff; }
    .badge.closed { color: #596579; background: #edf0f5; }
    .badge.no_participants { color: #6f4b12; background: #fff1d6; }
    .badge.canceled { color: #a12822; background: #fdecea; }
    .badge.draft { color: #875c12; background: #fff2d8; }
    .response-sections { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin: 14px 0; }
    .response-section { min-width: 0; border-radius: 8px; padding: 11px 12px; background: #f5f7fb; }
    .response-section h4 { margin: 0 0 7px; font-size: .88rem; }
    .response-person { display: grid; grid-template-columns: 3.5em minmax(0, 1fr); gap: 7px; color: #465166; font-size: .84rem; line-height: 1.65; }
    .response-grade { color: #294796; font-weight: 750; }
    .response-empty { color: #8992a3; font-size: .84rem; }
    .status-row { margin-top: 15px; padding-top: 14px; border-top: 1px solid #e7eaf0; justify-content: flex-start; flex-wrap: wrap; }
    .status-row label { display: flex; align-items: center; gap: 9px; }
    .status-row select { width: auto; min-width: 145px; padding: 8px 10px; }
    .status-message { font-size: .84rem; font-weight: 650; }
    .status-message.error { color: #b42318; }
    .notification-note { color: #697386; font-size: .78rem; margin-top: 10px; }
    .entry-management { margin: 15px 0; border: 1px solid #dce1eb; border-radius: 9px; background: #fbfcff; }
    .entry-management > summary { cursor: pointer; padding: 13px 14px; font-size: .9rem; font-weight: 800; color: #263550; user-select: none; }
    .entry-management > summary:hover { background: #f3f6fc; border-radius: 9px; }
    .entry-management[open] > summary { border-bottom: 1px solid #e7eaf0; border-radius: 9px 9px 0 0; }
    .entry-management-body { padding: 0 14px 14px; }
    .entry-row { display: grid; grid-template-columns: minmax(230px, 1.35fr) minmax(190px, .85fr) minmax(90px, .42fr) minmax(130px, .58fr) minmax(140px, .55fr); column-gap: 12px; row-gap: 4px; align-items: end; padding: 7px 0; border-top: 1px solid #e7eaf0; }
    .entry-name { align-self: center; line-height: 1.35; font-weight: 700; }
    .entry-field { display: grid; gap: 2px; min-width: 0; }
    .entry-field-label { color: #697386; font-size: .68rem; line-height: 1.2; font-weight: 700; }
    .entry-status-field { grid-column: 2; }
    .waitlist-field { grid-column: 3; }
    .payment-field { grid-column: 4; }
    .waitlist-control { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 5px; }
    .waitlist-suffix { color: #596579; font-size: .84rem; font-weight: 700; }
    .entry-row select, .entry-row input { padding: 6px 9px; }
    .entry-row button { padding: 7px 12px; white-space: nowrap; }
    .entry-result { grid-column: 1 / -1; color: #596579; font-size: .75rem; line-height: 1.25; }
    .entry-result:empty { display: none; }
    .entry-bulk-actions { display: flex; justify-content: flex-end; align-items: center; gap: 10px; flex-wrap: wrap; padding: 12px 0 0; border-top: 1px solid #e7eaf0; }
    .entry-bulk-actions .entry-result { flex: 1 1 220px; }
    .stage-box { display: grid; gap: 9px; margin: 12px 0; padding: 12px; border: 1px solid #d7dfef; border-radius: 9px; background: white; }
    .stage-box h5 { margin: 0; font-size: .9rem; }
    .stage-actions { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
    .result-list { display: grid; }
    .result-row { display: grid; grid-template-columns: minmax(230px, 1fr) minmax(190px, .72fr) auto; gap: 9px; align-items: center; padding: 5px 0; border-top: 1px solid #e7eaf0; }
    .result-row:first-child { border-top: 0; }
    .result-row select { padding-block: 7px; }
    .result-row button { padding: 7px 12px; white-space: nowrap; }
    .result-row .entry-result { grid-column: 1 / -1; }
    .guidance-fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; align-items: start; }
    .guidance-subsection { display: grid; gap: 9px; padding: 11px; border: 1px solid #dce1eb; border-radius: 8px; background: #fbfcff; }
    .guidance-subsection h6 { margin: 0; font-size: .86rem; }
    .guidance-guide-grid { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(260px, .65fr); gap: 10px; align-items: start; }
    .guidance-file-box { display: grid; gap: 7px; padding: 9px; border-radius: 7px; background: #f5f7fb; }
    .payment-setup-grid { display: grid; grid-template-columns: minmax(280px, .8fr) minmax(0, 1.2fr); gap: 10px; align-items: start; }
    .fee-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 8px; padding: 10px; border-radius: 8px; background: #f5f7fb; }
    .fee-grid h6 { grid-column: 1 / -1; margin: 0; font-size: .84rem; }
    .fee-grid select { padding-block: 8px; }
    .organizer-payment-box { display: grid; gap: 9px; padding: 10px; border-radius: 8px; border: 1px solid #dce1eb; background: #fbfcff; }
    .organizer-payment-box h6 { margin: 0; font-size: .84rem; }
    .organizer-payment-selector { max-width: 520px; }
    .organizer-payment-branch { display: grid; gap: 8px; }
    .organizer-payment-note { color: #596579; font-size: .8rem; line-height: 1.5; }
    .archive-management { margin: 15px 0; border: 1px solid #cad5eb; border-radius: 9px; background: #f7f9ff; }
    .archive-management > summary { cursor: pointer; padding: 13px 14px; font-size: .9rem; font-weight: 800; color: #263550; user-select: none; }
    .archive-management > summary:hover { background: #eef3ff; border-radius: 9px; }
    .archive-management[open] > summary { border-bottom: 1px solid #dce1eb; border-radius: 9px 9px 0 0; }
    .archive-management-body { padding: 14px; }
    .archive-note { margin: 0 0 12px; color: #596579; font-size: .82rem; line-height: 1.55; }
    .guidance-management { display: grid; gap: 9px; padding: 12px; margin-bottom: 14px; border: 1px solid #d7dfef; border-radius: 9px; background: #fff; }
    .guidance-management h5 { margin: 0; font-size: .9rem; }
    .guidance-management textarea { height: 72px; min-height: 72px; resize: vertical; line-height: 1.45; }
    .guidance-fields input[type="datetime-local"] { min-height: 42px; padding-block: 8px; }
    .deadline-control { display: grid; grid-template-columns: minmax(0, 1fr) 112px; gap: 8px; }
    .deadline-control input { min-width: 0; }
    .guidance-actions { display: flex; align-items: center; gap: 9px; flex-wrap: wrap; }
    .guidance-current { color: #596579; font-size: .8rem; }
    .guidance-current a { color: #294796; font-weight: 700; }
    .archive-documents { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .archive-document { display: grid; gap: 7px; padding: 11px; border-radius: 8px; background: white; border: 1px solid #dce1eb; }
    .archive-document strong { font-size: .86rem; }
    .archive-document a { color: #294796; font-size: .82rem; font-weight: 700; }
    .archive-document button { justify-self: start; }
    .archive-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 12px; }
    .result-archive-body { padding-block: 10px; }
    .result-archive-body > .archive-note { margin-bottom: 7px; }
    .result-document-upload { grid-template-columns: minmax(190px, auto) minmax(0, 1fr) auto; align-items: center; gap: 7px 10px; padding: 8px 10px; }
    .result-document-upload > input[type="file"] { grid-column: 1 / 3; }
    .result-document-upload > button { grid-column: 3; grid-row: 2; }
    .result-document-upload > .entry-result { grid-column: 1 / -1; }
    .result-stage { margin: 8px 0; padding: 9px 11px; gap: 5px; }
    .result-stage > .archive-note { margin-bottom: 2px; }
    .result-archive-body .archive-actions { margin-top: 8px; }
    #member-status { color: #697386; margin-bottom: 12px; }
    #member-list.has-members { overflow: hidden; border: 1px solid #dce1eb; border-radius: 10px; }
    .member-table-header, .member-summary-grid { display: grid; grid-template-columns: minmax(125px, 1.15fr) minmax(150px, 1.35fr) minmax(68px, .55fr) minmax(68px, .55fr) minmax(72px, .6fr) minmax(82px, .65fr) minmax(105px, .8fr); gap: 12px; align-items: center; }
    .member-table-header { padding: 10px 14px; color: #697386; background: #f5f7fb; border-bottom: 1px solid #dce1eb; font-size: .76rem; font-weight: 750; }
    .member-card { border-bottom: 1px solid #e7eaf0; }
    .member-card:last-child { border-bottom: 0; }
    .member-summary-grid { min-height: 58px; padding: 10px 14px; }
    .member-summary-item { min-width: 0; color: #172033; font-size: .88rem; font-weight: 700; overflow-wrap: anywhere; }
    .member-row-actions { min-width: 0; display: grid; justify-items: start; gap: 4px; }
    .member-row-actions button { padding: 7px 11px; }
    .member-editor { padding: 14px; background: #fafbfe; }
    .member-grid { display: grid; grid-template-columns: minmax(145px, 1.3fr) minmax(145px, 1.3fr) minmax(90px, .65fr) minmax(90px, .65fr) minmax(115px, .8fr) auto; gap: 12px; align-items: end; }
    .member-grid .checkbox { display: flex; align-items: center; gap: 8px; min-height: 42px; }
    .member-grid .checkbox input { width: auto; }
    .member-actions { display: flex; align-items: center; gap: 12px; margin-top: 12px; flex-wrap: wrap; }
    .member-link { color: #596579; font-size: .8rem; }
    #request-status { color: #697386; margin-bottom: 12px; }
    #request-list { display: grid; gap: 12px; }
    .request-card { border: 1px solid #dce1eb; border-radius: 10px; padding: 16px; }
    .request-card.update { border-left: 4px solid #3658b2; }
    .request-card.new { border-left: 4px solid #23905a; }
    .request-title { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .request-comparison { display: grid; grid-template-columns: 1fr auto 1fr; gap: 12px; align-items: center; margin-top: 14px; }
    .request-value { background: #f5f7fb; border-radius: 8px; padding: 12px; line-height: 1.6; }
    .request-value strong { display: block; font-size: .78rem; color: #697386; }
    .request-arrow { color: #697386; font-weight: 800; }
    .request-note { color: #596579; font-size: .82rem; margin-top: 10px; }
    button.danger { color: #a12822; background: #fdecea; }
    button.danger:hover { background: #f9d9d5; }
    .empty { color: #697386; text-align: center; padding: 30px 10px; }
    dialog { width: min(680px, calc(100vw - 32px)); max-height: calc(100vh - 40px); overflow: auto; border: 0; border-radius: 14px; padding: 0; box-shadow: 0 22px 70px #17203355; }
    dialog::backdrop { background: #17203388; }
    .dialog-form { padding: 24px; }
    .dialog-form h2 { margin-bottom: 8px; }
    .dialog-note { margin: 0 0 18px; color: #697386; font-size: .84rem; }
    .dialog-actions { display: flex; align-items: center; justify-content: flex-end; gap: 10px; margin-top: 22px; flex-wrap: wrap; }
    .dialog-actions .status-message { margin-right: auto; }
    @media (max-width: 680px) {
      .grid, .grade-date-grid, .application-method-fields, .response-sections, .member-grid, .request-comparison, .entry-row, .archive-documents, .guidance-fields, .guidance-guide-grid, .payment-setup-grid, .result-row { grid-template-columns: minmax(0, 1fr); }
      #member-list.has-members { overflow: visible; border: 0; border-radius: 0; display: grid; gap: 10px; }
      .member-table-header { display: none; }
      .member-card, .member-card:last-child { overflow: hidden; border: 1px solid #dce1eb; border-radius: 9px; }
      .member-summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); min-height: 0; padding: 12px; }
      .member-summary-item::before { content: attr(data-label); display: block; margin-bottom: 3px; color: #697386; font-size: .7rem; font-weight: 650; }
      .member-summary-item:nth-child(-n + 2) { grid-column: 1 / -1; }
      .member-row-actions { grid-column: 1 / -1; display: flex; align-items: center; gap: 10px; }
      .entry-status-field, .waitlist-field, .payment-field { grid-column: auto; }
      .entry-bulk-actions { justify-content: stretch; }
      .entry-bulk-actions button { width: 100%; }
      .result-document-upload { grid-template-columns: minmax(0, 1fr); }
      .result-document-upload > input[type="file"], .result-document-upload > button { grid-column: auto; grid-row: auto; }
      input[type="date"], input[type="datetime-local"] {
        display: block;
        inline-size: 100%;
        min-inline-size: 0;
        max-inline-size: 100%;
        overflow: hidden;
        -webkit-appearance: none;
        appearance: none;
        font-size: 16px;
      }
      input[type="date"]::-webkit-date-and-time-value,
      input[type="datetime-local"]::-webkit-date-and-time-value,
      input[type="date"]::-webkit-datetime-edit,
      input[type="datetime-local"]::-webkit-datetime-edit {
        min-inline-size: 0;
        text-align: left;
      }
      .request-arrow { transform: rotate(90deg); text-align: center; }
      .wide, .grade-date-settings { grid-column: auto; }
      .panel { padding: 18px; }
      .header-inner { display: block; }
      .identity-wrap { margin-top: 6px; }
      .tabs { padding: 0 8px; }
      .tab { padding-inline: 13px; }
      .card-heading { align-items: flex-start; }
      .list-controls { align-items: stretch; }
      .list-controls label { flex: 1 1 100%; }
    }
  </style>
</head>
<body data-page="${page}">
  <header><div class="header-inner"><h1>大会管理（Discord版MVP）</h1><span class="identity-wrap"><span id="identity">認証情報を確認中…</span><a id="logout" href="/auth/logout" hidden>ログアウト</a></span></div></header>
  <div class="tab-bar">
    <nav class="tabs" aria-label="管理画面メニュー">
      <a class="${tabClass("register")}" href="/register"${currentPage("register")}>大会登録</a>
      <a class="${tabClass("tournaments")}" href="/tournaments"${currentPage("tournaments")}>大会一覧</a>
      <a class="${tabClass("members")}" href="/members"${currentPage("members")}>メンバー管理<span id="pending-request-badge" class="request-badge" role="status" aria-live="polite" hidden>0</span></a>
    </nav>
  </div>
  <main>
    <div class="notice"${hiddenPage("register")}><strong>テスト運用中です。</strong> 登録後1分以内を目安に告知チャンネルへ投稿し、該当級の登録済みメンバー全員へのDMをキューに登録します。送信失敗時は最大5回まで自動再送します。</div>
    <form id="tournament-form" class="panel"${hiddenPage("register")}>
      <h2>大会登録</h2>
      <div class="grid">
        <label class="wide">大会名<input name="title" required maxlength="100" autocomplete="off"></label>
        <fieldset class="grade-picker wide"><legend>開催級 <span class="optional">複数選択可</span></legend><div class="grade-options"><label class="grade-option"><input type="checkbox" name="grades" value="all">すべて</label><label class="grade-option"><input type="checkbox" name="grades" value="A">A級</label><label class="grade-option"><input type="checkbox" name="grades" value="B">B級</label><label class="grade-option"><input type="checkbox" name="grades" value="C">C級</label><label class="grade-option"><input type="checkbox" name="grades" value="D">D級</label><label class="grade-option"><input type="checkbox" name="grades" value="E">E級</label><label class="grade-option"><input type="checkbox" name="grades" value="F">F級</label><label class="grade-option"><input type="checkbox" name="grades" value="beginner">初心者</label></div></fieldset>
        <label>開催日<input type="date" name="eventDate" required></label>
        <label>大会種別<select name="tournamentType" required><option value="official">公認大会</option><option value="support">後援大会</option><option value="event">その他イベント</option></select></label>
        <div id="grade-date-settings" class="grade-date-settings" hidden><strong>級ごとの開催日 <span class="optional">同じ大会で日程が異なる級だけ変更してください</span></strong><div id="grade-date-grid" class="grade-date-grid"></div></div>
        <label>主催締切日<input type="datetime-local" name="trueDeadline" required></label>
        <label><span>サークル内締切日 <span class="optional">（基本的に主催締切日の3日前を自動入力）</span></span><input type="datetime-local" name="internalDeadline" required></label>
        <fieldset class="application-method wide">
          <legend>申込方法</legend>
          <label>主催者への申込方法<select name="applicationMethod" required><option value="">選択してください</option><option value="excel_email">Excel名簿に選手名を記入してメール送信</option><option value="excel_form">Excel名簿に選手名を記入してフォームで送信</option><option value="direct_form">フォームに選手名を直接入力して送信</option></select></label>
          <div id="application-roster-fields" class="application-method-fields" hidden>
            <label class="wide">申込名簿Excel <span class="file-note">Excel形式、20MBまで。登録時にR2へ保存します</span><input type="file" name="applicationRosterFile" accept="application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.xls,.xlsx"></label>
            <label>保存ファイル名<select name="applicationRosterFilenameMode"><option value="automatic">標準名を自動生成</option><option value="custom">主催者指定のファイル名を使用</option></select></label>
            <label id="application-roster-custom-name" hidden>指定ファイル名 <span class="file-note">拡張子は省略可能</span><input name="applicationRosterCustomFileName" maxlength="240" autocomplete="off" placeholder="主催者指定のファイル名"></label>
            <div class="wide file-note">標準名：大会名_級_申込名簿_埼玉大学かるた会.xls / .xlsx</div>
          </div>
          <div id="application-form-url-field" class="application-method-fields" hidden>
            <label class="wide">申込フォームURL<input type="url" name="applicationFormUrl" maxlength="500" placeholder="https://..."></label>
          </div>
          <div id="application-email-field" class="application-method-fields" hidden>
            <label class="wide">申込先メールアドレス<input type="email" name="applicationEmail" maxlength="320" autocomplete="email" placeholder="entry@example.com"></label>
          </div>
        </fieldset>
        <label class="wide">大会要項PDF <span class="file-note">任意・PDF形式、20MBまで。開催月・大会名・級に自動でリネームします</span><input type="file" name="documentFile" accept="application/pdf,.pdf"></label>
      </div>
      <div class="actions"><button id="submit" type="submit">登録して通知を開始</button><span id="result" role="status" aria-live="polite"></span></div>
      <div class="footnote">複数級を選ぶと、共通の申込フロー・締切を持つ同一大会として登録します。級ごとに開催日を変えることもできます。「すべて」は1件の大会として登録し、全級のメンバーへDMを送ります。</div>
    </form>
    <section class="panel" aria-labelledby="tournament-list-title"${hiddenPage("tournaments")}>
      <div class="list-heading">
        <h2 id="tournament-list-title">大会一覧・回答集計</h2>
        <button id="refresh-list" type="button" class="secondary">再読み込み</button>
      </div>
      <div class="list-controls">
        <label>並び順<select id="tournament-sort"><option value="deadline_asc">締切日が近い順</option><option value="event_asc">開催日が近い順</option><option value="created_desc">登録日が新しい順</option><option value="created_asc">登録日が古い順</option></select></label>
        <label>ステータス<select id="tournament-status-filter"><option value="default" selected>通常表示（中止・参加者なしを除く）</option><option value="all">すべて</option><option value="active">回答受付中</option><option value="applied">申込完了</option><option value="no_participants">参加者なし終了</option><option value="closed">締切済み</option><option value="canceled">中止</option><option value="draft">下書き</option></select></label>
      </div>
      <div id="list-status" role="status" aria-live="polite">読み込み中…</div>
      <div id="tournament-list"></div>
    </section>
    <section class="panel" aria-labelledby="request-list-title"${hiddenPage("members")}>
      <h2 id="request-list-title">登録・変更申請</h2>
      <div id="request-status" role="status" aria-live="polite">読み込み中…</div>
      <div id="request-list"></div>
    </section>
    <section class="panel" aria-labelledby="member-list-title"${hiddenPage("members")}>
      <div class="list-heading">
        <h2 id="member-list-title">メンバー管理</h2>
        <button id="refresh-members" type="button" class="secondary">再読み込み</button>
      </div>
      <div id="member-status" role="status" aria-live="polite">読み込み中…</div>
      <div id="member-list"></div>
      <div class="footnote">Discord IDそのものは管理画面に表示しません。氏名・よみがな・出場級・段位・在籍状態・DM送信設定の変更履歴は管理者メールとともに保存されます。</div>
    </section>
  </main>
  <dialog id="edit-tournament-dialog">
    <form id="edit-tournament-form" class="dialog-form">
      <h2>大会情報を編集</h2>
      <p id="edit-tournament-grade" class="dialog-note"></p>
      <div class="grid">
        <label class="wide">大会名<input name="title" required maxlength="100" autocomplete="off"></label>
        <div id="edit-event-dates" class="grade-date-settings wide"><strong>開催日</strong><div id="edit-event-date-grid" class="grade-date-grid"></div></div>
        <label>大会種別<select name="tournamentType" required><option value="official">公認大会</option><option value="support">後援大会</option><option value="event">その他イベント</option></select></label>
        <label>主催締切日<input type="datetime-local" name="trueDeadline" required></label>
        <label>サークル内締切日<input type="datetime-local" name="internalDeadline" required></label>
        <label class="wide">会場 <span class="optional">任意</span><input name="venue" maxlength="200" autocomplete="off"></label>
        <label class="wide">大会要項PDF <span class="file-note">新しいPDFを選ぶと現在の要項を差し替えます</span><input type="file" name="documentFile" accept="application/pdf,.pdf"></label>
        <label class="wide">大会要項URL <span class="optional">現在のリンク。空欄にすると要項なし</span><input type="url" name="documentUrl" maxlength="500" placeholder="https://..."></label>
      </div>
      <div class="dialog-actions"><span id="edit-tournament-result" class="status-message" role="status" aria-live="polite"></span><button id="cancel-tournament-edit" type="button" class="secondary">キャンセル</button><button id="save-tournament-edit" type="submit">変更を保存</button></div>
    </form>
  </dialog>
  <script>
    const currentPage = document.body.dataset.page;
    const form = document.querySelector('#tournament-form');
    const submit = document.querySelector('#submit');
    const result = document.querySelector('#result');
    const identity = document.querySelector('#identity');
    const tournamentList = document.querySelector('#tournament-list');
    const listStatus = document.querySelector('#list-status');
    const refreshList = document.querySelector('#refresh-list');
    const tournamentSort = document.querySelector('#tournament-sort');
    const tournamentStatusFilter = document.querySelector('#tournament-status-filter');
    const editTournamentDialog = document.querySelector('#edit-tournament-dialog');
    const editTournamentForm = document.querySelector('#edit-tournament-form');
    const editTournamentGrade = document.querySelector('#edit-tournament-grade');
    const editEventDateGrid = document.querySelector('#edit-event-date-grid');
    const editTournamentResult = document.querySelector('#edit-tournament-result');
    const saveTournamentEdit = document.querySelector('#save-tournament-edit');
    const cancelTournamentEdit = document.querySelector('#cancel-tournament-edit');
    const memberList = document.querySelector('#member-list');
    const memberStatus = document.querySelector('#member-status');
    const refreshMembers = document.querySelector('#refresh-members');
    const requestList = document.querySelector('#request-list');
    const requestStatus = document.querySelector('#request-status');
    const pendingRequestBadge = document.querySelector('#pending-request-badge');
    const gradeDateSettings = document.querySelector('#grade-date-settings');
    const gradeDateGrid = document.querySelector('#grade-date-grid');
    const applicationRosterFields = document.querySelector('#application-roster-fields');
    const applicationFormUrlField = document.querySelector('#application-form-url-field');
    const applicationEmailField = document.querySelector('#application-email-field');
    const applicationRosterCustomName = document.querySelector('#application-roster-custom-name');
    const statusLabels = {
      draft: '下書き',
      active: '回答受付中',
      applied: '申込完了',
      closed: '締切済み',
      canceled: '中止',
      no_participants: '参加者なし終了',
    };
    const entryStatusLabels = {
      submitted: '申込済み（結果待ち）',
      selected: '出場確定',
      not_selected: 'キャンセル待ち',
      withdrawn: '辞退',
    };
    const responseLabels = {
      yes: '参加希望',
      maybe: '未定',
      no: '不参加',
      pending: '未回答',
    };
    let loadedTournaments = [];
    let editingTournaments = [];
    const memberStatusLabels = {
      active: '有効',
      inactive: '無効',
      pending: '確認待ち',
      rejected: '却下',
    };

    function element(tag, className, text) {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    }

    function setPendingRequestBadge(count) {
      const normalized = Number.isFinite(Number(count)) ? Math.max(0, Number(count)) : 0;
      pendingRequestBadge.hidden = normalized === 0;
      pendingRequestBadge.textContent = normalized > 99 ? '99+' : String(normalized);
      pendingRequestBadge.setAttribute('aria-label', '未処理の登録申請 ' + normalized + '件');
    }

    async function loadPendingRequestCount() {
      try {
        const response = await fetch('/api/member-requests/count');
        const body = await response.json();
        if (!response.ok) throw new Error();
        setPendingRequestBadge(body.count);
      } catch {
        // 一時的な取得失敗時は直前の表示を維持する。
      }
    }

    function gradeLabel(grade) {
      return grade === 'beginner' ? '初心者' : grade + '級';
    }

    function tournamentGradeLabel(tournament) {
      return tournament.all_grades === 1 ? 'すべて' : gradeLabel(tournament.grade);
    }

    function tournamentDisplayStatus(tournament) {
      return tournament.status === 'closed' && tournament.closure_reason === 'no_participants'
        ? 'no_participants'
        : tournament.status;
    }

    function selectedRegistrationGrades() {
      if (allGradesCheckbox?.checked) return ['all'];
      return individualGradeCheckboxes.filter((checkbox) => checkbox.checked).map((checkbox) => checkbox.value);
    }

    function refreshRegistrationGradeDates(previousCommonDate) {
      const grades = selectedRegistrationGrades();
      const currentValues = new Map(Array.from(gradeDateGrid.querySelectorAll('input[data-grade]')).map((input) => [input.dataset.grade, input.value]));
      gradeDateGrid.replaceChildren();
      gradeDateSettings.hidden = grades.length < 2 || grades.includes('all');
      if (gradeDateSettings.hidden) return;
      grades.forEach((grade) => {
        const label = element('label', '', gradeLabel(grade) + 'の開催日');
        const input = document.createElement('input');
        input.type = 'date';
        input.required = true;
        input.dataset.grade = grade;
        const existing = currentValues.get(grade);
        input.value = existing && existing !== previousCommonDate ? existing : form.elements.eventDate.value;
        label.append(input);
        gradeDateGrid.append(label);
      });
    }

    function registrationEventDatesByGrade(grades) {
      return Object.fromEntries(grades.map((grade) => {
        const input = gradeDateGrid.querySelector('input[data-grade="' + grade + '"]');
        return [grade, input?.value || form.elements.eventDate.value];
      }));
    }

    async function uploadPdf(file, title, grades, eventDates) {
      if (!file || file.size === 0) return '';
      const upload = new FormData();
      upload.append('file', file);
      upload.append('title', title);
      upload.append('grades', JSON.stringify(grades));
      upload.append('eventDates', JSON.stringify(eventDates));
      const response = await fetch('/api/documents', { method: 'POST', body: upload });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'PDFをアップロードできませんでした。');
      return body.url;
    }

    async function uploadRegistrationRoster(file, title, grades, customFileName) {
      const upload = new FormData();
      upload.append('file', file);
      upload.append('title', title);
      upload.append('grades', JSON.stringify(grades));
      if (customFileName) upload.append('customFileName', customFileName);
      const response = await fetch('/api/application-roster', { method: 'POST', body: upload });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || '申込名簿をアップロードできませんでした。');
      return body.document;
    }

    function rankLabel(rank) {
      return ['無段', '初段', '二段', '三段', '四段', '五段', '六段', '七段', '八段', '九段', '十段'][Number(rank)] || '段位不明';
    }

    function dateTimeLabel(value) {
      return new Intl.DateTimeFormat('ja-JP', {
        timeZone: 'Asia/Tokyo',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit',
      }).format(new Date(value));
    }

    function dateTimeInputValue(value) {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
      }).formatToParts(new Date(value));
      const get = (type) => parts.find((part) => part.type === type).value;
      return get('year') + '-' + get('month') + '-' + get('day') + 'T' + get('hour') + ':' + get('minute');
    }

    function defaultPaymentDeadlineInput(organizerDeadline) {
      const organizer = new Date(organizerDeadline);
      const jst = new Date(organizer.getTime() + 9 * 60 * 60 * 1000);
      const candidate = new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate() - 2));
      while (candidate.getUTCDay() === 0 || candidate.getUTCDay() === 6) {
        candidate.setUTCDate(candidate.getUTCDate() - 1);
      }
      const pad = (value) => String(value).padStart(2, '0');
      return candidate.getUTCFullYear() + '-' + pad(candidate.getUTCMonth() + 1) + '-' + pad(candidate.getUTCDate()) + 'T23:59';
    }

    const gradeOrder = new Map(['A', 'B', 'C', 'D', 'E', 'F', 'beginner'].map((grade, index) => [grade, index]));

    function tournamentFallbackGroupKey(tournament) {
      return [
        tournament.title,
        tournament.event_start_date,
        tournament.event_end_date,
        tournament.tournament_type || '',
        tournament.internal_deadline,
        tournament.true_deadline,
        tournament.venue || '',
        tournament.document_url || '',
        tournament.all_grades === 1 ? 'all' : 'individual',
        tournament.created_at,
      ].join('\u001f');
    }

    function groupTournaments(tournaments) {
      const groups = new Map();
      tournaments.forEach((tournament) => {
        const key = tournament.registration_group_id
          ? 'group:' + tournament.registration_group_id
          : 'legacy:' + tournamentFallbackGroupKey(tournament);
        const current = groups.get(key) || [];
        current.push(tournament);
        groups.set(key, current);
      });
      return Array.from(groups.values()).map((group) => group.sort((left, right) => {
        return (gradeOrder.get(left.grade) ?? 99) - (gradeOrder.get(right.grade) ?? 99);
      }));
    }

    function openTournamentEditor(tournaments) {
      const tournament = tournaments[0];
      editingTournaments = tournaments;
      editTournamentGrade.textContent = '開催級：' + tournaments.map(tournamentGradeLabel).join('・') + '（開催級はこの画面では変更できません）';
      editTournamentForm.elements.title.value = tournament.title;
      editEventDateGrid.replaceChildren();
      tournaments.forEach((item) => {
        const label = element('label', '', tournamentGradeLabel(item) + (tournaments.length > 1 ? 'の開催日' : ''));
        const input = document.createElement('input');
        input.type = 'date';
        input.required = true;
        input.dataset.tournamentId = item.tournament_id;
        input.value = item.event_start_date;
        label.append(input);
        editEventDateGrid.append(label);
      });
      editTournamentForm.elements.tournamentType.value = tournament.tournament_type;
      editTournamentForm.elements.trueDeadline.value = dateTimeInputValue(tournament.true_deadline);
      editTournamentForm.elements.internalDeadline.value = dateTimeInputValue(tournament.internal_deadline);
      editTournamentForm.elements.venue.value = tournament.venue || '';
      editTournamentForm.elements.documentUrl.value = tournament.document_url || '';
      editTournamentForm.elements.documentFile.value = '';
      editTournamentResult.className = 'status-message';
      editTournamentResult.textContent = '';
      editTournamentDialog.showModal();
    }

    function responseSection(tournaments, response) {
      const section = element('section', 'response-section');
      const people = tournaments.flatMap((tournament) => {
        return tournament.responses
          .filter((item) => item.response === response)
          .map((item) => ({ ...item, grade: tournament.all_grades === 1 ? item.grade : tournament.grade }));
      }).sort((left, right) => {
        const gradeDifference = (gradeOrder.get(left.grade) ?? 99) - (gradeOrder.get(right.grade) ?? 99);
        if (gradeDifference) return gradeDifference;
        return (left.display_name_kana || left.display_name).localeCompare(right.display_name_kana || right.display_name, 'ja');
      });
      section.append(element('h4', '', responseLabels[response] + '(' + people.length + '人)'));
      if (!people.length) {
        section.append(element('div', 'response-empty', 'なし'));
        return section;
      }
      let previousGrade = '';
      people.forEach((person) => {
        const row = element('div', 'response-person');
        const currentGrade = gradeLabel(person.grade);
        const entryResult = response === 'yes' && person.entry_status
          ? ' ／ ' + (entryStatusLabels[person.entry_status] || person.entry_status)
            + (person.entry_status === 'not_selected' && person.waitlist_number ? ' ' + person.waitlist_number + '番' : '')
          : '';
        const paymentResult = response === 'yes' && person.entry_status === 'selected'
          ? ' ／ ' + (person.payment_status === 'paid' ? '支払済み' : '未納')
          : '';
        row.append(
          element('span', 'response-grade', currentGrade === previousGrade ? '' : currentGrade),
          element('span', '', person.display_name + ' (' + (person.display_name_kana || 'よみがな未登録') + ')' + entryResult + paymentResult),
        );
        previousGrade = currentGrade;
        section.append(row);
      });
      return section;
    }


    function renderEntryManagement(tournaments) {
      if (!tournaments.some((item) => item.status === 'applied' || item.status === 'closed')) return null;
      const entries = tournaments.flatMap((tournament) => tournament.responses
        .filter((person) => person.response === 'yes')
        .map((person) => ({ ...person, tournament })));
      if (!entries.length) return null;
      const section = document.createElement('details');
      section.className = 'entry-management';
      const summary = document.createElement('summary');
      summary.textContent = '1. 申込確認名簿（抽選前・' + entries.length + '人）';
      const body = element('div', 'entry-management-body');
      section.append(summary, body);

      const confirmation = tournaments[0].confirmation_roster;
      const confirmationBox = element('section', 'stage-box');
      confirmationBox.append(
        element('h5', '', '申込確認名簿'),
        element('p', 'archive-note', '申込者へ名簿をDMします。確認ボタンは設けず、誤りがある場合のみ大会担当者へDMしてもらいます。PDF・Word・Excel、20MBまで登録できます。'),
      );
      const confirmationFile = document.createElement('input');
      confirmationFile.type = 'file';
      confirmationFile.accept = 'application/pdf,.pdf,application/msword,.doc,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx,application/vnd.ms-excel,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.xlsx';
      const confirmationCurrent = element('div', 'guidance-current');
      if (confirmation?.document_url) {
        const link = element('a', '', confirmation.file_name || '登録済み確認名簿を開く');
        link.href = confirmation.document_url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        confirmationCurrent.append('登録済み：', link);
      } else {
        confirmationCurrent.textContent = '確認名簿は未登録です。';
      }
      const confirmationActions = element('div', 'stage-actions');
      const saveConfirmation = element('button', 'secondary', confirmation ? '名簿を差し替える' : '名簿を保存');
      saveConfirmation.type = 'button';
      const sendConfirmation = element('button', 'success', '申込者へ確認名簿をDM');
      sendConfirmation.type = 'button';
      sendConfirmation.disabled = !confirmation;
      const confirmationMessage = element('span', 'entry-result', '');
      saveConfirmation.addEventListener('click', async () => {
        const selected = confirmationFile.files?.[0];
        if (!selected) { confirmationMessage.textContent = '名簿ファイルを選択してください。'; return; }
        saveConfirmation.disabled = true;
        confirmationMessage.textContent = '保存中…';
        const form = new FormData();
        form.append('file', selected);
        form.append('tournamentIds', JSON.stringify(tournaments.map((item) => item.tournament_id)));
        try {
          const response = await fetch('/api/confirmation-roster', { method: 'POST', body: form });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || '確認名簿を保存できませんでした。');
          await loadTournaments();
        } catch (error) {
          confirmationMessage.textContent = error instanceof Error ? error.message : '確認名簿を保存できませんでした。';
          saveConfirmation.disabled = false;
        }
      });
      sendConfirmation.addEventListener('click', async () => {
        if (!confirm('申込者' + entries.length + '人へ、保存済みの申込確認名簿をDM送信しますか？')) return;
        sendConfirmation.disabled = true;
        confirmationMessage.textContent = '送信予約中…';
        try {
          const response = await fetch('/api/confirmation-roster/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tournamentIds: tournaments.map((item) => item.tournament_id) }),
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || '確認名簿DMを予約できませんでした。');
          confirmationMessage.textContent = result.queued + '件のDMを予約しました。' + (result.unavailable ? ' DM対象外 ' + result.unavailable + '件。' : '');
        } catch (error) {
          confirmationMessage.textContent = error instanceof Error ? error.message : '確認名簿DMを予約できませんでした。';
          sendConfirmation.disabled = false;
        }
      });
      confirmationActions.append(saveConfirmation, sendConfirmation, confirmationMessage);
      confirmationBox.append(confirmationFile, confirmationCurrent, confirmationActions);
      body.append(confirmationBox);

      return section;
    }

    function renderLotteryManagement(tournaments) {
      if (!tournaments.some((item) => item.status === 'applied' || item.status === 'closed')) return null;
      const entries = tournaments.flatMap((tournament) => tournament.responses
        .filter((person) => person.response === 'yes')
        .map((person) => ({ ...person, tournament })));
      if (!entries.length) return null;
      const tracksPayment = tournaments[0].participant_guidance?.payment_collection_method !== 'onsite_cash';
      const body = element('section', 'stage-box');
      body.append(
        element('h5', '', tracksPayment ? '選手ごとの当落・入金状態' : '選手ごとの当落'),
        element('p', 'archive-note', tracksPayment
          ? '抽選結果、キャンセル待ち番号、出場確定者の入金状態を入力し、全員分をまとめて保存します。'
          : '抽選結果とキャンセル待ち番号を入力し、全員分をまとめて保存します。当日現金のため入金管理は行いません。'),
      );

      const entryControls = [];
      entries.forEach(({ tournament, ...person }) => {
        const row = element('div', 'entry-row');
        const name = element('span', 'entry-name', tournamentGradeLabel(tournament) + ' ' + person.display_name + ' (' + (person.display_name_kana || 'よみがな未登録') + ')');
        const statusField = element('div', 'entry-field entry-status-field');
        statusField.append(element('span', 'entry-field-label', '抽選結果'));
        const select = document.createElement('select');
        Object.entries(entryStatusLabels).forEach(([value, label]) => {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = label;
          option.selected = value === (person.entry_status || 'submitted');
          select.append(option);
        });
        const waitlistInput = document.createElement('input');
        waitlistInput.type = 'number';
        waitlistInput.min = '1';
        waitlistInput.max = '9999';
        waitlistInput.step = '1';
        waitlistInput.inputMode = 'numeric';
        waitlistInput.placeholder = '待ち番号';
        waitlistInput.value = person.waitlist_number ? String(person.waitlist_number) : '';
        waitlistInput.setAttribute('aria-label', person.display_name + 'のキャンセル待ち番号');
        statusField.append(select);

        const waitlistField = element('div', 'entry-field waitlist-field');
        waitlistField.append(element('span', 'entry-field-label', '待ち番号'));
        const waitlistControl = element('div', 'waitlist-control');
        waitlistControl.append(waitlistInput, element('span', 'waitlist-suffix', '番'));
        waitlistField.append(waitlistControl);

        const paymentField = element('div', 'entry-field payment-field');
        paymentField.append(element('span', 'entry-field-label', '入金状態'));
        const paymentSelect = document.createElement('select');
        [['unpaid', '未納'], ['paid', '支払済み']].forEach(([value, label]) => {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = label;
          option.selected = value === (person.payment_status || 'unpaid');
          paymentSelect.append(option);
        });
        paymentField.append(paymentSelect);

        const refreshEntryState = () => {
          const waitlisted = select.value === 'not_selected';
          waitlistField.hidden = !waitlisted;
          waitlistInput.disabled = !waitlisted;
          waitlistInput.required = waitlisted;
          paymentField.hidden = !tracksPayment || select.value !== 'selected';
        };
        select.addEventListener('change', refreshEntryState);
        refreshEntryState();
        entryControls.push({
          tournamentId: tournament.tournament_id,
          memberId: person.member_id,
          displayName: person.display_name,
          select,
          waitlistInput,
          paymentSelect,
        });
        row.append(name, statusField, waitlistField, paymentField);
        body.append(row);
      });

      const bulkActions = element('div', 'entry-bulk-actions');
      const bulkMessage = element('span', 'entry-result', '');
      const saveAll = element('button', 'secondary', '全員分の変更を保存');
      saveAll.type = 'button';
      saveAll.addEventListener('click', async () => {
        const changes = [];
        for (const control of entryControls) {
          const waitlistNumber = control.select.value === 'not_selected'
            ? Number(control.waitlistInput.value)
            : null;
          if (
            control.select.value === 'not_selected' &&
            (!Number.isInteger(waitlistNumber) || waitlistNumber < 1 || waitlistNumber > 9999)
          ) {
            bulkMessage.textContent = control.displayName + 'のキャンセル待ち番号を1〜9999の整数で入力してください。';
            control.waitlistInput.focus();
            return;
          }
          changes.push({
            tournamentId: control.tournamentId,
            memberId: control.memberId,
            status: control.select.value,
            waitlistNumber,
            paymentStatus: control.select.value === 'selected' ? control.paymentSelect.value : null,
          });
        }
        saveAll.disabled = true;
        bulkMessage.textContent = '全員分を保存中…';
        try {
          const response = await fetch('/api/tournament-entries/batch', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ entries: changes }),
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || '全員分の変更を保存できませんでした。');
          bulkMessage.textContent = result.changedCount
            ? result.changedCount + '人分の変更を保存しました。'
            : '変更はありません。';
          await loadTournaments();
        } catch (error) {
          bulkMessage.textContent = error instanceof Error ? error.message : '全員分の変更を保存できませんでした。';
          saveAll.disabled = false;
        }
      });
      bulkActions.append(bulkMessage, saveAll);
      body.append(bulkActions);
      return body;
    }

    function renderArchiveDocumentUpload(tournaments, type, label, allowExcel) {
      const documents = tournaments[0].archive_documents || [];
      const box = element('div', 'archive-document');
      box.append(element('strong', '', label));
      const current = documents.find((item) => item.document_type === type);
      if (current) {
        const link = element('a', '', current.file_name || (label + 'を開く'));
        link.href = current.document_url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        box.append(link);
      } else {
        box.append(element('span', 'response-empty', '未登録'));
      }
      const file = document.createElement('input');
      file.type = 'file';
      file.accept = allowExcel
        ? 'application/pdf,.pdf,application/vnd.ms-excel,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.xlsx'
        : 'application/pdf,.pdf';
      const upload = element('button', 'secondary', current ? '差し替える' : 'アップロード');
      upload.type = 'button';
      const message = element('span', 'entry-result', '');
      upload.addEventListener('click', async () => {
        const selected = file.files?.[0];
        if (!selected) {
          message.textContent = allowExcel ? 'PDFまたはExcelを選択してください。' : 'PDFを選択してください。';
          return;
        }
        upload.disabled = true;
        message.textContent = 'アップロード中…';
        const form = new FormData();
        form.append('file', selected);
        form.append('documentType', type);
        form.append('tournamentIds', JSON.stringify(tournaments.map((item) => item.tournament_id)));
        try {
          const response = await fetch('/api/archive-documents', { method: 'POST', body: form });
          const responseBody = await response.json();
          if (!response.ok) throw new Error(responseBody.error || 'アップロードできませんでした。');
          await loadTournaments();
        } catch (error) {
          message.textContent = error instanceof Error ? error.message : 'アップロードできませんでした。';
          upload.disabled = false;
        }
      });
      box.append(file, upload, message);
      return box;
    }

    function renderPostLotteryManagement(tournaments) {
      if (!tournaments.some((item) => item.status === 'applied' || item.status === 'closed')) return null;
      const section = document.createElement('details');
      section.className = 'archive-management';
      const summary = document.createElement('summary');
      summary.textContent = '2. 抽選結果・確定名簿・参加費・当日案内';
      const body = element('div', 'archive-management-body');
      section.append(summary, body);
      body.append(
        element('p', 'archive-note', '抽選結果と確定名簿は大会お知らせチャンネルへ送信し、参加費と当日案内は出場確定者だけへDMします。キャンセル待ちの選手にはDMしません。'),
      );
      body.append(renderArchiveDocumentUpload(tournaments, 'roster', '確定名簿（PDF・Excel）', true));
      const lotteryManagement = renderLotteryManagement(tournaments);
      if (lotteryManagement) body.append(lotteryManagement);
      const guidance = tournaments[0].participant_guidance;
      const guidanceBox = element('section', 'guidance-management');
      guidanceBox.append(
        element('h5', '', '参加費・当日案内'),
        element('p', 'archive-note', '参加者には級別参加費と支払い方法だけを案内します。主催者の振込先情報は大会担当者だけが参照できます。'),
      );

      const feeGrades = [...new Set(tournaments.flatMap((tournament) => tournament.responses
        .filter((person) => person.response === 'yes')
        .map((person) => tournament.all_grades === 1 ? person.grade : tournament.grade)))]
        .sort((left, right) => (gradeOrder.get(left) ?? 99) - (gradeOrder.get(right) ?? 99));
      const existingFees = new Map((tournaments[0].participation_fees || [])
        .map((fee) => [fee.grade, fee.amount_yen]));
      const feeGrid = element('div', 'fee-grid');
      feeGrid.append(element('h6', '', '級別参加費（参加者DMに表示）'));
      const feeInputs = new Map();
      feeGrades.forEach((grade) => {
        const label = element('label', '', grade === 'beginner' ? '初心者級' : grade + '級');
        const select = document.createElement('select');
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = '選択してください';
        select.append(placeholder);
        [500, 1000, 1500, 2000, 2500, 3000].forEach((amount) => {
          const option = document.createElement('option');
          option.value = String(amount);
          option.textContent = amount.toLocaleString('ja-JP') + '円';
          option.selected = existingFees.get(grade) === amount;
          select.append(option);
        });
        label.append(select);
        feeInputs.set(grade, select);
        feeGrid.append(label);
      });

      const paymentMethodLabel = element('label', '', '参加費の支払い方法');
      const paymentMethod = document.createElement('select');
      [
        ['advance_manager', '事前集金（参加者 → 大会担当者 → 主催者）'],
        ['onsite_cash', '当日現金（参加者 → 主催者）'],
      ].forEach(([value, label]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        option.selected = value === (guidance?.payment_collection_method || 'advance_manager');
        paymentMethod.append(option);
      });
      paymentMethodLabel.append(paymentMethod);

      const guidanceText = document.createElement('textarea');
      guidanceText.maxLength = 3500;
      guidanceText.placeholder = '参加者への案内本文（任意）';
      guidanceText.value = guidance?.body_text || '';

      const organizerBox = element('div', 'organizer-payment-box');
      organizerBox.append(
        element('h6', '', '主催者への振込情報（大会担当者のみ）'),
        element('p', 'organizer-payment-note', '参加者DMには表示されません。主催者への一括振込に必要な口座・名義などを保存します。'),
      );
      const organizerSourceLabel = element('label', 'organizer-payment-selector', '振込情報の登録方法');
      const organizerSource = document.createElement('select');
      [
        ['text', 'メール本文を転記'],
        ['file', '独立したPDF・Wordファイル'],
        ['guidance', '当日案内ファイル・本文に記載'],
      ].forEach(([value, label]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        option.selected = value === (guidance?.organizer_payment_source || 'text');
        organizerSource.append(option);
      });
      organizerSourceLabel.append(organizerSource);
      const organizerDetailsLabel = element('label', '', '主催者への振込先・振込方法');
      const organizerDetails = document.createElement('textarea');
      organizerDetails.maxLength = 3500;
      organizerDetails.placeholder = 'メール本文にある口座情報、振込名義、注意事項など';
      organizerDetails.value = guidance?.payment_details || '';
      organizerDetailsLabel.append(organizerDetails);
      const organizerFileLabel = element('label', '', '主催者振込情報ファイル');
      const organizerFile = document.createElement('input');
      organizerFile.type = 'file';
      organizerFile.accept = 'application/pdf,.pdf,application/msword,.doc,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx';
      organizerFileLabel.append(organizerFile);
      const organizerCurrent = element('div', 'guidance-current');
      if (guidance?.organizer_payment_document_url) {
        const link = element('a', '', guidance.organizer_payment_file_name || '登録済み振込情報を開く');
        link.href = guidance.organizer_payment_document_url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        organizerCurrent.append('登録済みファイル：', link);
      } else {
        organizerCurrent.textContent = '振込情報ファイルは未登録です。';
      }

      const organizerPaymentDeadlineLabel = element('label', '', '主催者への振込期限');
      const organizerPaymentDeadline = document.createElement('input');
      organizerPaymentDeadline.type = 'date';
      const organizerPaymentTime = document.createElement('input');
      organizerPaymentTime.type = 'time';
      organizerPaymentTime.step = '60';
      const organizerExistingValue = guidance?.organizer_payment_deadline
        ? dateTimeInputValue(guidance.organizer_payment_deadline)
        : '';
      organizerPaymentDeadline.value = organizerExistingValue ? organizerExistingValue.slice(0, 10) : '';
      organizerPaymentTime.value = organizerExistingValue ? organizerExistingValue.slice(11, 16) : '23:59';
      const organizerDeadlineControl = element('div', 'deadline-control');
      organizerDeadlineControl.append(organizerPaymentDeadline, organizerPaymentTime);
      organizerPaymentDeadlineLabel.append(organizerDeadlineControl);
      const paymentDeadlineLabel = element('label', '', 'サークル内支払期限');
      const paymentDeadline = document.createElement('input');
      paymentDeadline.type = 'date';
      const paymentTime = document.createElement('input');
      paymentTime.type = 'time';
      paymentTime.step = '60';
      const paymentExistingValue = guidance?.payment_deadline
        ? dateTimeInputValue(guidance.payment_deadline)
        : '';
      paymentDeadline.value = paymentExistingValue ? paymentExistingValue.slice(0, 10) : '';
      paymentTime.value = paymentExistingValue ? paymentExistingValue.slice(11, 16) : '23:59';
      const paymentDeadlineControl = element('div', 'deadline-control');
      paymentDeadlineControl.append(paymentDeadline, paymentTime);
      paymentDeadlineLabel.append(paymentDeadlineControl);
      organizerPaymentDeadline.addEventListener('change', () => {
        if (!organizerPaymentDeadline.value) return;
        const defaultValue = defaultPaymentDeadlineInput(
          organizerPaymentDeadline.value + 'T' + organizerPaymentTime.value + ':00+09:00',
        );
        paymentDeadline.value = defaultValue.slice(0, 10);
        paymentTime.value = defaultValue.slice(11, 16);
      });
      const organizerFileBox = element('div', 'guidance-file-box');
      organizerFileBox.append(organizerFileLabel, organizerCurrent);
      const organizerGuidanceNote = element('p', 'organizer-payment-note', '上部で登録した当日案内本文または案内ファイルを、主催者への振込情報として参照します。追加の入力は不要です。');
      const organizerBranch = element('div', 'organizer-payment-branch');
      organizerBranch.append(organizerDetailsLabel, organizerFileBox, organizerGuidanceNote);
      const organizerDeadlineFields = element('div', 'guidance-fields');
      organizerDeadlineFields.append(organizerPaymentDeadlineLabel, paymentDeadlineLabel);
      organizerBox.append(organizerSourceLabel, organizerBranch, organizerDeadlineFields);
      const onsiteNote = element('p', 'organizer-payment-note', '参加者には「大会当日に現金で主催者へ直接支払い」と案内します。事前の入金管理や未納リマインダーは行いません。');

      const refreshPaymentFields = () => {
        const advance = paymentMethod.value === 'advance_manager';
        organizerBox.hidden = !advance;
        onsiteNote.hidden = advance;
        organizerDetailsLabel.hidden = organizerSource.value !== 'text';
        organizerFileBox.hidden = organizerSource.value !== 'file';
        organizerGuidanceNote.hidden = organizerSource.value !== 'guidance';
      };
      paymentMethod.addEventListener('change', refreshPaymentFields);
      organizerSource.addEventListener('change', refreshPaymentFields);
      refreshPaymentFields();

      const guidanceFile = document.createElement('input');
      guidanceFile.type = 'file';
      guidanceFile.accept = 'application/pdf,.pdf,application/msword,.doc,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx';
      const currentGuidance = element('div', 'guidance-current');
      if (guidance?.document_url) {
        const link = element('a', '', guidance.file_name || '登録済み案内ファイルを開く');
        link.href = guidance.document_url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        currentGuidance.append('登録済みファイル：', link);
      } else {
        currentGuidance.textContent = '案内ファイルは未登録です。';
      }
      const guidanceActions = element('div', 'guidance-actions');
      const saveGuidance = element('button', 'secondary', guidance ? '参加費・案内を更新' : '参加費・案内を保存');
      saveGuidance.type = 'button';
      const sendGuidance = element('button', 'success', '抽選結果・確定名簿・当日案内を送信');
      sendGuidance.type = 'button';
      sendGuidance.disabled = !guidance || !tournaments[0].participation_fees?.length;
      const guidanceMessage = element('span', 'entry-result', guidance
        ? '現在版: ' + guidance.sent_count + '件送信済み、' + guidance.pending_count + '件送信待ち' + (guidance.failed_count ? '、' + guidance.failed_count + '件失敗' : '')
        : '案内を保存すると送信できます。');
      saveGuidance.addEventListener('click', async () => {
        const selected = guidanceFile.files?.[0];
        if (!guidanceText.value.trim() && !selected && !guidance?.document_url) {
          guidanceMessage.textContent = '本文または案内ファイルを入力してください。';
          return;
        }
        const feesByGrade = {};
        for (const [grade, input] of feeInputs) {
          const amount = Number(input.value);
          if (!input.value || !Number.isInteger(amount) || amount < 500 || amount > 3000 || amount % 500 !== 0) {
            guidanceMessage.textContent = (grade === 'beginner' ? '初心者級' : grade + '級') + 'の参加費を500〜3,000円の500円刻みで選択してください。';
            input.focus();
            return;
          }
          feesByGrade[grade] = amount;
        }
        const advance = paymentMethod.value === 'advance_manager';
        if (advance && organizerSource.value === 'text' && !organizerDetails.value.trim()) {
          guidanceMessage.textContent = '主催者への振込先・振込方法を入力してください。';
          return;
        }
        if (advance && organizerSource.value === 'file' && !organizerFile.files?.[0] && !guidance?.organizer_payment_document_url) {
          guidanceMessage.textContent = '主催者振込情報のPDFまたはWordを選択してください。';
          return;
        }
        if (advance && (!organizerPaymentDeadline.value || !organizerPaymentTime.value || !paymentDeadline.value || !paymentTime.value)) {
          guidanceMessage.textContent = '主催者への振込期限とサークル内支払期限を入力してください。';
          return;
        }
        saveGuidance.disabled = true;
        guidanceMessage.textContent = '保存中…';
        const form = new FormData();
        form.append('bodyText', guidanceText.value);
        form.append('feesByGrade', JSON.stringify(feesByGrade));
        form.append('paymentCollectionMethod', paymentMethod.value);
        form.append('organizerPaymentSource', organizerSource.value);
        form.append('organizerPaymentDetails', organizerDetails.value);
        if (advance) {
          form.append('organizerPaymentDeadline', localJstToIso(organizerPaymentDeadline.value + 'T' + organizerPaymentTime.value));
          form.append('paymentDeadline', localJstToIso(paymentDeadline.value + 'T' + paymentTime.value));
        }
        form.append('tournamentIds', JSON.stringify(tournaments.map((item) => item.tournament_id)));
        if (selected) form.append('file', selected);
        if (organizerFile.files?.[0]) form.append('organizerPaymentFile', organizerFile.files[0]);
        try {
          const response = await fetch('/api/participant-guidance', { method: 'POST', body: form });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || '案内を保存できませんでした。');
          await loadTournaments();
        } catch (error) {
          guidanceMessage.textContent = error instanceof Error ? error.message : '案内を保存できませんでした。';
          saveGuidance.disabled = false;
        }
      });
      sendGuidance.addEventListener('click', async () => {
        const selectedCount = new Set(tournaments.flatMap((tournament) => tournament.responses.filter((person) => person.entry_status === 'selected').map((person) => person.member_id))).size;
        const paymentDescription = paymentMethod.value === 'onsite_cash' ? '当日現金の案内' : '級別参加費と事前支払い案内';
        if (!confirm('抽選結果と確定名簿を大会お知らせチャンネルへ送り、出場確定者' + selectedCount + '人へ当日案内・' + paymentDescription + 'をDM送信しますか？')) return;
        sendGuidance.disabled = true;
        guidanceMessage.textContent = '送信予約中…';
        try {
          const response = await fetch('/api/lottery-results/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tournamentIds: tournaments.map((item) => item.tournament_id) }),
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || '抽選結果と確定者案内を予約できませんでした。');
          guidanceMessage.textContent = 'チャンネル告知 ' + result.channelQueued + '件、確定者DM ' + result.dmQueued + '件を予約しました。' + (result.dmUnavailable ? ' DM対象外 ' + result.dmUnavailable + '件。' : '');
        } catch (error) {
          guidanceMessage.textContent = error instanceof Error ? error.message : '抽選結果と確定者案内を予約できませんでした。';
          sendGuidance.disabled = false;
        }
      });
      guidanceActions.append(saveGuidance, sendGuidance, guidanceMessage);

      const guidanceSection = element('section', 'guidance-subsection');
      guidanceSection.append(element('h6', '', '当日案内'));
      const guidanceGuideGrid = element('div', 'guidance-guide-grid');
      const guidanceTextLabel = element('label', '', '当日案内本文');
      guidanceTextLabel.append(guidanceText);
      const guidanceFileBox = element('div', 'guidance-file-box');
      const guidanceFileLabel = element('label', '', '当日案内ファイル（PDF・Word）');
      guidanceFileLabel.append(guidanceFile);
      guidanceFileBox.append(guidanceFileLabel, currentGuidance);
      guidanceGuideGrid.append(guidanceTextLabel, guidanceFileBox);
      guidanceSection.append(guidanceGuideGrid);

      const paymentSection = element('section', 'guidance-subsection');
      paymentSection.append(element('h6', '', '参加費・支払い方法'));
      const paymentSetupGrid = element('div', 'payment-setup-grid');
      paymentSetupGrid.append(paymentMethodLabel, feeGrid);
      paymentSection.append(paymentSetupGrid, onsiteNote);

      guidanceBox.append(guidanceSection, paymentSection, organizerBox, guidanceActions);
      body.append(guidanceBox);
      return section;
    }

    function renderArchiveManagement(tournaments) {
      if (!tournaments.some((item) => item.status === 'applied' || item.status === 'closed')) return null;
      const section = document.createElement('details');
      section.className = 'archive-management';
      const summary = document.createElement('summary');
      summary.textContent = '3. 大会結果';
      const body = element('div', 'archive-management-body result-archive-body');
      section.append(summary, body);
      const resultDocumentUpload = renderArchiveDocumentUpload(
        tournaments,
        'results',
        '大会結果ファイル（PDF・Excel）',
        true,
      );
      resultDocumentUpload.classList.add('result-document-upload');
      body.append(
        element('p', 'archive-note', '結果ファイルと全出場者の個人成績が揃うと、メンバーポータルの「過去の大会結果」へ公開できます。'),
        resultDocumentUpload,
      );

      const resultBox = element('section', 'stage-box result-stage');
      resultBox.append(
        element('h5', '', '選手ごとの個人成績'),
        element('p', 'archive-note', '大会終了後に、出場者ごとの成績を登録します。'),
      );
      const resultEntries = tournaments.flatMap((tournament) => tournament.responses
        .filter((person) => person.response === 'yes' && (person.entry_status === 'selected' || person.entry_status === 'submitted'))
        .map((person) => ({ ...person, tournament })));
      const resultList = element('div', 'result-list');
      if (!resultEntries.length) {
        resultList.append(element('div', 'response-empty', '成績を登録できる出場者はいません。'));
      }
      resultEntries.forEach(({ tournament, ...person }) => {
        const row = element('div', 'result-row');
        const name = element('span', 'entry-name', tournamentGradeLabel(tournament) + ' ' + person.display_name + ' (' + (person.display_name_kana || 'よみがな未登録') + ')');
        const input = document.createElement('select');
        const resultOptions = ['1回戦敗退', '2回戦敗退', '3回戦敗退', '4回戦敗退', '4位入賞', '3位入賞', '準優勝', '優勝'];
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = '成績を選択';
        input.append(placeholder);
        if (person.result_text && !resultOptions.includes(person.result_text)) {
          const legacy = document.createElement('option');
          legacy.value = person.result_text;
          legacy.textContent = person.result_text + '（旧データ）';
          legacy.selected = true;
          legacy.disabled = true;
          input.append(legacy);
        }
        resultOptions.forEach((value) => {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = value;
          option.selected = value === person.result_text;
          input.append(option);
        });
        const save = element('button', 'secondary', '成績を保存');
        save.type = 'button';
        const result = element('span', 'entry-result', '');
        save.addEventListener('click', async () => {
          if (!input.value || !resultOptions.includes(input.value)) {
            result.textContent = '個人成績を選択してください。';
            input.focus();
            return;
          }
          save.disabled = true;
          result.textContent = '保存中…';
          try {
            const response = await fetch('/api/tournaments/' + encodeURIComponent(tournament.tournament_id) + '/entries/' + encodeURIComponent(person.member_id) + '/result', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ resultText: input.value }),
            });
            const responseBody = await response.json();
            if (!response.ok) throw new Error(responseBody.error || '個人成績を保存できませんでした。');
            result.textContent = responseBody.changed ? '成績を保存しました。' : '変更はありません。';
          } catch (error) {
            result.textContent = error instanceof Error ? error.message : '個人成績を保存できませんでした。';
          } finally {
            save.disabled = false;
          }
        });
        row.append(name, input, save, result);
        resultList.append(row);
      });
      resultBox.append(resultList);
      body.append(resultBox);

      const published = tournaments.every((item) => Boolean(item.archive_published_at));
      const actions = element('div', 'archive-actions');
      const publish = element('button', published ? 'danger' : 'success', published ? '公開を取り下げる' : '過去大会として公開');
      publish.type = 'button';
      const message = element('span', 'status-message', published ? '公開中' : '未公開');
      publish.addEventListener('click', async () => {
        const nextPublished = !published;
        if (!confirm(nextPublished ? '大会記録をメンバーポータルへ公開しますか？' : '大会記録の公開を取り下げますか？')) return;
        publish.disabled = true;
        message.textContent = nextPublished ? '公開処理中…' : '取り下げ中…';
        try {
          const response = await fetch('/api/tournaments/archive', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tournamentIds: tournaments.map((item) => item.tournament_id), published: nextPublished }),
          });
          const body = await response.json();
          if (!response.ok) throw new Error(body.error || '大会記録を更新できませんでした。');
          await loadTournaments();
        } catch (error) {
          message.textContent = error instanceof Error ? error.message : '大会記録を更新できませんでした。';
          publish.disabled = false;
        }
      });
      actions.append(publish, message);
      body.append(actions);
      return section;
    }

    function renderTournament(tournaments) {
      const tournament = tournaments[0];
      const card = element('article', 'tournament-card');
      card.dataset.tournamentGroup = tournaments
        .map((item) => item.tournament_id)
        .sort()
        .join(',');
      const heading = element('div', 'card-heading');
      const statuses = [...new Set(tournaments.map(tournamentDisplayStatus))];
      heading.append(
        element('h3', '', tournament.title),
        element('span', 'badge ' + (statuses.length === 1 ? statuses[0] : 'draft'), statuses.length === 1 ? (statusLabels[statuses[0]] || statuses[0]) : '複数ステータス'),
      );
      card.append(heading);

      const distinctEventDates = [...new Set(tournaments.map((item) => item.event_start_date))];
      const dateDescription = distinctEventDates.length === 1
        ? tournaments.map(tournamentGradeLabel).join('・') + ' ／ ' + distinctEventDates[0]
        : tournaments.map((item) => tournamentGradeLabel(item) + ' ' + item.event_start_date).join('・');
      const metaParts = [dateDescription, 'サークル内締切 ' + dateTimeLabel(tournament.internal_deadline)];
      if (tournament.venue) metaParts.push(tournament.venue);
      const meta = element('div', 'meta', metaParts.join(' ／ '));
      card.append(meta);
      if (tournament.document_url) {
        const link = element('a', '', '大会要項を開く');
        link.href = tournament.document_url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        meta.append(document.createTextNode(' ／ '), link);
      }

      if (tournament.application_method) {
        const applicationLabels = {
          excel_email: 'Excel名簿をメール送信',
          excel_form: 'Excel名簿をフォーム送信',
          direct_form: 'フォームへ直接入力',
        };
        const applicationSummary = element('div', 'application-summary');
        applicationSummary.append(
          element('strong', '', '申込方法'),
          element('span', '', applicationLabels[tournament.application_method] || tournament.application_method),
        );
        if (tournament.application_roster_url) {
          const rosterLink = element('a', '', tournament.application_roster_file_name || '申込名簿を開く');
          rosterLink.href = tournament.application_roster_url;
          rosterLink.target = '_blank';
          rosterLink.rel = 'noopener noreferrer';
          applicationSummary.append(rosterLink);
        }
        if (tournament.application_form_url) {
          const formLink = element('a', '', '申込フォームを開く');
          formLink.href = tournament.application_form_url;
          formLink.target = '_blank';
          formLink.rel = 'noopener noreferrer';
          applicationSummary.append(formLink);
        }
        if (tournament.application_email) {
          const emailLink = element('a', '', tournament.application_email);
          emailLink.href = 'mailto:' + tournament.application_email;
          applicationSummary.append(emailLink);
        }
        card.append(applicationSummary);
      }

      const cardActions = element('div', 'card-actions');
      const editButton = element('button', 'secondary', '大会情報を編集');
      editButton.type = 'button';
      editButton.addEventListener('click', () => openTournamentEditor(tournaments));
      const rawStatuses = [...new Set(tournaments.map((item) => item.status))];
      const applicationBlocked = tournaments.some((item) => item.status === 'canceled' || tournamentDisplayStatus(item) === 'no_participants');
      const statusSelect = document.createElement('select');
      statusSelect.className = 'card-status-select';
      if (rawStatuses.length > 1) {
        const mixed = document.createElement('option');
        mixed.value = '';
        mixed.textContent = '複数ステータス';
        mixed.selected = true;
        statusSelect.append(mixed);
      }
      Object.entries(statusLabels).filter(([value]) => value !== 'no_participants').forEach(([value, label]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        option.selected = rawStatuses.length === 1 && value === rawStatuses[0];
        option.disabled = value === 'applied' && applicationBlocked;
        statusSelect.append(option);
      });
      if (applicationBlocked) statusSelect.title = '申込完了へ戻す場合は、一度ほかのステータスへ変更してください。';
      const statusButton = element('button', 'secondary', 'ステータスを変更');
      statusButton.type = 'button';
      const statusMessage = element('span', 'status-message', '');
      statusButton.addEventListener('click', async () => {
        if (!statusSelect.value) {
          statusMessage.textContent = '変更先のステータスを選択してください。';
          return;
        }
        if (rawStatuses.length === 1 && rawStatuses[0] === statusSelect.value) {
          statusMessage.textContent = '変更はありません。';
          return;
        }
        const grades = tournaments.map(tournamentGradeLabel).join('・');
        const nextLabel = statusLabels[statusSelect.value] || statusSelect.value;
        const confirmMessage = statusSelect.value === 'applied'
          ? tournament.title + '（' + grades + '）を「申込完了」へ変更し、告知チャンネルへ通知しますか？'
          : tournament.title + '（' + grades + '）を「' + nextLabel + '」へ変更しますか？';
        if (!confirm(confirmMessage)) return;
        statusButton.disabled = true;
        statusSelect.disabled = true;
        statusMessage.className = 'status-message';
        statusMessage.textContent = '変更中…';
        try {
          const response = await fetch('/api/tournaments/status', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tournamentIds: tournaments.map((item) => item.tournament_id),
              status: statusSelect.value,
            }),
          });
          const body = await response.json();
          if (!response.ok) throw new Error(body.error || 'ステータスを変更できませんでした。');
          await loadTournaments();
        } catch (error) {
          statusMessage.className = 'status-message error';
          statusMessage.textContent = error instanceof Error ? error.message : 'ステータスを変更できませんでした。';
          statusButton.disabled = false;
          statusSelect.disabled = false;
        }
      });
      cardActions.append(editButton, statusSelect, statusButton, statusMessage);
      card.append(cardActions);

      const responseSections = element('div', 'response-sections');
      const applicationCompleted = tournaments.every((item) =>
        item.status === 'applied' || item.status === 'closed'
      );
      responseSections.append(responseSection(tournaments, 'yes'));
      if (!applicationCompleted) {
        responseSections.append(
          responseSection(tournaments, 'maybe'),
          responseSection(tournaments, 'no'),
          responseSection(tournaments, 'pending'),
        );
      }
      card.append(responseSections);

      const entryManagement = renderEntryManagement(tournaments);
      if (entryManagement) card.append(entryManagement);

      const postLotteryManagement = renderPostLotteryManagement(tournaments);
      if (postLotteryManagement) card.append(postLotteryManagement);

      const archiveManagement = renderArchiveManagement(tournaments);
      if (archiveManagement) card.append(archiveManagement);

      const notificationParts = [
        '告知 ' + tournaments.reduce((sum, item) => sum + Number(item.announcements_sent), 0) + '件',
        'DM ' + tournaments.reduce((sum, item) => sum + Number(item.invitation_dms_sent), 0) + '件送信済み',
      ];
      const queued = tournaments.reduce((sum, item) => sum + Number(item.notifications_queued), 0);
      const failures = tournaments.reduce((sum, item) => sum + Number(item.notification_failures), 0);
      if (queued) notificationParts.push('キュー・再送待ち ' + queued + '件');
      if (failures) notificationParts.push('送信失敗 ' + failures + '件');
      const notificationText = notificationParts.join('・');
      card.append(element('div', 'notification-note', notificationText));
      return card;
    }

    function renderMemberTableHeader() {
      const header = element('div', 'member-table-header');
      header.setAttribute('aria-hidden', 'true');
      ['氏名', 'よみがな', '出場級', '段位', '状態', 'DM', '操作'].forEach((label) => {
        header.append(element('span', '', label));
      });
      return header;
    }

    function renderMember(member) {
      const card = element('article', 'member-card');
      const summary = element('div', 'member-summary-grid');
      const summaryItem = (label, value) => {
        const item = element('div', 'member-summary-item', value);
        item.dataset.label = label;
        return item;
      };
      const edit = element('button', 'secondary', '編集');
      edit.type = 'button';
      const linkState = element('span', 'member-link', member.discordLinked ? 'Discord連携済み' : 'Discord未連携');
      const rowActions = element('div', 'member-row-actions');
      rowActions.append(edit, linkState);
      summary.append(
        summaryItem('氏名', member.displayName),
        summaryItem('よみがな', member.displayNameKana || '未登録'),
        summaryItem('出場級', gradeLabel(member.grade)),
        summaryItem('段位', rankLabel(member.rank)),
        summaryItem('状態', memberStatusLabels[member.status] || member.status),
        summaryItem('DM', member.dmEnabled ? '送信する' : '送信しない'),
        rowActions,
      );
      card.append(summary);

      const editor = element('div', 'member-editor');
      editor.hidden = true;
      const grid = element('div', 'member-grid');
      const nameLabel = element('label', '', '氏名');
      const nameInput = document.createElement('input');
      nameInput.value = member.displayName;
      nameInput.maxLength = 50;
      nameLabel.append(nameInput);

      const nameKanaLabel = element('label', '', 'よみがな');
      const nameKanaInput = document.createElement('input');
      nameKanaInput.value = member.displayNameKana || '';
      nameKanaInput.maxLength = 100;
      nameKanaInput.placeholder = 'いしだ ようおん';
      nameKanaLabel.append(nameKanaInput);

      const gradeLabelNode = element('label', '', '出場級');
      const gradeSelect = document.createElement('select');
      ['A', 'B', 'C', 'D', 'E', 'F', 'beginner'].forEach((grade) => {
        const option = document.createElement('option');
        option.value = grade;
        option.textContent = gradeLabel(grade);
        option.selected = grade === member.grade;
        gradeSelect.append(option);
      });
      gradeLabelNode.append(gradeSelect);

      const rankLabelNode = element('label', '', '段位');
      const rankSelect = document.createElement('select');
      Array.from({ length: 11 }, (_, rank) => rank).forEach((rank) => {
        const option = document.createElement('option');
        option.value = String(rank);
        option.textContent = rankLabel(rank);
        option.selected = rank === Number(member.rank);
        rankSelect.append(option);
      });
      rankLabelNode.append(rankSelect);

      const statusLabel = element('label', '', '状態');
      const statusSelect = document.createElement('select');
      Object.entries(memberStatusLabels).forEach(([value, label]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        option.selected = value === member.status;
        statusSelect.append(option);
      });
      statusLabel.append(statusSelect);

      const dmLabel = element('label', 'checkbox');
      const dmCheckbox = document.createElement('input');
      dmCheckbox.type = 'checkbox';
      dmCheckbox.checked = member.dmEnabled;
      dmLabel.append(dmCheckbox, document.createTextNode('DMを送る'));
      grid.append(nameLabel, nameKanaLabel, gradeLabelNode, rankLabelNode, statusLabel, dmLabel);
      editor.append(grid);

      const actions = element('div', 'member-actions');
      const cancel = element('button', 'secondary', 'キャンセル');
      cancel.type = 'button';
      const save = element('button', '', '変更を保存');
      save.type = 'button';
      const message = element('span', 'status-message', '');
      const resetEditor = () => {
        nameInput.value = member.displayName;
        nameKanaInput.value = member.displayNameKana || '';
        gradeSelect.value = member.grade;
        rankSelect.value = String(member.rank);
        statusSelect.value = member.status;
        dmCheckbox.checked = member.dmEnabled;
        message.className = 'status-message';
        message.textContent = '';
      };
      edit.addEventListener('click', () => {
        resetEditor();
        summary.hidden = true;
        editor.hidden = false;
        nameInput.focus();
      });
      cancel.addEventListener('click', () => {
        resetEditor();
        editor.hidden = true;
        summary.hidden = false;
      });
      save.addEventListener('click', async () => {
        save.disabled = true;
        message.className = 'status-message';
        message.textContent = '変更中…';
        try {
          const response = await fetch('/api/members/' + encodeURIComponent(member.memberId), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              displayName: nameInput.value,
              displayNameKana: nameKanaInput.value,
              grade: gradeSelect.value,
              rank: Number(rankSelect.value),
              status: statusSelect.value,
              dmEnabled: dmCheckbox.checked,
            }),
          });
          const body = await response.json();
          if (!response.ok) throw new Error(body.error || '変更に失敗しました。');
          message.textContent = '変更しました。';
          await loadMembers();
        } catch (error) {
          message.className = 'status-message error';
          message.textContent = error instanceof Error ? error.message : '変更に失敗しました。';
        } finally {
          save.disabled = false;
        }
      });
      actions.append(cancel, save, message);
      editor.append(actions);
      card.append(editor);
      return card;
    }

    function renderRegistrationRequest(request) {
      const card = element('article', 'request-card ' + request.requestType);
      const title = element('div', 'request-title');
      title.append(
        element('h3', '', request.requestedDisplayName),
        element('span', 'badge ' + (request.requestType === 'update' ? 'applied' : 'active'), request.requestType === 'update' ? '登録内容変更' : '新規登録'),
      );
      card.append(title);

      const comparison = element('div', 'request-comparison');
      const requested = element('div', 'request-value');
      requested.append(
        element('strong', '', request.requestType === 'update' ? '変更後' : '登録内容'),
        document.createTextNode(request.requestedDisplayName + '（' + (request.requestedDisplayNameKana || 'よみがな未登録') + '） ／ ' + gradeLabel(request.requestedGrade) + ' ／ ' + rankLabel(request.requestedRank)),
      );
      if (request.requestType === 'update') {
        const current = element('div', 'request-value');
        current.append(
          element('strong', '', '現在'),
          document.createTextNode((request.currentDisplayName || '不明') + '（' + (request.currentDisplayNameKana || 'よみがな未登録') + '） ／ ' + gradeLabel(request.currentGrade || '') + ' ／ ' + rankLabel(request.currentRank)),
        );
        comparison.append(current, element('div', 'request-arrow', '→'), requested);
      } else {
        requested.style.gridColumn = '1 / -1';
        comparison.append(requested);
      }
      card.append(comparison);
      const note = request.requestType === 'update'
        ? 'Discordの一意なユーザーIDで既存メンバーと照合済み'
        : 'Discordの一意なユーザーIDに一致する既存メンバーはありません';
      card.append(element('div', 'request-note', note + ' ／ 申請 ' + dateTimeLabel(request.submittedAt)));

      const actions = element('div', 'member-actions');
      const approve = element('button', 'secondary', '承認する');
      approve.type = 'button';
      const reject = element('button', 'danger', '却下する');
      reject.type = 'button';
      const message = element('span', 'status-message', '');
      const decide = async (decision) => {
        approve.disabled = true;
        reject.disabled = true;
        message.className = 'status-message';
        message.textContent = decision === 'approved' ? '承認中…' : '却下中…';
        try {
          const response = await fetch('/api/member-requests/' + encodeURIComponent(request.requestId), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ decision }),
          });
          const body = await response.json();
          if (!response.ok) throw new Error(body.error || '申請を処理できませんでした。');
          await loadMembers();
        } catch (error) {
          message.className = 'status-message error';
          message.textContent = error instanceof Error ? error.message : '申請を処理できませんでした。';
          approve.disabled = false;
          reject.disabled = false;
        }
      };
      approve.addEventListener('click', () => decide('approved'));
      reject.addEventListener('click', () => {
        if (confirm('この申請を却下しますか？')) decide('rejected');
      });
      actions.append(approve, reject, message);
      card.append(actions);
      return card;
    }

    function groupSortValue(group, sort) {
      const values = group.map((tournament) => {
        if (sort === 'event_asc') return Date.parse(tournament.event_start_date + 'T00:00:00+09:00');
        if (sort === 'created_desc' || sort === 'created_asc') return Date.parse(tournament.created_at);
        return Date.parse(tournament.internal_deadline);
      });
      return sort === 'created_desc' ? Math.max(...values) : Math.min(...values);
    }

    function renderTournamentList() {
      const status = tournamentStatusFilter.value;
      const allGroups = groupTournaments(loadedTournaments);
      let groups = allGroups;
      if (status === 'default') {
        groups = allGroups.filter((group) => group.some((tournament) => {
          const displayStatus = tournamentDisplayStatus(tournament);
          return displayStatus !== 'canceled' && displayStatus !== 'no_participants';
        }));
      } else if (status !== 'all') {
        groups = allGroups.filter((group) => group.some((tournament) => tournamentDisplayStatus(tournament) === status));
      }
      const visibleTournamentCount = groups.reduce((total, group) => total + group.length, 0);
      const sort = tournamentSort.value;
      groups.sort((left, right) => {
        const difference = groupSortValue(left, sort) - groupSortValue(right, sort);
        return sort === 'created_desc' ? -difference : difference;
      });

      tournamentList.replaceChildren();
      if (!groups.length) {
        tournamentList.append(element('div', 'empty', status === 'all' ? '登録された大会はありません。' : '該当する大会はありません。'));
      } else {
        groups.forEach((group) => tournamentList.append(renderTournament(group)));
      }
      const groupDescription = groups.length === visibleTournamentCount
        ? visibleTournamentCount + '件の大会'
        : visibleTournamentCount + '件の開催級を' + groups.length + '大会にまとめて表示';
      listStatus.textContent = groupDescription;
    }

    async function loadTournaments() {
      const openDetailsByGroup = new Map(
        [...tournamentList.querySelectorAll('.tournament-card[data-tournament-group]')]
          .map((card) => [
            card.dataset.tournamentGroup,
            [...card.querySelectorAll(':scope > details')]
              .map((details, index) => details.open ? index : -1)
              .filter((index) => index >= 0),
          ]),
      );
      refreshList.disabled = true;
      listStatus.textContent = '読み込み中…';
      try {
        const response = await fetch('/api/tournaments');
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || '大会一覧を取得できませんでした。');
        loadedTournaments = body.tournaments;
        renderTournamentList();
        [...tournamentList.querySelectorAll('.tournament-card[data-tournament-group]')]
          .forEach((card) => {
            const openIndexes = openDetailsByGroup.get(card.dataset.tournamentGroup) || [];
            const detailsNodes = [...card.querySelectorAll(':scope > details')];
            openIndexes.forEach((index) => {
              if (detailsNodes[index]) detailsNodes[index].open = true;
            });
          });
      } catch (error) {
        listStatus.textContent = error instanceof Error ? error.message : '大会一覧を取得できませんでした。';
      } finally {
        refreshList.disabled = false;
      }
    }

    async function loadMembers() {
      refreshMembers.disabled = true;
      memberStatus.textContent = '読み込み中…';
      requestStatus.textContent = '読み込み中…';
      try {
        const [memberResponse, requestResponse] = await Promise.all([
          fetch('/api/members'),
          fetch('/api/member-requests'),
        ]);
        const [body, requestBody] = await Promise.all([
          memberResponse.json(),
          requestResponse.json(),
        ]);
        if (!memberResponse.ok) throw new Error(body.error || 'メンバー一覧を取得できませんでした。');
        if (!requestResponse.ok) throw new Error(requestBody.error || '登録申請を取得できませんでした。');
        requestList.replaceChildren();
        if (!requestBody.requests.length) {
          requestList.append(element('div', 'empty', '未処理の申請はありません。'));
        } else {
          requestBody.requests.forEach((request) => requestList.append(renderRegistrationRequest(request)));
        }
        requestStatus.textContent = '未処理 ' + requestBody.requests.length + '件';
        setPendingRequestBadge(requestBody.requests.length);
        memberList.replaceChildren();
        memberList.classList.toggle('has-members', body.members.length > 0);
        if (!body.members.length) {
          memberList.append(element('div', 'empty', '登録されたメンバーはいません。'));
        } else {
          memberList.append(renderMemberTableHeader());
          body.members.forEach((member) => memberList.append(renderMember(member)));
        }
        const active = body.members.filter((member) => member.status === 'active').length;
        const dmEnabled = body.members.filter((member) => member.status === 'active' && member.dmEnabled).length;
        memberStatus.textContent = body.members.length + '人（有効 ' + active + '人・DM対象 ' + dmEnabled + '人）';
      } catch (error) {
        const message = error instanceof Error ? error.message : 'メンバー情報を取得できませんでした。';
        memberStatus.textContent = message;
        requestStatus.textContent = message;
      } finally {
        refreshMembers.disabled = false;
      }
    }

    function localJstToIso(value) {
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('締切日時を入力してください。');
      return new Date(value + ':00+09:00').toISOString();
    }

    function dateValue(date) {
      const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
      const get = (type) => parts.find((part) => part.type === type).value;
      return get('year') + '-' + get('month') + '-' + get('day');
    }

    function setInternalDeadlineFromOrganizer() {
      const organizerDeadline = form.elements.trueDeadline.value;
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(organizerDeadline)) return;
      const threeDaysEarlier = new Date(organizerDeadline + ':00+09:00');
      threeDaysEarlier.setTime(threeDaysEarlier.getTime() - 3 * 86400000);
      form.elements.internalDeadline.value = dateValue(threeDaysEarlier) + organizerDeadline.slice(10);
    }

    const now = Date.now();
    form.elements.eventDate.value = dateValue(new Date(now + 14 * 86400000));
    form.elements.trueDeadline.value = dateValue(new Date(now + 10 * 86400000)) + 'T23:59';
    setInternalDeadlineFromOrganizer();
    form.elements.trueDeadline.addEventListener('input', setInternalDeadlineFromOrganizer);
    function refreshApplicationMethodFields() {
      const method = form.elements.applicationMethod.value;
      const usesRoster = method === 'excel_email' || method === 'excel_form';
      const usesForm = method === 'excel_form' || method === 'direct_form';
      const usesEmail = method === 'excel_email';
      const usesCustomName = usesRoster && form.elements.applicationRosterFilenameMode.value === 'custom';
      applicationRosterFields.hidden = !usesRoster;
      applicationFormUrlField.hidden = !usesForm;
      applicationEmailField.hidden = !usesEmail;
      applicationRosterCustomName.hidden = !usesCustomName;
      form.elements.applicationRosterFile.required = usesRoster;
      form.elements.applicationFormUrl.required = usesForm;
      form.elements.applicationEmail.required = usesEmail;
      form.elements.applicationRosterCustomFileName.required = usesCustomName;
    }
    form.elements.applicationMethod.addEventListener('change', refreshApplicationMethodFields);
    form.elements.applicationRosterFilenameMode.addEventListener('change', refreshApplicationMethodFields);
    refreshApplicationMethodFields();
    const gradeCheckboxes = Array.from(form.querySelectorAll('input[name="grades"]'));
    const allGradesCheckbox = gradeCheckboxes.find((checkbox) => checkbox.value === 'all');
    const individualGradeCheckboxes = gradeCheckboxes.filter((checkbox) => checkbox.value !== 'all');
    allGradesCheckbox?.addEventListener('change', () => {
      individualGradeCheckboxes.forEach((checkbox) => {
        checkbox.checked = allGradesCheckbox.checked;
      });
      refreshRegistrationGradeDates();
    });
    individualGradeCheckboxes.forEach((checkbox) => {
      checkbox.addEventListener('change', () => {
        if (!checkbox.checked && allGradesCheckbox?.checked) {
          allGradesCheckbox.checked = false;
        }
        refreshRegistrationGradeDates();
      });
    });
    let previousCommonEventDate = form.elements.eventDate.value;
    form.elements.eventDate.addEventListener('input', () => {
      refreshRegistrationGradeDates(previousCommonEventDate);
      previousCommonEventDate = form.elements.eventDate.value;
    });

    function resetTournamentForm() {
      form.reset();
      gradeDateGrid.replaceChildren();
      gradeDateSettings.hidden = true;
      previousCommonEventDate = '';
      refreshApplicationMethodFields();
    }

    fetch('/api/session').then((response) => response.json()).then((data) => {
      identity.textContent = data.displayName || data.email || '認証済み';
      document.querySelector('#logout').hidden = data.provider !== 'discord';
    }).catch(() => { identity.textContent = '認証済み'; });
    loadPendingRequestCount();
    setInterval(() => {
      if (!document.hidden) loadPendingRequestCount();
    }, 30000);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) loadPendingRequestCount();
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      submit.disabled = true;
      result.className = '';
      result.textContent = '保存中…';
      const data = new FormData(form);
      try {
        const payload = Object.fromEntries(data.entries());
        delete payload.documentFile;
        delete payload.applicationRosterFile;
        delete payload.applicationRosterFilenameMode;
        delete payload.applicationRosterCustomFileName;
        payload.grades = selectedRegistrationGrades();
        if (!payload.grades.length) throw new Error('対象級を1つ以上選択してください。');
        payload.eventDatesByGrade = registrationEventDatesByGrade(payload.grades);
        payload.eventStartDate = payload.eventDate;
        payload.eventEndDate = payload.eventDate;
        delete payload.eventDate;
        payload.internalDeadline = localJstToIso(payload.internalDeadline);
        payload.trueDeadline = localJstToIso(payload.trueDeadline);
        const applicationMethod = payload.applicationMethod;
        if (!applicationMethod) throw new Error('申込方法を選択してください。');
        const usesRoster = applicationMethod === 'excel_email' || applicationMethod === 'excel_form';
        const usesForm = applicationMethod === 'excel_form' || applicationMethod === 'direct_form';
        if (usesRoster) {
          const rosterFile = form.elements.applicationRosterFile.files?.[0];
          if (!rosterFile) throw new Error('申込名簿のExcelファイルを選択してください。');
          result.textContent = '申込名簿をアップロード中…';
          const customFileName = form.elements.applicationRosterFilenameMode.value === 'custom'
            ? form.elements.applicationRosterCustomFileName.value.trim()
            : '';
          const roster = await uploadRegistrationRoster(rosterFile, payload.title, payload.grades, customFileName);
          payload.applicationRosterUrl = roster.url;
          payload.applicationRosterFileName = roster.fileName;
          payload.applicationRosterFileSize = roster.size;
          payload.applicationRosterContentType = roster.contentType;
        } else {
          payload.applicationRosterUrl = '';
          payload.applicationRosterFileName = '';
          payload.applicationRosterFileSize = 0;
          payload.applicationRosterContentType = '';
        }
        if (!usesForm) payload.applicationFormUrl = '';
        if (applicationMethod !== 'excel_email') payload.applicationEmail = '';
        const documentFile = form.elements.documentFile.files?.[0];
        if (documentFile) {
          result.textContent = 'PDFをアップロード中…';
          payload.documentUrl = await uploadPdf(
            documentFile,
            payload.title,
            payload.grades,
            Object.values(payload.eventDatesByGrade),
          );
          result.textContent = '大会を保存中…';
        }
        const response = await fetch('/api/tournaments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || '登録に失敗しました。');
        result.className = 'ok';
        result.textContent = body.message || '登録しました。Discord通知を予約しました。';
        resetTournamentForm();
      } catch (error) {
        result.className = 'error';
        result.textContent = error instanceof Error ? error.message : '登録に失敗しました。';
      } finally {
        submit.disabled = false;
      }
    });
    cancelTournamentEdit.addEventListener('click', () => editTournamentDialog.close());
    editTournamentForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!editingTournaments.length) return;
      saveTournamentEdit.disabled = true;
      editTournamentResult.className = 'status-message';
      editTournamentResult.textContent = '保存中…';
      try {
        const payload = Object.fromEntries(new FormData(editTournamentForm).entries());
        delete payload.documentFile;
        payload.tournamentIds = editingTournaments.map((tournament) => tournament.tournament_id);
        payload.eventDatesByTournament = Object.fromEntries(
          Array.from(editEventDateGrid.querySelectorAll('input[data-tournament-id]')).map((input) => [input.dataset.tournamentId, input.value]),
        );
        payload.eventStartDate = payload.eventDatesByTournament[payload.tournamentIds[0]];
        payload.internalDeadline = localJstToIso(payload.internalDeadline);
        payload.trueDeadline = localJstToIso(payload.trueDeadline);
        const documentFile = editTournamentForm.elements.documentFile.files?.[0];
        if (documentFile) {
          editTournamentResult.textContent = 'PDFをアップロード中…';
          const grades = editingTournaments.map((tournament) => tournament.all_grades === 1 ? 'all' : tournament.grade);
          payload.documentUrl = await uploadPdf(
            documentFile,
            payload.title,
            grades,
            Object.values(payload.eventDatesByTournament),
          );
          editTournamentResult.textContent = '大会情報を保存中…';
        }
        const response = await fetch('/api/tournaments', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || '大会情報を変更できませんでした。');
        editTournamentResult.className = 'status-message';
        editTournamentResult.textContent = body.message || '変更しました。';
        await loadTournaments();
        editTournamentDialog.close();
      } catch (error) {
        editTournamentResult.className = 'status-message error';
        editTournamentResult.textContent = error instanceof Error ? error.message : '大会情報を変更できませんでした。';
      } finally {
        saveTournamentEdit.disabled = false;
      }
    });
    if (currentPage === 'tournaments') {
      refreshList.addEventListener('click', loadTournaments);
      tournamentSort.addEventListener('change', renderTournamentList);
      tournamentStatusFilter.addEventListener('change', renderTournamentList);
      loadTournaments();
    }
    if (currentPage === 'members') {
      refreshMembers.addEventListener('click', loadMembers);
      loadMembers();
    }
  </script>
</body>
</html>`;
}

export async function handleAdminRequest(
  request: Request,
  env: AdminEnv,
  ctx: AdminContext,
  creator: TournamentCreator = createTournaments,
  lister: TournamentLister = listAdminTournaments,
  statusUpdater: TournamentStatusUpdater = updateTournamentStatus,
  memberLister: MemberLister = listAdminMembers,
  memberUpdater: MemberUpdater = updateAdminMember,
  memberRegistrationLister: MemberRegistrationLister = listPendingMemberRegistrations,
  memberRegistrationDecider: MemberRegistrationDecider = decideMemberRegistration,
  memberRegistrationCounter: MemberRegistrationCounter = countPendingMemberRegistrations,
  statusesUpdater: TournamentStatusesUpdater = updateTournamentStatuses,
  tournamentEditor: TournamentEditor = editTournaments,
  entryStatusUpdater: TournamentEntryStatusUpdater = updateTournamentEntryStatus,
  entryResultUpdater: TournamentEntryResultUpdater = updateTournamentEntryResult,
  archivePublisher: TournamentArchivePublisher = setTournamentArchivePublished,
): Promise<Response> {
  const url = new URL(request.url);
  const authResponse = await handleAdminAuthRequest(request, env);
  if (authResponse) return authResponse;

  let principal:
    | {
      provider: "cloudflare" | "discord";
      displayName: string;
      auditIdentity: string;
      discordUserId?: string;
    }
    | null = null;
  if (ctx.access) {
    const identity = await ctx.access.getIdentity();
    const email = identity?.email?.trim();
    if (email) {
      principal = {
        provider: "cloudflare",
        displayName: email,
        auditIdentity: email,
      };
    }
  }
  if (!principal) {
    principal = await readAdminDiscordPrincipal(request, env);
  }
  if (!principal) {
    if (url.pathname.startsWith("/api/")) {
      return json({ error: "Discordでの大会管理者ログインが必要です。" }, 401);
    }
    const returnTo = `${url.pathname}${url.search}`;
    return new Response(null, {
      status: 302,
      headers: {
        ...securityHeaders,
        Location: `/auth/discord?return_to=${encodeURIComponent(returnTo)}`,
      },
    });
  }
  const actor = principal.auditIdentity;

  if (request.method === "GET" && url.pathname === "/") {
    return new Response(null, {
      status: 302,
      headers: { ...securityHeaders, Location: "/register" },
    });
  }

  const page = {
    "/register": "register",
    "/tournaments": "tournaments",
    "/members": "members",
  }[url.pathname] as AdminPage | undefined;
  if (request.method === "GET" && page) {
    return new Response(adminHtml(page), {
      headers: { ...securityHeaders, "Content-Type": "text/html; charset=utf-8" },
    });
  }

  if (request.method === "GET" && url.pathname === "/api/session") {
    return json({
      email: principal.displayName,
      displayName: principal.displayName,
      provider: principal.provider,
    });
  }

  if (request.method === "POST" && url.pathname === "/api/documents") {
    if (!isSameOrigin(request)) {
      return json({ error: "不正な送信元です。" }, 403);
    }
    if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("multipart/form-data")) {
      return json({ error: "PDFをフォーム形式で送信してください。" }, 415);
    }
    try {
      return json(await uploadTournamentDocument(request, env, actor), 201);
    } catch (error: unknown) {
      if (error instanceof DocumentUploadError) {
        return json({ error: error.message }, 400);
      }
      console.error("大会要項PDFの保存エラー", error);
      return json({ error: "PDFを保存できませんでした。" }, 500);
    }
  }

  if (request.method === "POST" && url.pathname === "/api/application-roster") {
    if (!isSameOrigin(request)) {
      return json({ error: "不正な送信元です。" }, 403);
    }
    if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("multipart/form-data")) {
      return json({ error: "申込名簿をフォーム形式で送信してください。" }, 415);
    }
    try {
      return json({
        document: await uploadApplicationRoster(request, env, actor),
      }, 201);
    } catch (error: unknown) {
      if (error instanceof DocumentUploadError) {
        return json({ error: error.message }, 400);
      }
      console.error("申込名簿Excelの保存エラー", error);
      return json({ error: "申込名簿を保存できませんでした。" }, 500);
    }
  }

  if (request.method === "POST" && url.pathname === "/api/archive-documents") {
    if (!isSameOrigin(request)) {
      return json({ error: "不正な送信元です。" }, 403);
    }
    if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("multipart/form-data")) {
      return json({ error: "PDFをフォーム形式で送信してください。" }, 415);
    }
    try {
      return json({
        document: await uploadTournamentArchiveDocument(env, request, actor),
      }, 201);
    } catch (error: unknown) {
      if (error instanceof DocumentUploadError) {
        return json({ error: error.message }, 400);
      }
      console.error("大会記録PDFの保存エラー", error);
      return json({ error: "大会記録PDFを保存できませんでした。" }, 500);
    }
  }

  if (request.method === "POST" && url.pathname === "/api/confirmation-roster") {
    if (!isSameOrigin(request)) {
      return json({ error: "不正な送信元です。" }, 403);
    }
    if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("multipart/form-data")) {
      return json({ error: "確認名簿をフォーム形式で送信してください。" }, 415);
    }
    try {
      return json({ roster: await saveConfirmationRoster(env, request, actor) }, 201);
    } catch (error: unknown) {
      if (error instanceof DocumentUploadError || error instanceof AdminRequestError) {
        return json({ error: error.message }, 400);
      }
      console.error("申込確認名簿の保存エラー", error);
      return json({ error: "申込確認名簿を保存できませんでした。" }, 500);
    }
  }

  if (request.method === "POST" && url.pathname === "/api/confirmation-roster/send") {
    if (!isSameOrigin(request)) {
      return json({ error: "不正な送信元です。" }, 403);
    }
    if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
      return json({ error: "JSON形式で送信してください。" }, 415);
    }
    try {
      const body = (await request.json()) as { tournamentIds?: unknown };
      if (!Array.isArray(body.tournamentIds)) {
        throw new AdminRequestError("大会IDを指定してください。", 400);
      }
      return json(await queueConfirmationRoster(env, body.tournamentIds.map(String)));
    } catch (error: unknown) {
      if (error instanceof AdminRequestError) {
        return json({ error: error.message }, error.status);
      }
      const message = error instanceof Error ? error.message : "確認名簿DMを予約できませんでした。";
      console.error("申込確認名簿DMの予約エラー", error);
      return json({ error: message }, 409);
    }
  }

  if (request.method === "GET" && url.pathname === "/api/tournaments") {
    try {
      return json({ tournaments: await lister(env) });
    } catch (error: unknown) {
      console.error("大会一覧・回答集計の取得エラー", error);
      return json({ error: "大会一覧を取得できませんでした。" }, 500);
    }
  }

  if (request.method === "GET" && url.pathname === "/api/members") {
    try {
      return json({ members: await memberLister(env) });
    } catch (error: unknown) {
      console.error("メンバー一覧の取得エラー", error);
      return json({ error: "メンバー一覧を取得できませんでした。" }, 500);
    }
  }

  if (request.method === "GET" && url.pathname === "/api/member-requests") {
    try {
      return json({ requests: await memberRegistrationLister(env) });
    } catch (error: unknown) {
      console.error("メンバー登録申請一覧の取得エラー", error);
      return json({ error: "メンバー登録申請を取得できませんでした。" }, 500);
    }
  }

  if (request.method === "GET" && url.pathname === "/api/member-requests/count") {
    try {
      return json({ count: await memberRegistrationCounter(env) });
    } catch (error: unknown) {
      console.error("未処理メンバー登録申請数の取得エラー", error);
      return json({ error: "未処理申請数を取得できませんでした。" }, 500);
    }
  }

  const memberRequestPath = url.pathname.match(
    /^\/api\/member-requests\/(MR-[0-9a-f-]{36})$/,
  );
  if (request.method === "PATCH" && memberRequestPath) {
    if (!isSameOrigin(request)) {
      return json({ error: "不正な送信元です。" }, 403);
    }
    if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
      return json({ error: "JSON形式で送信してください。" }, 415);
    }
    let decision = "";
    try {
      const body = (await request.json()) as { decision?: unknown };
      decision = typeof body.decision === "string" ? body.decision : "";
    } catch {
      return json({ error: "入力内容を確認してください。" }, 400);
    }

    try {
      return json(
        await memberRegistrationDecider(
          env,
          memberRequestPath[1],
          decision,
          actor,
        ),
      );
    } catch (error: unknown) {
      if (error instanceof MemberAdminError) {
        return json({ error: error.message }, error.statusCode);
      }
      console.error("メンバー登録申請の承認エラー", error);
      return json({ error: "登録申請を処理できませんでした。" }, 500);
    }
  }

  const memberPath = url.pathname.match(/^\/api\/members\/(M-[0-9a-f-]{36})$/);
  if (request.method === "PATCH" && memberPath) {
    if (!isSameOrigin(request)) {
      return json({ error: "不正な送信元です。" }, 403);
    }
    if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
      return json({ error: "JSON形式で送信してください。" }, 415);
    }

    let body: MemberUpdateInput;
    try {
      body = (await request.json()) as MemberUpdateInput;
    } catch {
      return json({ error: "入力内容を確認してください。" }, 400);
    }

    try {
      const member = await memberUpdater(env, memberPath[1], body, actor);
      return json({ member });
    } catch (error: unknown) {
      if (error instanceof MemberAdminError) {
        return json({ error: error.message }, error.statusCode);
      }
      console.error("メンバー情報の変更エラー", error);
      return json({ error: "メンバー情報を変更できませんでした。" }, 500);
    }
  }

  if (request.method === "POST" && url.pathname === "/api/tournaments") {
    if (!isSameOrigin(request)) {
      return json({ error: "不正な送信元です。" }, 403);
    }
    if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
      return json({ error: "JSON形式で送信してください。" }, 415);
    }

    let inputs: TournamentInput[];
    try {
      const body = (await request.json()) as Partial<TournamentInput> & {
        grades?: unknown;
        eventDatesByGrade?: unknown;
      };
      const grades = normalizeTournamentGrades(body.grades ?? body.grade);
      if (!body.applicationMethod) {
        throw new Error("申込方法を選択してください。");
      }
      if (
        body.eventDatesByGrade !== undefined &&
        (typeof body.eventDatesByGrade !== "object" ||
          body.eventDatesByGrade === null ||
          Array.isArray(body.eventDatesByGrade))
      ) {
        throw new Error("級別の開催日が不正です。");
      }
      const eventDatesByGrade = body.eventDatesByGrade as Record<string, unknown> | undefined;
      inputs = grades.map((grade) =>
        normalizeTournamentInput({
          ...body,
          grade,
          eventStartDate: String(eventDatesByGrade?.[grade] ?? body.eventStartDate ?? ""),
          eventEndDate: String(eventDatesByGrade?.[grade] ?? body.eventStartDate ?? ""),
          createdByDiscordUserId: principal.discordUserId,
          createdByEmail: actor,
        } as TournamentInput),
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "入力内容を確認してください。";
      return json({ error: message }, 400);
    }

    try {
      const tournaments = await creator(env, inputs);
      return json(
        {
          ok: true,
          tournamentId: tournaments[0]?.tournament_id,
          tournamentIds: tournaments.map((tournament) => tournament.tournament_id),
          message:
            tournaments.length === 1
              ? "大会を登録し、Discord通知を予約しました。"
              : `${tournaments.length}件の級別大会を一括登録し、Discord通知を予約しました。`,
        },
        201,
      );
    } catch (error: unknown) {
      console.error("Web管理画面からの大会登録エラー", error);
      return json({ error: "大会の保存に失敗しました。" }, 500);
    }
  }

  if (request.method === "PATCH" && url.pathname === "/api/tournaments") {
    if (!isSameOrigin(request)) {
      return json({ error: "不正な送信元です。" }, 403);
    }
    if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
      return json({ error: "JSON形式で送信してください。" }, 415);
    }
    try {
      const body = (await request.json()) as TournamentEditInput & {
        tournamentIds?: unknown;
      };
      if (!Array.isArray(body.tournamentIds)) {
        throw new AdminRequestError("大会IDを指定してください。", 400);
      }
      const result = await tournamentEditor(
        env,
        body.tournamentIds.map(String),
        body,
        actor,
      );
      return json({
        ok: true,
        ...result,
        message:
          result.notificationsQueued > 0
            ? "大会情報を更新し、Discordへの更新通知を予約しました。"
            : "大会情報を更新しました。",
      });
    } catch (error: unknown) {
      if (error instanceof AdminRequestError) {
        return json({ error: error.message }, error.status);
      }
      if (error instanceof Error && !error.message.includes("D1_")) {
        return json({ error: error.message }, 400);
      }
      console.error("大会情報の編集エラー", error);
      return json({ error: "大会情報を変更できませんでした。" }, 500);
    }
  }

  if (request.method === "POST" && url.pathname === "/api/participant-guidance") {
    if (!isSameOrigin(request)) {
      return json({ error: "不正な送信元です。" }, 403);
    }
    if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("multipart/form-data")) {
      return json({ error: "案内をフォーム形式で送信してください。" }, 415);
    }
    try {
      return json({
        guidance: await saveParticipantGuidance(env, request, actor),
      }, 201);
    } catch (error: unknown) {
      if (error instanceof DocumentUploadError || error instanceof AdminRequestError) {
        return json({ error: error.message }, 400);
      }
      console.error("参加者向け案内の保存エラー", error);
      return json({ error: "参加者向け案内を保存できませんでした。" }, 500);
    }
  }

  if (request.method === "POST" && url.pathname === "/api/participant-guidance/send") {
    if (!isSameOrigin(request)) {
      return json({ error: "不正な送信元です。" }, 403);
    }
    if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
      return json({ error: "JSON形式で送信してください。" }, 415);
    }
    try {
      const body = (await request.json()) as { tournamentIds?: unknown };
      if (!Array.isArray(body.tournamentIds)) {
        throw new AdminRequestError("大会IDを指定してください。", 400);
      }
      const result = await queueParticipantGuidance(
        env,
        body.tournamentIds.map(String),
      );
      return json(result);
    } catch (error: unknown) {
      if (error instanceof AdminRequestError) {
        return json({ error: error.message }, error.status);
      }
      const message = error instanceof Error ? error.message : "DM送信を予約できませんでした。";
      console.error("参加者向け案内DMの予約エラー", error);
      return json({ error: message }, 409);
    }
  }

  if (request.method === "POST" && url.pathname === "/api/lottery-results/send") {
    if (!isSameOrigin(request)) {
      return json({ error: "不正な送信元です。" }, 403);
    }
    if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
      return json({ error: "JSON形式で送信してください。" }, 415);
    }
    try {
      const body = (await request.json()) as { tournamentIds?: unknown };
      if (!Array.isArray(body.tournamentIds)) {
        throw new AdminRequestError("大会IDを指定してください。", 400);
      }
      return json(await queueLotteryResultsAndGuidance(
        env,
        body.tournamentIds.map(String),
        actor,
      ));
    } catch (error: unknown) {
      if (error instanceof AdminRequestError) {
        return json({ error: error.message }, error.status);
      }
      const message = error instanceof Error
        ? error.message
        : "抽選結果と確定者案内を予約できませんでした。";
      console.error("抽選結果・確定者案内の予約エラー", error);
      return json({ error: message }, 409);
    }
  }

  if (request.method === "PATCH" && url.pathname === "/api/tournaments/status") {
    if (!isSameOrigin(request)) {
      return json({ error: "不正な送信元です。" }, 403);
    }
    if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
      return json({ error: "JSON形式で送信してください。" }, 415);
    }
    try {
      const body = (await request.json()) as {
        tournamentIds?: unknown;
        status?: unknown;
      };
      if (!Array.isArray(body.tournamentIds)) {
        throw new AdminRequestError("大会IDを指定してください。", 400);
      }
      const status = typeof body.status === "string" ? body.status : "";
      const result = await statusesUpdater(
        env,
        body.tournamentIds.map(String),
        status,
        actor,
      );
      return json({
        ...result,
        message:
          status === "applied"
            ? "申込完了へ変更し、告知チャンネルへの通知を予約しました。"
            : `${result.changedCount}件のステータスを変更しました。`,
      });
    } catch (error: unknown) {
      if (error instanceof AdminRequestError) {
        return json({ error: error.message }, error.status);
      }
      console.error("大会ステータス一括変更エラー", error);
      return json({ error: "ステータスを変更できませんでした。" }, 500);
    }
  }

  if (request.method === "PATCH" && url.pathname === "/api/tournaments/archive") {
    if (!isSameOrigin(request)) {
      return json({ error: "不正な送信元です。" }, 403);
    }
    if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
      return json({ error: "JSON形式で送信してください。" }, 415);
    }
    try {
      const body = (await request.json()) as {
        tournamentIds?: unknown;
        published?: unknown;
      };
      if (!Array.isArray(body.tournamentIds) || typeof body.published !== "boolean") {
        throw new AdminRequestError("大会IDと公開状態を指定してください。", 400);
      }
      return json(await archivePublisher(
        env,
        body.tournamentIds.map(String),
        body.published,
        actor,
      ));
    } catch (error: unknown) {
      if (error instanceof AdminRequestError) {
        return json({ error: error.message }, error.status);
      }
      console.error("大会記録の公開状態変更エラー", error);
      return json({ error: "大会記録の公開状態を変更できませんでした。" }, 500);
    }
  }

  if (request.method === "PATCH" && url.pathname === "/api/tournament-entries/batch") {
    if (!isSameOrigin(request)) {
      return json({ error: "不正な送信元です。" }, 403);
    }
    if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
      return json({ error: "JSON形式で送信してください。" }, 415);
    }
    try {
      const body = (await request.json()) as { entries?: unknown };
      if (!Array.isArray(body.entries)) {
        throw new AdminRequestError("保存対象を指定してください。", 400);
      }
      const entries: TournamentEntryBatchInput[] = body.entries.map((value) => {
        const entry = value && typeof value === "object"
          ? value as Record<string, unknown>
          : {};
        return {
          tournamentId: typeof entry.tournamentId === "string" ? entry.tournamentId : "",
          memberId: typeof entry.memberId === "string" ? entry.memberId : "",
          status: typeof entry.status === "string" ? entry.status : "",
          waitlistNumber: typeof entry.waitlistNumber === "number" ? entry.waitlistNumber : null,
          paymentStatus: entry.paymentStatus === "unpaid" || entry.paymentStatus === "paid"
            ? entry.paymentStatus
            : null,
        };
      });
      return json(await updateTournamentEntriesBatch(env, entries, actor));
    } catch (error: unknown) {
      if (error instanceof AdminRequestError) {
        return json({ error: error.message }, error.status);
      }
      console.error("申込・抽選結果の一括変更エラー", error);
      return json({ error: "全員分の変更を保存できませんでした。" }, 500);
    }
  }

  const entryPaymentPath = url.pathname.match(
    /^\/api\/tournaments\/(T-[0-9a-f-]{36})\/entries\/(M-[0-9a-f-]{36})\/payment$/,
  );
  if (request.method === "PATCH" && entryPaymentPath) {
    if (!isSameOrigin(request)) {
      return json({ error: "不正な送信元です。" }, 403);
    }
    if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
      return json({ error: "JSON形式で送信してください。" }, 415);
    }
    try {
      const body = (await request.json()) as { status?: unknown };
      const status = typeof body.status === "string" ? body.status : "";
      return json(await updateTournamentEntryPayment(
        env,
        entryPaymentPath[1],
        entryPaymentPath[2],
        status,
        actor,
      ));
    } catch (error: unknown) {
      if (error instanceof AdminRequestError) {
        return json({ error: error.message }, error.status);
      }
      console.error("入金状態の変更エラー", error);
      return json({ error: "入金状態を変更できませんでした。" }, 500);
    }
  }

  const entryResultPath = url.pathname.match(
    /^\/api\/tournaments\/(T-[0-9a-f-]{36})\/entries\/(M-[0-9a-f-]{36})\/result$/,
  );
  if (request.method === "PATCH" && entryResultPath) {
    if (!isSameOrigin(request)) {
      return json({ error: "不正な送信元です。" }, 403);
    }
    if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
      return json({ error: "JSON形式で送信してください。" }, 415);
    }
    let resultText = "";
    try {
      const body = (await request.json()) as { resultText?: unknown };
      resultText = typeof body.resultText === "string" ? body.resultText : "";
    } catch {
      return json({ error: "入力内容を確認してください。" }, 400);
    }
    try {
      return json(await entryResultUpdater(
        env,
        entryResultPath[1],
        entryResultPath[2],
        resultText,
        actor,
      ));
    } catch (error: unknown) {
      if (error instanceof AdminRequestError) {
        return json({ error: error.message }, error.status);
      }
      console.error("個人成績の変更エラー", error);
      return json({ error: "個人成績を変更できませんでした。" }, 500);
    }
  }

  const entryPath = url.pathname.match(
    /^\/api\/tournaments\/(T-[0-9a-f-]{36})\/entries\/(M-[0-9a-f-]{36})$/,
  );
  if (request.method === "PATCH" && entryPath) {
    if (!isSameOrigin(request)) {
      return json({ error: "不正な送信元です。" }, 403);
    }
    if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
      return json({ error: "JSON形式で送信してください。" }, 415);
    }
    let status = "";
    let waitlistNumber: number | null = null;
    try {
      const body = (await request.json()) as {
        status?: unknown;
        waitlistNumber?: unknown;
      };
      status = typeof body.status === "string" ? body.status : "";
      waitlistNumber = typeof body.waitlistNumber === "number"
        ? body.waitlistNumber
        : null;
    } catch {
      return json({ error: "入力内容を確認してください。" }, 400);
    }
    try {
      return json(
        await entryStatusUpdater(
          env,
          entryPath[1],
          entryPath[2],
          status,
          waitlistNumber,
          actor,
        ),
      );
    } catch (error: unknown) {
      if (error instanceof AdminRequestError) {
        return json({ error: error.message }, error.status);
      }
      console.error("申込・抽選結果の変更エラー", error);
      return json({ error: "申込・抽選結果を変更できませんでした。" }, 500);
    }
  }

  const statusPath = url.pathname.match(
    /^\/api\/tournaments\/(T-[0-9a-f-]{36})\/status$/,
  );
  if (request.method === "PATCH" && statusPath) {
    if (!isSameOrigin(request)) {
      return json({ error: "不正な送信元です。" }, 403);
    }
    if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
      return json({ error: "JSON形式で送信してください。" }, 415);
    }

    let status: string;
    try {
      const body = (await request.json()) as { status?: unknown };
      status = typeof body.status === "string" ? body.status : "";
      if (!MANAGEABLE_STATUSES.has(status)) {
        throw new AdminRequestError("変更先のステータスが不正です。", 400);
      }
    } catch (error: unknown) {
      const requestError =
        error instanceof AdminRequestError
          ? error
          : new AdminRequestError("入力内容を確認してください。", 400);
      return json({ error: requestError.message }, requestError.status);
    }

    try {
      return json(
        await statusUpdater(env, statusPath[1], status, actor),
      );
    } catch (error: unknown) {
      if (error instanceof AdminRequestError) {
        return json({ error: error.message }, error.status);
      }
      console.error("大会ステータス変更エラー", error);
      return json({ error: "ステータスを変更できませんでした。" }, 500);
    }
  }

  return json({ error: "Not Found" }, 404);
}

export default {
  fetch(request: Request, env: AdminEnv, ctx: ExecutionContext): Promise<Response> {
    return handleAdminRequest(request, env, ctx);
  },
} satisfies ExportedHandler<AdminEnv>;
