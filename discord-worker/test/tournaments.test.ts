import { describe, expect, it, vi } from "vitest";
import {
  buildAnnouncementMessage,
  buildApplicationEmailTemplate,
  buildApplicationCompletedMessage,
  buildEntryResultsAnnouncementMessage,
  buildAttendanceEditingMessage,
  buildAttendanceMessage,
  buildDeadlineReminderMessage,
  buildDeadlineReminderTargets,
  buildNotificationTargets,
  buildResponseDeadlineChannelReminderMessage,
  buildResponseDeadlineDmReminderMessage,
  buildResponseDeadlineReminderTargets,
  advanceTournamentWorkflowStages,
  closeExpiredTournamentsWithoutParticipants,
  createTournaments,
  enqueueTournamentUpdateNotifications,
  getDeadlineReminderSchedule,
  getResponseDeadlineReminderSchedule,
  getRetryDelayMinutes,
  normalizeTournamentGrades,
  normalizeTournamentInput,
  processNotificationQueue,
  recordAttendanceResponse,
} from "../src/tournaments";

const tournament = {
  tournament_id: "T-test",
  title: "DMテスト大会",
  event_start_date: "2026-11-01",
  event_end_date: "2026-11-01",
  grade: "C",
  internal_deadline: "2026-10-25T12:00:00.000Z",
  true_deadline: "2026-10-28T12:00:00.000Z",
};

