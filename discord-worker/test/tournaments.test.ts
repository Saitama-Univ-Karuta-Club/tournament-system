import { describe, expect, it } from "vitest";
import {
  buildAttendanceMessage,
  buildNotificationTargets,
  getRetryDelayMinutes,
  normalizeTournamentInput,
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
});
