import {
  sendDirectMessage,
  type DiscordMessagePayload,
} from "./discord-api";
import {
  applyBotMessageContent,
  defaultBotMessageContent,
} from "./bot-message-settings";

export interface ParticipantGuidanceEnv {
  DB: D1Database;
  DISCORD_BOT_TOKEN?: string;
}

export interface ParticipantGuidance {
  groupKey: string;
  tournamentId: string;
  tournamentTitle: string;
  bodyText: string | null;
  documentUrl: string | null;
  fileName: string | null;
  paymentCollectionMethod: "advance_manager" | "onsite_cash";
  participationFeeYen: number;
  paymentDeadline: string | null;
  paymentStatus?: "unpaid" | "paid";
  revision: number;
}

export interface ParticipantPaymentResponseInput {
  tournamentId: string;
  discordUserId: string;
  status: "unpaid" | "paid";
  waitlistPromotion?: boolean;
  changedBy?: string;
}

export interface GuidanceEnqueueResult {
  queued: number;
  unavailable: number;
  revision: number;
}

export interface WaitlistPromotionEnqueueResult {
  queued: number;
  unavailable: number;
  afterPaymentDeadline: boolean;
}

export interface WaitlistResultEnqueueResult {
  queued: number;
  unavailable: number;
}

interface GuidanceTargetRow {
  tournament_id: string;
  member_id: string;
  discord_user_id: string | null;
  status: string;
  dm_enabled: number;
}

interface GuidanceDeliveryRow {
  delivery_id: number;
  idempotency_key: string;
  group_key: string;
  tournament_id: string;
  member_id: string;
  destination_id: string;
  guidance_revision: number;
  attempt_count: number;
  current_revision: number;
  title: string;
  body_text: string | null;
  document_url: string | null;
  file_name: string | null;
  payment_collection_method: "advance_manager" | "onsite_cash";
  participation_fee_yen: number | null;
  payment_deadline: string | null;
  payment_status: "unpaid" | "paid" | null;
  entry_status: string | null;
  waitlist_number: number | null;
  roster_document_url: string | null;
  roster_file_name: string | null;
}

interface WaitlistPromotionTargetRow {
  group_key: string;
  revision: number;
  payment_collection_method: "advance_manager" | "onsite_cash";
  payment_deadline: string | null;
  discord_user_id: string | null;
  member_status: string;
  dm_enabled: number;
}

interface ParticipantPaymentTargetRow {
  member_id: string;
  title: string;
  body_text: string | null;
  document_url: string | null;
  file_name: string | null;
  payment_collection_method: "advance_manager" | "onsite_cash";
  participation_fee_yen: number;
  payment_deadline: string | null;
  payment_status: "unpaid" | "paid" | null;
}

const MAX_ATTEMPTS = 5;
const LEASE_MILLISECONDS = 5 * 60 * 1000;
const INSERT_BATCH_SIZE = 50;
const WAITLIST_PROMOTION_PREFIX = "waitlist_promotion:";
const WAITLIST_PROMOTION_LATE_PREFIX = "waitlist_promotion_late:";
const WAITLIST_RESULT_PREFIX = "waitlist_result:";

function waitlistPromotionKey(
  groupKey: string,
  revision: number,
  memberId: string,
  afterPaymentDeadline: boolean,
): string {
  const prefix = afterPaymentDeadline
    ? WAITLIST_PROMOTION_LATE_PREFIX
    : WAITLIST_PROMOTION_PREFIX;
  return `${prefix}${groupKey}:r${revision}:${memberId}`;
}

