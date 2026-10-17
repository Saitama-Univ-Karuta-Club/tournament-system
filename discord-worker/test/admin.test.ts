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
    await expect(response.text()).resolves.toContain("大会登録（Discord版MVP）");
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
});