describe("attendance DM", () => {
  it("contains three tournament-scoped response buttons", () => {
    const message = buildAttendanceMessage(tournament);
    const buttons = message.components?.[0]?.components ?? [];

    expect(buttons.map((button) => button.custom_id)).toEqual([
      "attendance:T-test:yes",
      "attendance:T-test:maybe",
      "attendance:T-test:no",
    ]);
  });

  it("shows the latest selected response", () => {
    const message = buildAttendanceMessage(tournament, "yes");
    const buttons = message.components?.[0]?.components ?? [];

    expect(message.content).toContain("現在の回答: **参加希望**");
    expect(buttons.map((button) => button.custom_id)).toEqual([
      "attendance:T-test:yes",
      "attendance-edit:T-test",
    ]);
    expect(buttons[0]?.label).toBe("✓ 参加希望");
    expect(buttons[0]?.style).toBe(3);
    expect(buttons[1]?.label).toBe("回答を変更");
  });

  it("shows all choices again when editing a response", () => {
    const message = buildAttendanceEditingMessage("T-test", {
      content: "現在の回答: **参加希望**",
      embeds: [{ title: "DMテスト大会" }],
    });

    expect(message.content).toBe("現在の回答: **参加希望**");
    expect(message.components?.[0]?.components.map((button) => button.custom_id)).toEqual([
      "attendance:T-test:yes",
      "attendance:T-test:maybe",
      "attendance:T-test:no",
    ]);
  });

  it("reactivates a previously invalidated response when an eligible member answers", async () => {
    const sqlStatements: string[] = [];
    const run = vi.fn().mockResolvedValue({ success: true });
    const prepare = vi.fn((sql: string) => {
      sqlStatements.push(sql);
      return {
        bind: vi.fn(() => ({
          first: vi.fn().mockResolvedValue({
            ...tournament,
            member_id: "M-test",
            internal_deadline: "2099-10-25T12:00:00.000Z",
          }),
          run,
        })),
      };
    });

    await recordAttendanceResponse(
      { DB: { prepare } as unknown as D1Database },
      {
        tournamentId: "T-test",
        discordUserId: "discord-test",
        response: "yes",
      },
    );

    const upsert = sqlStatements.find((sql) =>
      sql.includes("INSERT INTO responses"),
    );
    expect(upsert).toContain("is_valid = 1");
    expect(upsert).toContain("invalidated_at = NULL");
    expect(upsert).toContain("invalidated_reason = NULL");
    expect(sqlStatements[0]).toContain("tournaments.all_grades = 1");
    expect(run).toHaveBeenCalledOnce();
  });

  it("shows all grades for an unrestricted tournament", () => {
    const message = buildAttendanceMessage({ ...tournament, all_grades: 1 });

    expect(message.embeds?.[0]?.fields?.[0]?.value).toBe("すべて");
  });

  it("adds the member portal and PDF links to announcements and DMs", () => {
    const withDocument = {
      ...tournament,
      document_url: "https://bot.example.com/documents/test/guide.pdf",
    };
    const portalUrl = "https://portal.example.com";
    const messages = [
      buildAnnouncementMessage(withDocument, false, portalUrl),
      buildAttendanceMessage(withDocument, undefined, portalUrl),
    ];

    for (const message of messages) {
      const fields = message.embeds?.[0]?.fields ?? [];
      expect(fields).toContainEqual(expect.objectContaining({
        name: "Web版大会参加確認",
        value: "[大会一覧・回答画面を開く](https://portal.example.com/#answer)",
      }));
      expect(fields).toContainEqual(expect.objectContaining({
        name: "大会要項",
        value: "[PDFを開く](https://bot.example.com/documents/test/guide.pdf)",
      }));
    }
  });

  it("uses the approved new-tournament text and omits the removed venue", () => {
    const message = buildAnnouncementMessage({ ...tournament, venue: "浦和会館" });

    expect(message.content).toBe(
      "【新規大会追加のお知らせ】\n対象者のDMへ参加確認を送信しました。",
    );
    expect(message.embeds?.[0]?.fields?.some((field) => field.name === "会場"))
      .toBe(false);
  });

  it("同時登録した複数級を1通のお知らせにまとめる", () => {
    const message = buildAnnouncementMessage([
      { ...tournament, tournament_id: "T-c", registration_group_id: "TG-1", grade: "C" },
      { ...tournament, tournament_id: "T-d", registration_group_id: "TG-1", grade: "D" },
    ]);
    const fields = message.embeds?.[0]?.fields ?? [];

    expect(fields).toContainEqual(expect.objectContaining({
      name: "対象級",
      value: "C級・D級",
    }));
    expect(message.embeds).toHaveLength(1);
  });

  it("builds channel and unanswered-member deadline reminders", () => {
    const portalUrl = "https://portal.example.com";
    const channelMessage = buildResponseDeadlineChannelReminderMessage(
      tournament,
      portalUrl,
    );
    const dmMessage = buildResponseDeadlineDmReminderMessage(
      tournament,
      portalUrl,
    );

    expect(channelMessage.content).toBe(
      "サークル内締切の2日前です。未回答の方はお早めに回答お願いします。",
    );
    expect(channelMessage.components).toBeUndefined();
    expect(dmMessage.content).toBe(
      "【回答締切リマインダー】\nサークル内締切がもうすぐです。\nまだ回答が登録されていません。締切までに参加意思を選択してください。",
    );
    expect(dmMessage.components?.[0]?.components).toHaveLength(3);
    expect(dmMessage.embeds?.[0]?.fields).toContainEqual(
      expect.objectContaining({ name: "Web版大会参加確認" }),
    );
  });
});

