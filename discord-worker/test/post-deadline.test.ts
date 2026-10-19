import { describe, expect, it } from "vitest";
import { defaultPaymentDeadline } from "../src/admin";
import {
  buildConfirmationRosterMessage,
  buildPaymentReminderChannelMessage,
  buildPaymentReminderDmMessage,
} from "../src/post-deadline";

describe("post-deadline workflow", () => {
  it("asks entrants to contact the manager only when the confirmation roster is wrong", () => {
    const message = buildConfirmationRosterMessage(
      "埼玉大会",
      "https://example.com/confirmation.pdf",
      "申込確認名簿.pdf",
    );

    expect(message.embeds?.[0]?.fields?.[0]?.name).toBe("申込確認名簿");
    expect(message.content).toContain("氏名・出場級を確認してください");
    expect(message.content).toContain("大会担当者までお知らせください");
    expect(message.components).toBeUndefined();
  });

  it("includes the fee and deadline without exposing organizer bank details", () => {
    const message = buildPaymentReminderDmMessage(
      "埼玉大会",
      2000,
      "2026-11-05T14:59:00.000Z",
      "T-11111111-1111-4111-8111-111111111111",
    );

    const fields = message.embeds?.[0]?.fields ?? [];
    expect(message.content).toContain("お早めにお支払いください");
    expect(fields.some((field) => field.name.includes("期限"))).toBe(true);
    expect(fields.some((field) => field.value.includes("2,000円"))).toBe(true);
    expect(JSON.stringify(message)).toContain("大会担当者へ事前に支払い");
    expect(JSON.stringify(message)).toContain("支払い完了");
    expect(JSON.stringify(message)).toContain("操作を取り消す");
  });

  it("lists paid and unpaid entrants with their fees for the manager", () => {
    const message = buildPaymentReminderChannelMessage(
      "埼玉大会",
      [
        { display_name: "石田洋音", grade: "C", participation_fee_yen: 2000, payment_status: "paid" },
        { display_name: "髙田脩矢", grade: "D", participation_fee_yen: 2500, payment_status: "unpaid" },
      ],
      "2026-11-05T14:59:00.000Z",
    );
    const fields = message.embeds?.[0]?.fields ?? [];

    expect(fields[0]).toMatchObject({
      name: "支払い済み（1人・2,000円）",
      value: "C級 石田洋音 2,000円",
    });
    expect(fields[1]).toMatchObject({
      name: "未納（1人・2,500円）",
      value: "D級 髙田脩矢 2,500円",
    });
  });

  it("defaults to the closest weekday at least two days before the organizer deadline", () => {
    expect(defaultPaymentDeadline("2026-11-09T14:59:00.000Z"))
      .toBe("2026-11-06T14:59:00.000Z");
    expect(defaultPaymentDeadline("2026-11-11T14:59:00.000Z"))
      .toBe("2026-11-09T14:59:00.000Z");
  });
});
