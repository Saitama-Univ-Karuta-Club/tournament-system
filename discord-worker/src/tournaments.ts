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
  MEMBER_PORTAL_URL?: string;
  TOURNAMENT_ADMIN_URL?: string;
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
  registration_group_id?: string | null;
  title: string;
  event_start_date: string;
  event_end_date: string;
  grade: string;
  all_grades?: number;
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

export interface NotificationTarget {
  idempotencyKey: string;
  tournamentId: string;
  memberId?: string;
  notificationType:
    | "announcement"
    | "invitation_dm"
    | "deadline_reminder"
    | "application_completed";
  destinationType: "channel" | "dm";
  destinationId: string;
  reminderKind?: ReminderKind;
  deliveryContext?: "initial" | "update" | "completion" | "response_reminder";
  relatedTournamentIds?: string[];
}

export type ReminderKind = "internal_deadline" | "organizer_deadline";

export interface TestReminderResult {
  tournamentTitle: string;
  reminderKind: ReminderKind;
}

interface QueuedNotificationRow extends TournamentRow {
  notification_id: number;
  member_id: string | null;
  notification_type:
    | "announcement"
    | "invitation_dm"
    | "deadline_reminder"
    | "application_completed";
  destination_id: string;
  attempt_count: number;
  tournament_status: string;
  reminder_kind: ReminderKind | null;
  delivery_context: "initial" | "update" | "completion" | "response_reminder";
  related_tournament_ids: string | null;
}

interface ReminderTournamentRow extends TournamentRow {
  response_yes: number;
}

export interface ReminderParticipant {
  displayName: string;
  displayNameKana: string;
}

export interface ApplicationCompletedParticipant extends ReminderParticipant {
  grade: string;
}

interface ReminderParticipantRow {
  display_name: string;
  display_name_kana: string;
}

interface AttendanceTargetRow extends TournamentRow {
  member_id: string;
}

const RESPONSE_LABELS: Record<string, string> = {
  yes: "参加希望",
  maybe: "未定・条件付き",
  no: "不参加",
};

const QUEUE_BATCH_SIZE = 20;
const MAX_NOTIFICATION_ATTEMPTS = 5;
const QUEUE_LEASE_MILLISECONDS = 5 * 60 * 1000;
const INSERT_BATCH_SIZE = 50;
const JST_OFFSET_MILLISECONDS = 9 * 60 * 60 * 1000;
const TOURNAMENT_GRADES = new Set([
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "beginner",
  "all",
]);
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

export function normalizeTournamentGrades(raw: unknown): string[] {
  const values = Array.isArray(raw) ? raw : [raw];
  const grades = [...new Set(values.map((value) => String(value ?? "").trim()))]
    .filter(Boolean);
  if (grades.length === 0) {
    throw new Error("対象級を1つ以上選択してください。");
  }
  if (grades.some((grade) => !TOURNAMENT_GRADES.has(grade))) {
    throw new Error("対象級が不正です。");
  }
  if (grades.includes("all") && grades.length > 1) {
    throw new Error("「すべて」と個別の級は同時に選択できません。");
  }
  return grades;
}

export function formatTournamentGrade(tournament: TournamentRow): string {
  return tournament.all_grades === 1 ? "すべて" : formatGrade(tournament.grade);
}

