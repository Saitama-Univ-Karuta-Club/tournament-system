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
  lastName: string;
  firstName: string;
  lastNameKana: string;
  firstNameKana: string;
  grade: string;
  rank: number;
}

export interface MemberRegistrationRequestResult extends RegisterMemberInput {
  displayName: string;
  displayNameKana: string;
  requestId: string;
  requestType: "new" | "update";
  currentDisplayName?: string;
  currentDisplayNameKana?: string;
  currentGrade?: string;
  currentRank?: number;
}

interface ExistingMemberRow {
  member_id: string;
  last_name: string;
  first_name: string;
  last_name_kana: string;
  first_name_kana: string;
  display_name: string;
  display_name_kana: string;
  grade: string;
  rank: number;
}

export function normalizeMemberRegistration(
  input: RegisterMemberInput,
): RegisterMemberInput & { displayName: string; displayNameKana: string } {
  const discordUserId = input.discordUserId.trim();
  const lastName = input.lastName.trim().replace(/\s+/g, " ");
  const firstName = input.firstName.trim().replace(/\s+/g, " ");
  const lastNameKana = input.lastNameKana.trim().replace(/\s+/g, " ");
  const firstNameKana = input.firstNameKana.trim().replace(/\s+/g, " ");
  const displayName = `${lastName}${firstName}`;
  const displayNameKana = `${lastNameKana}${firstNameKana}`;
  const grade = input.grade.trim();
  const rank = Number(input.rank);

  if (!discordUserId) {
    throw new Error("DiscordユーザーIDを取得できません。");
  }
  if (!lastName || lastName.length > 50) {
    throw new Error("苗字は1〜50文字で入力してください。");
  }
  if (!firstName || firstName.length > 50) {
    throw new Error("名前は1〜50文字で入力してください。");
  }
  if (!lastNameKana || lastNameKana.length > 100) {
    throw new Error("苗字よみがなは1〜100文字で入力してください。");
  }
  if (!firstNameKana || firstNameKana.length > 100) {
    throw new Error("名前よみがなは1〜100文字で入力してください。");
  }
  if (!MEMBER_GRADES.has(grade)) {
    throw new Error("出場級の値が不正です。");
  }
  if (!Number.isInteger(rank) || rank < 0 || rank > 10) {
    throw new Error("段位の値が不正です。");
  }

  return {
    discordUserId,
    lastName,
    firstName,
    lastNameKana,
    firstNameKana,
    displayName,
    displayNameKana,
    grade,
    rank,
  };
}

export function formatGrade(grade: string): string {
  return grade === "beginner" ? "初心者" : `${grade}級`;
}

export function formatRank(rank: number): string {
  return [
    "無段",
    "初段",
    "二段",
    "三段",
    "四段",
    "五段",
    "六段",
    "七段",
    "八段",
    "九段",
    "十段",
  ][rank] ?? "段位不明";
}

export async function submitMemberRegistrationRequest(
  db: D1Database,
  rawInput: RegisterMemberInput,
): Promise<MemberRegistrationRequestResult> {
  const input = normalizeMemberRegistration(rawInput);
  const now = new Date().toISOString();
  const existing = await db.prepare(
    `SELECT member_id, last_name, first_name, last_name_kana, first_name_kana,
      display_name, display_name_kana, grade, rank
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
         requested_display_name_kana = ?, requested_last_name = ?,
         requested_first_name = ?, requested_last_name_kana = ?,
         requested_first_name_kana = ?, requested_grade = ?,
         requested_rank = ?, submitted_at = ?
       WHERE request_id = ? AND status = 'pending'`,
    )
      .bind(
        existing?.member_id ?? null,
        requestType,
        input.displayName,
        input.displayNameKana,
        input.lastName,
        input.firstName,
        input.lastNameKana,
        input.firstNameKana,
        input.grade,
        input.rank,
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
        requested_display_name, requested_display_name_kana,
        requested_last_name, requested_first_name,
        requested_last_name_kana, requested_first_name_kana,
        requested_grade,
        requested_rank,
        status,
        submitted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    )
      .bind(
        requestId,
        existing?.member_id ?? null,
        input.discordUserId,
        requestType,
        input.displayName,
        input.displayNameKana,
        input.lastName,
        input.firstName,
        input.lastNameKana,
        input.firstNameKana,
        input.grade,
        input.rank,
        now,
      )
      .run();
  }

  return {
    ...input,
    requestId,
    requestType,
    currentDisplayName: existing?.display_name,
    currentDisplayNameKana: existing?.display_name_kana,
    currentGrade: existing?.grade,
    currentRank: existing?.rank,
  };
}
