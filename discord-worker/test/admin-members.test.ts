import { describe, expect, it, vi } from "vitest";
import {
  decideMemberRegistration,
  MemberAdminError,
} from "../src/admin-members";

function decisionEnvironment(requestRow: Record<string, unknown>) {
  const sqlStatements: string[] = [];
  const first = vi.fn().mockResolvedValue(requestRow);
  const run = vi.fn().mockResolvedValue({ success: true });
  const bind = vi.fn().mockReturnValue({ first, run });
  const prepare = vi.fn((sql: string) => {
    sqlStatements.push(sql);
    return { bind };
  });
  const batch = vi.fn().mockResolvedValue([]);
  return {
    env: { DB: { prepare, batch } as unknown as D1Database },
    batch,
    sqlStatements,
  };
}

describe("member registration decisions", () => {
  it("approves an existing member update while preserving the member ID", async () => {
    const requestId = "MR-11111111-1111-4111-8111-111111111111";
    const { env, batch, sqlStatements } = decisionEnvironment({
      request_id: requestId,
      member_id: "M-11111111-1111-4111-8111-111111111111",
      discord_user_id: "discord-ishida",
      request_type: "update",
      requested_display_name: "石田洋音",
      requested_display_name_kana: "いしだ ようおん",
      requested_grade: "B",
      requested_rank: 3,
      submitted_at: "2026-10-18T00:00:00.000Z",
      current_display_name: "石田洋音",
      current_display_name_kana: "いしだ ようおん",
      current_grade: "C",
      current_rank: 2,
      current_status: "active",
      current_dm_enabled: 1,
    });

    const result = await decideMemberRegistration(
      env,
      requestId,
      "approved",
      "admin@example.com",
    );

    expect(result).toEqual({
      requestId,
      decision: "approved",
      memberId: "M-11111111-1111-4111-8111-111111111111",
    });
    expect(batch).toHaveBeenCalledOnce();
    expect(batch.mock.calls[0][0]).toHaveLength(5);
    const invalidationSql = sqlStatements.find(
      (sql) => sql.includes("UPDATE responses") && sql.includes("is_valid = 0"),
    );
    expect(invalidationSql).toContain("tournaments.all_grades = 0");
    expect(sqlStatements.some((sql) =>
      sql.includes("INSERT INTO member_notification_deliveries")
    )).toBe(true);
  });

  it("does not invalidate responses when an update keeps the same grade", async () => {
    const requestId = "MR-22222222-2222-4222-8222-222222222222";
    const { env, batch, sqlStatements } = decisionEnvironment({
      request_id: requestId,
      member_id: "M-22222222-2222-4222-8222-222222222222",
      discord_user_id: "discord-ishida",
      request_type: "update",
      requested_display_name: "石田 洋音",
      requested_display_name_kana: "いしだ ようおん",
      requested_grade: "C",
      requested_rank: 2,
      submitted_at: "2026-10-18T00:00:00.000Z",
      current_display_name: "石田洋音",
      current_display_name_kana: "いしだ ようおん",
      current_grade: "C",
      current_rank: 2,
      current_status: "active",
      current_dm_enabled: 1,
    });

    await decideMemberRegistration(
      env,
      requestId,
      "approved",
      "admin@example.com",
    );

    expect(batch.mock.calls[0][0]).toHaveLength(4);
    expect(sqlStatements.some((sql) => sql.includes("UPDATE responses"))).toBe(
      false,
    );
  });

  it("queues a distinct approval DM for a new registration", async () => {
    const requestId = "MR-33333333-3333-4333-8333-333333333333";
    const { env, batch, sqlStatements } = decisionEnvironment({
      request_id: requestId,
      member_id: null,
      discord_user_id: "discord-new-member",
      request_type: "new",
      requested_display_name: "埼玉花子",
      requested_display_name_kana: "さいたま はなこ",
      requested_grade: "C",
      requested_rank: 1,
      submitted_at: "2026-10-18T00:00:00.000Z",
      current_display_name: null,
      current_display_name_kana: null,
      current_grade: null,
      current_rank: null,
      current_status: null,
      current_dm_enabled: null,
    });

    const result = await decideMemberRegistration(
      env,
      requestId,
      "approved",
      "admin@example.com",
    );

    expect(result.decision).toBe("approved");
    expect(result.memberId).toMatch(/^M-/);
    expect(batch.mock.calls[0][0]).toHaveLength(3);
    expect(sqlStatements.some((sql) =>
      sql.includes("INSERT INTO member_notification_deliveries")
    )).toBe(true);
  });

  it("rejects an unsupported decision before changing the database", async () => {
    const { env, batch } = decisionEnvironment({});

    await expect(
      decideMemberRegistration(
        env,
        "MR-11111111-1111-4111-8111-111111111111",
        "later",
        "admin@example.com",
      ),
    ).rejects.toBeInstanceOf(MemberAdminError);
    expect(batch).not.toHaveBeenCalled();
  });
});
