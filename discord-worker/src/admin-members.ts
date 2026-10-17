import type { TournamentEnv } from "./tournaments";

const MEMBER_GRADES = new Set(["A", "B", "C", "D", "E", "F", "beginner"]);
const MEMBER_STATUSES = new Set(["active", "inactive", "pending", "rejected"]);

interface MemberDatabaseRow {
  member_id: string;
  display_name: string;
  grade: string;
  status: string;
  dm_enabled: number;
  discord_user_id: string | null;
  created_at: string;
  updated_at: string;
}

interface RegistrationRequestDatabaseRow {
  request_id: string;
  member_id: string | null;
  discord_user_id: string;
  request_type: "new" | "update";
  requested_display_name: string;
  requested_grade: string;
  submitted_at: string;
  current_display_name: string | null;
  current_grade: string | null;
  current_status: string | null;
  current_dm_enabled: number | null;
}

export interface AdminMember {
  memberId: string;
  displayName: string;
  grade: string;
  status: string;
  dmEnabled: boolean;
  discordLinked: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MemberUpdateInput {
  displayName: string;
  grade: string;
  status: string;
  dmEnabled: boolean;
}

export interface AdminMemberRegistrationRequest {
  requestId: string;
  requestType: "new" | "update";
  requestedDisplayName: string;
  requestedGrade: string;
  submittedAt: string;
  currentDisplayName?: string;
  currentGrade?: string;
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
  const displayName =
    typeof raw.displayName === "string"
      ? raw.displayName.trim().replace(/\s+/g, " ")
      : "";
  const grade = typeof raw.grade === "string" ? raw.grade.trim() : "";
  const status = typeof raw.status === "string" ? raw.status.trim() : "";

  if (!displayName || displayName.length > 50) {
    throw new MemberAdminError("氏名は1〜50文字で入力してください。", 400);
  }
  if (!MEMBER_GRADES.has(grade)) {
    throw new MemberAdminError("出場級が不正です。", 400);
  }
  if (!MEMBER_STATUSES.has(status)) {
    throw new MemberAdminError("メンバーステータスが不正です。", 400);
  }
  if (typeof raw.dmEnabled !== "boolean") {
    throw new MemberAdminError("DM設定が不正です。", 400);
  }

  return { displayName, grade, status, dmEnabled: raw.dmEnabled };
}

function toAdminMember(row: MemberDatabaseRow): AdminMember {
  return {
    memberId: row.member_id,
    displayName: row.display_name,
    grade: row.grade,
    status: row.status,
    dmEnabled: row.dm_enabled === 1,
    discordLinked: Boolean(row.discord_user_id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
export async function listAdminMembers(
  env: TournamentEnv,
): Promise<AdminMember[]> {
  const members = await env.DB.prepare(
    `SELECT
      member_id,
      display_name,
      grade,
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
      member_registration_requests.requested_grade,
      member_registration_requests.submitted_at,
      members.display_name AS current_display_name,
      members.grade AS current_grade,
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
    requestedGrade: request.requested_grade,
    submittedAt: request.submitted_at,
    currentDisplayName: request.current_display_name ?? undefined,
    currentGrade: request.current_grade ?? undefined,
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
      member_registration_requests.requested_grade,
      member_registration_requests.submitted_at,
      members.display_name AS current_display_name,
      members.grade AS current_grade,
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
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE members
         SET display_name = ?, grade = ?, status = 'active', updated_at = ?
         WHERE member_id = ?`,
      ).bind(
        request.requested_display_name,
        request.requested_grade,
        now,
        request.member_id,
      ),
      env.DB.prepare(
        `INSERT INTO member_change_history (
          member_id,
          previous_display_name,
          new_display_name,
          previous_grade,
          new_grade,
          previous_status,
          new_status,
          previous_dm_enabled,
          new_dm_enabled,
          changed_by_email,
          changed_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
      ).bind(
        request.member_id,
        request.current_display_name ?? request.requested_display_name,
        request.requested_display_name,
        request.current_grade ?? request.requested_grade,
        request.requested_grade,
        request.current_status ?? "pending",
        previousDmEnabled,
        previousDmEnabled,
        decidedByEmail,
        now,
      ),
      env.DB.prepare(
        `UPDATE member_registration_requests
         SET status = 'approved', decided_at = ?, decided_by_email = ?
         WHERE request_id = ? AND status = 'pending'`,
      ).bind(now, decidedByEmail, requestId),
    ]);
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
        rank,
        grade,
        status,
        dm_enabled,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, '', '', '', ?, 0, ?, 'active', 1, ?, ?)`,
    ).bind(
      memberId,
      request.discord_user_id,
      request.requested_display_name,
      request.requested_display_name,
      request.requested_grade,
      now,
      now,
    ),
    env.DB.prepare(
      `UPDATE member_registration_requests
       SET member_id = ?, status = 'approved', decided_at = ?, decided_by_email = ?
       WHERE request_id = ? AND status = 'pending'`,
    ).bind(memberId, now, decidedByEmail, requestId),
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
      display_name,
      grade,
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
  const changed =
    existing.display_name !== input.displayName ||
    existing.grade !== input.grade ||
    existing.status !== input.status ||
    existing.dm_enabled !== nextDmEnabled;
  if (!changed) {
    return toAdminMember(existing);
  }

  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE members
       SET display_name = ?, grade = ?, status = ?, dm_enabled = ?, updated_at = ?
       WHERE member_id = ?`,
    ).bind(
      input.displayName,
      input.grade,
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
        previous_grade,
        new_grade,
        previous_status,
        new_status,
        previous_dm_enabled,
        new_dm_enabled,
        changed_by_email,
        changed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      memberId,
      existing.display_name,
      input.displayName,
      existing.grade,
      input.grade,
      existing.status,
      input.status,
      existing.dm_enabled,
      nextDmEnabled,
      changedByEmail,
      now,
    ),
  ]);

  return {
    ...toAdminMember(existing),
    displayName: input.displayName,
    grade: input.grade,
    status: input.status,
    dmEnabled: input.dmEnabled,
    updatedAt: now,
  };
}
