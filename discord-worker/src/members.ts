const MEMBER_GRADES = new Set([
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "beginner",
]);

export interface RegisterMemberInput {
  discordUserId: string;
  displayName: string;
  grade: string;
}

export interface MemberRegistrationRequestResult extends RegisterMemberInput {
  requestId: string;
  requestType: "new" | "update";
  currentDisplayName?: string;
  currentGrade?: string;
}

interface ExistingMemberRow {
  member_id: string;
  display_name: string;
  grade: string;
}

export function normalizeMemberRegistration(
  input: RegisterMemberInput,
): RegisterMemberInput {
  const discordUserId = input.discordUserId.trim();
  const displayName = input.displayName.trim().replace(/\s+/g, " ");
  const grade = input.grade.trim();

  if (!discordUserId) {
    throw new Error("DiscordユーザーIDを取得できません。");
  }
  if (!displayName || displayName.length > 50) {
    throw new Error("氏名は1〜50文字で入力してください。");
  }
  if (!MEMBER_GRADES.has(grade)) {
    throw new Error("出場級の値が不正です。");
  }

  return { discordUserId, displayName, grade };
}

export function formatGrade(grade: string): string {
  return grade === "beginner" ? "初心者" : `${grade}級`;
}

export async function submitMemberRegistrationRequest(
  db: D1Database,
  rawInput: RegisterMemberInput,
): Promise<MemberRegistrationRequestResult> {
  const input = normalizeMemberRegistration(rawInput);
  const now = new Date().toISOString();
  const existing = await db.prepare(
    `SELECT member_id, display_name, grade
     FROM members
     WHERE discord_user_id = ?`,
  )
    .bind(input.discordUserId)
    .first<ExistingMemberRow>();
  const requestType = existing ? "update" : "new";
  const pending = await db.prepare(
    `SELECT request_id
     FROM member_registration_requests
     WHERE discord_user_id = ? AND status = 'pending'`,
  )
    .bind(input.discordUserId)
    .first<{ request_id: string }>();
  const requestId = pending?.request_id ?? `MR-${crypto.randomUUID()}`;

  if (pending) {
    await db.prepare(
      `UPDATE member_registration_requests
       SET member_id = ?, request_type = ?, requested_display_name = ?,
         requested_grade = ?, submitted_at = ?
       WHERE request_id = ? AND status = 'pending'`,
    )
      .bind(
        existing?.member_id ?? null,
        requestType,
        input.displayName,
        input.grade,
        now,
        requestId,
      )
      .run();
  } else {
    await db.prepare(
      `INSERT INTO member_registration_requests (
        request_id,
        member_id,
        discord_user_id,
        request_type,
        requested_display_name,
        requested_grade,
        status,
        submitted_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
    )
      .bind(
        requestId,
        existing?.member_id ?? null,
        input.discordUserId,
        requestType,
        input.displayName,
        input.grade,
        now,
      )
      .run();
  }

  return {
    ...input,
    requestId,
    requestType,
    currentDisplayName: existing?.display_name,
    currentGrade: existing?.grade,
  };
}
