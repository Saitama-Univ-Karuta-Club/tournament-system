import {
  type DiscordMessagePayload,
  sendChannelMessage,
  sendDirectMessage,
} from "./discord-api";
import { formatGrade, normalizeMemberRegistration } from "./members";

export interface TournamentEnv {
  DB: D1Database;
  DISCORD_GUILD_ID?: string;
  DISCORD_BOT_TOKEN?: string;
}

export interface TestTournamentInput {
  grade: string;
  title: string;
  createdByDiscordUserId: string;
}

export interface AttendanceInput {
  tournamentId: string;
  discordUserId: string;
  response: string;
}

export interface TournamentInput {
  title: string;
  eventStartDate: string;
  eventEndDate: string;
  grade: string;
  tournamentType: string;
  venue?: string;
  trueDeadline: string;
  internalDeadline: string;
  documentUrl?: string;
  createdByDiscordUserId?: string;
  createdByEmail?: string;
}

export interface TournamentRow {
  tournament_id: string;
  title: string;
  event_start_date: string;
  event_end_date: string;
  grade: string;
  internal_deadline: string;
  true_deadline: string;
  tournament_type?: string;
  venue?: string | null;
  document_url?: string | null;
}

interface TargetMemberRow {
  member_id: string;
  discord_user_id: string;
}

interface AttendanceTargetRow extends TournamentRow {
  member_id: string;
}

const RESPONSE_LABELS: Record<string, string> = {
  yes: "参加希望",
  maybe: "未定・条件付き",
  no: "不参加",
};

const TEST_DM_LIMIT = 10;
const TOURNAMENT_GRADES = new Set(["A", "B", "C", "D", "E", "F", "beginner"]);
const TOURNAMENT_TYPES = new Set(["official", "support", "event"]);

function addDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatJstDateTime(value: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function normalizeText(value: unknown, label: string, maxLength: number): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    throw new Error(`${label}を入力してください。`);
  }
  if (normalized.length > maxLength) {
    throw new Error(`${label}は${maxLength}文字以内で入力してください。`);
  }
  return normalized;
}

function normalizeOptionalText(value: unknown, label: string, maxLength: number): string {
  if (value === undefined || value === null || value === "") {
    return "";
  }
  const normalized = String(value).trim();
  if (normalized.length > maxLength) {
    throw new Error(`${label}は${maxLength}文字以内で入力してください。`);
  }
  return normalized;
}

function normalizeDate(value: unknown, label: string): string {
  const normalized = normalizeText(value, label, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error(`${label}の形式が不正です。`);
  }
  const [year, month, day] = normalized.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error(`${label}の形式が不正です。`);
  }
  return normalized;
}

