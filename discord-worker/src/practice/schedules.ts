import {
  sendChannelMessage,
  sendChannelMessageWithFiles,
  type DiscordMessagePayload,
} from "../discord-api";
import { generatePracticeScheduleCalendarPng } from "./calendar-image";
import { PracticeError, type PracticeEnv } from "./service";

export type PracticeScheduleResponse = "yes" | "maybe" | "no";

interface ScheduleRow {
  schedule_id: string;
  practice_date: string;
  start_time: string | null;
  end_time: string | null;
  title: string;
  location: string | null;
  note: string | null;
  status: "scheduled" | "canceled" | "completed";
  created_by_member_id: string | null;
  created_by_admin_identity: string | null;
  registration_batch_id: string | null;
  announcement_message_id: string | null;
}

interface ScheduleResponseRow {
  schedule_id: string;
  member_id: string;
  display_name: string;
  response: PracticeScheduleResponse;
  updated_at: string;
}

interface MemberResponseRow {
  member_id: string;
  display_name: string;
  response: PracticeScheduleResponse | null;
}

export interface PracticeScheduleNotificationEnv extends PracticeEnv {
  DISCORD_BOT_TOKEN?: string;
  MEMBER_PORTAL_URL?: string;
}

const SCHEDULE_ID = /^PS-[0-9a-f-]{36}$/;
const RESPONSE_LABELS: Record<PracticeScheduleResponse, string> = {
  yes: "参加",
  maybe: "未定",
  no: "不参加",
};
const RESPONSE_VALUES = new Set<PracticeScheduleResponse>(["yes", "maybe", "no"]);

function text(value: unknown, label: string, maxLength: number, required = false): string | null {
  const normalized = String(value ?? "").trim();
  if (required && !normalized) throw new PracticeError(`${label}を入力してください。`);
  if (normalized.length > maxLength) throw new PracticeError(`${label}は${maxLength}文字以内で入力してください。`);
  return normalized || null;
}

function date(value: unknown): string {
  const normalized = String(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized) || Number.isNaN(Date.parse(`${normalized}T00:00:00Z`))) {
    throw new PracticeError("練習日を正しく入力してください。");
  }
  return normalized;
}

function jstDateTime(now: Date): { date: string; time: string } {
  const value = new Date(now.getTime() + 9 * 60 * 60 * 1_000).toISOString();
  return { date: value.slice(0, 10), time: value.slice(11, 16) };
}

function time(value: unknown, label: string): string | null {
  const normalized = String(value ?? "").trim();
  if (!normalized) return null;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(normalized)) {
    throw new PracticeError(`${label}を正しく入力してください。`);
  }
  return normalized;
}

function timeRange(schedule: ScheduleRow): string {
  if (!schedule.start_time) return "時刻未定";
  return schedule.end_time ? `${schedule.start_time}〜${schedule.end_time}` : `${schedule.start_time}〜`;
}

function scheduleFields(schedule: ScheduleRow) {
  const fields: NonNullable<DiscordMessagePayload["embeds"]>[number]["fields"] = [
    { name: "日時", value: `${schedule.practice_date} ${timeRange(schedule)}`, inline: true },
    { name: "会場", value: schedule.location ?? "未定", inline: true },
  ];
  if (schedule.note) fields.push({ name: "連絡事項", value: schedule.note });
  return fields;
}

function responseButtons(scheduleId: string): NonNullable<DiscordMessagePayload["components"]> {
  return [{
    type: 1,
    components: [
      { type: 2, style: 3, label: "参加", custom_id: `practice-schedule:${scheduleId}:yes` },
      { type: 2, style: 2, label: "未定", custom_id: `practice-schedule:${scheduleId}:maybe` },
      { type: 2, style: 4, label: "不参加", custom_id: `practice-schedule:${scheduleId}:no` },
    ],
  }];
}

