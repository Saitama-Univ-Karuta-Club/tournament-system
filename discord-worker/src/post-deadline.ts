import { sendChannelMessage, sendDirectMessage, type DiscordMessagePayload } from "./discord-api";
import { formatGrade } from "./members";
import {
  buildEntryResultsAnnouncementMessage,
  getDeadlineReminderSchedule,
  type EntryResultAnnouncementParticipant,
  type TournamentRow,
} from "./tournaments";

export interface PostDeadlineEnv {
  DB: D1Database;
  DISCORD_BOT_TOKEN?: string;
  TOURNAMENT_ADMIN_URL?: string;
}

type DeliveryKind =
  | "confirmation_roster_dm"
  | "lottery_result_channel"
  | "organizer_payment_info_channel"
  | "payment_reminder_dm"
  | "payment_reminder_channel"
  | "organizer_payment_overdue_channel";

interface DeliveryTarget {
  idempotencyKey: string;
  groupKey: string;
  tournamentId: string;
  memberId?: string;
  kind: DeliveryKind;
  destinationType: "channel" | "dm";
  destinationId: string;
  revision: number;
}

interface QueuedDelivery {
  delivery_id: number;
  group_key: string;
  tournament_id: string;
  member_id: string | null;
  delivery_kind: DeliveryKind;
  destination_type: "channel" | "dm";
  destination_id: string;
  payload_revision: number;
  attempt_count: number;
}

interface RecipientRow {
  member_id: string;
  discord_user_id: string | null;
  status: string;
  dm_enabled: number;
}

interface PaymentRow extends RecipientRow {
  tournament_id: string;
  display_name: string;
  display_name_kana: string;
  grade: string;
  participation_fee_yen: number;
  payment_status: "paid" | "unpaid";
}

export interface PaymentReminderParticipant {
  display_name: string;
  grade: string;
  participation_fee_yen: number;
  payment_status: "paid" | "unpaid";
}

export interface OrganizerPaymentGuidance {
  title: string;
  trueDeadline: string;
  paymentDetails: string | null;
  organizerPaymentSource: "text" | "file" | "guidance";
  organizerPaymentDocumentUrl: string | null;
  organizerPaymentFileName: string | null;
  guidanceBodyText: string | null;
  guidanceDocumentUrl: string | null;
  guidanceFileName: string | null;
  organizerPaymentDeadline: string;
  paymentDeadline: string;
  organizerPaymentStatus: "unpaid" | "paid";
}

const MAX_ATTEMPTS = 5;
const LEASE_MILLISECONDS = 5 * 60 * 1000;
const INSERT_BATCH_SIZE = 50;

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

async function insertTargets(env: PostDeadlineEnv, targets: DeliveryTarget[]): Promise<number> {
  let queued = 0;
  for (let offset = 0; offset < targets.length; offset += INSERT_BATCH_SIZE) {
    const statements = targets.slice(offset, offset + INSERT_BATCH_SIZE).map((target) =>
      env.DB.prepare(
        `INSERT INTO post_deadline_deliveries (
          idempotency_key, group_key, tournament_id, member_id,
          delivery_kind, destination_type, destination_id,
          payload_revision, status, next_attempt_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
        ON CONFLICT(idempotency_key) DO NOTHING`,
      ).bind(
        target.idempotencyKey,
        target.groupKey,
        target.tournamentId,
        target.memberId ?? null,
        target.kind,
        target.destinationType,
        target.destinationId,
        target.revision,
        new Date().toISOString(),
      )
    );
    const results = await env.DB.batch(statements);
    queued += results.reduce((sum, result) => sum + Number(result.meta.changes ?? 0), 0);
  }
  return queued;
}

export function buildConfirmationRosterMessage(
  title: string,
  documentUrl: string,
  fileName: string,
): DiscordMessagePayload {
  return {
    content: "主催者から抽選前の確認名簿が届きました。氏名・出場級を確認してください。\n万が一誤りがある場合は、お早めに大会担当者までお知らせください。",
    embeds: [{
      title,
      color: 0xfee75c,
      fields: [{
        name: "申込確認名簿",
        value: `[${fileName}](${documentUrl})`,
        inline: false,
      }],
    }],
    allowed_mentions: { parse: [] },
  };
}