function normalizeDateTime(value: unknown, label: string): string {
  const normalized = normalizeText(value, label, 40);
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(normalized)) {
    throw new Error(`${label}にはタイムゾーンが必要です。`);
  }
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${label}の形式が不正です。`);
  }
  return parsed.toISOString();
}

function normalizeDocumentUrl(value: unknown): string {
  const normalized = normalizeOptionalText(value, "要項URL", 500);
  if (!normalized) {
    return "";
  }
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error("要項URLの形式が不正です。");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("要項URLはhttpまたはhttpsで入力してください。");
  }
  return url.toString();
}

export function normalizeTournamentInput(raw: TournamentInput): TournamentInput {
  const title = normalizeText(raw.title, "大会名", 100);
  const grade = normalizeText(raw.grade, "対象級", 20);
  if (!TOURNAMENT_GRADES.has(grade)) {
    throw new Error("対象級が不正です。");
  }

  const tournamentType = normalizeText(raw.tournamentType, "大会種別", 20);
  if (!TOURNAMENT_TYPES.has(tournamentType)) {
    throw new Error("大会種別が不正です。");
  }

  const eventStartDate = normalizeDate(raw.eventStartDate, "開催開始日");
  const eventEndDate = normalizeDate(raw.eventEndDate, "開催終了日");
  if (eventEndDate < eventStartDate) {
    throw new Error("開催終了日は開催開始日以降にしてください。");
  }

  const internalDeadline = normalizeDateTime(raw.internalDeadline, "サークル内締切");
  const trueDeadline = normalizeDateTime(raw.trueDeadline, "主催者締切");
  if (new Date(internalDeadline).getTime() > new Date(trueDeadline).getTime()) {
    throw new Error("サークル内締切は主催者締切以前にしてください。");
  }

  return {
    title,
    grade,
    tournamentType,
    eventStartDate,
    eventEndDate,
    internalDeadline,
    trueDeadline,
    venue: normalizeOptionalText(raw.venue, "会場", 200),
    documentUrl: normalizeDocumentUrl(raw.documentUrl),
    createdByDiscordUserId: normalizeOptionalText(
      raw.createdByDiscordUserId,
      "DiscordユーザーID",
      100,
    ),
    createdByEmail: normalizeOptionalText(raw.createdByEmail, "登録者メール", 320),
  };
}

export function buildAttendanceMessage(
  tournament: TournamentRow,
  selectedResponse?: string,
): DiscordMessagePayload {
  const selected = selectedResponse
    ? `\n現在の回答: **${RESPONSE_LABELS[selectedResponse]}**`
    : "";

  const fields = [
    {
      name: "対象級",
      value: formatGrade(tournament.grade),
      inline: true,
    },
    {
      name: "開催日",
      value:
        tournament.event_start_date === tournament.event_end_date
          ? tournament.event_start_date
          : `${tournament.event_start_date}〜${tournament.event_end_date}`,
      inline: true,
    },
    {
      name: "サークル内締切",
      value: formatJstDateTime(tournament.internal_deadline),
    },
  ];
  if (tournament.venue) {
    fields.push({ name: "会場", value: tournament.venue, inline: false });
  }
  if (tournament.document_url) {
    fields.push({
      name: "大会要項",
      value: `[リンクを開く](${tournament.document_url})`,
      inline: false,
    });
  }

  return {
    content: `大会への参加意思を選択してください。${selected}`,
    embeds: [
      {
        title: tournament.title,
        color: 0x5865f2,
        fields,
      },
    ],
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 3,
            label: "参加",
            custom_id: `attendance:${tournament.tournament_id}:yes`,
          },
          {
            type: 2,
            style: 2,
            label: "未定",
            custom_id: `attendance:${tournament.tournament_id}:maybe`,
          },
          {
            type: 2,
            style: 4,
            label: "不参加",
            custom_id: `attendance:${tournament.tournament_id}:no`,
          },
        ],
      },
    ],
    allowed_mentions: { parse: [] },
  };
}

function buildAnnouncementMessage(tournament: TournamentRow): DiscordMessagePayload {
  const fields = [
    {
      name: "対象級",
      value: formatGrade(tournament.grade),
      inline: true,
    },
    {
      name: "開催日",
      value:
        tournament.event_start_date === tournament.event_end_date
          ? tournament.event_start_date
          : `${tournament.event_start_date}〜${tournament.event_end_date}`,
      inline: true,
    },
    {
      name: "サークル内締切",
      value: formatJstDateTime(tournament.internal_deadline),
    },
  ];
  if (tournament.venue) {
    fields.push({ name: "会場", value: tournament.venue, inline: false });
  }
  if (tournament.document_url) {
    fields.push({
      name: "大会要項",
      value: `[リンクを開く](${tournament.document_url})`,
      inline: false,
    });
  }

  return {
    content: "【大会追加】\n対象者のDMへ参加確認を送信します。",
    embeds: [
      {
        title: tournament.title,
        color: 0x57f287,
        fields,
      },
    ],
    allowed_mentions: { parse: [] },
  };
}

async function createNotification(
  db: D1Database,
  values: {
    idempotencyKey: string;
    tournamentId: string;
    memberId?: string;
    notificationType: "announcement" | "invitation_dm";
    destinationType: "channel" | "dm";
    destinationId: string;
  },
): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT INTO notification_deliveries (
        idempotency_key,
        tournament_id,
        member_id,
        notification_type,
        destination_type,
        destination_id,
        status
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending')
      ON CONFLICT(idempotency_key) DO NOTHING`,
    )
    .bind(
      values.idempotencyKey,
      values.tournamentId,
      values.memberId ?? null,
      values.notificationType,
      values.destinationType,
      values.destinationId,
    )
    .run();

  return (result.meta.changes ?? 0) > 0;
}

