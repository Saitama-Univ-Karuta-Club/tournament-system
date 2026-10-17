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