export function buildPaymentReminderDmMessage(
  title: string,
  participationFeeYen: number,
  paymentDeadline: string,
  tournamentId: string,
): DiscordMessagePayload {
  return {
    content: "【参加費リマインダー】サークル内支払期限を過ぎています。お早めにお支払いください。\n出場をキャンセルする場合は、大会担当者までお知らせください。",
    embeds: [{
      title,
      color: 0xed4245,
      fields: [
        { name: "参加費", value: `${new Intl.NumberFormat("ja-JP").format(participationFeeYen)}円`, inline: true },
        { name: "支払い方法", value: "大会担当者へ事前に支払い", inline: true },
        { name: "サークル内支払期限", value: formatJstDateTime(paymentDeadline), inline: false },
      ],
    }],
    components: [{
      type: 1,
      components: [
        { type: 2, style: 3, label: "支払い完了", custom_id: `payment:${tournamentId}:paid` },
        { type: 2, style: 2, label: "操作を取り消す", custom_id: `payment:${tournamentId}:unpaid` },
      ],
    }],
    allowed_mentions: { parse: [] },
  };
}

export function buildPaymentReminderChannelMessage(
  title: string,
  participants: PaymentReminderParticipant[],
  paymentDeadline: string,
): DiscordMessagePayload {
  const paid = participants.filter((participant) => participant.payment_status === "paid");
  const unpaid = participants.filter((participant) => participant.payment_status === "unpaid");
  const participantLines = (rows: PaymentReminderParticipant[]) => rows.length
    ? rows.map((participant) =>
      `${formatGrade(participant.grade)} ${participant.display_name} ${new Intl.NumberFormat("ja-JP").format(Number(participant.participation_fee_yen))}円`
    ).join("\n")
    : "なし";
  const total = (rows: PaymentReminderParticipant[]) => rows.reduce((sum, participant) =>
    sum + Number(participant.participation_fee_yen), 0);
  return {
    content: "【参加費リマインダー】サークル内支払期限を過ぎました。",
    embeds: [{
      title,
      color: 0xed4245,
      fields: [
        {
          name: `支払い済み（${paid.length}人・${new Intl.NumberFormat("ja-JP").format(total(paid))}円）`,
          value: participantLines(paid),
          inline: false,
        },
        {
          name: `未納（${unpaid.length}人・${new Intl.NumberFormat("ja-JP").format(total(unpaid))}円）`,
          value: participantLines(unpaid),
          inline: false,
        },
        {
          name: "サークル内支払期限",
          value: formatJstDateTime(paymentDeadline),
          inline: false,
        },
      ],
    }],
    allowed_mentions: { parse: [] },
  };
}

function truncateDiscordField(value: string, maxLength = 1000): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function adminTournamentLink(adminUrl?: string): string | null {
  if (!adminUrl) return null;
  try {
    return new URL("/tournaments", adminUrl).toString();
  } catch {
    return null;
  }
}

