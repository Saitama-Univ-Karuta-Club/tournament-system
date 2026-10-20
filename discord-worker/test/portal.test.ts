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
  it("serves public Google backup information and privacy pages without login", async () => {
    const homeResponse = await handlePortalRequest(
      new Request("https://portal.example.com/google-backup"),
      baseEnv,
      context,
    );
    const home = await homeResponse.text();
    const privacyResponse = await handlePortalRequest(
      new Request("https://portal.example.com/google-backup/privacy"),
      baseEnv,
      context,
    );
    const privacy = await privacyResponse.text();

    expect(homeResponse.status).toBe(200);
    expect(home).toContain("大会システム Google Driveバックアップ");
    expect(home).toContain('href="/google-backup/privacy"');
    expect(privacyResponse.status).toBe(200);
    expect(privacy).toContain("プライバシーポリシー");
    expect(privacy).toContain("Google Drive");
    expect(privacy).toContain("第三者へ販売または提供しません");
  });

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
    expect(html).toContain('id="info-tab"');
    expect(html).toContain('id="tournaments-view-tab"');
    expect(html).toContain('id="documents-view-tab"');
    expect(html).toContain('data-view="documents">大会案内一覧</button>');
    expect(html).toContain('id="archive-view-tab"');
    expect(html).not.toContain("登録済みの大会案内をまとめて閲覧できます");
    expect(html).not.toContain("大会要項・選手名簿・大会結果と、サークルから出場したメンバーの成績を大会ごとにまとめています");
    expect(html).toContain('id="profile-tab"');
    expect(html).toContain('id="answer-list"');
    expect(html).toContain('id="tournament-list"');
    expect(html).toContain('id="archive-list"');
    expect(html).toContain('id="profile-panel"');
    expect(html).toContain('id="profile-content"');
    expect(html).toContain('id="payment-alert"');
    expect(html).toContain("過去の結果");
    expect(html).toContain("function renderArchives()");
    expect(html).toContain("結果ファイル");
    expect(html).toContain('id="answer-status-filter"');
    expect(html).not.toContain('id="answer-sort"');
    expect(html).toContain('<option value="all" selected>すべて</option>');
    expect(html).toContain('<option value="yes">参加希望</option>');
    expect(html).toContain('<option value="no">不参加</option>');
    expect(html).toContain('<option value="maybe">未定</option>');
    expect(html).toContain('<option value="unanswered">未回答</option>');
    expect(html).not.toContain('<option value="open"');
    expect(html).not.toContain('<option value="closed"');
    expect(html).toContain('<option value="current">すべての進行中</option>');
    expect(html).toContain('<option value="active">申込受付中</option>');
    expect(html).toContain('<option value="applied">申込済み</option>');
    expect(html).toContain('<option value="pre_lottery">抽選前</option>');
    expect(html).toContain('<option value="confirmed">参加者確定</option>');
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
    expect(html).toContain(".tab-count[hidden],.payment-alert[hidden]{display:none}");
    expect(script).toContain("function eligibleAnswerGroups()");
    expect(script).toContain("function canAnswer(target)");
    expect(script).toContain("target.status==='active'");
    expect(script).toContain("event_start_date+'T23:59:59.999+09:00'");
    expect(script).toContain("const statusOrder={unanswered:0,yes:1,no:2,maybe:3}");
    expect(script).toContain("eligibleAnswerGroups().filter(({target})=>canAnswer(target))");
    expect(script).toContain("function renderPaymentAlert()");
    expect(script).toContain("function renderProfile()");
    expect(script).toContain("function saveProfile(event)");
    expect(script).toContain("function selectProfileView(name)");
    expect(script).toContain("function enhanceProfileTabs()");
    expect(script).toContain('data-profile-view="registration"');
    expect(script).toContain('data-profile-view="history"');
    expect(html).toContain("#info-panel,#profile-content{display:grid;grid-template-columns:180px minmax(0,1fr)");
    expect(html).toContain(".subtabs,.profile-tabs{position:sticky;top:16px;display:grid");
    expect(script).toContain("現在の登録情報");
    expect(script).toContain('id="profile-dialog"');
    expect(script).toContain(">編集</button>");
    expect(script).toContain(">更新</button>");
    expect(script).toContain("大会出場履歴");
    expect(script).toContain("function eventMonth(value)");
    expect(script).toContain('class="history-table"');
    expect(script).toContain("未登録");
    expect(script).toContain("参加費のサークル内支払期限を過ぎています");
    expect(script).toContain("function savePayment(event)");
    expect(script).toContain(">振込完了</button>");
    expect(script).toContain("function tournamentStage(group)");
    expect(script).toContain("function tournamentResourceLinks(group,stage)");
    expect(script).toContain("function renderDocumentIndex()");
    expect(html).toContain('id="info-tab"');
    expect(html).toContain('id="documents-view-tab"');
    expect(html).toContain('id="document-search"');
    expect(script).toContain("function selectInfoView(name,updateHash=true)");
    expect(script).toContain("▣ 要項PDFを開く");
    expect(script).toContain("▣ 申込確認名簿");
    expect(script).toContain("▣ 確定選手名簿");
    expect(script).toContain("▣ 当日案内");
    expect(script).toContain("first.participant_guidance.has_document");
    expect(script).toContain("'guidance/document':'guidance'");
    expect(script).not.toContain("payment_status");
    expect(script).not.toContain("支払済み");
    expect(script).not.toContain("未納");
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

  it("marks only the logged-in participant payment as paid from the portal", async () => {
    const batch = vi.fn().mockResolvedValue([{ success: true }, { success: true }]);
    const prepare = vi.fn((statement: string) => ({
      bind: vi.fn(() => ({
        first: vi.fn().mockResolvedValue(
          statement.includes("tournament_participant_guidance.body_text")
            ? {
                member_id: member.member_id,
                title: "支払いテスト大会",
                body_text: null,
                document_url: null,
                file_name: null,
                payment_collection_method: "advance_manager",
                participation_fee_yen: 2000,
                payment_deadline: "2026-10-19T14:00:00.000Z",
                payment_status: "unpaid",
              }
            : member,
        ),
        run: vi.fn().mockResolvedValue({ success: true }),
      })),
    }));
    const sessionCookie = await createAuthenticatedCookie(prepare);
    const response = await handlePortalRequest(
      new Request(
        "https://portal.example.com/api/tournaments/T-22222222-2222-4222-8222-222222222222/payment",
        {
          method: "PUT",
          headers: {
            Cookie: sessionCookie,
            Origin: "https://portal.example.com",
          },
        },
      ),
      { ...baseEnv, DB: { prepare, batch } as unknown as D1Database },
      context,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "paid" });
    expect(batch).toHaveBeenCalledOnce();
    expect(prepare.mock.calls.some(([statement]) =>
      String(statement).includes("tournament_entry_payment_history"))).toBe(true);
  });
});
