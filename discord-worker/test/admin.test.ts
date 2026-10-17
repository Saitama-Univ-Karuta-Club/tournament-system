import { describe, expect, it, vi } from "vitest";
import { handleAdminRequest, type AdminEnv } from "../src/admin";

const env = {
  DB: {} as D1Database,
} satisfies AdminEnv;

function authenticatedContext(waitUntil = vi.fn()) {
  return {
    access: {
      getIdentity: vi.fn().mockResolvedValue({ email: "admin@example.com" }),
    },
    waitUntil,
  } as unknown as Pick<ExecutionContext, "access" | "waitUntil">;
}

describe("Admin Worker", () => {
  it("rejects a request that did not pass Cloudflare Access", async () => {
    const response = await handleAdminRequest(
      new Request("https://admin.example.com/"),
      env,
      { waitUntil: vi.fn() },
    );

    expect(response.status).toBe(403);
  });

  it("serves the tournament form to an authenticated admin", async () => {
    const response = await handleAdminRequest(
      new Request("https://admin.example.com/"),
      env,
      authenticatedContext(),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Security-Policy")).toContain(
      "frame-ancestors 'none'",
    );
    const html = await response.text();
    expect(html).toContain("大会管理（Discord版MVP）");
    expect(html).toContain("大会一覧・回答集計");
    expect(html).toContain("メンバー管理");
    expect(html).toContain("登録済みメンバー全員");
    expect(html).not.toContain("最大10人");
  });

  it("uses 23:59 as the default deadline time", async () => {
    const response = await handleAdminRequest(
      new Request("https://admin.example.com/"),
      env,
      authenticatedContext(),
    );

    const html = await response.text();
    expect(html.match(/T23:59/g)).toHaveLength(2);
  });

  it("stores a valid tournament for the notification worker", async () => {
    const waitUntil = vi.fn();
    const creator = vi.fn().mockResolvedValue({
      tournament_id: "T-test",
      title: "テスト大会",
      event_start_date: "2026-11-01",
      event_end_date: "2026-11-01",
      grade: "C",
      internal_deadline: "2026-10-25T14:59:00.000Z",
      true_deadline: "2026-10-28T14:59:00.000Z",
    });
    const response = await handleAdminRequest(
      new Request("https://admin.example.com/api/tournaments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://admin.example.com",
        },
        body: JSON.stringify({
          title: "テスト大会",
          grade: "C",
          tournamentType: "official",
          eventStartDate: "2026-11-01",
          eventEndDate: "2026-11-01",
          internalDeadline: "2026-10-25T23:59:00+09:00",
          trueDeadline: "2026-10-28T23:59:00+09:00",
        }),
      }),
      env,
      authenticatedContext(waitUntil),
      creator,
    );

    expect(response.status).toBe(201);
    expect(creator).toHaveBeenCalledWith(
      env,
      expect.objectContaining({
        title: "テスト大会",
        grade: "C",
        createdByEmail: "admin@example.com",
      }),
    );
    expect(waitUntil).not.toHaveBeenCalled();
  });

  it("rejects a cross-origin submission", async () => {
    const response = await handleAdminRequest(
      new Request("https://admin.example.com/api/tournaments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://attacker.example",
        },
        body: "{}",
      }),
      env,
      authenticatedContext(),
    );

    expect(response.status).toBe(403);
  });

  it("returns the tournament list and response summary", async () => {
    const lister = vi.fn().mockResolvedValue([
      {
        tournament_id: "T-11111111-1111-4111-8111-111111111111",
        title: "管理画面テスト大会",
        status: "active",
        response_yes: 1,
        response_maybe: 0,
        response_no: 0,
        response_pending: 0,
        responses: [{ display_name: "埼玉 花子", response: "yes" }],
      },
    ]);
    const response = await handleAdminRequest(
      new Request("https://admin.example.com/api/tournaments"),
      env,
      authenticatedContext(),
      undefined,
      lister,
    );

    expect(response.status).toBe(200);
    expect(lister).toHaveBeenCalledWith(env);
    await expect(response.json()).resolves.toMatchObject({
      tournaments: [
        {
          title: "管理画面テスト大会",
          response_yes: 1,
          responses: [{ display_name: "埼玉 花子", response: "yes" }],
        },
      ],
    });
  });

  it("updates a tournament status with the authenticated administrator", async () => {
    const statusUpdater = vi.fn().mockResolvedValue({
      tournamentId: "T-11111111-1111-4111-8111-111111111111",
      previousStatus: "active",
      status: "closed",
      changed: true,
    });
    const response = await handleAdminRequest(
      new Request(
        "https://admin.example.com/api/tournaments/T-11111111-1111-4111-8111-111111111111/status",
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Origin: "https://admin.example.com",
          },
          body: JSON.stringify({ status: "closed" }),
        },
      ),
      env,
      authenticatedContext(),
      undefined,
      undefined,
      statusUpdater,
    );

    expect(response.status).toBe(200);
    expect(statusUpdater).toHaveBeenCalledWith(
      env,
      "T-11111111-1111-4111-8111-111111111111",
      "closed",
      "admin@example.com",
    );
  });

  it("rejects an unsupported tournament status", async () => {
    const statusUpdater = vi.fn();
    const response = await handleAdminRequest(
      new Request(
        "https://admin.example.com/api/tournaments/T-11111111-1111-4111-8111-111111111111/status",
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Origin: "https://admin.example.com",
          },
          body: JSON.stringify({ status: "deleted" }),
        },
      ),
      env,
      authenticatedContext(),
      undefined,
      undefined,
      statusUpdater,
    );

    expect(response.status).toBe(400);
    expect(statusUpdater).not.toHaveBeenCalled();
  });

  it("returns members without exposing Discord user IDs", async () => {
    const memberLister = vi.fn().mockResolvedValue([
      {
        memberId: "M-11111111-1111-4111-8111-111111111111",
        displayName: "石田 洋音",
        grade: "C",
        status: "active",
        dmEnabled: true,
        discordLinked: true,
        createdAt: "2026-10-01T00:00:00.000Z",
        updatedAt: "2026-10-01T00:00:00.000Z",
      },
    ]);
    const response = await handleAdminRequest(
      new Request("https://admin.example.com/api/members"),
      env,
      authenticatedContext(),
      undefined,
      undefined,
      undefined,
      memberLister,
    );

    expect(response.status).toBe(200);
    const body = await response.json() as { members: Array<Record<string, unknown>> };
    expect(body.members[0]).toMatchObject({
      displayName: "石田 洋音",
      discordLinked: true,
    });
    expect(body.members[0]).not.toHaveProperty("discordUserId");
  });

  it("updates a member with the authenticated administrator", async () => {
    const memberId = "M-11111111-1111-4111-8111-111111111111";
    const memberUpdater = vi.fn().mockResolvedValue({
      memberId,
      displayName: "石田 洋音",
      grade: "B",
      status: "active",
      dmEnabled: false,
      discordLinked: true,
    });
    const input = {
      displayName: "石田 洋音",
      grade: "B",
      status: "active",
      dmEnabled: false,
    };
    const response = await handleAdminRequest(
      new Request(`https://admin.example.com/api/members/${memberId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://admin.example.com",
        },
        body: JSON.stringify(input),
      }),
      env,
      authenticatedContext(),
      undefined,
      undefined,
      undefined,
      undefined,
      memberUpdater,
    );

    expect(response.status).toBe(200);
    expect(memberUpdater).toHaveBeenCalledWith(
      env,
      memberId,
      input,
      "admin@example.com",
    );
  });
});