export function buildOrganizerPaymentMessage(
  guidance: OrganizerPaymentGuidance,
  participants: PaymentReminderParticipant[],
  adminUrl?: string,
  overdue = false,
): DiscordMessagePayload {
  const amount = (value: number) => new Intl.NumberFormat("ja-JP").format(value);
  const gradeTotals = new Map<string, { count: number; total: number }>();
  for (const participant of participants) {
    const current = gradeTotals.get(participant.grade) ?? { count: 0, total: 0 };
    current.count += 1;
    current.total += Number(participant.participation_fee_yen);
    gradeTotals.set(participant.grade, current);
  }
  const breakdown = [...gradeTotals.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([grade, value]) => `${formatGrade(grade)} ${value.count}人・${amount(value.total)}円`)
    .join("\n") || "出場確定者なし";
  const total = participants.reduce(
    (sum, participant) => sum + Number(participant.participation_fee_yen),
    0,
  );
  let paymentInstructions = "当日案内を参照してください。";
  if (guidance.organizerPaymentSource === "text") {
    paymentInstructions = guidance.paymentDetails || "振込先情報未登録";
  } else if (guidance.organizerPaymentSource === "file") {
    paymentInstructions = guidance.organizerPaymentDocumentUrl
      ? `[${guidance.organizerPaymentFileName || "主催者振込情報を開く"}](${guidance.organizerPaymentDocumentUrl})`
      : "振込情報ファイル未登録";
  } else {
    const parts = [guidance.guidanceBodyText || "当日案内に記載"];
    if (guidance.guidanceDocumentUrl) {
      parts.push(
        `[${guidance.guidanceFileName || "当日案内ファイルを開く"}](${guidance.guidanceDocumentUrl})`,
      );
    }
    paymentInstructions = parts.join("\n");
  }
  const fields: NonNullable<
    NonNullable<DiscordMessagePayload["embeds"]>[number]["fields"]
  > = [
    {
      name: `主催者への振込合計（${participants.length}人）`,
      value: `${amount(total)}円\n${breakdown}`,
      inline: false,
    },
    {
      name: "振込先・振込方法",
      value: truncateDiscordField(paymentInstructions),
      inline: false,
    },
    {
      name: "担当者の支払日",
      value: formatJstDateTime(guidance.organizerPaymentDeadline),
      inline: true,
    },
    {
      name: "サークル内支払期限",
      value: formatJstDateTime(guidance.paymentDeadline),
      inline: true,
    },
    {
      name: "主催者への振込状況",
      value: guidance.organizerPaymentStatus === "paid" ? "振込済み" : "未振込",
      inline: false,
    },
  ];
  const adminLink = adminTournamentLink(adminUrl);
  if (adminLink) {
    fields.push({
      name: "大会管理画面",
      value: `[振込後に「振込済み」へ変更する](${adminLink})`,
      inline: false,
    });
  }
  return {
    content: overdue
      ? "**【至急・主催者への振込未完了】本日が主催締切日です。主催者への参加費振込が未完了です。すぐに振込を行い、管理画面で「振込済み」に変更してください。**"
      : "【担当者向け・参加費振込情報】抽選結果と出場確定者が登録されました。主催者への振込内容を確認してください。",
    embeds: [{
      title: guidance.title,
      color: overdue ? 0xed4245 : 0x5865f2,
      fields,
    }],
    allowed_mentions: { parse: [] },
  };
}

export async function enqueueConfirmationRosterDms(
  env: PostDeadlineEnv,
  groupKey: string,
  tournamentIds: string[],
): Promise<{ queued: number; unavailable: number }> {
  const roster = await env.DB.prepare(
    `SELECT revision, representative_tournament_id
     FROM tournament_confirmation_rosters WHERE group_key = ?`,
  ).bind(groupKey).first<{ revision: number; representative_tournament_id: string }>();
  if (!roster) throw new Error("申込確認名簿が登録されていません。");
  const placeholders = tournamentIds.map(() => "?").join(", ");
  const recipients = await env.DB.prepare(
    `SELECT DISTINCT members.member_id, members.discord_user_id,
      members.status, members.dm_enabled
     FROM tournament_entries
     INNER JOIN members ON members.member_id = tournament_entries.member_id
     WHERE tournament_entries.tournament_id IN (${placeholders})
       AND tournament_entries.status <> 'withdrawn'
     ORDER BY members.member_id`,
  ).bind(...tournamentIds).all<RecipientRow>();
  const available = recipients.results.filter((recipient) =>
    recipient.status === "active" && recipient.dm_enabled === 1 && Boolean(recipient.discord_user_id)
  );
  const queued = await insertTargets(env, available.map((recipient) => ({
    idempotencyKey: `confirmation_roster:${groupKey}:r${roster.revision}:${recipient.member_id}`,
    groupKey,
    tournamentId: roster.representative_tournament_id,
    memberId: recipient.member_id,
    kind: "confirmation_roster_dm",
    destinationType: "dm",
    destinationId: recipient.discord_user_id!,
    revision: roster.revision,
  })));
  return { queued, unavailable: recipients.results.length - available.length };
}

