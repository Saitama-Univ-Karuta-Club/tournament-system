import { describe, expect, it, vi } from "vitest";
import {
  buildPracticeScheduleBatchAnnouncement,
  buildPracticeScheduleReminder,
  cancelPracticeSchedule,
  completeExpiredPracticeSchedules,
  createPracticeSchedules,
  enqueuePracticeScheduleReminders,
  loadAnnouncementSchedules,
  processPracticeScheduleNotifications,
  savePracticeScheduleMemberResponse,
  updatePracticeSchedule,
} from "../src/practice/schedules";
import { generatePracticeScheduleCalendarPng } from "../src/practice/calendar-image";

const schedule = {
  schedule_id: "PS-11111111-1111-4111-8111-111111111111",
  practice_date: "2026-10-30",
  start_time: "13:00",
  end_time: "17:00",
  title: "通常練習",
  location: "大学会館",
  note: "札を持参してください。",
  status: "scheduled" as const,
  created_by_member_id: "M-11111111-1111-4111-8111-111111111111",
  created_by_admin_identity: null,
  registration_batch_id: "PSB-11111111-1111-4111-8111-111111111111",
  announcement_message_id: null,
};

describe("practice schedule Discord messages", () => {
  it("summarizes a batch and links to the member portal without response buttons", () => {
    const secondSchedule = {
      ...schedule,
      schedule_id: "PS-22222222-2222-4222-8222-222222222222",
      practice_date: "2026-10-31",
      title: "休日練習",
    };
    const message = buildPracticeScheduleBatchAnnouncement({
      schedules: [schedule, secondSchedule],
      portalUrl: "https://portal.example.com/",
    });

    expect(message.embeds?.[0]?.description).toContain("2026-10-30");
    expect(message.content).toContain("2026年10月");
    expect(message.embeds?.[0]?.description).toContain("2026-10-31");
    expect(message.embeds?.[0]?.image?.url).toBe("attachment://practice-schedule-calendar.png");
    expect(message.components?.[0]?.components).toEqual([expect.objectContaining({
      style: 5,
      url: "https://portal.example.com/#practice-schedules",
    })]);
    expect(message.components?.[0]?.components.some((button) => Boolean(button.custom_id))).toBe(false);
  });

  it("generates a PNG calendar covering every registered month", async () => {
    const png = await generatePracticeScheduleCalendarPng([
      { practice_date: "2026-10-30", start_time: "18:00" },
      { practice_date: "2026-11-01", start_time: "13:00" },
    ]);

    expect([...png.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    expect(view.getUint32(16)).toBe(1600);
    expect(view.getUint32(20)).toBeGreaterThan(500);
    expect(png.byteLength).toBeLessThan(8_000_000);
  });

  it("groups the reminder by each member response", () => {
    const message = buildPracticeScheduleReminder({
      schedule,
      responses: [
        { member_id: "M-1", display_name: "参加者", response: "yes" },
        { member_id: "M-2", display_name: "未定者", response: "maybe" },
        { member_id: "M-3", display_name: "不参加者", response: "no" },
        { member_id: "M-4", display_name: "未回答者", response: null },
      ],
    });

    expect(message.embeds?.[0]?.fields).toEqual(expect.arrayContaining([
      { name: "参加", value: "参加者" },
      { name: "未定", value: "未定者" },
      { name: "不参加", value: "不参加者" },
      { name: "未回答", value: "未回答者" },
    ]));
    expect(message.components?.[0]?.components.map((button) => button.custom_id)).toEqual([
      `practice-schedule:${schedule.schedule_id}:yes`,
      `practice-schedule:${schedule.schedule_id}:maybe`,
      `practice-schedule:${schedule.schedule_id}:no`,
    ]);
  });
});

describe("practice schedule persistence", () => {
  it("loads every non-canceled schedule in the target month", async () => {
    const existing = [
      { ...schedule, practice_date: "2026-11-12" },
      { ...schedule, schedule_id: "PS-22222222-2222-4222-8222-222222222222", practice_date: "2026-11-13" },
      { ...schedule, schedule_id: "PS-33333333-3333-4333-8333-333333333333", practice_date: "2026-11-15" },
    ];
    const all = vi.fn().mockResolvedValue({ results: existing });
    const bind = vi.fn(() => ({ all }));
    const prepare = vi.fn(() => ({ bind }));

    await expect(loadAnnouncementSchedules(
      { DB: { prepare } as unknown as D1Database },
      "2026-11",
    )).resolves.toEqual(existing);

    expect(bind).toHaveBeenCalledWith("2026-11");
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("status <> 'canceled'"));
  });

  it("marks schedules completed after their JST end time", async () => {
    const run = vi.fn().mockResolvedValue({ meta: { changes: 2 } });
    const bind = vi.fn(() => ({ run }));
    const prepare = vi.fn(() => ({ bind }));

    await expect(completeExpiredPracticeSchedules(
      { DB: { prepare } as unknown as D1Database },
      new Date("2026-11-02T12:31:00Z"),
    )).resolves.toBe(2);

    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("SET status = 'completed'"));
    expect(bind).toHaveBeenCalledWith("2026-11-02", "2026-11-02", "21:31");
  });

  it("updates an upcoming schedule and rechecks its completion", async () => {
    const completionRun = vi.fn().mockResolvedValue({ meta: { changes: 0 } });
    const batched: Array<{ sql: string; values: unknown[] }> = [];
    const db = {
      prepare(sql: string) {
        return {
          bind: (...values: unknown[]) => {
            if (sql.includes("SELECT practice_date")) return { first: vi.fn().mockResolvedValue({ practice_date: "2026-10-30" }) };
            if (sql.includes("UPDATE practice_schedules") && sql.includes("practice_date < ?")) return { run: completionRun };
            return { sql, values };
          },
        };
      },
      async batch(statements: Array<{ sql: string; values: unknown[] }>) {
        batched.push(...statements);
        return statements.map((_, index) => ({ meta: { changes: index === 0 ? 1 : 0 } }));
      },
    };

    await updatePracticeSchedule(
      { DB: db as unknown as D1Database },
      schedule.schedule_id,
      {
        practiceDate: "2026-11-03",
        startTime: "18:00",
        endTime: "21:30",
        title: "変更後の練習",
        location: "大久保東公民館",
        note: "変更あり",
      },
    );

    expect(batched[0].sql).toContain("SET practice_date = ?");
    expect(batched.filter((item) => item.sql.includes("practice_schedule_notification_queue"))).toHaveLength(2);
    expect(batched.flatMap((item) => item.values)).toEqual(expect.arrayContaining(["2026-10", "2026-11"]));
    expect(completionRun).toHaveBeenCalledOnce();
  });

  it("inserts every schedule and one monthly announcement per affected month", async () => {
    type Statement = { sql: string; values: unknown[] };
    const batched: Statement[] = [];
    const db = {
      prepare(sql: string) {
        return { bind: (...values: unknown[]) => ({ sql, values }) };
      },
      async batch(statements: Statement[]) {
        batched.push(...statements);
        return statements.map(() => ({ success: true }));
      },
    };

    const created = await createPracticeSchedules(
      { DB: db as unknown as D1Database },
      { adminIdentity: "admin@example.com" },
      {
        schedules: [
          { practiceDate: "2026-10-30", startTime: "13:00", endTime: "17:00" },
          { practiceDate: "2026-11-01", title: "休日練習", location: "武道場" },
        ],
      },
    );

    expect(created.scheduleIds).toHaveLength(2);
    expect(batched).toHaveLength(4);
    expect(batched[0].sql).toContain("INSERT INTO practice_schedules");
    expect(batched[0].values).toContain("admin@example.com");
    expect(batched[1].sql).toContain("INSERT INTO practice_schedules");
    expect(batched[2].sql).toContain("practice_schedule_notification_queue");
    expect(batched[3].sql).toContain("practice_schedule_notification_queue");
    expect(batched[0].values.at(-1)).toBe(batched[1].values.at(-1));
    expect(batched[2].values[0]).toMatch(/^practice-schedule-month:2026-10:PSB-/);
    expect(batched[2].values.at(-1)).toBe("2026-10");
    expect(batched[3].values.at(-1)).toBe("2026-11");
  });

  it("cancels a schedule and queues its monthly calendar refresh", async () => {
    const batched: Array<{ sql: string; values: unknown[] }> = [];
    const db = {
      prepare(sql: string) {
        return { bind: (...values: unknown[]) => sql.includes("SELECT practice_date")
          ? { first: vi.fn().mockResolvedValue({ practice_date: "2026-11-15" }) }
          : { sql, values } };
      },
      async batch(statements: Array<{ sql: string; values: unknown[] }>) {
        batched.push(...statements);
        return [{ meta: { changes: 1 } }, { meta: { changes: 1 } }];
      },
    };

    await cancelPracticeSchedule({ DB: db as unknown as D1Database }, schedule.schedule_id);
    expect(batched[0].sql).toContain("status = 'canceled'");
    expect(batched[1].values.at(-1)).toBe("2026-11");
  });

  it("edits the existing Discord calendar message for the month", async () => {
    const novemberSchedule = { ...schedule, practice_date: "2026-11-15" };
    const deliveries = [{
      delivery_id: 7,
      schedule_id: novemberSchedule.schedule_id,
      notification_type: "announcement",
      target_month: "2026-11",
      attempts: 0,
      guild_id: "guild-1",
      schedule_channel_id: "channel-1",
    }];
    const batched: Array<{ sql: string; values: unknown[] }> = [];
    const db = {
      prepare(sql: string) {
        return {
          all: vi.fn().mockResolvedValue(sql.includes("CROSS JOIN practice_discord_settings")
            ? { results: deliveries }
            : { results: [] }),
          bind: (...values: unknown[]) => {
            if (sql.includes("practice_date < ?")) return { run: vi.fn().mockResolvedValue({ meta: { changes: 0 } }) };
            if (sql.includes("FROM practice_schedules WHERE schedule_id")) {
              return { first: vi.fn().mockResolvedValue(novemberSchedule) };
            }
            if (sql.includes("FROM members")) return { all: vi.fn().mockResolvedValue({ results: [] }) };
            if (sql.includes("status <> 'canceled'")) {
              return { all: vi.fn().mockResolvedValue({ results: [novemberSchedule] }) };
            }
            if (sql.includes("FROM practice_schedule_month_announcements")) {
              return { first: vi.fn().mockResolvedValue({
                guild_id: "guild-1",
                practice_month: "2026-11",
                channel_id: "channel-1",
                message_id: "monthly-message-1",
              }) };
            }
            if (sql.includes("INSERT INTO practice_schedule_month_announcements")) {
              return { run: vi.fn().mockResolvedValue({ success: true }) };
            }
            return { sql, values };
          },
        };
      },
      async batch(statements: Array<{ sql: string; values: unknown[] }>) {
        batched.push(...statements);
        return statements.map(() => ({ success: true }));
      },
    };
    const fetcher = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ id: "monthly-message-1", channel_id: "channel-1" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));

    await expect(processPracticeScheduleNotifications(
      {
        DB: db as unknown as D1Database,
        DISCORD_BOT_TOKEN: "token",
        MEMBER_PORTAL_URL: "https://portal.example.com",
      },
      fetcher as typeof fetch,
      new Date("2026-11-10T00:00:00Z"),
    )).resolves.toBe(1);

    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][0]).toContain("/channels/channel-1/messages/monthly-message-1");
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: "PATCH" });
    expect(batched[0].sql).toContain("status = 'sent'");
  });

  it("saves a portal response against the authenticated member", async () => {
    const run = vi.fn().mockResolvedValue({ success: true });
    const first = vi.fn().mockResolvedValue({ schedule_id: schedule.schedule_id });
    const binds: unknown[][] = [];
    const db = {
      prepare(sql: string) {
        return {
          bind: (...values: unknown[]) => {
            binds.push(values);
            return sql.includes("SELECT schedule_id") ? { first } : { run };
          },
        };
      },
    };

    await expect(savePracticeScheduleMemberResponse(
      { DB: db as unknown as D1Database },
      "M-11111111-1111-4111-8111-111111111111",
      schedule.schedule_id,
      "yes",
    )).resolves.toBe("参加で回答しました。");
    expect(binds[1]).toEqual([
      schedule.schedule_id,
      "M-11111111-1111-4111-8111-111111111111",
      "yes",
      "web",
    ]);
  });

  it("queues tomorrow's reminders only from 20:00 JST", async () => {
    const run = vi.fn().mockResolvedValue({ success: true });
    const bind = vi.fn(() => ({ run }));
    const prepare = vi.fn(() => ({ bind }));
    const env = { DB: { prepare } as unknown as D1Database };

    await enqueuePracticeScheduleReminders(env, new Date("2026-10-29T10:59:00Z"));
    expect(prepare).not.toHaveBeenCalled();

    await enqueuePracticeScheduleReminders(env, new Date("2026-10-29T11:00:00Z"));
    expect(bind).toHaveBeenCalledWith("2026-10-30");
    expect(run).toHaveBeenCalledOnce();
  });
});
