import { sendChannelMessage, type DiscordMessagePayload } from "../discord-api";
import { CARD_SCHEME_LABELS, type CardScheme } from "./cards";
import type { PracticePairingMode } from "./pairing";

export interface PracticeNotificationEnv {
  DB: D1Database;
  DISCORD_BOT_TOKEN?: string;
  MEMBER_PORTAL_URL?: string;
}

interface DeliveryRow {
  delivery_id: number;
  session_id: string;
  round_number: number | null;
  notification_type: "session" | "cards" | "pairings" | "results";
  attempts: number;
  channel_id: string;
}

interface SessionMessageRow {
  session_id: string;
  practice_date: string;
  title: string;
  location: string | null;
  pairing_mode: PracticePairingMode;
  card_scheme: CardScheme | null;
  card_selection_json: string | null;
}

interface PairingMessageRow {
  round_number: number;
  player1_name: string;
  player2_name: string | null;
  status: "scheduled" | "completed" | "canceled" | "bye";
}

function cardSelectionField(session: SessionMessageRow) {
  let labels: string[] = [];
  try {
    const parsed = JSON.parse(session.card_selection_json ?? "[]");
    if (Array.isArray(parsed)) labels = parsed.map(String);
  } catch {
    labels = [];
  }
  return {
    name: "使用札",
    value: session.card_scheme
      ? `${CARD_SCHEME_LABELS[session.card_scheme]}：**${labels.join("・")}**`
      : "未抽選",
  };
}

export function buildPracticePairingMessage(input: {
  session: SessionMessageRow;
  roundNumber: number;
  matches: PairingMessageRow[];
  portalUrl?: string;
}): DiscordMessagePayload {
  const pairings = input.matches.map((match, index) =>
    match.status === "bye"
      ? `休み　${match.player1_name}`
      : `${index + 1}組　${match.player1_name} — ${match.player2_name ?? "相手未定"}`
  ).join("\n");
  const fields: NonNullable<DiscordMessagePayload["embeds"]>[number]["fields"] = [
    cardSelectionField(input.session),
    {
      name: `第${input.roundNumber}試合`,
      value: pairings || "組み合わせがありません。",
    },
    {
      name: "組み合わせ方式",
      value: input.session.pairing_mode === "near_grade" ? "近い級同士" : "ランダム",
      inline: true,
    },
  ];
  if (input.portalUrl) {
    fields.push({
      name: "結果入力・対戦記録",
      value: `[メンバーポータルを開く](${input.portalUrl.replace(/\/$/, "")}/#practice)`,
    });
  }
  return {
    content: "【かるた練習帖】組み合わせをお知らせします。",
    embeds: [{
      title: `${input.session.practice_date} ${input.session.title}`,
      description: input.session.location ? `会場：${input.session.location}` : undefined,
      color: 0x4262ad,
      fields,
    }],
    allowed_mentions: { parse: [] },
  };
}