export async function enqueueLotteryResultAnnouncement(
  env: PostDeadlineEnv,
  groupKey: string,
  representativeTournamentId: string,
  revision: number,
): Promise<number> {
  const settings = await env.DB.prepare(
    `SELECT announcement_channel_id FROM discord_settings
     WHERE announcement_channel_id IS NOT NULL
     ORDER BY updated_at DESC LIMIT 1`,
  ).first<{ announcement_channel_id: string }>();
  if (!settings?.announcement_channel_id) throw new Error("大会お知らせチャンネルが未設定です。");
  return insertTargets(env, [{
    idempotencyKey: `lottery_result:${groupKey}:r${revision}`,
    groupKey,
    tournamentId: representativeTournamentId,
    kind: "lottery_result_channel",
    destinationType: "channel",
    destinationId: settings.announcement_channel_id,
    revision,
  }]);
}

export async function enqueueOrganizerPaymentInfo(
  env: PostDeadlineEnv,
  groupKey: string,
  representativeTournamentId: string,
  revision: number,
): Promise<number> {
  const settings = await env.DB.prepare(
    `SELECT admin_reminder_channel_id FROM discord_settings
     WHERE admin_reminder_channel_id IS NOT NULL
     ORDER BY updated_at DESC LIMIT 1`,
  ).first<{ admin_reminder_channel_id: string }>();
  if (!settings?.admin_reminder_channel_id) {
    throw new Error("大会担当者チャンネルが未設定です。");
  }
  return insertTargets(env, [{
    idempotencyKey: `organizer_payment_info:${groupKey}:r${revision}`,
    groupKey,
    tournamentId: representativeTournamentId,
    kind: "organizer_payment_info_channel",
    destinationType: "channel",
    destinationId: settings.admin_reminder_channel_id,
    revision,
  }]);
}

async function paymentParticipants(db: D1Database, groupKey: string): Promise<PaymentRow[]> {
  const rows = await db.prepare(
    `SELECT DISTINCT
      members.member_id,
      tournament_entries.tournament_id,
      members.discord_user_id,
      members.status,
      members.dm_enabled,
      members.display_name,
      COALESCE(NULLIF(members.display_name_kana, ''), '') AS display_name_kana,
      CASE WHEN tournaments.all_grades = 1 THEN members.grade ELSE tournaments.grade END AS grade,
      tournament_participation_fees.amount_yen AS participation_fee_yen,
      COALESCE(tournament_entry_payments.status, 'unpaid') AS payment_status
     FROM tournament_entries
     INNER JOIN tournaments ON tournaments.tournament_id = tournament_entries.tournament_id
     INNER JOIN members ON members.member_id = tournament_entries.member_id
     INNER JOIN tournament_participation_fees
       ON tournament_participation_fees.group_key = COALESCE(tournaments.registration_group_id, tournaments.tournament_id)
      AND tournament_participation_fees.grade = CASE
        WHEN tournaments.all_grades = 1 THEN members.grade ELSE tournaments.grade
      END
     LEFT JOIN tournament_entry_payments
       ON tournament_entry_payments.tournament_id = tournament_entries.tournament_id
      AND tournament_entry_payments.member_id = tournament_entries.member_id
     WHERE COALESCE(tournaments.registration_group_id, tournaments.tournament_id) = ?
       AND tournament_entries.status = 'selected'
       AND tournaments.status NOT IN ('canceled', 'deleted')
     ORDER BY grade, display_name_kana, members.display_name`,
  ).bind(groupKey).all<PaymentRow>();
  return rows.results;
}