describe("automatic tournament workflow transitions", () => {
  it("moves registration-open tournaments to application-pending after the internal deadline", async () => {
    const run = vi.fn().mockResolvedValue({ meta: { changes: 3 } });
    const bind = vi.fn(() => ({ run }));
    const prepare = vi.fn(() => ({ bind }));
    const now = new Date("2026-10-25T15:01:00.000Z");

    await expect(advanceTournamentWorkflowStages(
      { prepare } as unknown as D1Database,
      now,
    )).resolves.toBe(3);
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("workflow_stage = 'registration_open'"));
    expect(bind).toHaveBeenCalledWith(now.toISOString(), now.toISOString());
  });

  it("closes every due tournament returned by the zero-participant query", async () => {
    const statements: Array<{ sql: string; values: unknown[] }> = [];
    const prepare = vi.fn((sql: string) => ({
      bind: vi.fn((...values: unknown[]) => ({
        all: vi.fn().mockResolvedValue({
          results: [
            { tournament_id: "T-11111111-1111-4111-8111-111111111111" },
            { tournament_id: "T-22222222-2222-4222-8222-222222222222" },
          ],
        }),
        sql,
        values,
      })),
    }));
    const batch = vi.fn(async (items: Array<{ sql: string; values: unknown[] }>) => {
      statements.push(...items);
      return items.map(() => ({ success: true }));
    });

    const changed = await closeExpiredTournamentsWithoutParticipants(
      { prepare, batch } as unknown as D1Database,
      new Date("2026-10-26T00:00:00.000Z"),
    );

    expect(changed).toBe(2);
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("responses.response = 'yes'"));
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("tournaments.true_deadline <= ?"));
    expect(statements.filter((item) => item.sql.includes("UPDATE tournaments"))).toHaveLength(2);
    expect(statements.filter((item) => item.sql.includes("workflow_stage = 'no_participants'"))).toHaveLength(2);
    expect(statements.filter((item) => item.sql.includes("system:no-participants"))).toHaveLength(2);
  });

  it("does nothing when no due zero-participant tournament exists", async () => {
    const batch = vi.fn();
    const prepare = vi.fn(() => ({
      bind: vi.fn(() => ({ all: vi.fn().mockResolvedValue({ results: [] }) })),
    }));

    await expect(closeExpiredTournamentsWithoutParticipants(
      { prepare, batch } as unknown as D1Database,
    )).resolves.toBe(0);
    expect(batch).not.toHaveBeenCalled();
  });
});

