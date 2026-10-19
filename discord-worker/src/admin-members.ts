import type { TournamentEnv } from "./tournaments";
import { prepareMemberApprovalNotification } from "./member-notifications";

const MEMBER_GRADES = new Set(["A", "B", "C", "D", "E", "F", "beginner"]);
const MEMBER_STATUSES = new Set(["active", "inactive", "pending", "rejected"]);

interface MemberDatabaseRow {
  member_id: string;
  last_name: string;
  first_name: string;
  last_name_kana: string;
  first_name_kana: string;
  display_name: string;
  display_name_kana: string;
  grade: string;
  rank: number;
  status: string;
  dm_enabled: number;
  discord_user_id: string | null;
  created_at: string;
  updated_at: string;
}

interface MemberAppearanceDatabaseRow {
  group_key: string;
  title: string;
  event_start_date: string;
  grade: string;
  result_text: string | null;
}

interface RegistrationRequestDatabaseRow {
  request_id: string;
  member_id: string | null;
  discord_user_id: string;
  request_type: "new" | "update";
  requested_display_name: string;
  requested_display_name_kana: string;
  requested_last_name: string;
  requested_first_name: string;
  requested_last_name_kana: string;
  requested_first_name_kana: string;
  requested_grade: string;
  requested_rank: number;
  submitted_at: string;
  current_display_name: string | null;
  current_display_name_kana: string | null;
  current_last_name: string | null;
  current_first_name: string | null;
  current_last_name_kana: string | null;
  current_first_name_kana: string | null;
  current_grade: string | null;
  current_rank: number | null;
  current_status: string | null;
  current_dm_enabled: number | null;
}

export interface AdminMember {
  memberId: string;
  lastName: string;
  firstName: string;
  lastNameKana: string;
  firstNameKana: string;
  displayName: string;
  displayNameKana: string;
  grade: string;
  rank: number;
  status: string;
  dmEnabled: boolean;
  discordLinked: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AdminMemberAppearance {
  title: string;
  eventDate: string;
  grade: string;
  resultText: string | null;
}

export interface AdminMemberAppearanceHistory {
  memberId: string;
  fiscalYear: number;
  gradeCounts: Record<string, number>;
  appearances: AdminMemberAppearance[];
}

export interface MemberUpdateInput {
  lastName: string;
  firstName: string;
  lastNameKana: string;
  firstNameKana: string;
  grade: string;
  rank: number;
  status: string;
  dmEnabled: boolean;
}

export interface AdminMemberRegistrationRequest {
  requestId: string;
  requestType: "new" | "update";
  requestedDisplayName: string;
  requestedDisplayNameKana: string;
  requestedLastName: string;
  requestedFirstName: string;
  requestedLastNameKana: string;
  requestedFirstNameKana: string;
  requestedGrade: string;
  requestedRank: number;
  submittedAt: string;
  currentDisplayName?: string;
  currentDisplayNameKana?: string;
  currentLastName?: string;
  currentFirstName?: string;
  currentLastNameKana?: string;
  currentFirstNameKana?: string;
  currentGrade?: string;
  currentRank?: number;
  currentStatus?: string;
}

export interface MemberRegistrationDecision {
  requestId: string;
  decision: "approved" | "rejected";
  memberId?: string;
}

export class MemberAdminError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message);
  }
}

function normalizeMemberUpdate(raw: MemberUpdateInput): MemberUpdateInput {
  const lastName =
    typeof raw.lastName === "string"
      ? raw.lastName.trim().replace(/\s+/g, " ")
      : "";
  const firstName =
    typeof raw.firstName === "string"
      ? raw.firstName.trim().replace(/\s+/g, " ")
      : "";
  const lastNameKana =
    typeof raw.lastNameKana === "string"
      ? raw.lastNameKana.trim().replace(/\s+/g, " ")
      : "";
  const firstNameKana =
    typeof raw.firstNameKana === "string"
      ? raw.firstNameKana.trim().replace(/\s+/g, " ")
      : "";
  const grade = typeof raw.grade === "string" ? raw.grade.trim() : "";
  const rank = Number(raw.rank);
  const status = typeof raw.status === "string" ? raw.status.trim() : "";

  if (!lastName || lastName.length > 50) {
    throw new MemberAdminError("苗字は1〜50文字で入力してください。", 400);
  }
  if (!firstName || firstName.length > 50) {
    throw new MemberAdminError("名前は1〜50文字で入力してください。", 400);
  }
  if (!lastNameKana || lastNameKana.length > 100) {
    throw new MemberAdminError("苗字よみがなは1〜100文字で入力してください。", 400);
  }
  if (!firstNameKana || firstNameKana.length > 100) {
    throw new MemberAdminError("名前よみがなは1〜100文字で入力してください。", 400);
  }
  if (!MEMBER_GRADES.has(grade)) {
    throw new MemberAdminError("出場級が不正です。", 400);
  }
  if (!Number.isInteger(rank) || rank < 0 || rank > 10) {
    throw new MemberAdminError("段位が不正です。", 400);
  }
  if (!MEMBER_STATUSES.has(status)) {
    throw new MemberAdminError("メンバーステータスが不正です。", 400);
  }
  if (typeof raw.dmEnabled !== "boolean") {
    throw new MemberAdminError("DM設定が不正です。", 400);
  }

  return {
    lastName,
    firstName,
    lastNameKana,
    firstNameKana,
    grade,
    rank,
    status,
    dmEnabled: raw.dmEnabled,
  };
}