async function markNotificationSent(
  db: D1Database,
  idempotencyKey: string,
  discordMessageId: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE notification_deliveries
       SET status = 'sent', discord_message_id = ?, sent_at = ?
       WHERE idempotency_key = ?`,
    )
    .bind(discordMessageId, new Date().toISOString(), idempotencyKey)
    .run();
}

async function markNotificationFailed(
  db: D1Database,
  idempotencyKey: string,
  error: unknown,
): Promise<void> {
  const message = (error instanceof Error ? error.message : String(error)).slice(
    0,
    500,
  );
  await db
    .prepare(
      `UPDATE notification_deliveries
       SET status = 'failed', error_message = ?
       WHERE idempotency_key = ?`,
    )
    .bind(message, idempotencyKey)
    .run();
}

export async function upsertAnnouncementChannel(
  env: TournamentEnv,
  guildId: string,
  channelId: string,
): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO discord_settings (
      guild_id, announcement_channel_id, timezone, created_at, updated_at
    ) VALUES (?, ?, 'Asia/Tokyo', ?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET
      announcement_channel_id = excluded.announcement_channel_id,
      updated_at = excluded.updated_at`,
  )
    .bind(guildId, channelId, now, now)
    .run();
}

export async function createTournament(
  env: TournamentEnv,
  rawInput: TournamentInput,
): Promise<TournamentRow> {
  const input = normalizeTournamentInput(rawInput);
  const now = new Date();
  const tournament: TournamentRow = {
    tournament_id: `T-${crypto.randomUUID()}`,
    title: input.title,
    event_start_date: input.eventStartDate,
    event_end_date: input.eventEndDate,
    grade: input.grade,
    tournament_type: input.tournamentType,
    venue: input.venue || null,
    true_deadline: input.trueDeadline,
    internal_deadline: input.internalDeadline,
    document_url: input.documentUrl || null,
  };

  await env.DB.prepare(
    `INSERT INTO tournaments (
      tournament_id,
      title,
      event_start_date,
      event_end_date,
      grade,
      tournament_type,
      is_official,
      true_deadline,
      internal_deadline,
      venue,
      document_url,
      status,
      created_by_discord_user_id,
      created_by_email,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
  )
    .bind(
      tournament.tournament_id,
      tournament.title,
      tournament.event_start_date,
      tournament.event_end_date,
      tournament.grade,
      input.tournamentType,
      input.tournamentType === "official" ? 1 : 0,
      tournament.true_deadline,
      tournament.internal_deadline,
      input.venue || null,
      input.documentUrl || null,
      input.createdByDiscordUserId || null,
      input.createdByEmail || null,
      now.toISOString(),
      now.toISOString(),
    )
    .run();

  return tournament;
}

export async function notifyTournament(
  env: TournamentEnv,
  tournament: TournamentRow,
  dmLimit = TEST_DM_LIMIT,
): Promise<void> {
  if (!env.DISCORD_GUILD_ID || !env.DISCORD_BOT_TOKEN) {
    throw new Error("Discord設定が足りません。");
  }

  const settings = await env.DB.prepare(
    `SELECT announcement_channel_id
     FROM discord_settings
     WHERE guild_id = ?`,
  )
    .bind(env.DISCORD_GUILD_ID)
    .first<{ announcement_channel_id: string }>();
  if (!settings?.announcement_channel_id) {
    throw new Error("告知チャンネルが未設定です。");
  }

  const announcementKey = `announcement:${tournament.tournament_id}:${settings.announcement_channel_id}`;
  if (
    await createNotification(env.DB, {
      idempotencyKey: announcementKey,
      tournamentId: tournament.tournament_id,
      notificationType: "announcement",
      destinationType: "channel",
      destinationId: settings.announcement_channel_id,
    })
  ) {
    try {
      const message = await sendChannelMessage(
        env.DISCORD_BOT_TOKEN,
        settings.announcement_channel_id,
        buildAnnouncementMessage(tournament),
      );
      await markNotificationSent(env.DB, announcementKey, message.id);
    } catch (error: unknown) {
      await markNotificationFailed(env.DB, announcementKey, error);
    }
  }

  const members = await env.DB.prepare(
    `SELECT member_id, discord_user_id
     FROM members
     WHERE status = 'active'
       AND dm_enabled = 1
       AND grade = ?
       AND discord_user_id IS NOT NULL
     ORDER BY member_id
     LIMIT ?`,
  )
    .bind(tournament.grade, dmLimit)
    .all<TargetMemberRow>();

  for (const member of members.results) {
    const invitationKey = `invitation_dm:${tournament.tournament_id}:${member.member_id}`;
    if (
      !(await createNotification(env.DB, {
        idempotencyKey: invitationKey,
        tournamentId: tournament.tournament_id,
        memberId: member.member_id,
        notificationType: "invitation_dm",
        destinationType: "dm",
        destinationId: member.discord_user_id,
      }))
    ) {
      continue;
    }

    try {
      const message = await sendDirectMessage(
        env.DISCORD_BOT_TOKEN,
        member.discord_user_id,
        buildAttendanceMessage(tournament),
      );
      await markNotificationSent(env.DB, invitationKey, message.id);
    } catch (error: unknown) {
      await markNotificationFailed(env.DB, invitationKey, error);
    }
  }
}

export async function notifyPendingTournaments(
  env: TournamentEnv,
): Promise<void> {
  const pending = await env.DB.prepare(
    `SELECT
      tournaments.tournament_id,
      tournaments.title,
      tournaments.event_start_date,
      tournaments.event_end_date,
      tournaments.grade,
      tournaments.tournament_type,
      tournaments.venue,
      tournaments.true_deadline,
      tournaments.internal_deadline,
      tournaments.document_url
    FROM tournaments
    WHERE tournaments.status = 'active'
      AND NOT EXISTS (
        SELECT 1
        FROM notification_deliveries
        WHERE notification_deliveries.tournament_id = tournaments.tournament_id
          AND notification_deliveries.notification_type = 'announcement'
      )
    ORDER BY tournaments.created_at
    LIMIT 5`,
  ).all<TournamentRow>();

  for (const tournament of pending.results) {
    try {
      await notifyTournament(env, tournament);
    } catch (error: unknown) {
      console.error(
        `未通知大会のDiscord通知エラー: ${tournament.tournament_id}`,
        error,
      );
    }
  }
}

export async function createTestTournamentAndNotify(
  env: TournamentEnv,
  rawInput: TestTournamentInput,
): Promise<void> {
  const normalized = normalizeMemberRegistration({
    discordUserId: rawInput.createdByDiscordUserId,
    displayName: rawInput.title || "Discord Botテスト大会",
    grade: rawInput.grade,
  });
  const now = new Date();
  const tournament = await createTournament(env, {
    title: normalized.displayName,
    eventStartDate: isoDate(addDays(now, 14)),
    eventEndDate: isoDate(addDays(now, 14)),
    grade: normalized.grade,
    tournamentType: "event",
    internalDeadline: addDays(now, 7).toISOString(),
    trueDeadline: addDays(now, 10).toISOString(),
    createdByDiscordUserId: normalized.discordUserId,
  });
  await notifyTournament(env, tournament);
}

export async function recordAttendanceResponse(
  env: TournamentEnv,
  input: AttendanceInput,
): Promise<DiscordMessagePayload> {
  if (!RESPONSE_LABELS[input.response]) {
    throw new Error("回答の値が不正です。");
  }

  const target = await env.DB.prepare(
    `SELECT
      members.member_id,
      tournaments.tournament_id,
      tournaments.title,
      tournaments.event_start_date,
      tournaments.event_end_date,
      tournaments.grade,
      tournaments.internal_deadline,
      tournaments.true_deadline
    FROM members
    INNER JOIN tournaments ON tournaments.tournament_id = ?
    WHERE members.discord_user_id = ?
      AND members.status = 'active'
      AND members.grade = tournaments.grade
      AND tournaments.status = 'active'
    LIMIT 1`,
  )
    .bind(input.tournamentId, input.discordUserId)
    .first<AttendanceTargetRow>();

  if (!target) {
    throw new Error("この大会への回答権限を確認できません。");
  }

  if (new Date(target.internal_deadline).getTime() < Date.now()) {
    throw new Error("サークル内締切を過ぎています。");
  }

  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO responses (
      tournament_id, member_id, response, source, created_at, updated_at
    ) VALUES (?, ?, ?, 'discord', ?, ?)
    ON CONFLICT(tournament_id, member_id) DO UPDATE SET
      response = excluded.response,
      source = 'discord',
      updated_at = excluded.updated_at`,
  )
    .bind(target.tournament_id, target.member_id, input.response, now, now)
    .run();

  return buildAttendanceMessage(target, input.response);
}