export async function enqueueDuePaymentReminders(
  env: PostDeadlineEnv,
  now = new Date(),
): Promise<number> {
  const due = await env.DB.prepare(
    `SELECT group_key, representative_tournament_id, revision, payment_deadline
     FROM tournament_participant_guidance
     WHERE payment_collection_method = 'advance_manager'
       AND payment_deadline IS NOT NULL AND payment_deadline <= ?`,
  ).bind(now.toISOString()).all<{
    group_key: string;
    representative_tournament_id: string;
    revision: number;
    payment_deadline: string;
  }>();
  const settings = await env.DB.prepare(
    `SELECT admin_reminder_channel_id FROM discord_settings
     WHERE admin_reminder_channel_id IS NOT NULL
     ORDER BY updated_at DESC LIMIT 1`,
  ).first<{ admin_reminder_channel_id: string }>();
  let queued = 0;
  for (const guidance of due.results) {
    const payments = await paymentParticipants(env.DB, guidance.group_key);
    const unpaid = payments.filter((participant) => participant.payment_status === "unpaid");
    const available = unpaid.filter((participant) =>
      participant.status === "active" && participant.dm_enabled === 1 && Boolean(participant.discord_user_id)
    );
    const deadlineKey = guidance.payment_deadline.replace(/[^0-9]/g, "");
    const targets: DeliveryTarget[] = available.map((participant) => ({
      idempotencyKey: `payment_reminder_dm:${guidance.group_key}:${deadlineKey}:${participant.member_id}`,
      groupKey: guidance.group_key,
      tournamentId: participant.tournament_id,
      memberId: participant.member_id,
      kind: "payment_reminder_dm",
      destinationType: "dm",
      destinationId: participant.discord_user_id!,
      revision: guidance.revision,
    }));
    if (unpaid.length > 0 && settings?.admin_reminder_channel_id) {
      targets.push({
        idempotencyKey: `payment_reminder_channel:${guidance.group_key}:${deadlineKey}`,
        groupKey: guidance.group_key,
        tournamentId: guidance.representative_tournament_id,
        kind: "payment_reminder_channel",
        destinationType: "channel",
        destinationId: settings.admin_reminder_channel_id,
        revision: guidance.revision,
      });
    }
    queued += await insertTargets(env, targets);
  }
  return queued;
}

export async function enqueueDueOrganizerPaymentReminders(
  env: PostDeadlineEnv,
  now = new Date(),
): Promise<number> {
  const due = await env.DB.prepare(
    `SELECT tournament_participant_guidance.group_key,
      tournament_participant_guidance.representative_tournament_id,
      tournament_participant_guidance.revision,
      tournaments.true_deadline
     FROM tournament_participant_guidance
     INNER JOIN tournaments
       ON tournaments.tournament_id = tournament_participant_guidance.representative_tournament_id
     WHERE tournament_participant_guidance.payment_collection_method = 'advance_manager'
       AND tournament_participant_guidance.organizer_payment_status = 'unpaid'
       AND EXISTS (
         SELECT 1 FROM post_deadline_deliveries
         WHERE post_deadline_deliveries.group_key = tournament_participant_guidance.group_key
           AND post_deadline_deliveries.delivery_kind = 'organizer_payment_info_channel'
       )`,
  ).all<{
    group_key: string;
    representative_tournament_id: string;
    revision: number;
    true_deadline: string;
  }>();
  const settings = await env.DB.prepare(
    `SELECT admin_reminder_channel_id FROM discord_settings
     WHERE admin_reminder_channel_id IS NOT NULL
     ORDER BY updated_at DESC LIMIT 1`,
  ).first<{ admin_reminder_channel_id: string }>();
  if (!settings?.admin_reminder_channel_id) return 0;
  let queued = 0;
  for (const guidance of due.results) {
    const schedule = getDeadlineReminderSchedule(
      {
        tournament_id: guidance.representative_tournament_id,
        title: "",
        event_start_date: "",
        event_end_date: "",
        grade: "C",
        internal_deadline: guidance.true_deadline,
        true_deadline: guidance.true_deadline,
      },
      "organizer_deadline",
    );
    if (now < schedule) continue;
    const deadlineKey = guidance.true_deadline.replace(/[^0-9]/g, "");
    queued += await insertTargets(env, [{
      idempotencyKey: `organizer_payment_overdue:${guidance.group_key}:${deadlineKey}`,
      groupKey: guidance.group_key,
      tournamentId: guidance.representative_tournament_id,
      kind: "organizer_payment_overdue_channel",
      destinationType: "channel",
      destinationId: settings.admin_reminder_channel_id,
      revision: guidance.revision,
    }]);
  }
  return queued;
}

async function markSkipped(db: D1Database, deliveryId: number, reason: string): Promise<void> {
  await db.prepare(
    `UPDATE post_deadline_deliveries SET status = 'skipped', error_message = ?, lease_until = NULL
     WHERE delivery_id = ?`,
  ).bind(reason.slice(0, 1000), deliveryId).run();
}

