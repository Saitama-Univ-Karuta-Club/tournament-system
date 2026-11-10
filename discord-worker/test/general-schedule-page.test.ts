import { describe, expect, it } from "vitest";
import {
  parseScheduleCalendarForm,
  renderScheduleCreatePage,
  renderScheduleErrorPage,
} from "../src/general/schedule-page";

describe("general schedule calendar page", () => {
  it("renders native calendar and optional time controls", () => {
    const page = renderScheduleCreatePage("token-1");
    expect(page).toContain('type="date"');
    expect(page).toContain('type="time"');
    expect(page).toContain('name="token" value="token-1"');
    expect(page).toContain("候補を追加");
  });

  it("formats selected dates with their correct Japanese weekday", () => {
    const form = new FormData();
    form.set("token", "token-1");
    form.set("title", "懇親会");
    form.set("description", "回答してください");
    form.append("candidate_date", "2026-11-07");
    form.append("candidate_time", "18:00");
    form.append("candidate_date", "2026-11-08");
    form.append("candidate_time", "");
    expect(parseScheduleCalendarForm(form)).toEqual({
      token: "token-1",
      title: "懇親会",
      description: "回答してください",
      candidates: ["2026年11月7日（土） 18:00", "2026年11月8日（日）"],
    });
  });

  it("rejects invalid and duplicate calendar values", () => {
    const invalid = new FormData();
    invalid.set("token", "token-1");
    invalid.set("title", "日程調整");
    invalid.append("candidate_date", "2026-02-30");
    invalid.append("candidate_date", "2026-11-08");
    expect(() => parseScheduleCalendarForm(invalid)).toThrow("存在しない日付");

    const duplicate = new FormData();
    duplicate.set("token", "token-1");
    duplicate.set("title", "日程調整");
    duplicate.append("candidate_date", "2026-11-08");
    duplicate.append("candidate_date", "2026-11-08");
    expect(() => parseScheduleCalendarForm(duplicate)).toThrow("重複");
  });

  it("escapes error text before rendering", () => {
    expect(renderScheduleErrorPage("<script>alert(1)</script>")).not.toContain("<script>alert(1)</script>");
  });
});
