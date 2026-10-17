import { describe, expect, it, vi } from "vitest";
import {
  buildAttendanceMessage,
  buildDeadlineReminderMessage,
  buildDeadlineReminderTargets,
  buildNotificationTargets,
  createTournaments,
  getDeadlineReminderSchedule,
  getRetryDelayMinutes,
  normalizeTournamentGrades,
  normalizeTournamentInput,
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

    expect(message.content).toContain("現在の回答: **参加希望**");
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
    expect(created.every((item) => /^T-[0-9a-f-]{36}$/.test(item.tournament_id)))
      .toBe(true);
    expect(statements).toHaveLength(2);

    const [allGrades] = await createTournaments(
      { DB: { prepare, batch } as unknown as D1Database },
      [{ ...common, grade: "all" }],
    );
    expect(allGrades).toMatchObject({ grade: "A", all_grades: 1 });
    expect(statements).toHaveLength(3);
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

  it("サークル内締切の翌日0時に集計リマインダーをキューに入れる", () => {
    const targets = buildDeadlineReminderTargets(
      tournament,
      "admin-channel-1",
      1,
      new Date("2026-10-25T15:00:00.000Z"),
    );

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

  it("JSTの日付境界から両方の送信時刻を求める", () => {
    expect(
      getDeadlineReminderSchedule(tournament, "internal_deadline").toISOString(),
    ).toBe("2026-10-25T15:00:00.000Z");
    expect(
      getDeadlineReminderSchedule(tournament, "organizer_deadline").toISOString(),
    ).toBe("2026-10-27T15:00:00.000Z");
  });

  it("builds an administrator reminder without response buttons", () => {
    const message = buildDeadlineReminderMessage(
      tournament,
      "organizer_deadline",
      [
        {
          displayName: "石田洋音",
          displayNameKana: "いしだ ようおん",
        },
      ],
    );

    expect(message.content).toContain("本日が主催者締切");
    expect(message.embeds?.[0]?.fields?.at(-1)?.value).toContain(
      "石田洋音（いしだ ようおん）",
    );
    expect(message.components).toBeUndefined();
    expect(message.allowed_mentions).toEqual({ parse: [] });
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