async function confirmationPayload(db: D1Database, delivery: QueuedDelivery): Promise<DiscordMessagePayload> {
  const row = await db.prepare(
    `SELECT tournament_confirmation_rosters.document_url,
      tournament_confirmation_rosters.file_name,
      tournament_confirmation_rosters.revision,
      tournaments.title
     FROM tournament_confirmation_rosters
     INNER JOIN tournaments
       ON tournaments.tournament_id = tournament_confirmation_rosters.representative_tournament_id
     WHERE tournament_confirmation_rosters.group_key = ?`,
  ).bind(delivery.group_key).first<{
    document_url: string;
    file_name: string;
    revision: number;
    title: string;
  }>();
  if (!row || Number(row.revision) !== delivery.payload_revision) {
    throw new Error("申込確認名簿が更新または削除されています。");
  }
  return buildConfirmationRosterMessage(row.title, row.document_url, row.file_name);
}

async function lotteryPayload(db: D1Database, groupKey: string): Promise<DiscordMessagePayload> {
  const tournaments = await db.prepare(
    `SELECT tournament_id, registration_group_id, title, event_start_date,
      event_end_date, grade, all_grades, internal_deadline, true_deadline,
      tournament_type, venue, document_url
     FROM tournaments
     WHERE COALESCE(registration_group_id, tournament_id) = ?
       AND status NOT IN ('canceled', 'deleted')
     ORDER BY grade`,
  ).bind(groupKey).all<TournamentRow>();
  if (!tournaments.results.length) throw new Error("抽選結果の対象大会がありません。");
  const participants = await db.prepare(
    `SELECT members.display_name,
      COALESCE(NULLIF(members.display_name_kana, ''), '') AS display_name_kana,
      CASE WHEN tournaments.all_grades = 1 THEN members.grade ELSE tournaments.grade END AS grade,
      tournament_entries.status, tournament_entries.waitlist_number
     FROM tournament_entries
     INNER JOIN tournaments ON tournaments.tournament_id = tournament_entries.tournament_id
     INNER JOIN members ON members.member_id = tournament_entries.member_id
     WHERE COALESCE(tournaments.registration_group_id, tournaments.tournament_id) = ?
       AND tournament_entries.status IN ('selected', 'not_selected')`,
  ).bind(groupKey).all<{
    display_name: string;
    display_name_kana: string;
    grade: string;
    status: "selected" | "not_selected";
    waitlist_number: number | null;
  }>();
  const roster = await db.prepare(
    `SELECT document_url FROM tournament_archive_documents
     WHERE group_key = ? AND document_type = 'roster'`,
  ).bind(groupKey).first<{ document_url: string }>();
  if (!roster) throw new Error("確定名簿が登録されていません。");
  return buildEntryResultsAnnouncementMessage(
    tournaments.results[0].title,
    participants.results.map((participant): EntryResultAnnouncementParticipant => ({
      displayName: participant.display_name,
      displayNameKana: participant.display_name_kana,
      grade: participant.grade,
      entryStatus: participant.status,
      waitlistNumber: participant.waitlist_number,
    })),
    roster.document_url,
  );
}

async function paymentGuidance(db: D1Database, groupKey: string): Promise<{
  title: string;
  payment_deadline: string;
}> {
  const row = await db.prepare(
    `SELECT tournaments.title, tournament_participant_guidance.payment_deadline
     FROM tournament_participant_guidance
     INNER JOIN tournaments
       ON tournaments.tournament_id = tournament_participant_guidance.representative_tournament_id
     WHERE tournament_participant_guidance.group_key = ?
       AND tournament_participant_guidance.payment_collection_method = 'advance_manager'`,
  ).bind(groupKey).first<{
    title: string;
    payment_deadline: string | null;
  }>();
  if (!row?.payment_deadline) throw new Error("事前集金の支払期限が登録されていません。");
  return { ...row, payment_deadline: row.payment_deadline };
}

