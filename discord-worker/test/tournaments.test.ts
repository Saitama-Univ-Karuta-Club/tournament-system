import { describe, expect, it } from "vitest";
import { buildAttendanceMessage } from "../src/tournaments";

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
