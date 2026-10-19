import { describe, expect, it } from "vitest";
import { defaultPaymentDeadline } from "../src/admin";
import {
  buildConfirmationRosterMessage,
  buildPaymentReminderDmMessage,
} from "../src/post-deadline";

describe("post-deadline workflow", () => {
  it("asks entrants to contact the manager only when the confirmation roster is wrong", () => {
    const message = buildConfirmationRosterMessage(
      "埼玉大会",
      "https://example.com/confirmation.pdf",
      "申込確認名簿.pdf",
    );

    expect(message.content).toContain("申込確認名簿");
    expect(message.embeds?.[0]?.description).toContain("誤りがある場合のみ");
    expect(message.embeds?.[0]?.description).toContain("大会担当者へDM");
    expect(message.components).toBeUndefined();
  });

  it("includes the fee and deadline without exposing organizer bank details", () => {
    const message = buildPaymentReminderDmMessage(
      "埼玉大会",
      2000,
      "2026-11-05T14:59:00.000Z",
    );

    const fields = message.embeds?.[0]?.fields ?? [];
    expect(message.content).toContain("未納");
    expect(fields.some((field) => field.name.includes("期限"))).toBe(true);
    expect(fields.some((field) => field.value.includes("2,000円"))).toBe(true);
    expect(JSON.stringify(message)).toContain("大会担当者へ事前に支払い");
  });

  it("defaults to the closest weekday at least two days before the organizer deadline", () => {
    expect(defaultPaymentDeadline("2026-11-09T14:59:00.000Z"))
      .toBe("2026-11-06T14:59:00.000Z");
    expect(defaultPaymentDeadline("2026-11-11T14:59:00.000Z"))
      .toBe("2026-11-09T14:59:00.000Z");
  });
});