export async function upsertPracticeChannel(
  db: D1Database,
  guildId: string,
  channelId: string,
): Promise<void> {
  await db.prepare(
    `INSERT INTO practice_discord_settings (guild_id, channel_id)
     VALUES (?, ?)
     ON CONFLICT(guild_id) DO UPDATE SET
       channel_id = excluded.channel_id,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
  ).bind(guildId, channelId).run();
}

async function loadPairingPayload(
  env: PracticeNotificationEnv,
  sessionId: string,
  roundNumber: number,
): Promise<DiscordMessagePayload> {
  const [session, matches] = await Promise.all([
    env.DB.prepare(
      `SELECT session_id, practice_date, title, location, pairing_mode,
              card_scheme, card_selection_json
       FROM practice_sessions WHERE session_id = ?`,
    ).bind(sessionId).first<SessionMessageRow>(),
    env.DB.prepare(
      `SELECT practice_matches.round_number, practice_matches.status,
              COALESCE(player1.display_name, guest1.display_name) AS player1_name,
              COALESCE(player2.display_name, guest2.display_name) AS player2_name
       FROM practice_matches
       LEFT JOIN members AS player1 ON player1.member_id = practice_matches.player1_participant_id
       LEFT JOIN practice_guests AS guest1 ON guest1.guest_id = practice_matches.player1_participant_id
       LEFT JOIN members AS player2 ON player2.member_id = practice_matches.player2_participant_id
       LEFT JOIN practice_guests AS guest2 ON guest2.guest_id = practice_matches.player2_participant_id
       WHERE practice_matches.session_id = ? AND practice_matches.round_number = ?
       ORDER BY practice_matches.created_at`,
    ).bind(sessionId, roundNumber).all<PairingMessageRow>(),
  ]);
  if (!session) throw new Error("練習情報が見つかりません。");
  return buildPracticePairingMessage({
    session,
    roundNumber,
    matches: matches.results,
    portalUrl: env.MEMBER_PORTAL_URL,
  });
}

export async function loadTodayPracticeMessage(
  env: PracticeNotificationEnv,
  today: string,
): Promise<DiscordMessagePayload | null> {
  const session = await env.DB.prepare(
    `SELECT session_id, practice_date, title, location, pairing_mode,
            card_scheme, card_selection_json
     FROM practice_sessions
     WHERE practice_date = ? AND status NOT IN ('draft', 'canceled')
     ORDER BY created_at DESC LIMIT 1`,
  ).bind(today).first<SessionMessageRow>();
  if (!session) return null;
  const round = await env.DB.prepare(
    `SELECT MAX(round_number) AS round_number
     FROM practice_matches WHERE session_id = ?`,
  ).bind(session.session_id).first<{ round_number: number | null }>();
  if (!round?.round_number) return null;
  return loadPairingPayload(env, session.session_id, Number(round.round_number));
}

export async function processPracticeNotificationQueue(
  env: PracticeNotificationEnv,
  fetcher: typeof fetch = fetch,
): Promise<number> {
  if (!env.DISCORD_BOT_TOKEN) return 0;
  const deliveries = await env.DB.prepare(
    `SELECT practice_notification_queue.delivery_id,
            practice_notification_queue.session_id,
            practice_notification_queue.round_number,
            practice_notification_queue.notification_type,
            practice_notification_queue.attempts,
            practice_discord_settings.channel_id
     FROM practice_notification_queue
     CROSS JOIN practice_discord_settings
     WHERE practice_notification_queue.status IN ('pending', 'failed')
       AND practice_notification_queue.next_attempt_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       AND practice_notification_queue.attempts < 5
     ORDER BY practice_notification_queue.created_at
     LIMIT 10`,
  ).all<DeliveryRow>();
  let sent = 0;
  for (const delivery of deliveries.results) {
    try {
      if (delivery.notification_type !== "pairings") {
        await env.DB.prepare(
          `UPDATE practice_notification_queue
           SET status = 'skipped', error_message = 'この通知形式は使用しません。'
           WHERE delivery_id = ?`,
        ).bind(delivery.delivery_id).run();
        continue;
      }
      if (!delivery.round_number) throw new Error("試合番号がありません。");
      const payload = await loadPairingPayload(
        env,
        delivery.session_id,
        Number(delivery.round_number),
      );
      const message = await sendChannelMessage(
        env.DISCORD_BOT_TOKEN,
        delivery.channel_id,
        payload,
        fetcher,
      );
      await env.DB.prepare(
        `UPDATE practice_notification_queue
         SET status = 'sent', attempts = attempts + 1, discord_message_id = ?,
             error_message = NULL, sent_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE delivery_id = ?`,
      ).bind(message.id, delivery.delivery_id).run();
      sent += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 500) : "送信に失敗しました。";
      const delayMinutes = Math.min(2 ** delivery.attempts, 30);
      await env.DB.prepare(
        `UPDATE practice_notification_queue
         SET status = 'failed', attempts = attempts + 1, error_message = ?,
             next_attempt_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?)
         WHERE delivery_id = ?`,
      ).bind(message, `+${delayMinutes} minutes`, delivery.delivery_id).run();
    }
  }
  return sent;
}