function compact(value: string | null, maxLength = 50): string {
  if (!value) return "";
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function batchScheduleLine(schedule: ScheduleRow): string {
  const title = compact(schedule.title);
  const location = compact(schedule.location);
  const details = [title, location].filter(Boolean).join("／");
  return `**${schedule.practice_date} ${timeRange(schedule)}**${details ? `\n${details}` : ""}`;
}

export function buildPracticeScheduleBatchAnnouncement(input: {
  schedules: ScheduleRow[];
  portalUrl?: string;
}): DiscordMessagePayload {
  const portalUrl = input.portalUrl?.replace(/\/$/, "");
  return {
    content: "【かるた練習帖】練習日程をまとめてお知らせします。",
    embeds: [{
      title: `練習日程（${input.schedules.length}件）`,
      description: input.schedules.map(batchScheduleLine).join("\n\n"),
      color: 0x4262ad,
      image: { url: "attachment://practice-schedule-calendar.png" },
      fields: portalUrl
        ? [{
          name: "出欠回答",
          value: `[メンバーポータルで参加・未定・不参加を回答する](${portalUrl}/#practice-schedules)`,
        }]
        : undefined,
    }],
    components: portalUrl
      ? [{
        type: 1,
        components: [{
          type: 2,
          style: 5,
          label: "メンバーポータルで回答",
          url: `${portalUrl}/#practice-schedules`,
        }],
      }]
      : undefined,
    allowed_mentions: { parse: [] },
  };
}

function names(rows: MemberResponseRow[], response: PracticeScheduleResponse | null): string {
  const selected = rows.filter((row) => row.response === response).map((row) => row.display_name);
  return selected.length ? selected.join("、") : "なし";
}

export function buildPracticeScheduleReminder(input: {
  schedule: ScheduleRow;
  responses: MemberResponseRow[];
}): DiscordMessagePayload {
  return {
    content: "【かるた練習帖】明日の練習です。回答状況を確認してください。",
    embeds: [{
      title: `${input.schedule.practice_date} ${input.schedule.title}`,
      color: 0xd28a22,
      fields: [
        ...scheduleFields(input.schedule),
        { name: "参加", value: names(input.responses, "yes") },
        { name: "未定", value: names(input.responses, "maybe") },
        { name: "不参加", value: names(input.responses, "no") },
        { name: "未回答", value: names(input.responses, null) },
      ],
    }],
    components: responseButtons(input.schedule.schedule_id),
    allowed_mentions: { parse: [] },
  };
}

export async function listPracticeSchedules(env: PracticeEnv): Promise<unknown[]> {
  const [schedules, responses] = await Promise.all([
    env.DB.prepare(
      `SELECT schedule_id, practice_date, start_time, end_time, title, location,
              note, status, created_by_member_id, created_by_admin_identity,
              registration_batch_id, announcement_message_id
       FROM practice_schedules
       WHERE practice_date >= date('now', '+9 hours', '-30 days')
       ORDER BY practice_date, COALESCE(start_time, '99:99'), created_at`,
    ).all<ScheduleRow>(),
    env.DB.prepare(
      `SELECT practice_schedule_responses.schedule_id,
              practice_schedule_responses.member_id,
              members.display_name, practice_schedule_responses.response,
              practice_schedule_responses.updated_at
       FROM practice_schedule_responses
       INNER JOIN members ON members.member_id = practice_schedule_responses.member_id
       INNER JOIN practice_schedules ON practice_schedules.schedule_id = practice_schedule_responses.schedule_id
       WHERE practice_schedules.practice_date >= date('now', '+9 hours', '-30 days')
       ORDER BY members.display_name_kana, members.display_name`,
    ).all<ScheduleResponseRow>(),
  ]);
  return schedules.results.map((schedule) => ({
    ...schedule,
    responses: responses.results.filter((row) => row.schedule_id === schedule.schedule_id),
  }));
}

export async function completeExpiredPracticeSchedules(
  env: PracticeEnv,
  now = new Date(),
): Promise<number> {
  const current = jstDateTime(now);
  const result = await env.DB.prepare(
    `UPDATE practice_schedules
     SET status = 'completed',
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE status = 'scheduled'
       AND (
         practice_date < ?
         OR (
           practice_date = ?
           AND COALESCE(end_time, start_time) IS NOT NULL
           AND COALESCE(end_time, start_time) <= ?
         )
       )`,
  ).bind(current.date, current.date, current.time).run();
  return Number(result.meta?.changes ?? 0);
}

export async function createPracticeSchedules(
  env: PracticeEnv,
  creator: { memberId?: string | null; adminIdentity?: string | null },
  input: Record<string, unknown>,
): Promise<{ scheduleIds: string[] }> {
  const creatorMemberId = creator.memberId?.trim() || null;
  const creatorAdminIdentity = creator.adminIdentity?.trim() || null;
  if (!creatorMemberId && !creatorAdminIdentity) {
    throw new PracticeError("日程の登録者を確認できませんでした。", 403);
  }
  const rawSchedules = Array.isArray(input.schedules) ? input.schedules : [];
  if (!rawSchedules.length) throw new PracticeError("練習日程を1件以上入力してください。");
  if (rawSchedules.length > 31) throw new PracticeError("練習日程は一度に31件まで登録できます。");
  const registrationBatchId = `PSB-${crypto.randomUUID()}`;
  const schedules = rawSchedules.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new PracticeError("練習日程を確認できませんでした。");
    }
    const item = raw as Record<string, unknown>;
    const startTime = time(item.startTime, "開始時刻");
    const endTime = time(item.endTime, "終了時刻");
    if (startTime && endTime && endTime <= startTime) {
      throw new PracticeError("終了時刻は開始時刻より後にしてください。");
    }
    return {
      scheduleId: `PS-${crypto.randomUUID()}`,
      practiceDate: date(item.practiceDate),
      startTime,
      endTime,
      title: text(item.title ?? "通常練習", "練習名", 100, true)!,
      location: text(item.location, "会場", 100),
      note: text(item.note, "連絡事項", 500),
    };
  });
  const statements = schedules.map((schedule) =>
    env.DB.prepare(
      `INSERT INTO practice_schedules (
         schedule_id, practice_date, start_time, end_time, title,
         location, note, created_by_member_id, created_by_admin_identity,
         registration_batch_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      schedule.scheduleId,
      schedule.practiceDate,
      schedule.startTime,
      schedule.endTime,
      schedule.title,
      schedule.location,
      schedule.note,
      creatorMemberId,
      creatorAdminIdentity,
      registrationBatchId,
    ));
  statements.push(
    env.DB.prepare(
      `INSERT INTO practice_schedule_notification_queue (
         idempotency_key, schedule_id, notification_type
       ) VALUES (?, ?, 'announcement')`,
    ).bind(`practice-schedule-batch:${registrationBatchId}:announcement`, schedules[0].scheduleId),
  );
  await env.DB.batch(statements);
  return { scheduleIds: schedules.map((schedule) => schedule.scheduleId) };
}

export async function updatePracticeSchedule(
  env: PracticeEnv,
  scheduleId: string,
  input: Record<string, unknown>,
): Promise<void> {
  if (!SCHEDULE_ID.test(scheduleId)) throw new PracticeError("練習日程を確認できませんでした。", 404);
  const startTime = time(input.startTime, "開始時刻");
  const endTime = time(input.endTime, "終了時刻");
  if (startTime && endTime && endTime <= startTime) {
    throw new PracticeError("終了時刻は開始時刻より後にしてください。");
  }
  const result = await env.DB.prepare(
    `UPDATE practice_schedules
     SET practice_date = ?, start_time = ?, end_time = ?, title = ?,
         location = ?, note = ?,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE schedule_id = ? AND status = 'scheduled'`,
  ).bind(
    date(input.practiceDate),
    startTime,
    endTime,
    text(input.title ?? "通常練習", "練習名", 100, true),
    text(input.location, "会場", 100),
    text(input.note, "連絡事項", 500),
    scheduleId,
  ).run();
  if (Number(result.meta?.changes ?? 0) !== 1) {
    throw new PracticeError("終了済み、または存在しない練習日程は編集できません。", 409);
  }
  await completeExpiredPracticeSchedules(env);
}

export async function upsertPracticeScheduleChannel(
  db: D1Database,
  guildId: string,
  channelId: string,
): Promise<void> {
  await db.prepare(
    `INSERT INTO practice_discord_settings (guild_id, channel_id, schedule_channel_id)
     VALUES (?, ?, ?)
     ON CONFLICT(guild_id) DO UPDATE SET
       schedule_channel_id = excluded.schedule_channel_id,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
  ).bind(guildId, channelId, channelId).run();
}