async function organizerPaymentGuidance(
  db: D1Database,
  groupKey: string,
): Promise<OrganizerPaymentGuidance> {
  const row = await db.prepare(
    `SELECT tournaments.title, tournaments.true_deadline,
      tournament_participant_guidance.payment_details,
      tournament_participant_guidance.organizer_payment_source,
      tournament_participant_guidance.organizer_payment_document_url,
      tournament_participant_guidance.organizer_payment_file_name,
      tournament_participant_guidance.body_text,
      tournament_participant_guidance.document_url,
      tournament_participant_guidance.file_name,
      tournament_participant_guidance.organizer_payment_deadline,
      tournament_participant_guidance.payment_deadline,
      tournament_participant_guidance.organizer_payment_status
     FROM tournament_participant_guidance
     INNER JOIN tournaments
       ON tournaments.tournament_id = tournament_participant_guidance.representative_tournament_id
     WHERE tournament_participant_guidance.group_key = ?
       AND tournament_participant_guidance.payment_collection_method = 'advance_manager'`,
  ).bind(groupKey).first<{
    title: string;
    true_deadline: string;
    payment_details: string | null;
    organizer_payment_source: "text" | "file" | "guidance";
    organizer_payment_document_url: string | null;
    organizer_payment_file_name: string | null;
    body_text: string | null;
    document_url: string | null;
    file_name: string | null;
    organizer_payment_deadline: string | null;
    payment_deadline: string | null;
    organizer_payment_status: "unpaid" | "paid";
  }>();
  if (!row?.organizer_payment_deadline || !row.payment_deadline) {
    throw new Error("担当者向けの振込情報または支払期限が登録されていません。");
  }
  return {
    title: row.title,
    trueDeadline: row.true_deadline,
    paymentDetails: row.payment_details,
    organizerPaymentSource: row.organizer_payment_source,
    organizerPaymentDocumentUrl: row.organizer_payment_document_url,
    organizerPaymentFileName: row.organizer_payment_file_name,
    guidanceBodyText: row.body_text,
    guidanceDocumentUrl: row.document_url,
    guidanceFileName: row.file_name,
    organizerPaymentDeadline: row.organizer_payment_deadline,
    paymentDeadline: row.payment_deadline,
    organizerPaymentStatus: row.organizer_payment_status,
  };
}

