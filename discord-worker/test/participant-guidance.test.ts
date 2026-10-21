import { describe, expect, it, vi } from "vitest";
import {
  buildParticipantGuidanceMessage,
  buildWaitlistResultMessage,
  enqueueParticipantGuidance,
  enqueueWaitlistPromotionGuidance,
  recordParticipantPaymentResponse,
} from "../src/participant-guidance";

describe("participant guidance", () => {
  it("キャンセル待ちの選手に待ち番号と確定名簿を案内する", () => {
    const message = buildWaitlistResultMessage(
      "埼玉大会",
      3,
      "https://example.com/roster.pdf",
      "確定名簿.pdf",
    );

    expect(message.content).toContain("キャンセル待ちとなりました");
    expect(JSON.stringify(message)).toContain("キャンセル待ち 3番");
    expect(JSON.stringify(message)).toContain("https://example.com/roster.pdf");
    expect(message.components).toBeUndefined();
  });

  it("builds a confirmed-player DM from text and an attachment", () => {
    const message = buildParticipantGuidanceMessage({
      tournamentId: "T-11111111-1111-4111-8111-111111111111",
      tournamentTitle: "埼玉大会",
      bodyText: "受付は8時30分です。",
      documentUrl: "https://example.com/guide.docx",
      fileName: "参加者向け案内.docx",
      paymentCollectionMethod: "advance_manager",
      participationFeeYen: 2000,
      paymentDeadline: "2026-11-05T14:59:00.000Z",
      paymentStatus: "unpaid",
    });

    expect(message.content).toContain("参加者向け案内");
    expect(message.embeds?.[0]?.title).toBe("埼玉大会");
    expect(message.embeds?.[0]?.description).toContain("8時30分");
    expect(message.embeds?.[0]?.fields?.[0]?.value).toContain("guide.docx");
    expect(message.embeds?.[0]?.fields?.some((field) => field.value === "2,000円")).toBe(true);
    expect(message.components?.[0]?.components.map((button) => button.custom_id)).toEqual([
      "payment:T-11111111-1111-4111-8111-111111111111:paid",
      "payment:T-11111111-1111-4111-8111-111111111111:unpaid",
    ]);
    expect(JSON.stringify(message)).not.toContain("指定口座");
  });

  it("supports an email-text-only guidance message", () => {
    const message = buildParticipantGuidanceMessage({
      tournamentId: "T-11111111-1111-4111-8111-111111111111",
      tournamentTitle: "埼玉大会",
      bodyText: "主催者からの連絡本文です。",
      documentUrl: null,
      fileName: null,
      paymentCollectionMethod: "onsite_cash",
      participationFeeYen: 1500,
      paymentDeadline: null,
    });

    expect(message.embeds?.[0]?.description).toBe("主催者からの連絡本文です。");
    expect(JSON.stringify(message)).toContain("大会当日に現金");
    expect(JSON.stringify(message)).not.toContain("支払期限");
    expect(message.components).toBeUndefined();
  });

  it("builds a promoted-player DM with payment buttons before the deadline", () => {
    const message = buildParticipantGuidanceMessage({
      tournamentId: "T-11111111-1111-4111-8111-111111111111",
      tournamentTitle: "埼玉大会",
      bodyText: "当日の案内です。",
      documentUrl: null,
      fileName: null,
      paymentCollectionMethod: "advance_manager",
      participationFeeYen: 2000,
      paymentDeadline: "2026-10-20T14:59:00.000Z",
      paymentStatus: "unpaid",
    }, { waitlistPromotion: true });

    expect(message.content).toContain("キャンセル待ちから繰り上がり、出場が確定しました。");
    expect(message.content).toContain("「支払い完了」ボタンを押してください。");
    expect(message.components?.[0]?.components.map((button) => button.custom_id)).toEqual([
      "payment-promotion:T-11111111-1111-4111-8111-111111111111:paid",
      "payment-promotion:T-11111111-1111-4111-8111-111111111111:unpaid",
    ]);
  });

  it("replaces payment buttons with a manager consultation note after the deadline", () => {
    const message = buildParticipantGuidanceMessage({
      tournamentId: "T-11111111-1111-4111-8111-111111111111",
      tournamentTitle: "埼玉大会",
      bodyText: "当日の案内です。",
      documentUrl: null,
      fileName: null,
      paymentCollectionMethod: "advance_manager",
      participationFeeYen: 2000,
      paymentDeadline: "2026-10-20T14:59:00.000Z",
      paymentStatus: "unpaid",
    }, { waitlistPromotion: true, afterPaymentDeadline: true });

    expect(message.content).toContain("キャンセル待ちから繰り上がり、出場が確定しました。");
    expect(message.content).toContain("サークル内支払期限を過ぎているため、支払いに関しては大会担当者に相談してください。");
    expect(message.components).toBeUndefined();
  });

  it.each([
    {
      name: "before the payment deadline",
      promotedAt: "2026-10-20T14:58:00.000Z",
      expectedKeyPrefix: "waitlist_promotion:",
      afterPaymentDeadline: false,
    },
    {
      name: "after the payment deadline",
      promotedAt: "2026-10-20T15:00:00.000Z",
      expectedKeyPrefix: "waitlist_promotion_late:",
      afterPaymentDeadline: true,
    },
  ])("queues a $name waitlist-promotion DM", async ({
    promotedAt,
    expectedKeyPrefix,
    afterPaymentDeadline,
  }) => {
    const run = vi.fn().mockResolvedValue({ meta: { changes: 1 } });
    const prepare = vi.fn((sql: string) => ({
      bind: vi.fn((...values: unknown[]) => ({
        first: vi.fn().mockResolvedValue({
          group_key: "TG-11111111-1111-4111-8111-111111111111",
          revision: 3,
          payment_collection_method: "advance_manager",
          payment_deadline: "2026-10-20T14:59:00.000Z",
          discord_user_id: "discord-user-1",
          member_status: "active",
          dm_enabled: 1,
        }),
        run,
        sql,
        values,
      })),
    }));

    const result = await enqueueWaitlistPromotionGuidance(
      { DB: { prepare } as unknown as D1Database },
      "T-11111111-1111-4111-8111-111111111111",
      "M-11111111-1111-4111-8111-111111111111",
      new Date(promotedAt),
    );

    expect(result).toEqual({ queued: 1, unavailable: 0, afterPaymentDeadline });
    const insertCall = prepare.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO participant_guidance_deliveries")
    );
    expect(insertCall).toBeTruthy();
    const insertBinding = prepare.mock.results[1].value.bind.mock.calls[0];
    expect(String(insertBinding[0])).toMatch(new RegExp(`^${expectedKeyPrefix}`));
  });

  it("queues DMs only for confirmed members who can receive them", async () => {
    const prepare = vi.fn((sql: string) => ({
      bind: vi.fn(() => ({
        first: vi.fn().mockResolvedValue({ revision: 2 }),
        all: vi.fn().mockResolvedValue({
          results: [
            { tournament_id: "T-1", member_id: "M-1", discord_user_id: "discord-1", status: "active", dm_enabled: 1 },
            { tournament_id: "T-2", member_id: "M-2", discord_user_id: "discord-2", status: "active", dm_enabled: 0 },
          ],
        }),
        sql,
      })),
    }));
    const batch = vi.fn().mockResolvedValue([{ meta: { changes: 1 } }]);

    const result = await enqueueParticipantGuidance(
      { DB: { prepare, batch } as unknown as D1Database },
      "TG-11111111-1111-4111-8111-111111111111",
      ["T-11111111-1111-4111-8111-111111111111"],
    );

    expect(result).toEqual({ queued: 1, unavailable: 1, revision: 2 });
    expect(batch).toHaveBeenCalledOnce();
    expect(prepare.mock.calls.some(([sql]) =>
      String(sql).includes("WHERE NOT EXISTS") &&
      String(sql).includes("participant_guidance_deliveries")
    )).toBe(true);
  });

  it("records a participant payment in the shared admin data", async () => {
    const writes: Array<{ sql: string; values: unknown[] }> = [];
    const prepare = vi.fn((sql: string) => ({
      bind: vi.fn((...values: unknown[]) => ({
        first: vi.fn().mockResolvedValue({
          member_id: "M-11111111-1111-4111-8111-111111111111",
          title: "埼玉大会",
          body_text: "当日の案内です。",
          document_url: null,
          file_name: null,
          payment_collection_method: "advance_manager",
          participation_fee_yen: 2000,
          payment_deadline: "2026-11-05T14:59:00.000Z",
          payment_status: "unpaid",
        }),
        sql,
        values,
      })),
    }));
    const batch = vi.fn(async (items: Array<{ sql: string; values: unknown[] }>) => {
      writes.push(...items);
      return items.map(() => ({ success: true }));
    });

    const message = await recordParticipantPaymentResponse(
      { DB: { prepare, batch } as unknown as D1Database },
      {
        tournamentId: "T-11111111-1111-4111-8111-111111111111",
        discordUserId: "discord-user-1",
        status: "paid",
      },
    );

    expect(batch).toHaveBeenCalledOnce();
    expect(writes.some((item) => item.sql.includes("INSERT INTO tournament_entry_payments"))).toBe(true);
    expect(writes.some((item) => item.sql.includes("tournament_entry_payment_history"))).toBe(true);
    expect(JSON.stringify(message)).toContain("支払い済み");
    expect(JSON.stringify(message)).toContain("操作を取り消す");
  });

  it("reverts a participant payment to unpaid", async () => {
    const writes: Array<{ sql: string; values: unknown[] }> = [];
    const prepare = vi.fn((sql: string) => ({
      bind: vi.fn((...values: unknown[]) => ({
        first: vi.fn().mockResolvedValue({
          member_id: "M-11111111-1111-4111-8111-111111111111",
          title: "埼玉大会",
          body_text: "当日の案内です。",
          document_url: null,
          file_name: null,
          payment_collection_method: "advance_manager",
          participation_fee_yen: 2000,
          payment_deadline: "2026-11-05T14:59:00.000Z",
          payment_status: "paid",
        }),
        sql,
        values,
      })),
    }));
    const batch = vi.fn(async (items: Array<{ sql: string; values: unknown[] }>) => {
      writes.push(...items);
      return items.map(() => ({ success: true }));
    });

    const message = await recordParticipantPaymentResponse(
      { DB: { prepare, batch } as unknown as D1Database },
      {
        tournamentId: "T-11111111-1111-4111-8111-111111111111",
        discordUserId: "discord-user-1",
        status: "unpaid",
      },
    );

    const paymentWrite = writes.find((item) =>
      item.sql.includes("INSERT INTO tournament_entry_payments")
    );
    expect(paymentWrite?.values.slice(0, 4)).toEqual([
      "T-11111111-1111-4111-8111-111111111111",
      "M-11111111-1111-4111-8111-111111111111",
      "unpaid",
      null,
    ]);
    expect(JSON.stringify(message)).toContain("未払い");
  });
});
