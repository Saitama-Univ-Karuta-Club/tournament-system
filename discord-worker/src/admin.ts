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

export interface AdminEnv extends TournamentEnv {}

type AdminContext = Pick<ExecutionContext, "access" | "waitUntil">;
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
  created_at: string;
  announcements_sent: number;
  invitation_dms_sent: number;
  notifications_queued: number;
  notification_failures: number;
}

interface AdminResponseRow {
  tournament_id: string;
  response: string;
  display_name: string;
  display_name_kana: string;
  grade: string;
  is_eligible: number;
  updated_at: string;
}

export interface AdminTournament extends AdminTournamentRow {
  response_yes: number;
  response_maybe: number;
  response_no: number;
  eligible_members: number;
  response_total: number;
  response_pending: number;
  responses: AdminResponseRow[];
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

interface EditableTournamentRow extends TournamentRow {
  status: string;
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
      status
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

async function editFingerprint(input: TournamentEditInput): Promise<string> {
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
      tournaments.status,
      tournaments.created_at,
      (SELECT COUNT(*) FROM notification_deliveries
        WHERE notification_deliveries.tournament_id = tournaments.tournament_id
          AND notification_deliveries.notification_type = 'announcement'
          AND notification_deliveries.status = 'sent') AS announcements_sent,
      (SELECT COUNT(*) FROM notification_deliveries
        WHERE notification_deliveries.tournament_id = tournaments.tournament_id
          AND notification_deliveries.notification_type = 'invitation_dm'
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
    WHERE tournaments.status <> 'deleted'
    ORDER BY tournaments.created_at DESC
    LIMIT 100`,
  ).all<AdminTournamentRow>();

  const responseRows = await env.DB.prepare(
    `SELECT
      tournaments.tournament_id,
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
      COALESCE(responses.updated_at, members.updated_at) AS updated_at
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
    WHERE tournaments.status <> 'deleted'
    ORDER BY
      tournaments.tournament_id,
      members.grade,
      display_name_kana,
      members.display_name`,
  ).all<AdminResponseRow>();

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
  const changed = tournaments.filter((tournament) => tournament.status !== status);
  if (changed.length > 0) {
    const now = new Date().toISOString();
    await env.DB.batch(
      changed.flatMap((tournament) => [
        env.DB.prepare(
          `UPDATE tournaments
           SET status = ?, updated_at = ?,
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
  const normalized = normalizeTournamentInput({
    ...rawInput,
    eventEndDate: rawInput.eventStartDate,
    grade: tournaments[0].all_grades === 1 ? "all" : tournaments[0].grade,
    createdByEmail: changedByEmail,
  });
  const editableData = {
    title: normalized.title,
    eventStartDate: normalized.eventStartDate,
    tournamentType: normalized.tournamentType,
    venue: normalized.venue || "",
    trueDeadline: normalized.trueDeadline,
    internalDeadline: normalized.internalDeadline,
    documentUrl: normalized.documentUrl || "",
  };
  const changed = tournaments.filter((tournament) =>
    tournament.title !== editableData.title ||
    tournament.event_start_date !== editableData.eventStartDate ||
    tournament.event_end_date !== editableData.eventStartDate ||
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
      const previousData = {
        title: tournament.title,
        eventStartDate: tournament.event_start_date,
        tournamentType: tournament.tournament_type,
        venue: tournament.venue ?? "",
        trueDeadline: tournament.true_deadline,
        internalDeadline: tournament.internal_deadline,
        documentUrl: tournament.document_url ?? "",
      };
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
          editableData.eventStartDate,
          editableData.eventStartDate,
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
          JSON.stringify(editableData),
          changedByEmail,
          now,
        ),
      ];
    }),
  );

  const updated = tournaments.map((tournament) => ({
    ...tournament,
    title: editableData.title,
    event_start_date: editableData.eventStartDate,
    event_end_date: editableData.eventStartDate,
    tournament_type: editableData.tournamentType,
    venue: editableData.venue || null,
    true_deadline: editableData.trueDeadline,
    internal_deadline: editableData.internalDeadline,
    document_url: editableData.documentUrl || null,
  }));
  const revision = await editFingerprint(editableData);
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
    #identity { font-size: .82rem; opacity: .85; }
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
    .grid > label, .grid > fieldset { width: 100%; }
    label { display: grid; gap: 7px; font-weight: 650; font-size: .9rem; }
    .wide { grid-column: 1 / -1; }
    .optional { color: #697386; font-size: .78rem; font-weight: 500; }
    input, select { width: 100%; border: 1px solid #b9c1d0; border-radius: 8px; padding: 11px 12px; font: inherit; color: inherit; background: white; }
    input:focus, select:focus { outline: 3px solid #7c9cff3b; border-color: #526fc4; }
    .grade-picker { min-width: 0; margin: 0; padding: 0; border: 0; }
    .grade-picker legend { margin-bottom: 7px; padding: 0; font-size: .9rem; font-weight: 650; }
    .grade-options { display: flex; flex-wrap: wrap; gap: 8px; padding: 9px; border: 1px solid #b9c1d0; border-radius: 8px; background: #fff; }
    .grade-option { display: inline-flex; grid-template-columns: none; align-items: center; gap: 6px; padding: 3px 7px; border-radius: 6px; font-weight: 600; white-space: nowrap; }
    .grade-option:has(input:checked) { color: #294796; background: #edf1ff; }
    .grade-option input { width: auto; margin: 0; }
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
    button.success { padding: 9px 14px; background: #18794e; }
    button.success:hover { background: #12633f; }
    .meta { color: #596579; margin: 8px 0 14px; font-size: .88rem; line-height: 1.6; }
    .badge { display: inline-flex; align-items: center; border-radius: 999px; padding: 5px 10px; font-size: .78rem; font-weight: 750; white-space: nowrap; }
    .badge.active { color: #17643a; background: #e4f7ec; }
    .badge.applied { color: #2452a4; background: #e7efff; }
    .badge.closed { color: #596579; background: #edf0f5; }
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
    #member-status { color: #697386; margin-bottom: 12px; }
    #member-list { display: grid; gap: 12px; }
    .member-card { border: 1px solid #dce1eb; border-radius: 10px; padding: 16px; }
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
    @media (max-width: 680px) { .grid, .response-sections, .member-grid, .request-comparison { grid-template-columns: 1fr; } .request-arrow { transform: rotate(90deg); text-align: center; } .wide { grid-column: auto; } .panel { padding: 18px; } .header-inner { display: block; } #identity { display: block; margin-top: 6px; } .tabs { padding: 0 8px; } .tab { padding-inline: 13px; } .card-heading { align-items: flex-start; } .list-controls { align-items: stretch; } .list-controls label { flex: 1 1 100%; } }
  </style>
</head>
<body data-page="${page}">
  <header><div class="header-inner"><h1>大会管理（Discord版MVP）</h1><span id="identity">認証情報を確認中…</span></div></header>
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
        <label>主催締切日<input type="datetime-local" name="trueDeadline" required></label>
        <label><span>サークル内締切日 <span class="optional">（基本的に主催締切日の3日前を自動入力）</span></span><input type="datetime-local" name="internalDeadline" required></label>
        <label class="wide">会場 <span class="optional">任意</span><input name="venue" maxlength="200" autocomplete="off"></label>
        <label class="wide">大会要項 <span class="optional">任意・URLを入力</span><input type="url" name="documentUrl" maxlength="500" placeholder="https://..."></label>
      </div>
      <div class="actions"><button id="submit" type="submit">登録して通知を開始</button><span id="result" role="status" aria-live="polite"></span></div>
      <div class="footnote">複数級を選ぶと、同じ内容で級ごとに独立した大会として一括登録します。「すべて」は1件の大会として登録し、全級のメンバーへDMを送ります。</div>
    </form>
    <section class="panel" aria-labelledby="tournament-list-title"${hiddenPage("tournaments")}>
      <div class="list-heading">
        <h2 id="tournament-list-title">大会一覧・回答集計</h2>
        <button id="refresh-list" type="button" class="secondary">再読み込み</button>
      </div>
      <div class="list-controls">
        <label>並び順<select id="tournament-sort"><option value="deadline_asc">締切日が近い順</option><option value="event_asc">開催日が近い順</option><option value="created_desc">登録日が新しい順</option><option value="created_asc">登録日が古い順</option></select></label>
        <label>ステータス<select id="tournament-status-filter"><option value="all">すべて</option><option value="active">回答受付中</option><option value="applied">申込完了</option><option value="closed">締切済み</option><option value="canceled">中止</option><option value="draft">下書き</option></select></label>
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
        <label>開催日<input type="date" name="eventStartDate" required></label>
        <label>大会種別<select name="tournamentType" required><option value="official">公認大会</option><option value="support">後援大会</option><option value="event">その他イベント</option></select></label>
        <label>主催締切日<input type="datetime-local" name="trueDeadline" required></label>
        <label>サークル内締切日<input type="datetime-local" name="internalDeadline" required></label>
        <label class="wide">会場 <span class="optional">任意</span><input name="venue" maxlength="200" autocomplete="off"></label>
        <label class="wide">大会要項 <span class="optional">任意・URLを入力</span><input type="url" name="documentUrl" maxlength="500" placeholder="https://..."></label>
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
    const editTournamentResult = document.querySelector('#edit-tournament-result');
    const saveTournamentEdit = document.querySelector('#save-tournament-edit');
    const cancelTournamentEdit = document.querySelector('#cancel-tournament-edit');
    const memberList = document.querySelector('#member-list');
    const memberStatus = document.querySelector('#member-status');
    const refreshMembers = document.querySelector('#refresh-members');
    const requestList = document.querySelector('#request-list');
    const requestStatus = document.querySelector('#request-status');
    const pendingRequestBadge = document.querySelector('#pending-request-badge');
    const statusLabels = {
      draft: '下書き',
      active: '回答受付中',
      applied: '申込完了',
      closed: '締切済み',
      canceled: '中止',
    };
    const responseLabels = {
      yes: '参加',
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
      editTournamentForm.elements.eventStartDate.value = tournament.event_start_date;
      editTournamentForm.elements.tournamentType.value = tournament.tournament_type;
      editTournamentForm.elements.trueDeadline.value = dateTimeInputValue(tournament.true_deadline);
      editTournamentForm.elements.internalDeadline.value = dateTimeInputValue(tournament.internal_deadline);
      editTournamentForm.elements.venue.value = tournament.venue || '';
      editTournamentForm.elements.documentUrl.value = tournament.document_url || '';
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
        row.append(
          element('span', 'response-grade', currentGrade === previousGrade ? '' : currentGrade),
          element('span', '', person.display_name + ' (' + (person.display_name_kana || 'よみがな未登録') + ')'),
        );
        previousGrade = currentGrade;
        section.append(row);
      });
      return section;
    }

    function renderTournamentStatusControl(tournament) {
      const statusRow = element('div', 'status-row');
      const labelText = tournament.all_grades === 1 ? 'すべて' : gradeLabel(tournament.grade);
      const statusLabel = element('label', '', labelText + ' ステータス');
      const select = document.createElement('select');
      Object.entries(statusLabels).forEach(([value, label]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        option.selected = value === tournament.status;
        select.append(option);
      });
      statusLabel.append(select);
      const updateButton = element('button', 'secondary', '変更を保存');
      updateButton.type = 'button';
      const statusMessage = element('span', 'status-message', '');
      updateButton.addEventListener('click', async () => {
        updateButton.disabled = true;
        statusMessage.className = 'status-message';
        statusMessage.textContent = '変更中…';
        try {
          const response = await fetch('/api/tournaments/' + encodeURIComponent(tournament.tournament_id) + '/status', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: select.value }),
          });
          const body = await response.json();
          if (!response.ok) throw new Error(body.error || '変更に失敗しました。');
          statusMessage.textContent = body.changed ? '変更しました。' : '変更はありません。';
          await loadTournaments();
        } catch (error) {
          statusMessage.className = 'status-message error';
          statusMessage.textContent = error instanceof Error ? error.message : '変更に失敗しました。';
        } finally {
          updateButton.disabled = false;
        }
      });
      statusRow.append(statusLabel, updateButton, statusMessage);
      return statusRow;
    }

    function renderTournament(tournaments) {
      const tournament = tournaments[0];
      const card = element('article', 'tournament-card');
      const heading = element('div', 'card-heading');
      const statuses = [...new Set(tournaments.map((item) => item.status))];
      heading.append(
        element('h3', '', tournament.title),
        element('span', 'badge ' + (statuses.length === 1 ? statuses[0] : 'draft'), statuses.length === 1 ? (statusLabels[statuses[0]] || statuses[0]) : '複数ステータス'),
      );
      card.append(heading);

      const eventDates = tournament.event_start_date === tournament.event_end_date
        ? tournament.event_start_date
        : tournament.event_start_date + '〜' + tournament.event_end_date;
      const metaParts = [
        tournaments.map(tournamentGradeLabel).join('・'),
        eventDates,
        'サークル内締切 ' + dateTimeLabel(tournament.internal_deadline),
      ];
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

      const cardActions = element('div', 'card-actions');
      const editButton = element('button', 'secondary', '大会情報を編集');
      editButton.type = 'button';
      editButton.addEventListener('click', () => openTournamentEditor(tournaments));
      const completeButton = element('button', 'success', tournaments.every((item) => item.status === 'applied') ? '申込完了済み' : '申込完了にする');
      completeButton.type = 'button';
      completeButton.disabled = tournaments.every((item) => item.status === 'applied');
      completeButton.addEventListener('click', async () => {
        const grades = tournaments.map(tournamentGradeLabel).join('・');
        if (!confirm(tournament.title + '（' + grades + '）を申込完了にして、告知チャンネルへ通知しますか？')) return;
        completeButton.disabled = true;
        completeButton.textContent = '変更中…';
        try {
          const response = await fetch('/api/tournaments/status', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tournamentIds: tournaments.map((item) => item.tournament_id),
              status: 'applied',
            }),
          });
          const body = await response.json();
          if (!response.ok) throw new Error(body.error || '申込完了に変更できませんでした。');
          await loadTournaments();
        } catch (error) {
          alert(error instanceof Error ? error.message : '申込完了に変更できませんでした。');
          completeButton.disabled = false;
          completeButton.textContent = '申込完了にする';
        }
      });
      cardActions.append(editButton, completeButton);
      card.append(cardActions);

      const responseSections = element('div', 'response-sections');
      responseSections.append(
        responseSection(tournaments, 'yes'),
        responseSection(tournaments, 'maybe'),
        responseSection(tournaments, 'no'),
        responseSection(tournaments, 'pending'),
      );
      card.append(responseSections);

      tournaments.forEach((item) => card.append(renderTournamentStatusControl(item)));

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

    function renderMember(member) {
      const card = element('article', 'member-card');
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
      card.append(grid);

      const actions = element('div', 'member-actions');
      const save = element('button', 'secondary', '変更を保存');
      save.type = 'button';
      const message = element('span', 'status-message', '');
      const linkState = element('span', 'member-link', member.discordLinked ? 'Discord連携済み' : 'Discord未連携');
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
      actions.append(save, message, linkState);
      card.append(actions);
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
      const groups = status === 'all'
        ? allGroups
        : allGroups.filter((group) => group.some((tournament) => tournament.status === status));
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
      refreshList.disabled = true;
      listStatus.textContent = '読み込み中…';
      try {
        const response = await fetch('/api/tournaments');
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || '大会一覧を取得できませんでした。');
        loadedTournaments = body.tournaments;
        renderTournamentList();
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
        if (!body.members.length) {
          memberList.append(element('div', 'empty', '登録されたメンバーはいません。'));
        } else {
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
    const gradeCheckboxes = Array.from(form.querySelectorAll('input[name="grades"]'));
    const allGradesCheckbox = gradeCheckboxes.find((checkbox) => checkbox.value === 'all');
    const individualGradeCheckboxes = gradeCheckboxes.filter((checkbox) => checkbox.value !== 'all');
    allGradesCheckbox?.addEventListener('change', () => {
      individualGradeCheckboxes.forEach((checkbox) => {
        checkbox.checked = allGradesCheckbox.checked;
      });
    });
    individualGradeCheckboxes.forEach((checkbox) => {
      checkbox.addEventListener('change', () => {
        if (!checkbox.checked && allGradesCheckbox?.checked) {
          allGradesCheckbox.checked = false;
        }
      });
    });

    fetch('/api/session').then((response) => response.json()).then((data) => {
      identity.textContent = data.email || '認証済み';
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
        payload.grades = allGradesCheckbox?.checked
          ? ['all']
          : data.getAll('grades').filter((grade) => grade !== 'all');
        if (!payload.grades.length) throw new Error('対象級を1つ以上選択してください。');
        payload.eventStartDate = payload.eventDate;
        payload.eventEndDate = payload.eventDate;
        delete payload.eventDate;
        payload.internalDeadline = localJstToIso(payload.internalDeadline);
        payload.trueDeadline = localJstToIso(payload.trueDeadline);
        const response = await fetch('/api/tournaments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || '登録に失敗しました。');
        result.className = 'ok';
        result.textContent = body.message || '登録しました。Discord通知を予約しました。';
        form.elements.title.value = '';
        form.elements.venue.value = '';
        form.elements.documentUrl.value = '';
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
        payload.tournamentIds = editingTournaments.map((tournament) => tournament.tournament_id);
        payload.internalDeadline = localJstToIso(payload.internalDeadline);
        payload.trueDeadline = localJstToIso(payload.trueDeadline);
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
): Promise<Response> {
  if (!ctx.access) {
    return json({ error: "Cloudflare Accessによる認証が必要です。" }, 403);
  }

  const identity = await ctx.access.getIdentity();
  const email = identity?.email?.trim();
  if (!email) {
    return json({ error: "認証済みメールアドレスを確認できません。" }, 403);
  }

  const url = new URL(request.url);
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
    return json({ email });
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
          email,
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
      const member = await memberUpdater(env, memberPath[1], body, email);
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
      };
      const grades = normalizeTournamentGrades(body.grades ?? body.grade);
      inputs = grades.map((grade) =>
        normalizeTournamentInput({
          ...body,
          grade,
          createdByEmail: email,
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
        email,
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
        email,
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
        await statusUpdater(env, statusPath[1], status, email),
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
