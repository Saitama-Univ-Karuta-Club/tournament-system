import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PRACTICE_SCHEDULE_SETTINGS,
  getPracticeScheduleSettings,
  PracticeScheduleSettingError,
  savePracticeScheduleSettings,
} from "../src/practice/schedule-settings";

describe("practice schedule settings", () => {
  it("uses the club defaults when no setting has been saved", async () => {
    const first = vi.fn().mockResolvedValue(null);
    const db = { prepare: vi.fn(() => ({ first })) } as unknown as D1Database;
    await expect(getPracticeScheduleSettings(db)).resolves.toEqual(DEFAULT_PRACTICE_SCHEDULE_SETTINGS);
  });

  it("saves custom periods and venue abbreviations and queues calendar refreshes", async () => {
    const statements: Array<{ sql: string; values: unknown[] }> = [];
    const db = {
      prepare(sql: string) {
        return {
          bind: (...values: unknown[]) => ({
            run: vi.fn(async () => {
              statements.push({ sql, values });
              return { success: true };
            }),
          }),
        };
      },
    } as unknown as D1Database;
    const input = {
      morningStartTime: "08:30",
      morningEndTime: "11:30",
      afternoonStartTime: "12:30",
      afternoonEndTime: "16:30",
      eveningStartTime: "17:30",
      eveningEndTime: "20:30",
      defaultTimeBand: "afternoon",
      defaultVenue: "中央市民会館",
      venues: [{ name: "中央市民会館", shortName: "中央会館" }],
    };
    const saved = await savePracticeScheduleSettings(db, input, "admin@example.com", "2026-11-10T00:00:00.000Z");
    expect(saved).toMatchObject({ ...input, customized: true });
    expect(statements[0].sql).toContain("INSERT INTO practice_schedule_settings");
    expect(statements[1].sql).toContain("practice_schedule_notification_queue");
  });

  it("rejects overlapping periods and abbreviations longer than seven characters", async () => {
    const db = { prepare: vi.fn() } as unknown as D1Database;
    const base = {
      morningStartTime: "09:00",
      morningEndTime: "12:00",
      afternoonStartTime: "13:00",
      afternoonEndTime: "17:00",
      eveningStartTime: "18:00",
      eveningEndTime: "21:30",
      defaultTimeBand: "evening",
      defaultVenue: "会場",
      venues: [{ name: "会場", shortName: "12345678" }],
    };
    await expect(savePracticeScheduleSettings(db, base, "admin@example.com"))
      .rejects.toBeInstanceOf(PracticeScheduleSettingError);
    await expect(savePracticeScheduleSettings(db, {
      ...base,
      morningEndTime: "14:00",
      venues: [{ name: "会場", shortName: "会場" }],
    }, "admin@example.com")).rejects.toThrow("時間が重ならないように設定してください");
  });
});
