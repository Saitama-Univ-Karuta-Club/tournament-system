import {
  type DiscordMessagePayload,
  sendChannelMessage,
  sendDirectMessage,
} from "./discord-api";
import { formatGrade, normalizeMemberRegistration } from "./members";
import type { Env } from "./index";

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

interface TournamentRow {
  tournament_id: string;
  title: string;
  event_start_date: string;
  event_end_date: string;
  grade: string;
  internal_deadline: string;
  true_deadline: string;
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

export function buildAttendanceMessage(
  tournament: TournamentRow,
  selectedResponse?: string,
): DiscordMessagePayload {
  const selected = selectedResponse
    ? `\n現在の回答: **${RESPONSE_LABELS[selectedResponse]}**`
    : "";

  return {
    content: `大会への参加意思を選択してください。${selected}`,
    embeds: [
      {
        title: tournament.title,
        color: 0x5865f2,
        fields: [
          {
            name: "対象級",
            value: formatGrade(tournament.grade),
            inline: true,
          },
          {
            name: "開催日",
            value: tournament.event_start_date,
            inline: true,
          },
          {
            name: "サークル内締切",
            value: formatJstDateTime(tournament.internal_deadline),
          },
        ],
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
  return {
    content: "【テスト大会追加】\n対象者のDMへ参加確認の送信を開始しました。",
    embeds: [
      {
        title: tournament.title,
        color: 0x57f287,
        fields: [
          {
            name: "対象級",
            value: formatGrade(tournament.grade),
            inline: true,
          },
          {
            name: "開催日",
            value: tournament.event_start_date,
            inline: true,
          },
          {
            name: "サークル内締切",
            value: formatJstDateTime(tournament.internal_deadline),
          },
        ],
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
  env: Env,
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

export async function createTestTournamentAndNotify(
  env: Env,
  rawInput: TestTournamentInput,
): Promise<void> {
  if (!env.DISCORD_GUILD_ID || !env.DISCORD_BOT_TOKEN) {
    throw new Error("Discord設定が足りません。");
  }

  const normalized = normalizeMemberRegistration({
    discordUserId: rawInput.createdByDiscordUserId,
    displayName: rawInput.title || "Discord Botテスト大会",
    grade: rawInput.grade,
  });
  const title = normalized.displayName;
  const now = new Date();
  const tournament: TournamentRow = {
    tournament_id: `T-${crypto.randomUUID()}`,
    title,
    event_start_date: isoDate(addDays(now, 14)),
    event_end_date: isoDate(addDays(now, 14)),
    grade: normalized.grade,
    internal_deadline: addDays(now, 7).toISOString(),
    true_deadline: addDays(now, 10).toISOString(),
  };

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
      status,
      created_by_discord_user_id,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, 'event', 0, ?, ?, 'active', ?, ?, ?)`,
  )
    .bind(
      tournament.tournament_id,
      tournament.title,
      tournament.event_start_date,
      tournament.event_end_date,
      tournament.grade,
      tournament.true_deadline,
      tournament.internal_deadline,
      rawInput.createdByDiscordUserId,
      now.toISOString(),
      now.toISOString(),
    )
    .run();

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
    .bind(tournament.grade, TEST_DM_LIMIT)
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

export async function recordAttendanceResponse(
  env: Env,
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
