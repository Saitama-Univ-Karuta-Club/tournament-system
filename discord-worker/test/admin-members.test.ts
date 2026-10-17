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
      requested_grade: "B",
      submitted_at: "2026-10-18T00:00:00.000Z",
      current_display_name: "石田洋音",
      current_grade: "C",
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
    expect(batch.mock.calls[0][0]).toHaveLength(4);
    expect(
      sqlStatements.some(
        (sql) => sql.includes("UPDATE responses") && sql.includes("is_valid = 0"),
      ),
    ).toBe(true);
  });

  it("does not invalidate responses when an update keeps the same grade", async () => {
    const requestId = "MR-22222222-2222-4222-8222-222222222222";
    const { env, batch, sqlStatements } = decisionEnvironment({
      request_id: requestId,
      member_id: "M-22222222-2222-4222-8222-222222222222",
      discord_user_id: "discord-ishida",
      request_type: "update",
      requested_display_name: "石田 洋音",
      requested_grade: "C",
      submitted_at: "2026-10-18T00:00:00.000Z",
      current_display_name: "石田洋音",
      current_grade: "C",
      current_status: "active",
      current_dm_enabled: 1,
    });

    await decideMemberRegistration(
      env,
      requestId,
      "approved",
      "admin@example.com",
    );

    expect(batch.mock.calls[0][0]).toHaveLength(3);
    expect(sqlStatements.some((sql) => sql.includes("UPDATE responses"))).toBe(
      false,
    );
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
