import { afterEach, describe, expect, it, vi } from "vitest";
import {
  handleAdminAuthRequest,
  readAdminDiscordPrincipal,
  type AdminAuthEnv,
} from "../src/admin-auth";
import { handleAdminRequest, type AdminEnv } from "../src/admin";

const ADMIN_ROLE_ID = "1562000000000000000";
const PRACTICE_ROLE_ID = "1562000000000000003";
const DISCORD_USER_ID = "1562000000000000001";

function adminEnv(
  roleId: string | null = ADMIN_ROLE_ID,
  practiceRoleId: string | null = null,
): AdminAuthEnv {
  const prepare = vi.fn(() => ({
    bind: vi.fn(() => ({
      first: vi.fn().mockResolvedValue({
        admin_role_id: roleId,
        practice_role_id: practiceRoleId,
      }),
    })),
  }));
  return {
    DB: { prepare } as unknown as D1Database,
    DISCORD_APPLICATION_ID: "1562000000000000002",
    DISCORD_CLIENT_SECRET: "discord-client-secret",
    DISCORD_REDIRECT_URI: "https://admin.example.com/auth/discord/callback",
    DISCORD_GUILD_ID: "1534368058632572990",
    SESSION_SECRET: "admin-session-secret-long-enough-for-tests",
  };
}

function firstSetCookie(response: Response, name: string): string {
  const combined = response.headers.get("Set-Cookie") ?? "";
  const match = combined.match(new RegExp(`${name}=([^;,]+)`));
  if (!match) throw new Error(`Cookie ${name} was not set`);
  return `${name}=${match[1]}`;
}

function mockDiscord(roles: string[]): void {
  vi.stubGlobal("fetch", vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "oauth-token" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }))
    .mockResolvedValueOnce(new Response(JSON.stringify({
      id: DISCORD_USER_ID,
      username: "tournament-admin",
      global_name: "大会担当者",
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }))
    .mockResolvedValueOnce(new Response(JSON.stringify({
      nick: "大会係",
      roles,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })));
}