export async function savePracticeScheduleResponse(
  env: PracticeEnv,
  discordUserId: string,
  scheduleId: string,
  response: PracticeScheduleResponse,
): Promise<string> {
  if (!SCHEDULE_ID.test(scheduleId)) throw new PracticeError("練習日程を確認できませんでした。", 404);
  const member = await env.DB.prepare(
    `SELECT member_id FROM members
     WHERE discord_user_id = ? AND status = 'active'`,
  ).bind(discordUserId).first<{ member_id: string }>();
  if (!member) throw new PracticeError("メンバー登録済みのDiscordアカウントから回答してください。", 403);
  return savePracticeScheduleMemberResponse(env, member.member_id, scheduleId, response, "discord");
}

export async function savePracticeScheduleMemberResponse(
  env: PracticeEnv,
  memberId: string,
  scheduleId: string,
  response: unknown,
  source: "discord" | "web" = "web",
): Promise<string> {
  if (!SCHEDULE_ID.test(scheduleId)) throw new PracticeError("練習日程を確認できませんでした。", 404);
  const schedule = await env.DB.prepare(
    `SELECT schedule_id FROM practice_schedules
     WHERE schedule_id = ? AND status = 'scheduled'`,
  ).bind(scheduleId).first<{ schedule_id: string }>();
  if (!schedule) throw new PracticeError("回答できる練習日程ではありません。", 409);
  if (!RESPONSE_VALUES.has(response as PracticeScheduleResponse)) {
    throw new PracticeError("参加・未定・不参加のいずれかを選択してください。");
  }
  const normalized = response as PracticeScheduleResponse;
  await env.DB.prepare(
    `INSERT INTO practice_schedule_responses (schedule_id, member_id, response, source)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(schedule_id, member_id) DO UPDATE SET
       response = excluded.response, source = excluded.source,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
  ).bind(scheduleId, memberId, normalized, source).run();
  return `${RESPONSE_LABELS[normalized]}で回答しました。`;
}

async function loadSchedulePayloadData(env: PracticeEnv, scheduleId: string) {
  const [schedule, responses] = await Promise.all([
    env.DB.prepare(
      `SELECT schedule_id, practice_date, start_time, end_time, title, location,
              note, status, created_by_member_id, created_by_admin_identity,
              registration_batch_id, announcement_message_id
       FROM practice_schedules WHERE schedule_id = ?`,
    ).bind(scheduleId).first<ScheduleRow>(),
    env.DB.prepare(
      `SELECT members.member_id, members.display_name,
              practice_schedule_responses.response
       FROM members
       LEFT JOIN practice_schedule_responses
         ON practice_schedule_responses.member_id = members.member_id
        AND practice_schedule_responses.schedule_id = ?
       WHERE members.status = 'active'
       ORDER BY members.display_name_kana, members.display_name`,
    ).bind(scheduleId).all<MemberResponseRow>(),
  ]);
  if (!schedule) throw new Error("練習日程が見つかりません。");
  return { schedule, responses: responses.results };
}

export async function loadPracticeScheduleReminder(
  env: PracticeEnv,
  scheduleId: string,
): Promise<DiscordMessagePayload> {
  const data = await loadSchedulePayloadData(env, scheduleId);
  return buildPracticeScheduleReminder(data);
}

export async function loadAnnouncementSchedules(
  env: PracticeEnv,
  schedule: ScheduleRow,
): Promise<ScheduleRow[]> {
  let addedSchedules = [schedule];
  if (schedule.registration_batch_id) {
    const batch = await env.DB.prepare(
      `SELECT schedule_id, practice_date, start_time, end_time, title, location,
              note, status, created_by_member_id, created_by_admin_identity,
              registration_batch_id, announcement_message_id
       FROM practice_schedules
       WHERE registration_batch_id = ? AND status = 'scheduled'
       ORDER BY practice_date, COALESCE(start_time, '99:99'), created_at`,
    ).bind(schedule.registration_batch_id).all<ScheduleRow>();
    if (batch.results.length) addedSchedules = batch.results;
  }

  const months = [...new Set(addedSchedules.map((item) => item.practice_date.slice(0, 7)))];
  const placeholders = months.map(() => "?").join(", ");
  const current = await env.DB.prepare(
    `SELECT schedule_id, practice_date, start_time, end_time, title, location,
            note, status, created_by_member_id, created_by_admin_identity,
            registration_batch_id, announcement_message_id
     FROM practice_schedules
     WHERE status = 'scheduled'
       AND substr(practice_date, 1, 7) IN (${placeholders})
     ORDER BY practice_date, COALESCE(start_time, '99:99'), created_at`,
  ).bind(...months).all<ScheduleRow>();
  return current.results.length ? current.results : addedSchedules;
}

export async function enqueuePracticeScheduleReminders(
  env: PracticeEnv,
  now = new Date(),
): Promise<void> {
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1_000);
  if (jst.toISOString().slice(11, 16) < "20:00") return;
  const tomorrow = new Date(jst.getTime() + 86_400_000).toISOString().slice(0, 10);
  await env.DB.prepare(
    `INSERT OR IGNORE INTO practice_schedule_notification_queue (
       idempotency_key, schedule_id, notification_type
     )
     SELECT 'practice-schedule:' || schedule_id || ':reminder',
            schedule_id, 'reminder'
     FROM practice_schedules
     WHERE practice_date = ? AND status = 'scheduled'`,
  ).bind(tomorrow).run();
}

export async function processPracticeScheduleNotifications(
  env: PracticeScheduleNotificationEnv,
  fetcher: typeof fetch = fetch,
  now = new Date(),
): Promise<number> {
  await completeExpiredPracticeSchedules(env, now);
  await enqueuePracticeScheduleReminders(env, now);
  if (!env.DISCORD_BOT_TOKEN) return 0;
  const deliveries = await env.DB.prepare(
    `SELECT practice_schedule_notification_queue.delivery_id,
            practice_schedule_notification_queue.schedule_id,
            practice_schedule_notification_queue.notification_type,
            practice_schedule_notification_queue.attempts,
            practice_discord_settings.schedule_channel_id
     FROM practice_schedule_notification_queue
     CROSS JOIN practice_discord_settings
     WHERE practice_discord_settings.schedule_channel_id IS NOT NULL
       AND practice_schedule_notification_queue.status IN ('pending', 'failed')
       AND practice_schedule_notification_queue.next_attempt_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       AND practice_schedule_notification_queue.attempts < 5
     ORDER BY practice_schedule_notification_queue.created_at
     LIMIT 10`,
  ).all<{
    delivery_id: number;
    schedule_id: string;
    notification_type: "announcement" | "reminder";
    attempts: number;
    schedule_channel_id: string;
  }>();
  let sent = 0;
  for (const delivery of deliveries.results) {
    try {
      const data = await loadSchedulePayloadData(env, delivery.schedule_id);
      if (data.schedule.status !== "scheduled") {
        await env.DB.prepare(
          `UPDATE practice_schedule_notification_queue SET status = 'skipped'
           WHERE delivery_id = ?`,
        ).bind(delivery.delivery_id).run();
        continue;
      }
      let message;
      if (delivery.notification_type === "reminder") {
        message = await sendChannelMessage(
          env.DISCORD_BOT_TOKEN,
          delivery.schedule_channel_id,
          buildPracticeScheduleReminder(data),
          fetcher,
        );
      } else {
        const schedules = await loadAnnouncementSchedules(env, data.schedule);
        const calendar = await generatePracticeScheduleCalendarPng(schedules);
        const calendarData = calendar.slice().buffer as ArrayBuffer;
        message = await sendChannelMessageWithFiles(
          env.DISCORD_BOT_TOKEN,
          delivery.schedule_channel_id,
          buildPracticeScheduleBatchAnnouncement({
            schedules,
            portalUrl: env.MEMBER_PORTAL_URL,
          }),
          [{
            data: calendarData,
            filename: "practice-schedule-calendar.png",
            contentType: "image/png",
            description: "練習日程カレンダー",
          }],
          fetcher,
        );
      }
      const updates = [env.DB.prepare(
        `UPDATE practice_schedule_notification_queue
         SET status = 'sent', attempts = attempts + 1, discord_message_id = ?,
             error_message = NULL, sent_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE delivery_id = ?`,
      ).bind(message.id, delivery.delivery_id)];
      if (delivery.notification_type === "announcement") {
        updates.push(env.DB.prepare(
          `UPDATE practice_schedules
           SET announcement_message_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE schedule_id = ?`,
        ).bind(message.id, delivery.schedule_id));
      }
      await env.DB.batch(updates);
      sent += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 500) : "送信に失敗しました。";
      const delayMinutes = Math.min(2 ** delivery.attempts, 30);
      await env.DB.prepare(
        `UPDATE practice_schedule_notification_queue
         SET status = 'failed', attempts = attempts + 1, error_message = ?,
             next_attempt_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?)
         WHERE delivery_id = ?`,
      ).bind(message, `+${delayMinutes} minutes`, delivery.delivery_id).run();
    }
  }
  return sent;
}
