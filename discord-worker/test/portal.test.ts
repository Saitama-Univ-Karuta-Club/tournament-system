import { afterEach, describe, expect, it, vi } from "vitest";
import { handlePortalRequest, type PortalEnv } from "../src/portal";

const member = {
  member_id: "M-11111111-1111-4111-8111-111111111111",
  discord_user_id: "123456789012345678",
  display_name: "石田洋音",
  display_name_kana: "いしだひろね",
  grade: "C",
  rank: 3,
  status: "active",
};

const baseEnv = {
  DB: {} as D1Database,
  DISCORD_APPLICATION_ID: "987654321098765432",
  DISCORD_CLIENT_SECRET: "client-secret-for-test",
  DISCORD_REDIRECT_URI: "https://portal.example.com/auth/discord/callback",
  SESSION_SECRET: "session-secret-long-enough-for-tests",
} satisfies PortalEnv;

const context = { waitUntil: vi.fn() } as unknown as Pick<ExecutionContext, "waitUntil">;

function firstSetCookie(response: Response, name: string): string {
  const combined = response.headers.get("Set-Cookie") ?? "";
  const match = combined.match(new RegExp(`${name}=([^;,]+)`));
  if (!match) throw new Error(`Cookie ${name} was not set`);
  return `${name}=${match[1]}`;
}

async function createAuthenticatedCookie(prepare: ReturnType<typeof vi.fn>): Promise<string> {
  vi.stubGlobal("fetch", vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "oauth-token" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ id: member.discord_user_id }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })));
  const response = await handlePortalRequest(
    new Request(
      "https://portal.example.com/auth/discord/callback?code=oauth-code&state=state-value&iss=https%3A%2F%2Fdiscord.com",
      { headers: { Cookie: "__Host-sukc_oauth_state=state-value; __Host-sukc_oauth_verifier=verifier-value" } },
    ),
    { ...baseEnv, DB: { prepare } as unknown as D1Database },
    context,
  );
  expect(response.status).toBe(302);
  return firstSetCookie(response, "__Host-sukc_portal_session");
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("member portal", () => {
  it("serves a Discord login page without exposing tournament data", async () => {
    const response = await handlePortalRequest(
      new Request("https://portal.example.com/"),
      baseEnv,
      context,
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain("大会参加確認");
    expect(html).toContain("Discordでログイン");
    expect(html).toContain('id="answer-tab"');
    expect(html).toContain('id="tournaments-tab"');
    expect(html).toContain('id="archive-tab"');
    expect(html).toContain('id="answer-list"');
    expect(html).toContain('id="tournament-list"');
    expect(html).toContain('id="archive-list"');
    expect(html).toContain("過去の大会結果");
    expect(html).toContain("function renderArchives()");
    expect(html).toContain("結果ファイル");
    expect(html).toContain('id="answer-status-filter"');
    expect(html).toContain('id="answer-sort"');
    expect(html).toContain('<option value="open" selected>回答受付中</option>');
    expect(html).toContain('<option value="unanswered">未回答</option>');
    expect(html).toContain('<option value="action">回答が必要な順</option>');
    expect(response.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1];
    expect(script).toBeTruthy();
    expect(() => new Function(script!)).not.toThrow();
    const answerRenderer = script!.slice(
      script!.indexOf("function renderAnswers"),
      script!.indexOf("function renderTournamentList"),
    );
    const tournamentRenderer = script!.slice(
      script!.indexOf("function renderTournamentList"),
      script!.indexOf("function render()"),
    );
    expect(answerRenderer).not.toContain('class="participants"');
    expect(answerRenderer).not.toContain("○ ");
    expect(answerRenderer).not.toContain("△ ");
    expect(answerRenderer).not.toContain("× ");
    expect(tournamentRenderer).toContain('class="participants"');
    expect(html).toContain(".participants li.empty{display:block;white-space:nowrap}");
    expect(script).toContain("function eligibleAnswerGroups()");
    expect(script).toContain("function canAnswer(target)");
  });

  it("rejects tournament API access without a member session", async () => {
    const response = await handlePortalRequest(
      new Request("https://portal.example.com/api/tournaments"),
      baseEnv,
      context,
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "ログインが必要です。" });
  });

  it("starts Discord authorization code flow with state and PKCE", async () => {
    const response = await handlePortalRequest(
      new Request("https://portal.example.com/auth/discord"),
      baseEnv,
      context,
    );
    const location = new URL(response.headers.get("Location")!);

    expect(response.status).toBe(302);
    expect(location.origin).toBe("https://discord.com");
    expect(location.searchParams.get("scope")).toBe("identify");
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    expect(response.headers.get("Set-Cookie")).toContain("__Host-sukc_oauth_state");
  });

  it("creates a session only for an active approved Discord member", async () => {
    const prepare = vi.fn(() => ({
      bind: vi.fn(() => ({ first: vi.fn().mockResolvedValue(member) })),
    }));
    const sessionCookie = await createAuthenticatedCookie(prepare);

    expect(sessionCookie).toMatch(/^__Host-sukc_portal_session=/);

    const response = await handlePortalRequest(
      new Request("https://portal.example.com/api/session", {
        headers: { Cookie: sessionCookie },
      }),
      { ...baseEnv, DB: { prepare } as unknown as D1Database },
      context,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      member: { display_name: "石田洋音", grade: "C", rank: 3 },
    });
  });

  it("refreshes a 30-day session when fewer than seven days remain", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-01T00:00:00.000Z"));
    const prepare = vi.fn(() => ({
      bind: vi.fn(() => ({ first: vi.fn().mockResolvedValue(member) })),
    }));
    const sessionCookie = await createAuthenticatedCookie(prepare);

    vi.setSystemTime(new Date("2026-10-25T00:00:00.000Z"));
    const response = await handlePortalRequest(
      new Request("https://portal.example.com/api/session", {
        headers: { Cookie: sessionCookie },
      }),
      { ...baseEnv, DB: { prepare } as unknown as D1Database },
      context,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Set-Cookie")).toContain(
      "__Host-sukc_portal_session=",
    );
    expect(response.headers.get("Set-Cookie")).toContain("Max-Age=2592000");
  });

  it("stores a web answer in the shared response row", async () => {
    const run = vi.fn().mockResolvedValue({ success: true });
    const sql: string[] = [];
    const prepare = vi.fn((statement: string) => {
      sql.push(statement);
      return {
        bind: vi.fn(() => ({
          first: vi.fn().mockResolvedValue(
            statement.includes("FROM tournaments")
              ? { tournament_id: "T-22222222-2222-4222-8222-222222222222", internal_deadline: "2099-01-01T00:00:00.000Z" }
              : member,
          ),
          run,
        })),
      };
    });
    const sessionCookie = await createAuthenticatedCookie(prepare);
    const response = await handlePortalRequest(
      new Request(
        "https://portal.example.com/api/tournaments/T-22222222-2222-4222-8222-222222222222/response",
        {
          method: "PUT",
          headers: {
            Cookie: sessionCookie,
            Origin: "https://portal.example.com",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ response: "yes" }),
        },
      ),
      { ...baseEnv, DB: { prepare } as unknown as D1Database },
      context,
    );

    expect(response.status).toBe(200);
    expect(sql.find((statement) => statement.includes("INSERT INTO responses"))).toContain("'web'");
    expect(run).toHaveBeenCalledOnce();
  });
});
