import { describe, expect, it, vi } from "vitest";
import {
  buildMemberApprovalMessage,
  prepareMemberApprovalNotification,
} from "../src/member-notifications";

const approvedMember = {
  notification_type: "registration_approved" as const,
  display_name: "石田洋音",
  display_name_kana: "いしだ ようおん",
  grade: "C",
  rank: 2,
};

describe("member approval notifications", () => {
  it("builds a new-registration approval DM", () => {
    const message = buildMemberApprovalMessage(
      approvedMember,
      "https://portal.example.com",
    );

    expect(message.content).toContain("新規メンバー登録が承認されました");
    expect(message.embeds?.[0]?.title).toBe("登録された内容");
    expect(message.embeds?.[0]?.fields).toContainEqual(
      expect.objectContaining({ name: "出場級", value: "C級" }),
    );
    expect(message.embeds?.[0]?.fields).toContainEqual(
      expect.objectContaining({ name: "段位", value: "二段" }),
    );
    expect(message.embeds?.[0]?.fields).toContainEqual(
      expect.objectContaining({
        name: "Web版大会参加確認",
        value: "[大会一覧・回答画面を開く](https://portal.example.com/#answer)",
      }),
    );
  });

  it("builds a registration-update approval DM", () => {
    const message = buildMemberApprovalMessage({
      ...approvedMember,
      notification_type: "update_approved",
    });

    expect(message.content).toContain("登録内容の変更が承認されました");
    expect(message.embeds?.[0]?.title).toBe("更新後の登録内容");
  });

  it("queues the new and update patterns with separate notification types", () => {
    const bind = vi.fn(() => ({}) as D1PreparedStatement);
    const prepare = vi.fn(() => ({ bind }));
    const db = { prepare } as unknown as D1Database;
    const base = {
      requestId: "MR-11111111-1111-4111-8111-111111111111",
      memberId: "M-11111111-1111-4111-8111-111111111111",
      discordUserId: "discord-user",
      displayName: "石田洋音",
      displayNameKana: "いしだ ようおん",
      grade: "C",
      rank: 2,
    };

    prepareMemberApprovalNotification(db, { ...base, requestType: "new" });
    expect(bind.mock.calls[0]).toContain("registration_approved");

    prepareMemberApprovalNotification(db, { ...base, requestType: "update" });
    expect(bind.mock.calls[1]).toContain("update_approved");
  });
});