function retryDelayMinutes(attemptCount: number): number {
  return [1, 5, 15, 60][Math.min(Math.max(attemptCount - 1, 0), 3)];
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

export function buildParticipantGuidanceMessage(
  guidance: Pick<
    ParticipantGuidance,
    "tournamentId" | "tournamentTitle" | "bodyText" | "documentUrl" | "fileName" |
    "paymentCollectionMethod" | "participationFeeYen" | "paymentDeadline" | "paymentStatus"
  >,
  options: { waitlistPromotion?: boolean; afterPaymentDeadline?: boolean } = {},
): DiscordMessagePayload {
  const messageKey = options.waitlistPromotion
    ? options.afterPaymentDeadline
      ? "waitlist_promotion_after_deadline"
      : "waitlist_promotion_before_deadline"
    : "participant_guidance";
  const fields: NonNullable<
    NonNullable<DiscordMessagePayload["embeds"]>[number]["fields"]
  > = [];
  if (guidance.documentUrl) {
    fields.push({
      name: "案内ファイル",
      value: `[${guidance.fileName || "案内ファイルを開く"}](${guidance.documentUrl})`,
      inline: false,
    });
  }
  fields.push({
    name: "参加費",
    value: `${new Intl.NumberFormat("ja-JP").format(guidance.participationFeeYen)}円`,
    inline: true,
  });
  fields.push({
    name: "支払い方法",
    value: guidance.paymentCollectionMethod === "onsite_cash"
      ? "大会当日に現金で主催者へ直接支払い"
      : "大会担当者へ事前に支払い",
    inline: true,
  });
  if (guidance.paymentCollectionMethod === "advance_manager" && guidance.paymentDeadline) {
    fields.push({
      name: "サークル内支払期限",
      value: formatJstDateTime(guidance.paymentDeadline),
      inline: false,
    });
  }
  if (guidance.paymentCollectionMethod === "advance_manager") {
    fields.push({
      name: "現在の支払い状態",
      value: guidance.paymentStatus === "paid" ? "支払い済み" : "未払い",
      inline: false,
    });
  }
  return {
    content: defaultBotMessageContent(messageKey),
    embeds: [{
      title: guidance.tournamentTitle,
      description: guidance.bodyText || "添付された案内ファイルを確認してください。",
      color: 0x5865f2,
      fields: fields.length ? fields : undefined,
    }],
    components: guidance.paymentCollectionMethod === "advance_manager" &&
        !options.afterPaymentDeadline
      ? [{
        type: 1,
        components: [
          {
            type: 2,
            style: 3,
            label: "支払い完了",
            custom_id: `${options.waitlistPromotion ? "payment-promotion" : "payment"}:${guidance.tournamentId}:paid`,
          },
          {
            type: 2,
            style: 2,
            label: "操作を取り消す",
            custom_id: `${options.waitlistPromotion ? "payment-promotion" : "payment"}:${guidance.tournamentId}:unpaid`,
          },
        ],
      }]
      : undefined,
    allowed_mentions: { parse: [] },
  };
}

export function buildWaitlistResultMessage(
  tournamentTitle: string,
  waitlistNumber: number,
  rosterDocumentUrl: string,
  rosterFileName: string | null,
): DiscordMessagePayload {
  return {
    content: defaultBotMessageContent("waitlist_result"),
    embeds: [{
      title: tournamentTitle,
      color: 0xfee75c,
      fields: [
        {
          name: "抽選結果",
          value: `キャンセル待ち ${waitlistNumber}番`,
          inline: false,
        },
        {
          name: "確定名簿",
          value: `[${rosterFileName || "名簿を開く"}](${rosterDocumentUrl})`,
          inline: false,
        },
      ],
    }],
    allowed_mentions: { parse: [] },
  };
}

export async function enqueueWaitlistResultGuidance(
  env: ParticipantGuidanceEnv,
  groupKey: string,
  tournamentIds: string[],
): Promise<WaitlistResultEnqueueResult> {
  if (!tournamentIds.length) throw new Error("対象大会がありません。");
  const guidance = await env.DB.prepare(
    `SELECT revision FROM tournament_participant_guidance WHERE group_key = ?`,
  ).bind(groupKey).first<{ revision: number }>();
  if (!guidance) throw new Error("参加者向け案内が保存されていません。");
  const placeholders = tournamentIds.map(() => "?").join(", ");
  const targets = await env.DB.prepare(
    `SELECT tournament_entries.tournament_id, tournament_entries.member_id,
      tournament_entries.waitlist_number, members.discord_user_id,
      members.status, members.dm_enabled
     FROM tournament_entries
     INNER JOIN members ON members.member_id = tournament_entries.member_id
     WHERE tournament_entries.tournament_id IN (${placeholders})
       AND tournament_entries.status = 'not_selected'
       AND tournament_entries.waitlist_number IS NOT NULL
     ORDER BY members.member_id`,
  ).bind(...tournamentIds).all<GuidanceTargetRow & { waitlist_number: number }>();
  const available = targets.results.filter((target) =>
    target.status === "active" && target.dm_enabled === 1 && Boolean(target.discord_user_id)
  );
  let queued = 0;
  for (let offset = 0; offset < available.length; offset += INSERT_BATCH_SIZE) {
    const statements = available.slice(offset, offset + INSERT_BATCH_SIZE).map((target) =>
      env.DB.prepare(
        `INSERT INTO participant_guidance_deliveries (
          idempotency_key, group_key, tournament_id, member_id,
          destination_id, guidance_revision, status, next_attempt_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
        ON CONFLICT(idempotency_key) DO NOTHING`,
      ).bind(
        `${WAITLIST_RESULT_PREFIX}${groupKey}:r${guidance.revision}:${target.member_id}:n${target.waitlist_number}`,
        groupKey,
        target.tournament_id,
        target.member_id,
        target.discord_user_id,
        guidance.revision,
        new Date().toISOString(),
      )
    );
    const results = await env.DB.batch(statements);
    queued += results.reduce((sum, result) => sum + Number(result.meta.changes ?? 0), 0);
  }
  return { queued, unavailable: targets.results.length - available.length };
}

export async function enqueueWaitlistPromotionGuidance(
  env: ParticipantGuidanceEnv,
  tournamentId: string,
  memberId: string,
  promotedAt = new Date(),
): Promise<WaitlistPromotionEnqueueResult> {
  const target = await env.DB.prepare(
    `SELECT
      COALESCE(tournaments.registration_group_id, tournaments.tournament_id) AS group_key,
      tournament_participant_guidance.revision,
      tournament_participant_guidance.payment_collection_method,
      tournament_participant_guidance.payment_deadline,
      members.discord_user_id,
      members.status AS member_status,
      members.dm_enabled
     FROM tournament_entries
     INNER JOIN tournaments
       ON tournaments.tournament_id = tournament_entries.tournament_id
     INNER JOIN members
       ON members.member_id = tournament_entries.member_id
     INNER JOIN tournament_participant_guidance
       ON tournament_participant_guidance.group_key = COALESCE(
         tournaments.registration_group_id,
         tournaments.tournament_id
       )
     WHERE tournament_entries.tournament_id = ?
       AND tournament_entries.member_id = ?
       AND tournament_entries.status = 'selected'
       AND tournaments.status NOT IN ('canceled', 'deleted')
     LIMIT 1`,
  ).bind(tournamentId, memberId).first<WaitlistPromotionTargetRow>();
  if (
    !target ||
    target.member_status !== "active" ||
    target.dm_enabled !== 1 ||
    !target.discord_user_id
  ) {
    return { queued: 0, unavailable: 1, afterPaymentDeadline: false };
  }

  const deadlineTime = target.payment_deadline
    ? Date.parse(target.payment_deadline)
    : Number.NaN;
  const afterPaymentDeadline = target.payment_collection_method === "advance_manager" &&
    Number.isFinite(deadlineTime) &&
    promotedAt.getTime() > deadlineTime;
  const idempotencyKey = waitlistPromotionKey(
    target.group_key,
    target.revision,
    memberId,
    afterPaymentDeadline,
  );
  const queued = await env.DB.prepare(
    `INSERT INTO participant_guidance_deliveries (
      idempotency_key, group_key, tournament_id, member_id,
      destination_id, guidance_revision, status, next_attempt_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
    ON CONFLICT(idempotency_key) DO UPDATE SET
      tournament_id = excluded.tournament_id,
      destination_id = excluded.destination_id,
      guidance_revision = excluded.guidance_revision,
      discord_message_id = NULL,
      status = 'pending',
      attempt_count = 0,
      next_attempt_at = excluded.next_attempt_at,
      last_attempt_at = NULL,
      lease_until = NULL,
      error_message = NULL,
      sent_at = NULL
    WHERE participant_guidance_deliveries.status IN ('sent', 'failed', 'skipped')`,
  ).bind(
    idempotencyKey,
    target.group_key,
    tournamentId,
    memberId,
    target.discord_user_id,
    target.revision,
    promotedAt.toISOString(),
  ).run();
  return {
    queued: Number(queued.meta.changes ?? 0),
    unavailable: 0,
    afterPaymentDeadline,
  };
}

export async function recordParticipantPaymentResponse(
  env: ParticipantGuidanceEnv,
  input: ParticipantPaymentResponseInput,
): Promise<DiscordMessagePayload> {
  if (!/^T-[0-9a-f-]{36}$/.test(input.tournamentId)) {
    throw new Error("大会IDが不正です。");
  }
  if (!input.discordUserId || (input.status !== "paid" && input.status !== "unpaid")) {
    throw new Error("支払い操作が不正です。");
  }
  const target = await env.DB.prepare(
    `SELECT
      members.member_id,
      tournaments.title,
      tournament_participant_guidance.body_text,
      tournament_participant_guidance.document_url,
      tournament_participant_guidance.file_name,
      tournament_participant_guidance.payment_collection_method,
      tournament_participation_fees.amount_yen AS participation_fee_yen,
      tournament_participant_guidance.payment_deadline,
      tournament_entry_payments.status AS payment_status
     FROM members
     INNER JOIN tournament_entries
       ON tournament_entries.member_id = members.member_id
     INNER JOIN tournaments
       ON tournaments.tournament_id = tournament_entries.tournament_id
     INNER JOIN tournament_participant_guidance
       ON tournament_participant_guidance.group_key = COALESCE(
         tournaments.registration_group_id,
         tournaments.tournament_id
       )
     INNER JOIN tournament_participation_fees
       ON tournament_participation_fees.group_key = tournament_participant_guidance.group_key
      AND tournament_participation_fees.grade = CASE
        WHEN tournaments.all_grades = 1 THEN members.grade
        ELSE tournaments.grade
      END
     LEFT JOIN tournament_entry_payments
       ON tournament_entry_payments.tournament_id = tournament_entries.tournament_id
      AND tournament_entry_payments.member_id = tournament_entries.member_id
     WHERE tournaments.tournament_id = ?
       AND members.discord_user_id = ?
       AND members.status = 'active'
       AND tournament_entries.status = 'selected'
       AND tournaments.status NOT IN ('canceled', 'deleted')
     LIMIT 1`,
  ).bind(input.tournamentId, input.discordUserId).first<ParticipantPaymentTargetRow>();
  if (!target) {
    throw new Error("この大会の出場確定者として確認できません。");
  }
  if (target.payment_collection_method !== "advance_manager") {
    throw new Error("この大会は事前支払いの対象ではありません。");
  }
  const previousStatus = target.payment_status ?? "unpaid";
  if (previousStatus !== input.status) {
    const now = new Date().toISOString();
    const changedBy = input.changedBy ?? `discord:${input.discordUserId}`;
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO tournament_entry_payments (
          tournament_id, member_id, status, paid_at, updated_by_email, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(tournament_id, member_id) DO UPDATE SET
          status = excluded.status,
          paid_at = excluded.paid_at,
          updated_by_email = excluded.updated_by_email,
          updated_at = excluded.updated_at`,
      ).bind(
        input.tournamentId,
        target.member_id,
        input.status,
        input.status === "paid" ? now : null,
        changedBy,
        now,
      ),
      env.DB.prepare(
        `INSERT INTO tournament_entry_payment_history (
          tournament_id, member_id, previous_status, new_status,
          changed_by_email, changed_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(
        input.tournamentId,
        target.member_id,
        previousStatus,
        input.status,
        changedBy,
        now,
      ),
    ]);
  }
  return applyBotMessageContent(
    env.DB,
    input.waitlistPromotion
      ? "waitlist_promotion_before_deadline"
      : "participant_guidance",
    buildParticipantGuidanceMessage({
      tournamentId: input.tournamentId,
      tournamentTitle: target.title,
      bodyText: target.body_text,
      documentUrl: target.document_url,
      fileName: target.file_name,
      paymentCollectionMethod: target.payment_collection_method,
      participationFeeYen: Number(target.participation_fee_yen),
      paymentDeadline: target.payment_deadline,
      paymentStatus: input.status,
    }, { waitlistPromotion: input.waitlistPromotion }),
  );
}

export async function enqueueParticipantGuidance(
  env: ParticipantGuidanceEnv,
  groupKey: string,
  tournamentIds: string[],
): Promise<GuidanceEnqueueResult> {
  if (tournamentIds.length === 0) throw new Error("対象大会がありません。");
  const guidance = await env.DB.prepare(
    `SELECT revision
     FROM tournament_participant_guidance
     WHERE group_key = ?`,
  ).bind(groupKey).first<{ revision: number }>();
  if (!guidance) throw new Error("参加者向け案内が保存されていません。");
  const placeholders = tournamentIds.map(() => "?").join(", ");
  const targets = await env.DB.prepare(
    `SELECT DISTINCT
      tournament_entries.tournament_id,
      members.member_id,
      members.discord_user_id,
      members.status,
      members.dm_enabled
     FROM tournament_entries
     INNER JOIN members ON members.member_id = tournament_entries.member_id
     WHERE tournament_entries.tournament_id IN (${placeholders})
       AND tournament_entries.status = 'selected'
     ORDER BY members.member_id`,
  ).bind(...tournamentIds).all<GuidanceTargetRow>();
  const available = targets.results.filter((target) =>
    target.status === "active" &&
    target.dm_enabled === 1 &&
    Boolean(target.discord_user_id)
  );
  let queued = 0;
  for (let offset = 0; offset < available.length; offset += INSERT_BATCH_SIZE) {
    const statements = available.slice(offset, offset + INSERT_BATCH_SIZE).map((target) =>
      env.DB.prepare(
        `INSERT INTO participant_guidance_deliveries (
          idempotency_key, group_key, tournament_id, member_id,
          destination_id, guidance_revision, status, next_attempt_at
        ) SELECT ?, ?, ?, ?, ?, ?, 'pending', ?
        WHERE NOT EXISTS (
          SELECT 1 FROM participant_guidance_deliveries
          WHERE idempotency_key IN (?, ?)
        )
        ON CONFLICT(idempotency_key) DO NOTHING`,
      ).bind(
        `participant_guidance:${groupKey}:r${guidance.revision}:${target.member_id}`,
        groupKey,
        target.tournament_id,
        target.member_id,
        target.discord_user_id,
        guidance.revision,
        new Date().toISOString(),
        waitlistPromotionKey(groupKey, guidance.revision, target.member_id, false),
        waitlistPromotionKey(groupKey, guidance.revision, target.member_id, true),
      )
    );
    const results = await env.DB.batch(statements);
    queued += results.reduce(
      (sum, result) => sum + Number(result.meta.changes ?? 0),
      0,
    );
  }
  return {
    queued,
    unavailable: targets.results.length - available.length,
    revision: guidance.revision,
  };
}

async function markSkipped(db: D1Database, deliveryId: number, reason: string): Promise<void> {
  await db.prepare(
    `UPDATE participant_guidance_deliveries
     SET status = 'skipped', error_message = ?, lease_until = NULL
     WHERE delivery_id = ?`,
  ).bind(reason.slice(0, 1000), deliveryId).run();
}

export async function processParticipantGuidanceQueue(
  env: ParticipantGuidanceEnv,
  batchSize = 20,
): Promise<number> {
  if (!env.DISCORD_BOT_TOKEN) throw new Error("Discord Bot Tokenが未設定です。");
  const now = new Date();
  const nowIso = now.toISOString();
  const queued = await env.DB.prepare(
    `SELECT
      participant_guidance_deliveries.delivery_id,
      participant_guidance_deliveries.idempotency_key,
      participant_guidance_deliveries.group_key,
      participant_guidance_deliveries.tournament_id,
      participant_guidance_deliveries.member_id,
      participant_guidance_deliveries.destination_id,
      participant_guidance_deliveries.guidance_revision,
      participant_guidance_deliveries.attempt_count,
      tournament_participant_guidance.revision AS current_revision,
      tournaments.title,
      tournament_participant_guidance.body_text,
      tournament_participant_guidance.document_url,
      tournament_participant_guidance.file_name,
      tournament_participant_guidance.payment_collection_method,
      tournament_participant_guidance.payment_deadline,
      tournament_entry_payments.status AS payment_status,
      delivery_entries.status AS entry_status,
      delivery_entries.waitlist_number,
      (
        SELECT tournament_archive_documents.document_url
        FROM tournament_archive_documents
        WHERE tournament_archive_documents.group_key = participant_guidance_deliveries.group_key
          AND tournament_archive_documents.document_type = 'roster'
        LIMIT 1
      ) AS roster_document_url,
      (
        SELECT tournament_archive_documents.file_name
        FROM tournament_archive_documents
        WHERE tournament_archive_documents.group_key = participant_guidance_deliveries.group_key
          AND tournament_archive_documents.document_type = 'roster'
        LIMIT 1
      ) AS roster_file_name,
      (
        SELECT tournament_participation_fees.amount_yen
        FROM tournament_entries AS fee_entries
        INNER JOIN tournaments AS fee_tournaments
          ON fee_tournaments.tournament_id = fee_entries.tournament_id
        INNER JOIN members AS fee_members
          ON fee_members.member_id = fee_entries.member_id
        INNER JOIN tournament_participation_fees
          ON tournament_participation_fees.group_key = participant_guidance_deliveries.group_key
         AND tournament_participation_fees.grade = CASE
           WHEN fee_tournaments.all_grades = 1 THEN fee_members.grade
           ELSE fee_tournaments.grade
         END
        WHERE fee_entries.member_id = participant_guidance_deliveries.member_id
          AND fee_entries.status = 'selected'
          AND COALESCE(fee_tournaments.registration_group_id, fee_tournaments.tournament_id)
            = participant_guidance_deliveries.group_key
        LIMIT 1
      ) AS participation_fee_yen
     FROM participant_guidance_deliveries
     INNER JOIN tournament_participant_guidance
       ON tournament_participant_guidance.group_key = participant_guidance_deliveries.group_key
     INNER JOIN tournaments
       ON tournaments.tournament_id = tournament_participant_guidance.representative_tournament_id
     LEFT JOIN tournament_entry_payments
       ON tournament_entry_payments.tournament_id = participant_guidance_deliveries.tournament_id
      AND tournament_entry_payments.member_id = participant_guidance_deliveries.member_id
     LEFT JOIN tournament_entries AS delivery_entries
       ON delivery_entries.tournament_id = participant_guidance_deliveries.tournament_id
      AND delivery_entries.member_id = participant_guidance_deliveries.member_id
     WHERE participant_guidance_deliveries.status IN ('pending', 'failed')
       AND participant_guidance_deliveries.attempt_count < ?
       AND (participant_guidance_deliveries.next_attempt_at IS NULL
         OR participant_guidance_deliveries.next_attempt_at <= ?)
       AND (participant_guidance_deliveries.lease_until IS NULL
         OR participant_guidance_deliveries.lease_until <= ?)
     ORDER BY participant_guidance_deliveries.created_at,
       participant_guidance_deliveries.delivery_id
     LIMIT ?`,
  ).bind(MAX_ATTEMPTS, nowIso, nowIso, batchSize).all<GuidanceDeliveryRow>();

  let processed = 0;
  for (const delivery of queued.results) {
    const attemptedAt = new Date();
    const leaseUntil = new Date(attemptedAt.getTime() + LEASE_MILLISECONDS).toISOString();
    const claim = await env.DB.prepare(
      `UPDATE participant_guidance_deliveries
       SET lease_until = ?, last_attempt_at = ?, attempt_count = attempt_count + 1
       WHERE delivery_id = ? AND attempt_count = ?
         AND status IN ('pending', 'failed')
         AND (lease_until IS NULL OR lease_until <= ?)`,
    ).bind(
      leaseUntil,
      attemptedAt.toISOString(),
      delivery.delivery_id,
      delivery.attempt_count,
      attemptedAt.toISOString(),
    ).run();
    if (Number(claim.meta.changes ?? 0) !== 1) continue;
    processed += 1;

    if (delivery.guidance_revision !== delivery.current_revision) {
      await markSkipped(env.DB, delivery.delivery_id, "案内が更新されたため旧版の送信を停止しました。");
      continue;
    }
    const waitlistResult = delivery.idempotency_key.startsWith(WAITLIST_RESULT_PREFIX);
    const eligible = await env.DB.prepare(
      `SELECT members.member_id
       FROM members
       WHERE members.member_id = ?
         AND members.discord_user_id = ?
         AND members.status = 'active'
         AND members.dm_enabled = 1
         AND EXISTS (
           SELECT 1
           FROM tournament_entries
           INNER JOIN tournaments
             ON tournaments.tournament_id = tournament_entries.tournament_id
           WHERE tournament_entries.member_id = members.member_id
             AND (
               (? = 1 AND tournament_entries.status = 'not_selected')
               OR (? = 0 AND tournament_entries.status = 'selected')
             )
             AND COALESCE(tournaments.registration_group_id, tournaments.tournament_id) = ?
             AND tournaments.status NOT IN ('canceled', 'deleted')
         )
       LIMIT 1`,
    ).bind(
      delivery.member_id,
      delivery.destination_id,
      waitlistResult ? 1 : 0,
      waitlistResult ? 1 : 0,
      delivery.group_key,
    ).first<{ member_id: string }>();
    if (!eligible) {
      await markSkipped(env.DB, delivery.delivery_id, "出場確定者またはDM対象ではなくなったため送信を停止しました。");
      continue;
    }
    if (waitlistResult) {
      if (
        delivery.entry_status !== "not_selected" ||
        !delivery.waitlist_number ||
        !delivery.roster_document_url
      ) {
        await markSkipped(env.DB, delivery.delivery_id, "キャンセル待ち結果または確定名簿を確認できないため送信を停止しました。");
        continue;
      }
      try {
        const payload = await applyBotMessageContent(
          env.DB,
          "waitlist_result",
          buildWaitlistResultMessage(
            delivery.title,
            delivery.waitlist_number,
            delivery.roster_document_url,
            delivery.roster_file_name,
          ),
        );
        const message = await sendDirectMessage(
          env.DISCORD_BOT_TOKEN,
          delivery.destination_id,
          payload,
        );
        await env.DB.prepare(
          `UPDATE participant_guidance_deliveries
           SET status = 'sent', discord_message_id = ?, sent_at = ?,
             error_message = NULL, next_attempt_at = NULL, lease_until = NULL
           WHERE delivery_id = ?`,
        ).bind(message.id, new Date().toISOString(), delivery.delivery_id).run();
      } catch (error: unknown) {
        const nextAttemptCount = delivery.attempt_count + 1;
        const terminal = nextAttemptCount >= MAX_ATTEMPTS;
        const nextAttemptAt = terminal
          ? null
          : new Date(Date.now() + retryDelayMinutes(nextAttemptCount) * 60 * 1000).toISOString();
        const errorMessage = error instanceof Error ? error.message : String(error);
        await env.DB.prepare(
          `UPDATE participant_guidance_deliveries
           SET status = 'failed', error_message = ?, next_attempt_at = ?, lease_until = NULL
           WHERE delivery_id = ?`,
        ).bind(errorMessage.slice(0, 1000), nextAttemptAt, delivery.delivery_id).run();
      }
      continue;
    }
    if (delivery.participation_fee_yen === null) {
      await markSkipped(env.DB, delivery.delivery_id, "対象級の参加費が未登録です。");
      continue;
    }

    try {
      const latePromotion =
        delivery.idempotency_key.startsWith(WAITLIST_PROMOTION_LATE_PREFIX);
      const waitlistPromotion = latePromotion ||
        delivery.idempotency_key.startsWith(WAITLIST_PROMOTION_PREFIX);
      const paymentDeadlineTime = delivery.payment_deadline
        ? Date.parse(delivery.payment_deadline)
        : Number.NaN;
      const afterPaymentDeadline = latePromotion || (
        delivery.payment_collection_method === "advance_manager" &&
        Number.isFinite(paymentDeadlineTime) &&
        attemptedAt.getTime() > paymentDeadlineTime
      );
      const messageKey = afterPaymentDeadline
        ? "waitlist_promotion_after_deadline"
        : waitlistPromotion
          ? "waitlist_promotion_before_deadline"
          : "participant_guidance";
      const payload = await applyBotMessageContent(
        env.DB,
        messageKey,
        buildParticipantGuidanceMessage({
          tournamentId: delivery.tournament_id,
          tournamentTitle: delivery.title,
          bodyText: delivery.body_text,
          documentUrl: delivery.document_url,
          fileName: delivery.file_name,
          paymentCollectionMethod: delivery.payment_collection_method,
          participationFeeYen: Number(delivery.participation_fee_yen),
          paymentDeadline: delivery.payment_deadline,
          paymentStatus: delivery.payment_status ?? "unpaid",
        }, { waitlistPromotion, afterPaymentDeadline }),
      );
      const message = await sendDirectMessage(
        env.DISCORD_BOT_TOKEN,
        delivery.destination_id,
        payload,
      );
      await env.DB.prepare(
        `UPDATE participant_guidance_deliveries
         SET status = 'sent', discord_message_id = ?, sent_at = ?,
           error_message = NULL, next_attempt_at = NULL, lease_until = NULL
         WHERE delivery_id = ?`,
      ).bind(message.id, new Date().toISOString(), delivery.delivery_id).run();
    } catch (error: unknown) {
      const nextAttemptCount = delivery.attempt_count + 1;
      const terminal = nextAttemptCount >= MAX_ATTEMPTS;
      const nextAttemptAt = terminal
        ? null
        : new Date(
          Date.now() + retryDelayMinutes(nextAttemptCount) * 60 * 1000,
        ).toISOString();
      const errorMessage = error instanceof Error ? error.message : String(error);
      await env.DB.prepare(
        `UPDATE participant_guidance_deliveries
         SET status = 'failed', error_message = ?, next_attempt_at = ?, lease_until = NULL
         WHERE delivery_id = ?`,
      ).bind(errorMessage.slice(0, 1000), nextAttemptAt, delivery.delivery_id).run();
    }
  }
  return processed;
}
