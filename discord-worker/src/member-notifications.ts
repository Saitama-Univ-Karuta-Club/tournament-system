import {
  type DiscordMessagePayload,
  sendDirectMessage,
} from "./discord-api";
import { formatGrade, formatRank } from "./members";

const QUEUE_BATCH_SIZE = 20;
const MAX_NOTIFICATION_ATTEMPTS = 5;
const QUEUE_LEASE_MILLISECONDS = 5 * 60 * 1000;

export interface MemberApprovalNotificationInput {
  requestId: string;
  requestType: "new" | "update";
  memberId: string;
  discordUserId: string;
  displayName: string;
  displayNameKana: string;
  grade: string;
  rank: number;
}

interface MemberApprovalNotificationRow {
  notification_id: number;
  notification_type: "registration_approved" | "update_approved";
  destination_id: string;
  display_name: string;
  display_name_kana: string;
  grade: string;
  rank: number;
  attempt_count: number;
}

export interface MemberNotificationEnv {
  DB: D1Database;
  DISCORD_BOT_TOKEN?: string;
  MEMBER_PORTAL_URL?: string;
}

function memberPortalUrl(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return undefined;
    url.hash = "answer";
    return url.toString();
  } catch {
    return undefined;
  }
}

export function buildMemberApprovalMessage(
  notification: Omit<MemberApprovalNotificationRow, "notification_id" | "destination_id" | "attempt_count">,
  portalBaseUrl?: string,
): DiscordMessagePayload {
  const isNew = notification.notification_type === "registration_approved";
  const fields = [
    { name: "氏名", value: notification.display_name, inline: true },
    { name: "よみがな", value: notification.display_name_kana, inline: true },
    { name: "出場級", value: formatGrade(notification.grade), inline: true },
    { name: "段位", value: formatRank(notification.rank), inline: true },
  ];
  const portalUrl = memberPortalUrl(portalBaseUrl);
  if (portalUrl) {
    fields.push({
      name: "Web版大会参加確認",
      value: `[大会一覧・回答画面を開く](${portalUrl})`,
      inline: false,
    });
  }

  return {
    content: isNew
      ? "【メンバー登録承認】\n新規メンバー登録が承認されました。大会お知らせくんを利用できます。"
      : "【登録内容更新承認】\nメンバー登録内容の変更が承認されました。",
    embeds: [
      {
        title: isNew ? "登録された内容" : "更新後の登録内容",
        color: 0x57f287,
        fields,
      },
    ],
    allowed_mentions: { parse: [] },
  };
}

export function prepareMemberApprovalNotification(
  db: D1Database,
  input: MemberApprovalNotificationInput,
  now = new Date().toISOString(),
): D1PreparedStatement {
  const notificationType = input.requestType === "new"
    ? "registration_approved"
    : "update_approved";
  return db.prepare(
    `INSERT INTO member_notification_deliveries (
      idempotency_key,
      request_id,
      member_id,
      notification_type,
      destination_id,
      display_name,
      display_name_kana,
      grade,
      rank,
      status,
      next_attempt_at,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    ON CONFLICT(idempotency_key) DO NOTHING`,
  ).bind(
    `member_approval:${input.requestId}`,
    input.requestId,
    input.memberId,
    notificationType,
    input.discordUserId,
    input.displayName,
    input.displayNameKana,
    input.grade,
    input.rank,
    now,
    now,
  );
}

function retryDelayMinutes(attemptCount: number): number {
  return [1, 5, 15, 60][Math.max(0, Math.min(attemptCount - 1, 3))];
}

export async function processMemberApprovalNotificationQueue(
  env: MemberNotificationEnv,
  batchSize = QUEUE_BATCH_SIZE,
): Promise<number> {
  if (!env.DISCORD_BOT_TOKEN) {
    throw new Error("Discord Bot Tokenが未設定です。");
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const queued = await env.DB.prepare(
    `SELECT
      notification_id,
      notification_type,
      destination_id,
      display_name,
      display_name_kana,
      grade,
      rank,
      attempt_count
    FROM member_notification_deliveries
    WHERE status IN ('pending', 'failed')
      AND attempt_count < ?
      AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
      AND (lease_until IS NULL OR lease_until <= ?)
    ORDER BY created_at, notification_id
    LIMIT ?`,
  )
    .bind(MAX_NOTIFICATION_ATTEMPTS, nowIso, nowIso, batchSize)
    .all<MemberApprovalNotificationRow>();

  let processed = 0;
  for (const notification of queued.results) {
    const attemptedAt = new Date();
    const leaseUntil = new Date(
      attemptedAt.getTime() + QUEUE_LEASE_MILLISECONDS,
    ).toISOString();
    const claim = await env.DB.prepare(
      `UPDATE member_notification_deliveries
       SET lease_until = ?, last_attempt_at = ?, attempt_count = attempt_count + 1
       WHERE notification_id = ?
         AND attempt_count = ?
         AND status IN ('pending', 'failed')
         AND (lease_until IS NULL OR lease_until <= ?)`,
    )
      .bind(
        leaseUntil,
        attemptedAt.toISOString(),
        notification.notification_id,
        notification.attempt_count,
        attemptedAt.toISOString(),
      )
      .run();
    if (Number(claim.meta.changes ?? 0) !== 1) continue;

    processed += 1;
    try {
      const message = await sendDirectMessage(
        env.DISCORD_BOT_TOKEN,
        notification.destination_id,
        buildMemberApprovalMessage(notification, env.MEMBER_PORTAL_URL),
      );
      await env.DB.prepare(
        `UPDATE member_notification_deliveries
         SET status = 'sent', discord_message_id = ?, sent_at = ?,
           error_message = NULL, next_attempt_at = NULL, lease_until = NULL
         WHERE notification_id = ?`,
      )
        .bind(message.id, new Date().toISOString(), notification.notification_id)
        .run();
    } catch (error: unknown) {
      const attemptCount = notification.attempt_count + 1;
      const nextAttemptAt = attemptCount < MAX_NOTIFICATION_ATTEMPTS
        ? new Date(
            attemptedAt.getTime() + retryDelayMinutes(attemptCount) * 60 * 1000,
          ).toISOString()
        : null;
      const errorMessage = (
        error instanceof Error ? error.message : String(error)
      ).slice(0, 500);
      await env.DB.prepare(
        `UPDATE member_notification_deliveries
         SET status = 'failed', error_message = ?, next_attempt_at = ?,
           lease_until = NULL
         WHERE notification_id = ?`,
      )
        .bind(errorMessage, nextAttemptAt, notification.notification_id)
        .run();
    }
  }
  return processed;
}