function callbackRequest(returnTo = "/register"): Request {
  return new Request(
    "https://admin.example.com/auth/discord/callback?code=oauth-code&state=state-value&iss=https%3A%2F%2Fdiscord.com",
    {
      headers: {
        Cookie: `__Host-sukc_admin_oauth_state=state-value; __Host-sukc_admin_oauth_verifier=verifier-value; __Host-sukc_admin_oauth_return=${encodeURIComponent(returnTo)}`,
      },
    },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("Discord administrator authentication", () => {
  it("starts authorization with identity and guild member scopes", async () => {
    const response = await handleAdminAuthRequest(
      new Request("https://admin.example.com/auth/discord?return_to=%2Ftournaments"),
      adminEnv(),
    );
    expect(response).not.toBeNull();
    const location = new URL(response!.headers.get("Location")!);

    expect(response!.status).toBe(302);
    expect(location.origin).toBe("https://discord.com");
    expect(location.searchParams.get("scope")).toBe(
      "identify guilds.members.read",
    );
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(response!.headers.get("Set-Cookie")).toContain(
      "__Host-sukc_admin_oauth_state",
    );
  });

  it("creates an eight-hour session for a member with the configured role", async () => {
    const env = adminEnv();
    mockDiscord([ADMIN_ROLE_ID]);
    const callback = await handleAdminAuthRequest(
      callbackRequest("/tournaments"),
      env,
    );

    expect(callback!.status).toBe(302);
    expect(callback!.headers.get("Location")).toBe("/tournaments");
    expect(callback!.headers.get("Set-Cookie")).toContain("Max-Age=28800");
    const sessionCookie = firstSetCookie(callback!, "__Host-sukc_admin_session");
    await expect(readAdminDiscordPrincipal(
      new Request("https://admin.example.com/", {
        headers: { Cookie: sessionCookie },
      }),
      env,
    )).resolves.toMatchObject({
      provider: "discord",
      displayName: "大会係",
      discordUserId: DISCORD_USER_ID,
      auditIdentity: `discord:${DISCORD_USER_ID}`,
      permissions: ["tournament"],
    });

    const sessionResponse = await handleAdminRequest(
      new Request("https://admin.example.com/api/session", {
        headers: { Cookie: sessionCookie },
      }),
      env as AdminEnv,
      { waitUntil: vi.fn() },
    );
    expect(sessionResponse.status).toBe(200);
    await expect(sessionResponse.json()).resolves.toEqual({
      email: "大会係",
      displayName: "大会係",
      provider: "discord",
      permissions: ["tournament"],
    });
  });

  it("creates a practice-only session and limits pages and APIs", async () => {
    const env = adminEnv(ADMIN_ROLE_ID, PRACTICE_ROLE_ID);
    mockDiscord([PRACTICE_ROLE_ID]);
    const callback = await handleAdminAuthRequest(callbackRequest("/practice"), env);
    const sessionCookie = firstSetCookie(callback!, "__Host-sukc_admin_session");

    await expect(readAdminDiscordPrincipal(
      new Request("https://admin.example.com/", { headers: { Cookie: sessionCookie } }),
      env,
    )).resolves.toMatchObject({ permissions: ["practice"] });

    const practicePage = await handleAdminRequest(
      new Request("https://admin.example.com/practice", { headers: { Cookie: sessionCookie } }),
      env as AdminEnv,
      { waitUntil: vi.fn() },
    );
    expect(practicePage.status).toBe(200);
    const html = await practicePage.text();
    const tabs = html.match(/<nav class="tabs"[\s\S]*?<\/nav>/)?.[0] ?? "";
    expect(tabs).toContain('href="/practice"');
    expect(tabs).not.toContain('href="/register"');
    expect(tabs).toContain('href="/settings"');

    const settingsPage = await handleAdminRequest(
      new Request("https://admin.example.com/settings", { headers: { Cookie: sessionCookie } }),
      env as AdminEnv,
      { waitUntil: vi.fn() },
    );
    expect(settingsPage.status).toBe(200);
    const settingsHtml = await settingsPage.text();
    expect(settingsHtml).toContain('data-settings-view="design"');
    expect(settingsHtml).toContain('data-can-manage-tournaments="false"');

    const tournamentPage = await handleAdminRequest(
      new Request("https://admin.example.com/tournaments", { headers: { Cookie: sessionCookie } }),
      env as AdminEnv,
      { waitUntil: vi.fn() },
    );
    expect(tournamentPage.status).toBe(302);
    expect(tournamentPage.headers.get("Location")).toBe("/practice");

    const tournamentApi = await handleAdminRequest(
      new Request("https://admin.example.com/api/tournaments", { headers: { Cookie: sessionCookie } }),
      env as AdminEnv,
      { waitUntil: vi.fn() },
    );
    expect(tournamentApi.status).toBe(403);
  });

  it("creates a session with both permissions for a member with both roles", async () => {
    const env = adminEnv(ADMIN_ROLE_ID, PRACTICE_ROLE_ID);
    mockDiscord([ADMIN_ROLE_ID, PRACTICE_ROLE_ID]);
    const callback = await handleAdminAuthRequest(callbackRequest(), env);
    const sessionCookie = firstSetCookie(callback!, "__Host-sukc_admin_session");

    await expect(readAdminDiscordPrincipal(
      new Request("https://admin.example.com/", { headers: { Cookie: sessionCookie } }),
      env,
    )).resolves.toMatchObject({ permissions: ["tournament", "practice"] });
  });

  it("hides practice management and blocks its API for tournament-only users", async () => {
    const env = adminEnv(ADMIN_ROLE_ID, PRACTICE_ROLE_ID);
    mockDiscord([ADMIN_ROLE_ID]);
    const callback = await handleAdminAuthRequest(callbackRequest(), env);
    const sessionCookie = firstSetCookie(callback!, "__Host-sukc_admin_session");

    const tournamentPage = await handleAdminRequest(
      new Request("https://admin.example.com/register", { headers: { Cookie: sessionCookie } }),
      env as AdminEnv,
      { waitUntil: vi.fn() },
    );
    const html = await tournamentPage.text();
    const tabs = html.match(/<nav class="tabs"[\s\S]*?<\/nav>/)?.[0] ?? "";
    expect(tabs).toContain('href="/register"');
    expect(tabs).not.toContain('href="/practice"');

    const practiceApi = await handleAdminRequest(
      new Request("https://admin.example.com/api/practice/schedules", {
        headers: { Cookie: sessionCookie },
      }),
      env as AdminEnv,
      { waitUntil: vi.fn() },
    );
    expect(practiceApi.status).toBe(403);
  });

  it("rejects a server member without either administrator role", async () => {
    mockDiscord(["1562000000000000999"]);
    const response = await handleAdminAuthRequest(
      callbackRequest(),
      adminEnv(ADMIN_ROLE_ID, PRACTICE_ROLE_ID),
    );

    expect(response!.status).toBe(403);
    expect(await response!.text()).toContain("担当者権限がありません");
    expect(response!.headers.get("Set-Cookie") ?? "").not.toContain(
      "__Host-sukc_admin_session",
    );
  });

  it("refuses login until an administrator role ID is configured", async () => {
    mockDiscord([ADMIN_ROLE_ID]);
    const response = await handleAdminAuthRequest(callbackRequest(), adminEnv(null, null));

    expect(response!.status).toBe(503);
    expect(await response!.text()).toContain("担当者ロールが未設定です");
  });
});