describe("tournament input", () => {
  it("normalizes deadlines to UTC", () => {
    const input = normalizeTournamentInput({
      title: " 東会大会 ",
      grade: "C",
      tournamentType: "official",
      eventStartDate: "2026-11-01",
      eventEndDate: "2026-11-01",
      internalDeadline: "2026-10-25T23:59:00+09:00",
      trueDeadline: "2026-10-28T23:59:00+09:00",
    });

    expect(input.title).toBe("東会大会");
    expect(input.internalDeadline).toBe("2026-10-25T14:59:00.000Z");
  });

  it("rejects an internal deadline after the organizer deadline", () => {
    expect(() =>
      normalizeTournamentInput({
        title: "東会大会",
        grade: "C",
        tournamentType: "official",
        eventStartDate: "2026-11-01",
        eventEndDate: "2026-11-01",
        internalDeadline: "2026-10-29T23:59:00+09:00",
        trueDeadline: "2026-10-28T23:59:00+09:00",
      }),
    ).toThrow("サークル内締切は主催者締切以前");
  });

  it("accepts all grades but rejects mixing it with individual grades", () => {
    expect(normalizeTournamentGrades(["all"])).toEqual(["all"]);
    expect(normalizeTournamentGrades(["B", "C", "B"])).toEqual(["B", "C"]);
    expect(() => normalizeTournamentGrades(["all", "C"])).toThrow(
      "同時に選択できません",
    );
  });

  it("keeps one independent tournament ID per selected grade", async () => {
    const statements: unknown[] = [];
    const prepare = vi.fn(() => ({
      bind: vi.fn((...values: unknown[]) => ({ values })),
    }));
    const batch = vi.fn(async (items: unknown[]) => {
      statements.push(...items);
      return items.map(() => ({ success: true }));
    });
    const common = {
      title: "複数級大会",
      tournamentType: "official",
      eventStartDate: "2026-11-01",
      eventEndDate: "2026-11-01",
      internalDeadline: "2026-10-25T23:59:00+09:00",
      trueDeadline: "2026-10-28T23:59:00+09:00",
    };

    const created = await createTournaments(
      { DB: { prepare, batch } as unknown as D1Database },
      [
        { ...common, grade: "B" },
        { ...common, grade: "C" },
      ],
    );

    expect(created.map((item) => item.grade)).toEqual(["B", "C"]);
    expect(created[0].tournament_id).not.toBe(created[1].tournament_id);
    expect(created[0].registration_group_id).toMatch(/^TG-[0-9a-f-]{36}$/);
    expect(created[1].registration_group_id).toBe(created[0].registration_group_id);
    expect(created.every((item) => /^T-[0-9a-f-]{36}$/.test(item.tournament_id)))
      .toBe(true);
    expect(statements).toHaveLength(2);

    const [allGrades] = await createTournaments(
      { DB: { prepare, batch } as unknown as D1Database },
      [{ ...common, grade: "all" }],
    );
    expect(allGrades).toMatchObject({
      grade: "A",
      all_grades: 1,
      registration_group_id: null,
    });
    expect(statements).toHaveLength(3);
  });

  it("stores one shared application method for a multi-grade tournament", async () => {
    const statements: Array<{ sql: string; values: unknown[] }> = [];
    const prepare = vi.fn((sql: string) => ({
      bind: vi.fn((...values: unknown[]) => ({ sql, values })),
    }));
    const batch = vi.fn(async (items: Array<{ sql: string; values: unknown[] }>) => {
      statements.push(...items);
      return items.map(() => ({ success: true }));
    });
    const common = {
      title: "申込方法テスト大会",
      tournamentType: "official",
      eventStartDate: "2026-11-01",
      eventEndDate: "2026-11-01",
      internalDeadline: "2026-10-25T23:59:00+09:00",
      trueDeadline: "2026-10-28T23:59:00+09:00",
      applicationMethod: "excel_form" as const,
      applicationRosterUrl: "https://bot.example.com/documents/roster.xlsx",
      applicationRosterFileName: "申込方法テスト大会_B級・C級_申込名簿_埼玉大学かるた会.xlsx",
      applicationRosterFileSize: 1024,
      applicationRosterContentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      applicationFormUrl: "https://example.com/apply",
      createdByEmail: "admin@example.com",
    };

    const created = await createTournaments(
      { DB: { prepare, batch } as unknown as D1Database },
      [{ ...common, grade: "B" }, { ...common, grade: "C" }],
    );

    expect(statements).toHaveLength(3);
    const applicationStatement = statements.find((item) =>
      item.sql.includes("INSERT INTO tournament_application_methods")
    );
    expect(applicationStatement?.values).toEqual(expect.arrayContaining([
      created[0].registration_group_id,
      "excel_form",
      "https://example.com/apply",
    ]));
  });

  it("requires the Excel roster for an Excel-based application method", () => {
    expect(() => normalizeTournamentInput({
      title: "申込方法テスト大会",
      grade: "C",
      tournamentType: "official",
      eventStartDate: "2026-11-01",
      eventEndDate: "2026-11-01",
      internalDeadline: "2026-10-25T23:59:00+09:00",
      trueDeadline: "2026-10-28T23:59:00+09:00",
      applicationMethod: "excel_email",
    })).toThrow("申込名簿");
  });

  it("メール申込では有効な送信先アドレスを要求する", () => {
    const input = {
      title: "メール申込テスト大会",
      grade: "C",
      tournamentType: "official",
      eventStartDate: "2026-11-01",
      eventEndDate: "2026-11-01",
      internalDeadline: "2026-10-25T23:59:00+09:00",
      trueDeadline: "2026-10-28T23:59:00+09:00",
      applicationMethod: "excel_email" as const,
      applicationRosterUrl: "https://bot.example.com/documents/roster.xlsx",
      applicationRosterFileName: "roster.xlsx",
      applicationRosterFileSize: 1024,
      applicationRosterContentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    };

    expect(() => normalizeTournamentInput(input)).toThrow("申込先メールアドレス");
    expect(() => normalizeTournamentInput({
      ...input,
      applicationEmail: "not-an-email",
    })).toThrow("形式が不正");
    expect(normalizeTournamentInput({
      ...input,
      applicationEmail: "entry@example.com",
    }).applicationEmail).toBe("entry@example.com");
  });
});