function toAdminMember(row: MemberDatabaseRow): AdminMember {
  return {
    memberId: row.member_id,
    lastName: row.last_name,
    firstName: row.first_name,
    lastNameKana: row.last_name_kana,
    firstNameKana: row.first_name_kana,
    displayName: row.display_name,
    displayNameKana: row.display_name_kana,
    grade: row.grade,
    rank: row.rank,
    status: row.status,
    dmEnabled: row.dm_enabled === 1,
    discordLinked: Boolean(row.discord_user_id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function invalidateResponsesForGrade(
  env: TournamentEnv,
  memberId: string,
  previousGrade: string,
  invalidatedAt: string,
) {
  return env.DB.prepare(
    `UPDATE responses
     SET
       is_valid = 0,
       invalidated_at = ?,
       invalidated_reason = 'member_grade_changed'
     WHERE member_id = ?
       AND is_valid = 1
       AND EXISTS (
         SELECT 1
         FROM tournaments
         WHERE tournaments.tournament_id = responses.tournament_id
           AND tournaments.all_grades = 0
           AND tournaments.grade = ?
       )`,
  ).bind(invalidatedAt, memberId, previousGrade);
}

export async function listAdminMembers(
  env: TournamentEnv,
): Promise<AdminMember[]> {
  const members = await env.DB.prepare(
    `SELECT
      member_id,
      last_name,
      first_name,
      last_name_kana,
      first_name_kana,
      display_name,
      display_name_kana,
      grade,
      rank,
      status,
      dm_enabled,
      discord_user_id,
      created_at,
      updated_at
    FROM members
    ORDER BY
      CASE status WHEN 'active' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
      grade,
      display_name`,
  ).all<MemberDatabaseRow>();

  return members.results.map(toAdminMember);
}

function currentJstDate(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export async function listAdminMemberAppearances(
  env: TournamentEnv,
  memberId: string,
): Promise<AdminMemberAppearanceHistory> {
  const today = currentJstDate();
  const [year, month] = today.split("-").map(Number);
  const fiscalYear = month >= 4 ? year : year - 1;
  const rows = await env.DB.prepare(
    `SELECT
      COALESCE(tournaments.registration_group_id, tournaments.tournament_id) AS group_key,
      tournaments.title,
      tournaments.event_start_date,
      CASE
        WHEN tournaments.all_grades = 1
          THEN COALESCE(NULLIF(tournament_entries.archive_grade, ''), members.grade)
        ELSE tournaments.grade
      END AS grade,
      tournament_entries.result_text
    FROM tournament_entries
    INNER JOIN tournaments
      ON tournaments.tournament_id = tournament_entries.tournament_id
    INNER JOIN members
      ON members.member_id = tournament_entries.member_id
    WHERE tournament_entries.member_id = ?
      AND tournament_entries.status = 'selected'
      AND tournaments.event_start_date <= ?
      AND tournaments.status NOT IN ('canceled', 'deleted')
    ORDER BY tournaments.event_start_date DESC, tournaments.created_at DESC`,
  ).bind(memberId, today).all<MemberAppearanceDatabaseRow>();

  const seenGroups = new Set<string>();
  const appearances = rows.results
    .filter((row) => {
      if (seenGroups.has(row.group_key)) return false;
      seenGroups.add(row.group_key);
      return true;
    })
    .map((row) => ({
      title: row.title,
      eventDate: row.event_start_date,
      grade: row.grade,
      resultText: row.result_text,
    }));
  const fiscalStart = `${fiscalYear}-04-01`;
  const fiscalEnd = `${fiscalYear + 1}-03-31`;
  const gradeCounts: Record<string, number> = {};
  for (const appearance of appearances) {
    if (appearance.eventDate < fiscalStart || appearance.eventDate > fiscalEnd) continue;
    gradeCounts[appearance.grade] = (gradeCounts[appearance.grade] ?? 0) + 1;
  }

  return { memberId, fiscalYear, gradeCounts, appearances };
}

export async function listPendingMemberRegistrations(
  env: TournamentEnv,
): Promise<AdminMemberRegistrationRequest[]> {
  const requests = await env.DB.prepare(
    `SELECT
      member_registration_requests.request_id,
      member_registration_requests.member_id,
      member_registration_requests.discord_user_id,
      member_registration_requests.request_type,
      member_registration_requests.requested_display_name,
      member_registration_requests.requested_display_name_kana,
      member_registration_requests.requested_last_name,
      member_registration_requests.requested_first_name,
      member_registration_requests.requested_last_name_kana,
      member_registration_requests.requested_first_name_kana,
      member_registration_requests.requested_grade,
      member_registration_requests.requested_rank,
      member_registration_requests.submitted_at,
      members.display_name AS current_display_name,
      members.display_name_kana AS current_display_name_kana,
      members.last_name AS current_last_name,
      members.first_name AS current_first_name,
      members.last_name_kana AS current_last_name_kana,
      members.first_name_kana AS current_first_name_kana,
      members.grade AS current_grade,
      members.rank AS current_rank,
      members.status AS current_status,
      members.dm_enabled AS current_dm_enabled
    FROM member_registration_requests
    LEFT JOIN members
      ON members.member_id = member_registration_requests.member_id
    WHERE member_registration_requests.status = 'pending'
    ORDER BY member_registration_requests.submitted_at`,
  ).all<RegistrationRequestDatabaseRow>();

  return requests.results.map((request) => ({
    requestId: request.request_id,
    requestType: request.request_type,
    requestedDisplayName: request.requested_display_name,
    requestedDisplayNameKana: request.requested_display_name_kana,
    requestedLastName: request.requested_last_name,
    requestedFirstName: request.requested_first_name,
    requestedLastNameKana: request.requested_last_name_kana,
    requestedFirstNameKana: request.requested_first_name_kana,
    requestedGrade: request.requested_grade,
    requestedRank: Number(request.requested_rank),
    submittedAt: request.submitted_at,
    currentDisplayName: request.current_display_name ?? undefined,
    currentDisplayNameKana: request.current_display_name_kana ?? undefined,
    currentLastName: request.current_last_name ?? undefined,
    currentFirstName: request.current_first_name ?? undefined,
    currentLastNameKana: request.current_last_name_kana ?? undefined,
    currentFirstNameKana: request.current_first_name_kana ?? undefined,
    currentGrade: request.current_grade ?? undefined,
    currentRank:
      request.current_rank === null ? undefined : Number(request.current_rank),
    currentStatus: request.current_status ?? undefined,
  }));
}

export async function countPendingMemberRegistrations(
  env: TournamentEnv,
): Promise<number> {
  const result = await env.DB.prepare(
    `SELECT COUNT(*) AS count
     FROM member_registration_requests
     WHERE status = 'pending'`,
  ).first<{ count: number }>();
  return Number(result?.count ?? 0);
}

export async function decideMemberRegistration(
  env: TournamentEnv,
  requestId: string,
  decision: string,
  decidedByEmail: string,
): Promise<MemberRegistrationDecision> {
  if (!/^MR-[0-9a-f-]{36}$/.test(requestId)) {
    throw new MemberAdminError("登録申請IDが不正です。", 400);
  }
  if (decision !== "approved" && decision !== "rejected") {
    throw new MemberAdminError("承認結果が不正です。", 400);
  }

  const request = await env.DB.prepare(
    `SELECT
      member_registration_requests.request_id,
      member_registration_requests.member_id,
      member_registration_requests.discord_user_id,
      member_registration_requests.request_type,
      member_registration_requests.requested_display_name,
      member_registration_requests.requested_display_name_kana,
      member_registration_requests.requested_last_name,
      member_registration_requests.requested_first_name,
      member_registration_requests.requested_last_name_kana,
      member_registration_requests.requested_first_name_kana,
      member_registration_requests.requested_grade,
      member_registration_requests.requested_rank,
      member_registration_requests.submitted_at,
      members.display_name AS current_display_name,
      members.display_name_kana AS current_display_name_kana,
      members.last_name AS current_last_name,
      members.first_name AS current_first_name,
      members.last_name_kana AS current_last_name_kana,
      members.first_name_kana AS current_first_name_kana,
      members.grade AS current_grade,
      members.rank AS current_rank,
      members.status AS current_status,
      members.dm_enabled AS current_dm_enabled
    FROM member_registration_requests
    LEFT JOIN members
      ON members.member_id = member_registration_requests.member_id
    WHERE member_registration_requests.request_id = ?
      AND member_registration_requests.status = 'pending'`,
  )
    .bind(requestId)
    .first<RegistrationRequestDatabaseRow>();
  if (!request) {
    throw new MemberAdminError("未処理の登録申請が見つかりません。", 404);
  }

  const now = new Date().toISOString();
  if (decision === "rejected") {
    await env.DB.prepare(
      `UPDATE member_registration_requests
       SET status = 'rejected', decided_at = ?, decided_by_email = ?
       WHERE request_id = ? AND status = 'pending'`,
    )
      .bind(now, decidedByEmail, requestId)
      .run();
    return { requestId, decision: "rejected" };
  }

  if (request.member_id) {
    const previousDmEnabled = request.current_dm_enabled ?? 1;
    const statements = [
      env.DB.prepare(
        `UPDATE members
         SET last_name = ?, first_name = ?, last_name_kana = ?, first_name_kana = ?,
           display_name = ?, display_name_kana = ?, grade = ?, rank = ?,
           status = 'active', updated_at = ?
         WHERE member_id = ?`,
      ).bind(
        request.requested_last_name,
        request.requested_first_name,
        request.requested_last_name_kana,
        request.requested_first_name_kana,
        request.requested_display_name,
        request.requested_display_name_kana,
        request.requested_grade,
        request.requested_rank,
        now,
        request.member_id,
      ),
      env.DB.prepare(
        `INSERT INTO member_change_history (
          member_id,
          previous_display_name,
          new_display_name,
          previous_display_name_kana,
          new_display_name_kana,
          previous_rank,
          new_rank,
          previous_grade,
          new_grade,
          previous_status,
          new_status,
          previous_dm_enabled,
          new_dm_enabled,
          changed_by_email,
          changed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
      ).bind(
        request.member_id,
        request.current_display_name ?? request.requested_display_name,
        request.requested_display_name,
        request.current_display_name_kana ?? "",
        request.requested_display_name_kana,
        request.current_rank ?? request.requested_rank,
        request.requested_rank,
        request.current_grade ?? request.requested_grade,
        request.requested_grade,
        request.current_status ?? "pending",
        previousDmEnabled,
        previousDmEnabled,
        decidedByEmail,
        now,
      ),
    ];
    if (
      request.current_grade &&
      request.current_grade !== request.requested_grade
    ) {
      statements.push(
        invalidateResponsesForGrade(
          env,
          request.member_id,
          request.current_grade,
          now,
        ),
      );
    }
    statements.push(
      env.DB.prepare(
        `UPDATE member_registration_requests
         SET status = 'approved', decided_at = ?, decided_by_email = ?
         WHERE request_id = ? AND status = 'pending'`,
      ).bind(now, decidedByEmail, requestId),
      prepareMemberApprovalNotification(
        env.DB,
        {
          requestId,
          requestType: "update",
          memberId: request.member_id,
          discordUserId: request.discord_user_id,
          displayName: request.requested_display_name,
          displayNameKana: request.requested_display_name_kana,
          grade: request.requested_grade,
          rank: request.requested_rank,
        },
        now,
      ),
    );
    await env.DB.batch(statements);
    return { requestId, decision: "approved", memberId: request.member_id };
  }

  const memberId = `M-${crypto.randomUUID()}`;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO members (
        member_id,
        discord_user_id,
        last_name,
        last_name_kana,
        first_name,
        first_name_kana,
        display_name,
        display_name_kana,
        rank,
        grade,
        status,
        dm_enabled,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 1, ?, ?)`,
    ).bind(
      memberId,
      request.discord_user_id,
      request.requested_last_name,
      request.requested_last_name_kana,
      request.requested_first_name,
      request.requested_first_name_kana,
      request.requested_display_name,
      request.requested_display_name_kana,
      request.requested_rank,
      request.requested_grade,
      now,
      now,
    ),
    env.DB.prepare(
      `UPDATE member_registration_requests
       SET member_id = ?, status = 'approved', decided_at = ?, decided_by_email = ?
       WHERE request_id = ? AND status = 'pending'`,
    ).bind(memberId, now, decidedByEmail, requestId),
    prepareMemberApprovalNotification(
      env.DB,
      {
        requestId,
        requestType: "new",
        memberId,
        discordUserId: request.discord_user_id,
        displayName: request.requested_display_name,
        displayNameKana: request.requested_display_name_kana,
        grade: request.requested_grade,
        rank: request.requested_rank,
      },
      now,
    ),
  ]);
  return { requestId, decision: "approved", memberId };
}

export async function updateAdminMember(
  env: TournamentEnv,
  memberId: string,
  rawInput: MemberUpdateInput,
  changedByEmail: string,
): Promise<AdminMember> {
  if (!/^M-[0-9a-f-]{36}$/.test(memberId)) {
    throw new MemberAdminError("メンバーIDが不正です。", 400);
  }
  const input = normalizeMemberUpdate(rawInput);
  const existing = await env.DB.prepare(
    `SELECT
      member_id,
      last_name,
      first_name,
      last_name_kana,
      first_name_kana,
      display_name,
      display_name_kana,
      grade,
      rank,
      status,
      dm_enabled,
      discord_user_id,
      created_at,
      updated_at
    FROM members
    WHERE member_id = ?`,
  )
    .bind(memberId)
    .first<MemberDatabaseRow>();
  if (!existing) {
    throw new MemberAdminError("対象のメンバーが見つかりません。", 404);
  }

  const nextDmEnabled = input.dmEnabled ? 1 : 0;
  const displayName = `${input.lastName}${input.firstName}`;
  const displayNameKana = `${input.lastNameKana}${input.firstNameKana}`;
  const changed =
    existing.last_name !== input.lastName ||
    existing.first_name !== input.firstName ||
    existing.last_name_kana !== input.lastNameKana ||
    existing.first_name_kana !== input.firstNameKana ||
    existing.grade !== input.grade ||
    existing.rank !== input.rank ||
    existing.status !== input.status ||
    existing.dm_enabled !== nextDmEnabled;
  if (!changed) {
    return toAdminMember(existing);
  }

  const now = new Date().toISOString();
  const statements = [
    env.DB.prepare(
      `UPDATE members
       SET last_name = ?, first_name = ?, last_name_kana = ?, first_name_kana = ?,
         display_name = ?, display_name_kana = ?, grade = ?, rank = ?, status = ?,
         dm_enabled = ?, updated_at = ?
       WHERE member_id = ?`,
    ).bind(
      input.lastName,
      input.firstName,
      input.lastNameKana,
      input.firstNameKana,
      displayName,
      displayNameKana,
      input.grade,
      input.rank,
      input.status,
      nextDmEnabled,
      now,
      memberId,
    ),
    env.DB.prepare(
      `INSERT INTO member_change_history (
        member_id,
        previous_display_name,
        new_display_name,
        previous_display_name_kana,
        new_display_name_kana,
        previous_rank,
        new_rank,
        previous_grade,
        new_grade,
        previous_status,
        new_status,
        previous_dm_enabled,
        new_dm_enabled,
        changed_by_email,
        changed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      memberId,
      existing.display_name,
      displayName,
      existing.display_name_kana,
      displayNameKana,
      existing.rank,
      input.rank,
      existing.grade,
      input.grade,
      existing.status,
      input.status,
      existing.dm_enabled,
      nextDmEnabled,
      changedByEmail,
      now,
    ),
  ];
  if (existing.grade !== input.grade) {
    statements.push(
      invalidateResponsesForGrade(env, memberId, existing.grade, now),
    );
  }
  await env.DB.batch(statements);

  return {
    ...toAdminMember(existing),
    lastName: input.lastName,
    firstName: input.firstName,
    lastNameKana: input.lastNameKana,
    firstNameKana: input.firstNameKana,
    displayName,
    displayNameKana,
    grade: input.grade,
    rank: input.rank,
    status: input.status,
    dmEnabled: input.dmEnabled,
    updatedAt: now,
  };
}