export async function processPostDeadlineQueue(
  env: PostDeadlineEnv,
  batchSize = 20,
): Promise<number> {
  if (!env.DISCORD_BOT_TOKEN) throw new Error("Discord Bot Tokenが未設定です。");
  const nowIso = new Date().toISOString();
  const queued = await env.DB.prepare(
    `SELECT delivery_id, group_key, tournament_id, member_id,
      delivery_kind, destination_type, destination_id,
      payload_revision, attempt_count
     FROM post_deadline_deliveries
     WHERE status IN ('pending', 'failed') AND attempt_count < ?
       AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
       AND (lease_until IS NULL OR lease_until <= ?)
     ORDER BY created_at, delivery_id LIMIT ?`,
  ).bind(MAX_ATTEMPTS, nowIso, nowIso, batchSize).all<QueuedDelivery>();
  let processed = 0;
  for (const delivery of queued.results) {
    const attemptedAt = new Date();
    const leaseUntil = new Date(attemptedAt.getTime() + LEASE_MILLISECONDS).toISOString();
    const claim = await env.DB.prepare(
      `UPDATE post_deadline_deliveries
       SET lease_until = ?, last_attempt_at = ?, attempt_count = attempt_count + 1
       WHERE delivery_id = ? AND attempt_count = ? AND status IN ('pending', 'failed')
         AND (lease_until IS NULL OR lease_until <= ?)`,
    ).bind(leaseUntil, attemptedAt.toISOString(), delivery.delivery_id,
      delivery.attempt_count, attemptedAt.toISOString()).run();
    if (Number(claim.meta.changes ?? 0) !== 1) continue;
    processed += 1;
    try {
      let payload: DiscordMessagePayload;
      if (delivery.delivery_kind === "confirmation_roster_dm") {
        const eligible = await env.DB.prepare(
          `SELECT members.member_id FROM members
           INNER JOIN tournament_entries ON tournament_entries.member_id = members.member_id
           INNER JOIN tournaments ON tournaments.tournament_id = tournament_entries.tournament_id
           WHERE members.member_id = ? AND members.discord_user_id = ?
             AND members.status = 'active' AND members.dm_enabled = 1
             AND tournament_entries.status <> 'withdrawn'
             AND COALESCE(tournaments.registration_group_id, tournaments.tournament_id) = ?
           LIMIT 1`,
        ).bind(delivery.member_id, delivery.destination_id, delivery.group_key)
          .first<{ member_id: string }>();
        if (!eligible) {
          await markSkipped(env.DB, delivery.delivery_id, "申込者またはDM対象ではなくなりました。");
          continue;
        }
        payload = await confirmationPayload(env.DB, delivery);
      } else if (delivery.delivery_kind === "lottery_result_channel") {
        payload = await lotteryPayload(env.DB, delivery.group_key);
      } else if (
        delivery.delivery_kind === "organizer_payment_info_channel" ||
        delivery.delivery_kind === "organizer_payment_overdue_channel"
      ) {
        const guidance = await organizerPaymentGuidance(env.DB, delivery.group_key);
        if (
          delivery.delivery_kind === "organizer_payment_overdue_channel" &&
          guidance.organizerPaymentStatus === "paid"
        ) {
          await markSkipped(env.DB, delivery.delivery_id, "主催者への振込済みのため送信しませんでした。");
          continue;
        }
        const payments = await paymentParticipants(env.DB, delivery.group_key);
        payload = buildOrganizerPaymentMessage(
          guidance,
          payments,
          env.TOURNAMENT_ADMIN_URL,
          delivery.delivery_kind === "organizer_payment_overdue_channel",
        );
      } else {
        const guidance = await paymentGuidance(env.DB, delivery.group_key);
        const payments = await paymentParticipants(env.DB, delivery.group_key);
        const unpaid = payments.filter((participant) => participant.payment_status === "unpaid");
        if (delivery.delivery_kind === "payment_reminder_dm") {
          const participant = unpaid.find((candidate) =>
            candidate.member_id === delivery.member_id &&
            candidate.discord_user_id === delivery.destination_id &&
            candidate.status === "active" && candidate.dm_enabled === 1
          );
          if (!participant) {
            await markSkipped(env.DB, delivery.delivery_id, "支払済みまたはDM対象外になりました。");
            continue;
          }
          payload = buildPaymentReminderDmMessage(
            guidance.title,
            Number(participant.participation_fee_yen),
            guidance.payment_deadline,
            delivery.tournament_id,
          );
        } else {
          if (!unpaid.length) {
            await markSkipped(env.DB, delivery.delivery_id, "未納者がいないため送信しませんでした。");
            continue;
          }
          payload = buildPaymentReminderChannelMessage(
            guidance.title,
            payments,
            guidance.payment_deadline,
          );
        }
      }

      const message = delivery.destination_type === "channel"
        ? await sendChannelMessage(env.DISCORD_BOT_TOKEN, delivery.destination_id, payload)
        : await sendDirectMessage(env.DISCORD_BOT_TOKEN, delivery.destination_id, payload);
      await env.DB.prepare(
        `UPDATE post_deadline_deliveries
         SET status = 'sent', discord_message_id = ?, sent_at = ?,
           error_message = NULL, next_attempt_at = NULL, lease_until = NULL
         WHERE delivery_id = ?`,
      ).bind(message.id, new Date().toISOString(), delivery.delivery_id).run();
    } catch (error: unknown) {
      const nextAttemptCount = delivery.attempt_count + 1;
      const nextAttemptAt = nextAttemptCount >= MAX_ATTEMPTS ? null : new Date(
        Date.now() + retryDelayMinutes(nextAttemptCount) * 60 * 1000,
      ).toISOString();
      const errorMessage = error instanceof Error ? error.message : String(error);
      await env.DB.prepare(
        `UPDATE post_deadline_deliveries
         SET status = 'failed', error_message = ?, next_attempt_at = ?, lease_until = NULL
         WHERE delivery_id = ?`,
      ).bind(errorMessage.slice(0, 1000), nextAttemptAt, delivery.delivery_id).run();
    }
  }
  return processed;
}