describe("notification queue", () => {
  it("queues every eligible member without the former 10-member cap", () => {
    const members = Array.from({ length: 12 }, (_, index) => ({
      member_id: `M-${String(index).padStart(2, "0")}`,
      discord_user_id: `discord-${index}`,
    }));

    const targets = buildNotificationTargets(tournament, "channel-1", members);

    expect(targets).toHaveLength(13);
    expect(targets.filter((target) => target.notificationType === "invitation_dm"))
      .toHaveLength(12);
    expect(targets.at(-1)?.destinationId).toBe("discord-11");
  });

  it("backs off failed deliveries before the next retry", () => {
    expect([1, 2, 3, 4, 5].map(getRetryDelayMinutes)).toEqual([
      1, 5, 15, 60, 60,
    ]);
  });

  it("shows important tournament changes in a channel update", () => {
    const message = buildAnnouncementMessage(
      tournament,
      true,
      undefined,
      ["開催級: ABCD → ABC", "要項ファイルを差し替えました。"],
    );

    expect(message.content).toBe("【大会情報更新】\n重要な大会情報を変更しました。");
    expect(message.embeds?.[0]?.fields).toContainEqual({
      name: "変更内容",
      value: "・開催級: ABCD → ABC\n・要項ファイルを差し替えました。",
      inline: false,
    });
  });

  it("queues a tournament edit only for the announcement channel", async () => {
    const statements: Array<{ sql: string; values: unknown[] }> = [];
    const prepare = vi.fn((sql: string) => ({
      first: vi.fn().mockResolvedValue({ announcement_channel_id: "channel-1" }),
      bind: vi.fn((...values: unknown[]) => ({
        first: vi.fn().mockResolvedValue({ announcement_channel_id: "channel-1" }),
        sql,
        values,
      })),
    }));
    const batch = vi.fn(async (items: Array<{ sql: string; values: unknown[] }>) => {
      statements.push(...items);
      return items.map(() => ({ meta: { changes: 1 } }));
    });

    const queued = await enqueueTournamentUpdateNotifications(
      { DB: { prepare, batch } as unknown as D1Database },
      [{
        ...tournament,
        tournament_id: "T-11111111-1111-4111-8111-111111111111",
      }],
      "revision-1",
      ["開催日: 2026-11-01 → 2026-11-02"],
    );

    expect(queued).toBe(1);
    expect(statements).toHaveLength(1);
    expect(statements[0].values).toEqual(expect.arrayContaining([
      "announcement",
      "channel",
      "update",
      '["開催日: 2026-11-01 → 2026-11-02"]',
    ]));
    expect(statements[0].values).not.toContain("dm");
  });

  it("does not queue an update without an important change", async () => {
    const prepare = vi.fn();
    const queued = await enqueueTournamentUpdateNotifications(
      { DB: { prepare } as unknown as D1Database },
      [{
        ...tournament,
        tournament_id: "T-11111111-1111-4111-8111-111111111111",
      }],
      "revision-1",
      [],
    );

    expect(queued).toBe(0);
    expect(prepare).not.toHaveBeenCalled();
  });

  it("builds one application-completed message for multiple grades", () => {
    const message = buildApplicationCompletedMessage(
      [
        { ...tournament, tournament_id: "T-b", grade: "B" },
        { ...tournament, tournament_id: "T-c", grade: "C" },
      ],
      [
        { displayName: "石田洋音", displayNameKana: "いしだひろね", grade: "C" },
        { displayName: "山田花子", displayNameKana: "やまだはなこ", grade: "B" },
      ],
    );

    expect(message.content).toContain("申込完了");
    expect(message.embeds?.[0]?.fields?.[0]?.value).toBe("B級・C級");
    expect(message.embeds?.[0]?.fields?.[2]?.value).toContain("B級 山田花子");
    expect(message.embeds?.[0]?.fields?.[2]?.value).toContain("C級 石田洋音");
    expect(message.components).toBeUndefined();
  });

  it("shows each grade date when one grouped tournament spans multiple dates", () => {
    const message = buildApplicationCompletedMessage(
      [
        { ...tournament, tournament_id: "T-b", grade: "B", event_start_date: "2026-11-01" },
        { ...tournament, tournament_id: "T-c", grade: "C", event_start_date: "2026-11-08" },
      ],
      [],
    );

    expect(message.embeds?.[0]?.fields?.[1]?.value).toBe(
      "B級: 2026-11-01\nC級: 2026-11-08",
    );
  });

  it("builds an unsent entry-result announcement with confirmed and waitlisted members", () => {
    const message = buildEntryResultsAnnouncementMessage(
      "抽選テスト大会",
      [
        { displayName: "山田太郎", displayNameKana: "やまだたろう", grade: "C", entryStatus: "selected" },
        { displayName: "石田洋音", displayNameKana: "いしだひろね", grade: "C", entryStatus: "selected" },
        { displayName: "山口武", displayNameKana: "やまぐちたけし", grade: "C", entryStatus: "not_selected", waitlistNumber: 45 },
        { displayName: "吉村かなで", displayNameKana: "よしむらかなで", grade: "D", entryStatus: "not_selected", waitlistNumber: 12 },
      ],
      "https://example.com/roster.pdf",
    );

    expect(message.content).toContain("出場者・キャンセル待ち確定");
    expect(message.embeds?.[0]?.fields?.[0]?.value).toBe(
      "C級 石田洋音\n　　山田太郎",
    );
    expect(message.embeds?.[0]?.fields?.[1]?.value).toBe(
      "C級 45番 山口武\nD級 12番 吉村かなで",
    );
    expect(message.embeds?.[0]?.fields?.[2]?.value).toContain(
      "https://example.com/roster.pdf",
    );
  });

  it("requires a waitlist number before building the entry-result announcement", () => {
    expect(() => buildEntryResultsAnnouncementMessage(
      "抽選テスト大会",
      [{ displayName: "山口武", grade: "C", entryStatus: "not_selected" }],
      "https://example.com/roster.pdf",
    )).toThrow("待ち番号");
  });

  it("サークル内締切の1分後に集計リマインダーをキューに入れる", () => {
    const beforeSchedule = buildDeadlineReminderTargets(
      tournament,
      "admin-channel-1",
      1,
      new Date("2026-10-25T12:00:59.999Z"),
    );
    const targets = buildDeadlineReminderTargets(
      tournament,
      "admin-channel-1",
      1,
      new Date("2026-10-25T12:01:00.000Z"),
    );

    expect(beforeSchedule.some((target) =>
      target.reminderKind === "internal_deadline"
    )).toBe(false);
    expect(targets).toEqual([
      expect.objectContaining({
        notificationType: "deadline_reminder",
        reminderKind: "internal_deadline",
        destinationType: "channel",
        destinationId: "admin-channel-1",
      }),
    ]);
  });

  it("主催者締切日0の0時は参加希望者がいる場合のみキューに入れる", () => {
    const now = new Date("2026-10-27T15:00:00.000Z");
    const withParticipant = buildDeadlineReminderTargets(
      tournament,
      "admin-channel-1",
      1,
      now,
    );
    const withoutParticipant = buildDeadlineReminderTargets(
      tournament,
      "admin-channel-1",
      0,
      now,
    );

    expect(
      withParticipant.some(
        (target) => target.reminderKind === "organizer_deadline",
      ),
    ).toBe(true);
    expect(
      withoutParticipant.some(
        (target) => target.reminderKind === "organizer_deadline",
      ),
    ).toBe(false);
  });

  it("サークル内締切1分後と主催締切日0時の送信時刻を求める", () => {
    expect(
      getDeadlineReminderSchedule(tournament, "internal_deadline").toISOString(),
    ).toBe("2026-10-25T12:01:00.000Z");
    expect(
      getDeadlineReminderSchedule(tournament, "organizer_deadline").toISOString(),
    ).toBe("2026-10-27T15:00:00.000Z");
  });

  it("サークル内締切日の2日前0時にチャンネルと未回答者DMをキューに入れる", () => {
    const schedule = getResponseDeadlineReminderSchedule(tournament);
    expect(schedule.toISOString()).toBe("2026-10-22T15:00:00.000Z");
    expect(getResponseDeadlineReminderSchedule(tournament, 4).toISOString()).toBe(
      "2026-10-20T15:00:00.000Z",
    );
    expect(getResponseDeadlineReminderSchedule(tournament, 4, "00:00", "same").toISOString()).toBe(
      "2026-10-21T12:00:00.000Z",
    );
    const customSchedule = getResponseDeadlineReminderSchedule(tournament, 4, "12:30");
    expect(customSchedule.toISOString()).toBe(
      "2026-10-21T03:30:00.000Z",
    );
    expect(buildResponseDeadlineReminderTargets(
      tournament,
      "announcement-channel",
      [],
      new Date(customSchedule.getTime() - 1),
      4,
      "12:30",
    )).toEqual([]);
    expect(buildResponseDeadlineReminderTargets(
      tournament,
      "announcement-channel",
      [],
      customSchedule,
      4,
      "12:30",
    )).toHaveLength(1);

    const targets = buildResponseDeadlineReminderTargets(
      tournament,
      "announcement-channel",
      [
        { member_id: "M-1", discord_user_id: "D-1" },
        { member_id: "M-2", discord_user_id: "D-2" },
      ],
      schedule,
    );
    expect(targets).toEqual([
      expect.objectContaining({
        notificationType: "announcement",
        destinationId: "announcement-channel",
        deliveryContext: "response_reminder",
      }),
      expect.objectContaining({
        notificationType: "invitation_dm",
        memberId: "M-1",
        destinationId: "D-1",
        deliveryContext: "response_reminder",
      }),
      expect.objectContaining({
        notificationType: "invitation_dm",
        memberId: "M-2",
        destinationId: "D-2",
        deliveryContext: "response_reminder",
      }),
    ]);

    expect(buildResponseDeadlineReminderTargets(
      tournament,
      "announcement-channel",
      [],
      new Date(schedule.getTime() - 1),
    )).toEqual([]);
    expect(buildResponseDeadlineReminderTargets(
      tournament,
      "announcement-channel",
      [],
      new Date(tournament.internal_deadline),
    )).toEqual([]);
  });

  it("キュー登録後に回答したメンバーへはリマインダーDMを送らない", async () => {
    const skipped = vi.fn().mockResolvedValue({ meta: { changes: 1 } });
    const prepare = vi.fn((sql: string) => {
      if (
        sql.includes("FROM notification_deliveries") &&
        sql.includes("INNER JOIN tournaments")
      ) {
        return {
          bind: vi.fn(() => ({
            all: vi.fn().mockResolvedValue({
              results: [{
                ...tournament,
                internal_deadline: "2099-10-25T12:00:00.000Z",
                notification_id: 10,
                member_id: "M-answered",
                notification_type: "invitation_dm",
                destination_id: "D-answered",
                attempt_count: 0,
                tournament_status: "active",
                reminder_kind: null,
                delivery_context: "response_reminder",
                related_tournament_ids: null,
              }],
            }),
          })),
        };
      }
      if (sql.includes("SET lease_until = ?")) {
        return {
          bind: vi.fn(() => ({
            run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
          })),
        };
      }
      if (sql.includes("SELECT members.member_id")) {
        return {
          bind: vi.fn(() => ({ first: vi.fn().mockResolvedValue(null) })),
        };
      }
      if (sql.includes("SET status = 'skipped'")) {
        return { bind: vi.fn((reason: string) => ({ run: () => skipped(reason) })) };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const discordFetch = vi.spyOn(globalThis, "fetch");

    const processed = await processNotificationQueue({
      DB: { prepare } as unknown as D1Database,
      DISCORD_BOT_TOKEN: "bot-token",
    });

    expect(processed).toBe(1);
    expect(skipped).toHaveBeenCalledWith(
      expect.stringContaining("回答済み"),
    );
    expect(discordFetch).not.toHaveBeenCalled();
    discordFetch.mockRestore();
  });

  it("builds an administrator reminder without response buttons", () => {
    const message = buildDeadlineReminderMessage(
      tournament,
      "organizer_deadline",
      [
        {
          displayName: "石田洋音",
          displayNameKana: "いしだ ようおん",
          grade: "C",
        },
      ],
      false,
      "https://admin.example.com/tournaments",
    );

    expect(message.content).toContain("本日が主催者締切");
    expect(message.embeds?.[0]?.fields?.at(-1)?.value).toContain(
      "https://admin.example.com/tournaments",
    );
    expect(message.embeds?.[0]?.fields?.find((field) =>
      field.name.includes("参加希望者")
    )?.value).toContain(
      "石田洋音（いしだ ようおん）",
    );
    expect(message.components).toBeUndefined();
    expect(message.allowed_mentions).toEqual({ parse: [] });
  });

  it("サークル内締切後の通知に級別名簿・主催締切・申込方法と必要なリンクを表示する", () => {
    const message = buildDeadlineReminderMessage(
      {
        ...tournament,
        all_grades: 1,
        application_method: "excel_form",
        application_roster_url: "https://files.example.com/roster.xlsx",
        application_roster_file_name: "申込名簿_埼玉大学かるた会.xlsx",
        application_form_url: "https://forms.example.com/apply",
      },
      "internal_deadline",
      [
        { displayName: "石田洋音", displayNameKana: "いしだひろね", grade: "C" },
        { displayName: "髙田脩矢", displayNameKana: "たかだしゅうや", grade: "D" },
      ],
      false,
      "https://admin.example.com/tournaments",
    );

    const fields = message.embeds?.[0]?.fields ?? [];
    expect(message.content).toBe(
      "サークル内締切を過ぎました。参加希望者を確認し、申し込みを行なってください。",
    );
    expect(fields.find((field) => field.name === "主催締切日")?.value).toContain("2026");
    expect(fields.find((field) => field.name === "C級 参加希望者（1人）")?.value).toContain("石田洋音");
    expect(fields.find((field) => field.name === "D級 参加希望者（1人）")?.value).toContain("髙田脩矢");
    const method = fields.find((field) => field.name === "申込方法")?.value ?? "";
    expect(method).toContain("Excelファイルの名簿");
    expect(method).toContain("https://files.example.com/roster.xlsx");
    expect(method).toContain("https://forms.example.com/apply");
    expect(fields.find((field) => field.name === "大会管理画面")?.value).toContain(
      "https://admin.example.com/tournaments",
    );
    expect(message.components).toBeUndefined();
  });

  it("メール申込の担当者通知に宛先とメール作成リンクを表示する", () => {
    const message = buildDeadlineReminderMessage(
      {
        ...tournament,
        application_method: "excel_email",
        application_roster_url: "https://files.example.com/roster.xlsx",
        application_roster_file_name: "roster.xlsx",
        application_email: "entry@example.com",
      },
      "internal_deadline",
      [{ displayName: "石田洋音", displayNameKana: "いしだひろね", grade: "C" }],
    );

    const fields = message.embeds?.[0]?.fields ?? [];
    expect(fields.find((field) =>
      field.name === "申込先メールアドレス"
    )?.value).toBe("entry@example.com");
    const email = fields.find((field) =>
      field.name === "申込メール作成"
    )?.value ?? "";
    expect(email).toContain("https://files.example.com/application-email/T-test");
    expect(email).toContain("申込名簿はメーラーで添付");
  });

  it("参加希望者がいる級だけを人数付きで申込メールに入れる", () => {
    const template = buildApplicationEmailTemplate(
      {
        ...tournament,
        title: "関東地区大会",
        application_email: "entry@example.com",
      },
      [
        { displayName: "石田洋音", displayNameKana: "いしだひろね", grade: "C" },
        { displayName: "山田花子", displayNameKana: "やまだはなこ", grade: "C" },
        { displayName: "佐藤太郎", displayNameKana: "さとうたろう", grade: "E" },
      ],
    );

    expect(template.subject).toBe("関東地区大会 C級・E級 申し込み(埼玉大学かるた会)");
    expect(template.body).toContain("関東地区大会 担当者 様");
    expect(template.body).toContain("埼玉大学かるた会の石田洋音と申します。");
    expect(template.body).toContain("申し込みはC級2名、E級1名の計3名になります。");
    expect(template.body).not.toContain("A級");
    expect(template.body).not.toContain("B級");
    expect(template.body).not.toContain("D級");
    expect(template.body).toContain("E-mail: saitama.iroha@gmail.com");
    expect(decodeURIComponent(template.mailto)).toContain(template.body);
  });

  it("labels a test reminder without claiming the deadline is near", () => {
    const message = buildDeadlineReminderMessage(
      tournament,
      "internal_deadline",
      [],
      true,
    );

    expect(message.content).toContain("テスト送信");
    expect(message.content).not.toContain("24時間以内");
  });
});
