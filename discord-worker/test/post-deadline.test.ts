import { describe, expect, it } from "vitest";
import {
  defaultOrganizerPaymentDeadline,
  defaultPaymentDeadline,
} from "../src/admin";
import {
  buildConfirmationRosterMessage,
  buildOrganizerPaymentMessage,
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
    expect(message.components).toBeUndefined();
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

  it("defaults the manager payment date to two days before the organizer deadline", () => {
    const managerDeadline = defaultOrganizerPaymentDeadline("2026-11-09T14:59:00.000Z");
    expect(managerDeadline).toBe("2026-11-07T14:59:00.000Z");
    expect(defaultPaymentDeadline(managerDeadline)).toBe("2026-11-06T14:59:00.000Z");
  });

  it("builds manager-only bank-transfer information with totals and deadlines", () => {
    const message = buildOrganizerPaymentMessage(
      {
        title: "埼玉大会",
        trueDeadline: "2026-11-09T14:59:00.000Z",
        paymentCollectionMethod: "advance_manager",
        paymentDetails: "埼玉銀行 かるた支店 普通 1234567",
        organizerPaymentSource: "text",
        organizerPaymentDocumentUrl: null,
        organizerPaymentFileName: null,
        guidanceBodyText: null,
        guidanceDocumentUrl: null,
        guidanceFileName: null,
        organizerPaymentDeadline: "2026-11-07T14:59:00.000Z",
        paymentDeadline: "2026-11-06T14:59:00.000Z",
        organizerPaymentStatus: "unpaid",
      },
      [
        { display_name: "石田洋音", grade: "C", participation_fee_yen: 2000, payment_status: "paid" },
        { display_name: "山田花子", grade: "C", participation_fee_yen: 2000, payment_status: "unpaid" },
      ],
      "https://admin.example.com",
    );

    expect(message.content).toContain("担当者向け・参加費振込情報");
    expect(JSON.stringify(message)).toContain("4,000円");
    expect(JSON.stringify(message)).toContain("埼玉銀行");
    expect(JSON.stringify(message)).toContain("担当者の支払日");
    expect(JSON.stringify(message)).toContain("振込済み");
    expect(JSON.stringify(message)).toContain("https://admin.example.com/tournaments");
  });

  it("strongly highlights an unpaid organizer transfer on the organizer deadline day", () => {
    const message = buildOrganizerPaymentMessage(
      {
        title: "埼玉大会",
        trueDeadline: "2026-11-09T14:59:00.000Z",
        paymentCollectionMethod: "advance_manager",
        paymentDetails: "振込先",
        organizerPaymentSource: "text",
        organizerPaymentDocumentUrl: null,
        organizerPaymentFileName: null,
        guidanceBodyText: null,
        guidanceDocumentUrl: null,
        guidanceFileName: null,
        organizerPaymentDeadline: "2026-11-07T14:59:00.000Z",
        paymentDeadline: "2026-11-06T14:59:00.000Z",
        organizerPaymentStatus: "unpaid",
      },
      [],
      undefined,
      true,
    );

    expect(message.content).toContain("【至急・主催者への振込未完了】");
    expect(message.content).toContain("本日が主催締切日");
    expect(message.embeds?.[0]?.color).toBe(0xed4245);
  });

  it("当日支払いでも担当者チャンネル用の参加費情報を作る", () => {
    const message = buildOrganizerPaymentMessage(
      {
        title: "埼玉大会",
        trueDeadline: "2026-11-09T14:59:00.000Z",
        paymentCollectionMethod: "onsite_cash",
        paymentDetails: null,
        organizerPaymentSource: "text",
        organizerPaymentDocumentUrl: null,
        organizerPaymentFileName: null,
        guidanceBodyText: null,
        guidanceDocumentUrl: null,
        guidanceFileName: null,
        organizerPaymentDeadline: null,
        paymentDeadline: null,
        organizerPaymentStatus: "unpaid",
      },
      [
        { display_name: "石田洋音", grade: "C", participation_fee_yen: 2000, payment_status: "unpaid" },
      ],
    );

    expect(message.content).toContain("担当者向け・当日支払い情報");
    expect(JSON.stringify(message)).toContain("2,000円");
    expect(JSON.stringify(message)).toContain("集金・振込作業はありません");
    expect(JSON.stringify(message)).not.toContain("担当者の支払日");
  });
});
