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

export async function upsertDiscordMember(
  db: D1Database,
  rawInput: RegisterMemberInput,
): Promise<RegisterMemberInput> {
  const input = normalizeMemberRegistration(rawInput);
  const now = new Date().toISOString();
  const memberId = `M-${crypto.randomUUID()}`;

  await db
    .prepare(
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
      ) VALUES (?, ?, ?, '', '', '', ?, 0, ?, 'active', 1, ?, ?)
      ON CONFLICT(discord_user_id) DO UPDATE SET
        display_name = excluded.display_name,
        grade = excluded.grade,
        status = 'active',
        dm_enabled = 1,
        updated_at = excluded.updated_at`,
    )
    .bind(
      memberId,
      input.discordUserId,
      input.displayName,
      input.displayName,
      input.grade,
      now,
      now,
    )
    .run();

  return input;
}