export function buildAttendanceMessage(
  tournament: TournamentRow,
  selectedResponse?: string,
  isUpdate = false,
  memberPortalUrl?: string,
): DiscordMessagePayload {
  const selected = selectedResponse
    ? `\n現在の回答: **${RESPONSE_LABELS[selectedResponse]}**`
    : "";

  const fields = [
    {
      name: "対象級",
      value: formatTournamentGrade(tournament),
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
  const portalUrl = buildMemberPortalUrl(memberPortalUrl);
  if (portalUrl) {
    fields.push({
      name: "Web版大会参加確認",
      value: `[大会一覧・回答画面を開く](${portalUrl})`,
      inline: false,
    });
  }
  if (tournament.document_url) {
    fields.push({
      name: "大会要項",
      value: `[PDFを開く](${tournament.document_url})`,
      inline: false,
    });
  }

  return {
    content: isUpdate
      ? `【大会情報更新】内容が変更されました。参加意思をもう一度確認してください。${selected}`
      : `大会への参加意思を選択してください。${selected}`,
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

function buildMemberPortalUrl(memberPortalUrl?: string): string | undefined {
  if (!memberPortalUrl) return undefined;
  try {
    const url = new URL(memberPortalUrl);
    if (url.protocol !== "https:") return undefined;
    url.hash = "answer";
    return url.toString();
  } catch {
    return undefined;
  }
}

function buildTournamentAdminUrl(
  tournamentAdminUrl?: string,
): string | undefined {
  if (!tournamentAdminUrl) return undefined;
  try {
    const url = new URL(tournamentAdminUrl);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function buildAnnouncementMessage(
  tournament: TournamentRow,
  isUpdate = false,
  memberPortalUrl?: string,
): DiscordMessagePayload {
  const fields = [
    {
      name: "対象級",
      value: formatTournamentGrade(tournament),
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
  const portalUrl = buildMemberPortalUrl(memberPortalUrl);
  if (portalUrl) {
    fields.push({
      name: "Web版大会参加確認",
      value: `[大会一覧・回答画面を開く](${portalUrl})`,
      inline: false,
    });
  }
  if (tournament.document_url) {
    fields.push({
      name: "大会要項",
      value: `[PDFを開く](${tournament.document_url})`,
      inline: false,
    });
  }

  return {
    content: isUpdate
      ? "【大会情報更新】\n変更後の内容を対象者のDMへ再送します。"
      : "【大会追加】\n対象者のDMへ参加確認を送信します。",
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

export function buildResponseDeadlineChannelReminderMessage(
  tournament: TournamentRow,
  memberPortalUrl?: string,
): DiscordMessagePayload {
  const message = buildAnnouncementMessage(tournament, false, memberPortalUrl);
  return {
    ...message,
    content:
      "【回答締切リマインダー】サークル内締切の2日前です。未回答の方は回答してください。",
    embeds: message.embeds?.map((embed) => ({ ...embed, color: 0xfee75c })),
  };
}

export function buildResponseDeadlineDmReminderMessage(
  tournament: TournamentRow,
  memberPortalUrl?: string,
): DiscordMessagePayload {
  const message = buildAttendanceMessage(
    tournament,
    undefined,
    false,
    memberPortalUrl,
  );
  return {
    ...message,
    content:
      "【回答締切リマインダー】まだ回答が登録されていません。サークル内締切までに参加意思を選択してください。",
    embeds: message.embeds?.map((embed) => ({ ...embed, color: 0xfee75c })),
  };
}

export function buildApplicationCompletedMessage(
  tournaments: TournamentRow[],
  participants: ApplicationCompletedParticipant[],
): DiscordMessagePayload {
  const first = tournaments[0];
  if (!first) {
    throw new Error("申込完了通知の大会情報がありません。");
  }
  const gradeOrder = new Map(
    ["A", "B", "C", "D", "E", "F", "beginner"].map((grade, index) => [grade, index]),
  );
  const grades = tournaments
    .map((tournament) => formatTournamentGrade(tournament))
    .join("・");
  const distinctEventDates = new Set(
    tournaments.map((tournament) => tournament.event_start_date),
  );
  const eventDateValue = distinctEventDates.size === 1
    ? first.event_start_date
    : tournaments
      .map((tournament) =>
        `${formatTournamentGrade(tournament)}: ${tournament.event_start_date}`)
      .join("\n");
  const sortedParticipants = [...participants].sort((left, right) => {
    const gradeDifference =
      (gradeOrder.get(left.grade) ?? 99) - (gradeOrder.get(right.grade) ?? 99);
    if (gradeDifference !== 0) return gradeDifference;
    return left.displayNameKana.localeCompare(right.displayNameKana, "ja");
  });
  const participantLines = sortedParticipants.map((participant) => {
    const reading = participant.displayNameKana || "よみがな未登録";
    return `${formatGrade(participant.grade)} ${participant.displayName}（${reading}）`;
  });
  const participantChunks: string[] = [];
  let currentChunk = "";
  for (const line of participantLines) {
    if (currentChunk && currentChunk.length + line.length + 1 > 950) {
      participantChunks.push(currentChunk);
      currentChunk = line;
    } else {
      currentChunk += `${currentChunk ? "\n" : ""}${line}`;
    }
  }
  if (currentChunk) participantChunks.push(currentChunk);
  if (participantChunks.length === 0) participantChunks.push("なし");

  return {
    content: "【申込完了】主催者への大会申込が完了しました。",
    embeds: [
      {
        title: first.title,
        color: 0x5865f2,
        fields: [
          { name: "申込完了した級", value: grades, inline: true },
          {
            name: "開催日",
            value: eventDateValue,
            inline: true,
          },
          ...participantChunks.map((value, index) => ({
            name:
              index === 0
                ? `参加者（${participants.length}人）`
                : `参加者（続き${index + 1}）`,
            value,
            inline: false,
          })),
        ],
      },
    ],
    allowed_mentions: { parse: [] },
  };
}

export function buildDeadlineReminderMessage(
  tournament: TournamentRow,
  reminderKind: ReminderKind,
  participants: ReminderParticipant[] = [],
  isTest = false,
  tournamentAdminUrl?: string,
): DiscordMessagePayload {
  const isInternal = reminderKind === "internal_deadline";
  const deadlineLabel = isInternal ? "サークル内締切" : "主催者締切";
  const deadline = isInternal
    ? tournament.internal_deadline
    : tournament.true_deadline;
  const adminUrl = buildTournamentAdminUrl(tournamentAdminUrl);

  return {
    content: isTest
      ? `【テスト送信・締切リマインダー】${deadlineLabel}の通知表示と送信権限の確認です。`
      : isInternal
        ? "【締切リマインダー】サークル内締切を過ぎました。参加希望者を確認してください。"
        : "【締切リマインダー】本日が主催者締切です。申込完了後、大会ステータスを「申込完了」に変更してください。",
    embeds: [
      {
        title: tournament.title,
        color: isInternal ? 0xfee75c : 0xed4245,
        fields: [
          {
            name: "対象級",
            value: formatTournamentGrade(tournament),
            inline: true,
          },
          {
            name: deadlineLabel,
            value: formatJstDateTime(deadline),
            inline: true,
          },
          ...buildParticipantFields(participants),
          ...(adminUrl
            ? [{
              name: "大会管理画面",
              value: `[大会一覧・申込状況を開く](${adminUrl})`,
              inline: false,
            }]
            : []),
        ],
      },
    ],
    allowed_mentions: { parse: [] },
  };
}

function buildParticipantFields(participants: ReminderParticipant[]) {
  if (participants.length === 0) {
    return [{ name: "参加希望者（0人）", value: "なし", inline: false }];
  }

  const chunks: string[] = [];
  let current = "";
  for (const participant of participants) {
    const reading = participant.displayNameKana || "よみがな未登録";
    const line = `・${participant.displayName}（${reading}）`;
    if (current && current.length + line.length + 1 > 950) {
      chunks.push(current);
      current = line;
    } else {
      current += `${current ? "\n" : ""}${line}`;
    }
  }
  if (current) {
    chunks.push(current);
  }

  return chunks.map((value, index) => ({
    name:
      index === 0
        ? `参加希望者（${participants.length}人）`
        : `参加希望者（続き${index + 1}）`,
    value,
    inline: false,
  }));
}

function startOfJstDay(value: string): Date {
  const date = new Date(value);
  const jstDate = new Date(date.getTime() + JST_OFFSET_MILLISECONDS)
    .toISOString()
    .slice(0, 10);
  return new Date(`${jstDate}T00:00:00+09:00`);
}

export function getDeadlineReminderSchedule(
  tournament: TournamentRow,
  reminderKind: ReminderKind,
): Date {
  if (reminderKind === "internal_deadline") {
    return new Date(
      startOfJstDay(tournament.internal_deadline).getTime() +
        24 * 60 * 60 * 1000,
    );
  }
  return startOfJstDay(tournament.true_deadline);
}

export function getResponseDeadlineReminderSchedule(
  tournament: TournamentRow,
): Date {
  return new Date(
    startOfJstDay(tournament.internal_deadline).getTime() -
      2 * 24 * 60 * 60 * 1000,
  );
}

export function buildResponseDeadlineReminderTargets(
  tournament: TournamentRow,
  announcementChannelId: string,
  unansweredMembers: TargetMemberRow[],
  now = new Date(),
): NotificationTarget[] {
  const nowMs = now.getTime();
  if (
    nowMs < getResponseDeadlineReminderSchedule(tournament).getTime() ||
    nowMs >= new Date(tournament.internal_deadline).getTime()
  ) {
    return [];
  }

  return [
    {
      idempotencyKey:
        `response_reminder:channel:${tournament.tournament_id}:${announcementChannelId}`,
      tournamentId: tournament.tournament_id,
      notificationType: "announcement",
      destinationType: "channel",
      destinationId: announcementChannelId,
      deliveryContext: "response_reminder",
    },
    ...unansweredMembers.map((member) => ({
      idempotencyKey:
        `response_reminder:dm:${tournament.tournament_id}:${member.member_id}`,
      tournamentId: tournament.tournament_id,
      memberId: member.member_id,
      notificationType: "invitation_dm" as const,
      destinationType: "dm" as const,
      destinationId: member.discord_user_id,
      deliveryContext: "response_reminder" as const,
    })),
  ];
}

export function buildNotificationTargets(
  tournament: TournamentRow,
  announcementChannelId: string,
  members: TargetMemberRow[],
  options: { context?: "initial" | "update"; revision?: string } = {},
): NotificationTarget[] {
  const context = options.context ?? "initial";
  const revisionPart = context === "update"
    ? `:update:${options.revision ?? "update"}`
    : "";
  return [
    {
      idempotencyKey: `announcement${revisionPart}:${tournament.tournament_id}:${announcementChannelId}`,
      tournamentId: tournament.tournament_id,
      notificationType: "announcement",
      destinationType: "channel",
      destinationId: announcementChannelId,
      deliveryContext: context,
    },
    ...members.map((member) => ({
      idempotencyKey: `invitation_dm${revisionPart}:${tournament.tournament_id}:${member.member_id}`,
      tournamentId: tournament.tournament_id,
      memberId: member.member_id,
      notificationType: "invitation_dm" as const,
      destinationType: "dm" as const,
      destinationId: member.discord_user_id,
      deliveryContext: context,
    })),
  ];
}

export function buildDeadlineReminderTargets(
  tournament: TournamentRow,
  reminderChannelId: string,
  participantCount: number,
  now = new Date(),
): NotificationTarget[] {
  const nowMs = now.getTime();
  const reminders: Array<{ kind: ReminderKind; enabled: boolean }> = [
    {
      kind: "internal_deadline",
      enabled:
        nowMs >=
        getDeadlineReminderSchedule(tournament, "internal_deadline").getTime(),
    },
    {
      kind: "organizer_deadline",
      enabled:
        participantCount > 0 &&
        nowMs >=
          getDeadlineReminderSchedule(
            tournament,
            "organizer_deadline",
          ).getTime(),
    },
  ];

  return reminders
    .filter(({ enabled }) => enabled)
    .map(({ kind }) => ({
      idempotencyKey: `deadline_reminder:${kind}:${tournament.tournament_id}:${reminderChannelId}`,
      tournamentId: tournament.tournament_id,
      notificationType: "deadline_reminder" as const,
      destinationType: "channel" as const,
      destinationId: reminderChannelId,
      reminderKind: kind,
    }));
}

export function getRetryDelayMinutes(attemptCount: number): number {
  return [1, 5, 15, 60][Math.max(0, Math.min(attemptCount - 1, 3))];
}

async function markNotificationSent(
  db: D1Database,
  notificationId: number,
  discordMessageId: string,
  sentAt: string,
): Promise<void> {
  await db.prepare(
    `UPDATE notification_deliveries
     SET status = 'sent', discord_message_id = ?, sent_at = ?,
       error_message = NULL, next_attempt_at = NULL, lease_until = NULL
     WHERE notification_id = ?`,
  ).bind(discordMessageId, sentAt, notificationId).run();
}

async function markNotificationFailed(
  db: D1Database,
  notificationId: number,
  attemptCount: number,
  error: unknown,
  attemptedAt: Date,
): Promise<void> {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
  const nextAttemptAt =
    attemptCount < MAX_NOTIFICATION_ATTEMPTS
      ? new Date(
          attemptedAt.getTime() + getRetryDelayMinutes(attemptCount) * 60 * 1000,
        ).toISOString()
      : null;
  await db.prepare(
    `UPDATE notification_deliveries
     SET status = 'failed', error_message = ?, next_attempt_at = ?, lease_until = NULL
     WHERE notification_id = ?`,
  ).bind(message, nextAttemptAt, notificationId).run();
}

async function markNotificationSkipped(
  db: D1Database,
  notificationId: number,
  reason: string,
): Promise<void> {
  await db.prepare(
    `UPDATE notification_deliveries
     SET status = 'skipped', error_message = ?, next_attempt_at = NULL,
       lease_until = NULL
     WHERE notification_id = ?`,
  ).bind(reason, notificationId).run();
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

export async function upsertReminderChannel(
  env: TournamentEnv,
  guildId: string,
  channelId: string,
): Promise<void> {
  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    `UPDATE discord_settings
     SET admin_reminder_channel_id = ?, updated_at = ?
     WHERE guild_id = ?`,
  )
    .bind(channelId, now, guildId)
    .run();
  if (Number(result.meta.changes ?? 0) !== 1) {
    throw new Error("先に大会告知チャンネルを設定してください。");
  }
}

async function listReminderParticipants(
  db: D1Database,
  tournamentId: string,
): Promise<ReminderParticipant[]> {
  const participants = await db.prepare(
    `SELECT
      members.display_name,
      COALESCE(
        NULLIF(members.display_name_kana, ''),
        NULLIF(trim(members.last_name_kana || ' ' || members.first_name_kana), ''),
        ''
      ) AS display_name_kana
    FROM responses
    INNER JOIN members ON members.member_id = responses.member_id
    WHERE responses.tournament_id = ?
      AND responses.response = 'yes'
      AND responses.is_valid = 1
    ORDER BY
      CASE WHEN display_name_kana = '' THEN 1 ELSE 0 END,
      display_name_kana,
      members.display_name`,
  )
    .bind(tournamentId)
    .all<ReminderParticipantRow>();

  return participants.results.map((participant) => ({
    displayName: participant.display_name,
    displayNameKana: participant.display_name_kana,
  }));
}

export async function sendTestDeadlineReminder(
  env: TournamentEnv,
  now = new Date(),
): Promise<TestReminderResult> {
  if (!env.DISCORD_GUILD_ID || !env.DISCORD_BOT_TOKEN) {
    throw new Error("Discord設定が足りません。");
  }

  const settings = await env.DB.prepare(
    `SELECT admin_reminder_channel_id
     FROM discord_settings
     WHERE guild_id = ?`,
  )
    .bind(env.DISCORD_GUILD_ID)
    .first<{ admin_reminder_channel_id: string | null }>();
  if (!settings?.admin_reminder_channel_id) {
    throw new Error("管理者用リマインダーチャンネルが未設定です。");
  }

  const nowIso = now.toISOString();
  const tournament = await env.DB.prepare(
    `SELECT
      tournament_id,
      title,
      event_start_date,
      event_end_date,
      grade,
      all_grades,
      tournament_type,
      venue,
      true_deadline,
      internal_deadline,
      document_url
    FROM tournaments
    WHERE status = 'active'
      AND (internal_deadline > ? OR true_deadline > ?)
    ORDER BY
      CASE
        WHEN internal_deadline > ? THEN internal_deadline
        ELSE true_deadline
      END
    LIMIT 1`,
  )
    .bind(nowIso, nowIso, nowIso)
    .first<TournamentRow>();
  if (!tournament) {
    throw new Error("締切前の回答受付中大会がありません。");
  }

  const reminderKind: ReminderKind =
    tournament.internal_deadline > nowIso
      ? "internal_deadline"
      : "organizer_deadline";
  const participants = await listReminderParticipants(
    env.DB,
    tournament.tournament_id,
  );
  await sendChannelMessage(
    env.DISCORD_BOT_TOKEN,
    settings.admin_reminder_channel_id,
    buildDeadlineReminderMessage(
      tournament,
      reminderKind,
      participants,
      true,
      env.TOURNAMENT_ADMIN_URL,
    ),
  );
  return { tournamentTitle: tournament.title, reminderKind };
}

async function insertNotificationTargets(
  env: TournamentEnv,
  targets: NotificationTarget[],
): Promise<number> {
  let enqueued = 0;
  for (let offset = 0; offset < targets.length; offset += INSERT_BATCH_SIZE) {
    const statements = targets.slice(offset, offset + INSERT_BATCH_SIZE).map((target) =>
      env.DB.prepare(
        `INSERT INTO notification_deliveries (
          idempotency_key,
          tournament_id,
          member_id,
          notification_type,
          destination_type,
          destination_id,
          reminder_kind,
          delivery_context,
          related_tournament_ids,
          status,
          next_attempt_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
        ON CONFLICT(idempotency_key) DO NOTHING`,
      ).bind(
        target.idempotencyKey,
        target.tournamentId,
        target.memberId ?? null,
        target.notificationType,
        target.destinationType,
        target.destinationId,
        target.reminderKind ?? null,
        target.deliveryContext ?? "initial",
        target.relatedTournamentIds
          ? JSON.stringify(target.relatedTournamentIds)
          : null,
        new Date().toISOString(),
      ),
    );
    const results = await env.DB.batch(statements);
    enqueued += results.reduce(
      (total, result) => total + Number(result.meta.changes ?? 0),
      0,
    );
  }
  return enqueued;
}

export async function createTournament(
  env: TournamentEnv,
  rawInput: TournamentInput,
): Promise<TournamentRow> {
  const [tournament] = await createTournaments(env, [rawInput]);
  return tournament;
}

export async function createTournaments(
  env: TournamentEnv,
  rawInputs: TournamentInput[],
): Promise<TournamentRow[]> {
  if (rawInputs.length === 0 || rawInputs.length > 7) {
    throw new Error("対象級は1〜7件で指定してください。");
  }
  const inputs = rawInputs.map(normalizeTournamentInput);
  const now = new Date();
  const registrationGroupId = inputs.length > 1
    ? `TG-${crypto.randomUUID()}`
    : null;
  const tournaments = inputs.map<TournamentRow>((input) => ({
    tournament_id: `T-${crypto.randomUUID()}`,
    registration_group_id: registrationGroupId,
    title: input.title,
    event_start_date: input.eventStartDate,
    event_end_date: input.eventEndDate,
    grade: input.grade === "all" ? "A" : input.grade,
    all_grades: input.grade === "all" ? 1 : 0,
    tournament_type: input.tournamentType,
    venue: input.venue || null,
    true_deadline: input.trueDeadline,
    internal_deadline: input.internalDeadline,
    document_url: input.documentUrl || null,
  }));

  await env.DB.batch(
    tournaments.map((tournament, index) => {
      const input = inputs[index];
      return env.DB.prepare(
        `INSERT INTO tournaments (
          tournament_id,
          registration_group_id,
          title,
          event_start_date,
          event_end_date,
          grade,
          all_grades,
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
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
      ).bind(
        tournament.tournament_id,
        tournament.registration_group_id,
        tournament.title,
        tournament.event_start_date,
        tournament.event_end_date,
        tournament.grade,
        tournament.all_grades,
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
      );
    }),
  );

  return tournaments;
}

export async function enqueueTournamentNotifications(
  env: TournamentEnv,
  tournament: TournamentRow,
): Promise<number> {
  if (!env.DISCORD_GUILD_ID) {
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

  const members = await env.DB.prepare(
    `SELECT member_id, discord_user_id
     FROM members
     WHERE status = 'active'
       AND dm_enabled = 1
       AND (? = 1 OR grade = ?)
       AND discord_user_id IS NOT NULL
     ORDER BY member_id`,
  )
    .bind(tournament.all_grades ?? 0, tournament.grade)
    .all<TargetMemberRow>();

  const targets = buildNotificationTargets(
    tournament,
    settings.announcement_channel_id,
    members.results,
  );
  return insertNotificationTargets(env, targets);
}

async function latestAnnouncementChannelId(
  db: D1Database,
): Promise<string> {
  const settings = await db.prepare(
    `SELECT announcement_channel_id
     FROM discord_settings
     WHERE announcement_channel_id IS NOT NULL
     ORDER BY updated_at DESC
     LIMIT 1`,
  ).first<{ announcement_channel_id: string }>();
  if (!settings?.announcement_channel_id) {
    throw new Error("告知チャンネルが未設定です。");
  }
  return settings.announcement_channel_id;
}

export async function enqueueTournamentUpdateNotifications(
  env: TournamentEnv,
  tournament: TournamentRow,
  revision: string,
): Promise<number> {
  const announcementChannelId = await latestAnnouncementChannelId(env.DB);
  const members = await env.DB.prepare(
    `SELECT member_id, discord_user_id
     FROM members
     WHERE status = 'active'
       AND dm_enabled = 1
       AND (? = 1 OR grade = ?)
       AND discord_user_id IS NOT NULL
     ORDER BY member_id`,
  )
    .bind(tournament.all_grades ?? 0, tournament.grade)
    .all<TargetMemberRow>();
  return insertNotificationTargets(
    env,
    buildNotificationTargets(
      tournament,
      announcementChannelId,
      members.results,
      { context: "update", revision },
    ),
  );
}

export async function enqueueApplicationCompletedNotification(
  env: TournamentEnv,
  tournaments: TournamentRow[],
): Promise<number> {
  if (tournaments.length === 0) return 0;
  const announcementChannelId = await latestAnnouncementChannelId(env.DB);
  const tournamentIds = tournaments
    .map((tournament) => tournament.tournament_id)
    .sort();
  return insertNotificationTargets(env, [
    {
      idempotencyKey: `application_completed:${tournamentIds.join(":")}`,
      tournamentId: tournamentIds[0],
      notificationType: "application_completed",
      destinationType: "channel",
      destinationId: announcementChannelId,
      deliveryContext: "completion",
      relatedTournamentIds: tournamentIds,
    },
  ]);
}

export async function enqueueDeadlineReminders(
  env: TournamentEnv,
  now = new Date(),
): Promise<number> {
  if (!env.DISCORD_GUILD_ID) {
    return 0;
  }

  const settings = await env.DB.prepare(
    `SELECT admin_reminder_channel_id
     FROM discord_settings
     WHERE guild_id = ?`,
  )
    .bind(env.DISCORD_GUILD_ID)
    .first<{ admin_reminder_channel_id: string | null }>();
  if (!settings?.admin_reminder_channel_id) {
    return 0;
  }

  const tournaments = await env.DB.prepare(
    `SELECT
      tournament_id,
      title,
      event_start_date,
      event_end_date,
      grade,
      all_grades,
      tournament_type,
      venue,
      true_deadline,
      internal_deadline,
      document_url,
      (SELECT COUNT(*)
       FROM responses
       WHERE responses.tournament_id = tournaments.tournament_id
         AND responses.response = 'yes'
         AND responses.is_valid = 1) AS response_yes
    FROM tournaments
    WHERE status = 'active'
    ORDER BY internal_deadline, true_deadline
    LIMIT 100`,
  )
    .all<ReminderTournamentRow>();

  const targets = tournaments.results.flatMap((tournament) =>
    buildDeadlineReminderTargets(
      tournament,
      settings.admin_reminder_channel_id!,
      Number(tournament.response_yes),
      now,
    ),
  );
  return insertNotificationTargets(env, targets);
}

export async function enqueueResponseDeadlineReminders(
  env: TournamentEnv,
  now = new Date(),
): Promise<number> {
  if (!env.DISCORD_GUILD_ID) return 0;

  const settings = await env.DB.prepare(
    `SELECT announcement_channel_id
     FROM discord_settings
     WHERE guild_id = ?`,
  )
    .bind(env.DISCORD_GUILD_ID)
    .first<{ announcement_channel_id: string | null }>();
  if (!settings?.announcement_channel_id) return 0;

  const tournaments = await env.DB.prepare(
    `SELECT
      tournament_id,
      title,
      event_start_date,
      event_end_date,
      grade,
      all_grades,
      tournament_type,
      venue,
      true_deadline,
      internal_deadline,
      document_url
    FROM tournaments
    WHERE status = 'active'
      AND internal_deadline > ?
      AND (
        NOT EXISTS (
          SELECT 1
          FROM notification_deliveries
          WHERE notification_deliveries.tournament_id = tournaments.tournament_id
            AND notification_deliveries.delivery_context = 'response_reminder'
            AND notification_deliveries.destination_type = 'channel'
        )
        OR EXISTS (
          SELECT 1
          FROM members
          WHERE members.status = 'active'
            AND members.dm_enabled = 1
            AND (tournaments.all_grades = 1 OR members.grade = tournaments.grade)
            AND members.discord_user_id IS NOT NULL
            AND NOT EXISTS (
              SELECT 1
              FROM responses
              WHERE responses.tournament_id = tournaments.tournament_id
                AND responses.member_id = members.member_id
                AND responses.is_valid = 1
            )
            AND NOT EXISTS (
              SELECT 1
              FROM notification_deliveries
              WHERE notification_deliveries.tournament_id = tournaments.tournament_id
                AND notification_deliveries.member_id = members.member_id
                AND notification_deliveries.delivery_context = 'response_reminder'
                AND notification_deliveries.destination_type = 'dm'
            )
        )
      )
    ORDER BY internal_deadline
    LIMIT 100`,
  ).bind(now.toISOString()).all<TournamentRow>();

  let enqueued = 0;
  for (const tournament of tournaments.results) {
    if (now < getResponseDeadlineReminderSchedule(tournament)) continue;

    const unansweredMembers = await env.DB.prepare(
      `SELECT members.member_id, members.discord_user_id
       FROM members
       WHERE members.status = 'active'
         AND members.dm_enabled = 1
         AND (? = 1 OR members.grade = ?)
         AND members.discord_user_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1
           FROM responses
           WHERE responses.tournament_id = ?
             AND responses.member_id = members.member_id
             AND responses.is_valid = 1
         )
         AND NOT EXISTS (
           SELECT 1
           FROM notification_deliveries
           WHERE notification_deliveries.tournament_id = ?
             AND notification_deliveries.member_id = members.member_id
             AND notification_deliveries.delivery_context = 'response_reminder'
             AND notification_deliveries.destination_type = 'dm'
         )
       ORDER BY members.member_id`,
    )
      .bind(
        tournament.all_grades ?? 0,
        tournament.grade,
        tournament.tournament_id,
        tournament.tournament_id,
      )
      .all<TargetMemberRow>();

    enqueued += await insertNotificationTargets(
      env,
      buildResponseDeadlineReminderTargets(
        tournament,
        settings.announcement_channel_id,
        unansweredMembers.results,
        now,
      ),
    );
  }
  return enqueued;
}

function parseRelatedTournamentIds(
  raw: string | null,
  fallbackId: string,
): string[] {
  if (!raw) return [fallbackId];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      Array.isArray(parsed) &&
      parsed.length > 0 &&
      parsed.length <= 7 &&
      parsed.every(
        (value) =>
          typeof value === "string" && /^T-[0-9a-f-]{36}$/.test(value),
      )
    ) {
      return [...new Set(parsed)];
    }
  } catch {
    // キュー値が壊れている場合は代表大会だけで安全に処理する。
  }
  return [fallbackId];
}

async function applicationCompletedPayload(
  db: D1Database,
  notification: QueuedNotificationRow,
): Promise<DiscordMessagePayload> {
  const tournamentIds = parseRelatedTournamentIds(
    notification.related_tournament_ids,
    notification.tournament_id,
  );
  const placeholders = tournamentIds.map(() => "?").join(", ");
  const tournaments = await db.prepare(
    `SELECT
      tournament_id,
      registration_group_id,
      title,
      event_start_date,
      event_end_date,
      grade,
      all_grades,
      tournament_type,
      venue,
      true_deadline,
      internal_deadline,
      document_url
     FROM tournaments
     WHERE tournament_id IN (${placeholders})
       AND status = 'applied'
     ORDER BY grade`,
  ).bind(...tournamentIds).all<TournamentRow>();
  if (tournaments.results.length === 0) {
    throw new Error("申込完了状態の大会がありません。");
  }
  const participants = await db.prepare(
    `SELECT
      members.display_name,
      COALESCE(
        NULLIF(members.display_name_kana, ''),
        NULLIF(TRIM(members.last_name_kana || ' ' || members.first_name_kana), ''),
        ''
      ) AS display_name_kana,
      CASE WHEN tournaments.all_grades = 1
        THEN members.grade
        ELSE tournaments.grade
      END AS grade
     FROM responses
     INNER JOIN members ON members.member_id = responses.member_id
     INNER JOIN tournaments
       ON tournaments.tournament_id = responses.tournament_id
     WHERE responses.tournament_id IN (${placeholders})
       AND responses.response = 'yes'
       AND responses.is_valid = 1
     ORDER BY tournaments.grade, display_name_kana, members.display_name`,
  ).bind(...tournamentIds).all<{
    display_name: string;
    display_name_kana: string;
    grade: string;
  }>();
  return buildApplicationCompletedMessage(
    tournaments.results,
    participants.results.map((participant) => ({
      displayName: participant.display_name,
      displayNameKana: participant.display_name_kana,
      grade: participant.grade,
    })),
  );
}

export async function processNotificationQueue(
  env: TournamentEnv,
  batchSize = QUEUE_BATCH_SIZE,
): Promise<number> {
  if (!env.DISCORD_BOT_TOKEN) {
    throw new Error("Discord Bot Tokenが未設定です。");
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const queued = await env.DB.prepare(
    `SELECT
      notification_deliveries.notification_id,
      notification_deliveries.member_id,
      notification_deliveries.notification_type,
      notification_deliveries.reminder_kind,
      notification_deliveries.delivery_context,
      notification_deliveries.related_tournament_ids,
      notification_deliveries.destination_id,
      notification_deliveries.attempt_count,
      tournaments.tournament_id,
      tournaments.title,
      tournaments.event_start_date,
      tournaments.event_end_date,
      tournaments.grade,
      tournaments.all_grades,
      tournaments.tournament_type,
      tournaments.venue,
      tournaments.true_deadline,
      tournaments.internal_deadline,
      tournaments.document_url,
      tournaments.status AS tournament_status
    FROM notification_deliveries
    INNER JOIN tournaments
      ON tournaments.tournament_id = notification_deliveries.tournament_id
    WHERE notification_deliveries.status IN ('pending', 'failed')
      AND notification_deliveries.attempt_count < ?
      AND (
        notification_deliveries.next_attempt_at IS NULL
        OR notification_deliveries.next_attempt_at <= ?
      )
      AND (
        notification_deliveries.lease_until IS NULL
        OR notification_deliveries.lease_until <= ?
      )
    ORDER BY
      CASE notification_deliveries.notification_type
        WHEN 'announcement' THEN 0
        WHEN 'deadline_reminder' THEN 1
        WHEN 'application_completed' THEN 2
        ELSE 2
      END,
      notification_deliveries.created_at,
      notification_deliveries.notification_id
    LIMIT ?`,
  )
    .bind(MAX_NOTIFICATION_ATTEMPTS, nowIso, nowIso, batchSize)
    .all<QueuedNotificationRow>();

  let processed = 0;
  for (const notification of queued.results) {
    const attemptedAt = new Date();
    const leaseUntil = new Date(
      attemptedAt.getTime() + QUEUE_LEASE_MILLISECONDS,
    ).toISOString();
    const claim = await env.DB.prepare(
      `UPDATE notification_deliveries
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
    if (Number(claim.meta.changes ?? 0) !== 1) {
      continue;
    }

    processed += 1;
    const statusAllowsNotification =
      notification.notification_type === "application_completed"
        ? notification.tournament_status === "applied"
        : notification.tournament_status === "active";
    if (!statusAllowsNotification) {
      await markNotificationSkipped(
        env.DB,
        notification.notification_id,
        "大会ステータスが通知条件を満たさないため送信を停止しました。",
      );
      continue;
    }

    try {
      let payload: DiscordMessagePayload;
      if (notification.delivery_context === "response_reminder") {
        if (
          attemptedAt.getTime() >=
            new Date(notification.internal_deadline).getTime()
        ) {
          await markNotificationSkipped(
            env.DB,
            notification.notification_id,
            "サークル内締切を過ぎたため回答リマインダーを送信しませんでした。",
          );
          continue;
        }
        if (notification.notification_type === "invitation_dm") {
          if (!notification.member_id) {
            throw new Error("回答リマインダーの送信先メンバーが未設定です。");
          }
          const unanswered = await env.DB.prepare(
            `SELECT members.member_id
             FROM members
             WHERE members.member_id = ?
               AND members.discord_user_id = ?
               AND members.status = 'active'
               AND members.dm_enabled = 1
               AND (? = 1 OR members.grade = ?)
               AND NOT EXISTS (
                 SELECT 1
                 FROM responses
                 WHERE responses.tournament_id = ?
                   AND responses.member_id = members.member_id
                   AND responses.is_valid = 1
               )
             LIMIT 1`,
          )
            .bind(
              notification.member_id,
              notification.destination_id,
              notification.all_grades ?? 0,
              notification.grade,
              notification.tournament_id,
            )
            .first<{ member_id: string }>();
          if (!unanswered) {
            await markNotificationSkipped(
              env.DB,
              notification.notification_id,
              "回答済みまたは通知対象外になったためDMを送信しませんでした。",
            );
            continue;
          }
          payload = buildResponseDeadlineDmReminderMessage(
            notification,
            env.MEMBER_PORTAL_URL,
          );
        } else if (notification.notification_type === "announcement") {
          payload = buildResponseDeadlineChannelReminderMessage(
            notification,
            env.MEMBER_PORTAL_URL,
          );
        } else {
          throw new Error("回答リマインダーの通知種別が不正です。");
        }
      } else if (notification.notification_type === "announcement") {
        payload = buildAnnouncementMessage(
          notification,
          notification.delivery_context === "update",
          env.MEMBER_PORTAL_URL,
        );
      } else if (notification.notification_type === "deadline_reminder") {
        if (!notification.reminder_kind) {
          throw new Error("締切リマインダーの種類が未設定です。");
        }
        const participants = await listReminderParticipants(
          env.DB,
          notification.tournament_id,
        );
        if (
          notification.reminder_kind === "organizer_deadline" &&
          participants.length === 0
        ) {
          await markNotificationSkipped(
            env.DB,
            notification.notification_id,
            "参加希望者がいないため主催者締切リマインダーを送信しませんでした。",
          );
          continue;
        }
        payload = buildDeadlineReminderMessage(
          notification,
          notification.reminder_kind,
          participants,
          false,
          env.TOURNAMENT_ADMIN_URL,
        );
      } else if (notification.notification_type === "application_completed") {
        payload = await applicationCompletedPayload(env.DB, notification);
      } else {
        let selectedResponse: string | undefined;
        if (notification.member_id) {
          const current = await env.DB.prepare(
            `SELECT response FROM responses
             WHERE tournament_id = ? AND member_id = ? AND is_valid = 1`,
          )
            .bind(notification.tournament_id, notification.member_id)
            .first<{ response: string }>();
          selectedResponse = current?.response;
        }
        payload = buildAttendanceMessage(
          notification,
          selectedResponse,
          notification.delivery_context === "update",
          env.MEMBER_PORTAL_URL,
        );
      }
      const message =
        notification.notification_type !== "invitation_dm"
          ? await sendChannelMessage(
              env.DISCORD_BOT_TOKEN,
              notification.destination_id,
              payload,
            )
          : await sendDirectMessage(
              env.DISCORD_BOT_TOKEN,
              notification.destination_id,
              payload,
            );
      await markNotificationSent(
        env.DB,
        notification.notification_id,
        message.id,
        new Date().toISOString(),
      );
    } catch (error: unknown) {
      await markNotificationFailed(
        env.DB,
        notification.notification_id,
        notification.attempt_count + 1,
        error,
        attemptedAt,
      );
    }
  }
  return processed;
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
      tournaments.all_grades,
      tournaments.tournament_type,
      tournaments.venue,
      tournaments.true_deadline,
      tournaments.internal_deadline,
      tournaments.document_url
    FROM tournaments
    WHERE tournaments.status = 'active'
      AND (
        NOT EXISTS (
          SELECT 1
          FROM notification_deliveries
          WHERE notification_deliveries.tournament_id = tournaments.tournament_id
            AND notification_deliveries.notification_type = 'announcement'
            AND notification_deliveries.delivery_context = 'initial'
        )
        OR EXISTS (
          SELECT 1
          FROM members
          WHERE members.status = 'active'
            AND members.dm_enabled = 1
            AND (tournaments.all_grades = 1 OR members.grade = tournaments.grade)
            AND members.discord_user_id IS NOT NULL
            AND NOT EXISTS (
              SELECT 1
              FROM notification_deliveries
              WHERE notification_deliveries.tournament_id = tournaments.tournament_id
                AND notification_deliveries.member_id = members.member_id
                AND notification_deliveries.notification_type = 'invitation_dm'
                AND notification_deliveries.delivery_context = 'initial'
            )
        )
      )
    ORDER BY tournaments.created_at
    LIMIT 5`,
  ).all<TournamentRow>();

  for (const tournament of pending.results) {
    try {
      await enqueueTournamentNotifications(env, tournament);
    } catch (error: unknown) {
      console.error(
        `未通知大会のDiscord通知エラー: ${tournament.tournament_id}`,
        error,
      );
    }
  }
  await enqueueResponseDeadlineReminders(env);
  await enqueueDeadlineReminders(env);
  await processNotificationQueue(env);
}

export async function createTestTournamentAndNotify(
  env: TournamentEnv,
  rawInput: TestTournamentInput,
): Promise<void> {
  const normalized = normalizeMemberRegistration({
    discordUserId: rawInput.createdByDiscordUserId,
    displayName: rawInput.title || "Discord Botテスト大会",
    displayNameKana: rawInput.title || "Discord Botテスト大会",
    grade: rawInput.grade,
    rank: 0,
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
  await enqueueTournamentNotifications(env, tournament);
  await processNotificationQueue(env);
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
      tournaments.all_grades,
      tournaments.internal_deadline,
      tournaments.true_deadline,
      tournaments.venue,
      tournaments.document_url
    FROM members
    INNER JOIN tournaments ON tournaments.tournament_id = ?
    WHERE members.discord_user_id = ?
      AND members.status = 'active'
      AND (tournaments.all_grades = 1 OR members.grade = tournaments.grade)
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
      tournament_id, member_id, response, source, is_valid, created_at, updated_at
    ) VALUES (?, ?, ?, 'discord', 1, ?, ?)
    ON CONFLICT(tournament_id, member_id) DO UPDATE SET
      response = excluded.response,
      source = 'discord',
      is_valid = 1,
      invalidated_at = NULL,
      invalidated_reason = NULL,
      updated_at = excluded.updated_at`,
  )
    .bind(target.tournament_id, target.member_id, input.response, now, now)
    .run();

  return buildAttendanceMessage(
    target,
    input.response,
    false,
    env.MEMBER_PORTAL_URL,
  );
}
