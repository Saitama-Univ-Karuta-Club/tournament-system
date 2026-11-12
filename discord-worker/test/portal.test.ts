import { afterEach, describe, expect, it, vi } from "vitest";
import { handlePortalRequest, type PortalEnv } from "../src/portal";
import { handlePracticePortalRequest } from "../src/portal/practice";

const member = {
  member_id: "M-11111111-1111-4111-8111-111111111111",
  discord_user_id: "123456789012345678",
  last_name: "石田",
  first_name: "洋音",
  last_name_kana: "いしだ",
  first_name_kana: "ひろね",
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
  it("does not expose practice schedule registration from the member portal", async () => {
    const request = new Request("https://portal.example.com/api/practice/schedules", {
      method: "POST",
      headers: {
        Origin: "https://portal.example.com",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ schedules: [{ practiceDate: "2026-11-01" }] }),
    });

    await expect(handlePracticePortalRequest(
      request,
      new URL(request.url),
      baseEnv,
      member,
    )).resolves.toBeNull();
  });

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
    expect(html).toContain("埼玉大学かるた会 メンバーポータル</p>");
    expect(html).toContain("Discordでログイン");
    expect(html).toContain('id="info-tab"');
    expect(html).not.toContain('id="answer-tab"');
    expect(html).toContain('data-tab="info">大会関連<span');
    expect(html).toContain('id="answer-view-tab"');
    expect(html).toContain('data-view="answer">参加回答</button>');
    expect(html).toContain('aria-label="大会関連の表示切替"');
    expect(html).toContain('id="tournaments-view-tab"');
    expect(html).toContain('id="documents-view-tab"');
    expect(html).toContain('data-view="documents">大会案内一覧</button>');
    expect(html).toContain('id="archive-view-tab"');
    expect(html).not.toContain("登録済みの大会案内をまとめて閲覧できます");
    expect(html).not.toContain("大会要項・選手名簿・大会結果と、サークルから出場したメンバーの成績を大会ごとにまとめています");
    expect(html).toContain('id="profile-tab"');
    expect(html).toContain('id="practice-tab"');
    expect(html).toContain('data-tab="practice">練習関連</button>');
    expect(html).toContain('id="practice-panel"');
    expect(html).toContain('data-practice-view="create">練習を作成</button>');
    expect(html).toContain('data-practice-view="results">練習結果入力</button>');
    expect(html).toContain('data-practice-view="schedules">練習日程</button>');
    expect(html).toMatch(/data-practice-view="schedules">練習日程<\/button>[\s\S]*data-practice-view="create">練習を作成<\/button>[\s\S]*data-practice-view="results">練習結果入力<\/button>/);
    expect(html).toContain("practice-schedule-note");
    expect(html).toContain("let selectedPracticeView='schedules'");
    expect(html).toContain('id="practice-schedule-response-list"');
    expect(html).toContain('class="practice-schedule-attendees"');
    expect(html).toContain("response.response==='yes'");
    expect(html).toContain('.practice-schedule-response-card{display:grid;grid-template-columns:minmax(20rem,1fr) minmax(15rem,.85fr)');
    expect(html).not.toContain('id="practice-schedule-form"');
    expect(html).toContain("api('/api/practice/schedules/'");
    expect(html).toContain("method:'PUT'");
    expect(html).toContain("name==='practice-schedules'?'schedules'");
    expect(html).toContain('function applyScheduledParticipants(force=false)');
    expect(html).toContain('id="practice-session-form"');
    expect(html).toContain('id="practice-reader"');
    expect(html).toContain('type="hidden" name="readerMemberId" id="practice-reader"');
    expect(html).toContain('class="practice-reader-toggle"');
    expect(html).toContain('function renderPracticeReaderToggles()');
    expect(html).toContain('function togglePracticeReader(event)');
    expect(html).toContain('.practice-reader-toggle[aria-pressed="true"]');
    expect(html).toContain('.member-picker-list{grid-template-columns:repeat(auto-fit,minmax(15rem,1fr))}');
    expect(html).toContain('.member-choice{justify-content:space-between;min-width:0;padding:6px 7px;white-space:nowrap}');
    expect(html).toContain("readerMemberId:fields.get('readerMemberId')");
    expect(html).toContain('id="internal-match-form"');
    expect(html).toContain('id="internal-match-form" class="practice-form practice-result-form"');
    expect(html).toContain('id="internal-match-form" class="practice-form practice-result-form">\n          <div class="practice-fields practice-result-fields internal-result-fields"');
    expect(html).toContain('class="internal-result-session"');
    expect(html).toContain('class="internal-result-date"');
    expect(html).toContain('class="internal-result-opponent"');
    expect(html).toContain('class="internal-result-outcome"');
    expect(html).toContain('class="internal-result-score"');
    expect(html).toContain('grid-template-areas:"session date opponent outcome score"');
    expect(html).toContain('grid-template-areas:"session opponent outcome score"');
    expect(html).toContain("classList.toggle('without-date',hasSession)");
    expect(html).toContain('.member-choice .member-name{display:flex;align-items:baseline;gap:8px');
    expect(html).toContain('id="external-match-form" class="practice-form practice-result-form">\n          <div class="practice-fields practice-result-fields external-result-fields"');
    expect(html).toContain('class="practice-actions practice-result-actions"');
    expect(html).not.toContain('<label>備考<input name="note"');
    expect(html).toContain('.practice-result-fields input,.practice-result-fields select{height:42px');
    expect(html.match(/<summary>詳細を入力<\/summary>/g)).toHaveLength(2);
    expect(html).toContain('name="faultCount"');
    expect(html).toContain('name="cardsTaken"');
    expect(html).toContain('name="opponentRightTaken"');
    expect(html).toContain('name="opponentLeftTaken"');
    expect(html).toContain('name="ownRightTaken"');
    expect(html).toContain('name="ownLeftTaken"');
    expect(html).toContain('name="comment"');
    expect(html).toContain('class="practice-detail-cards">取得枚数<input');
    expect(html).toContain('class="practice-detail-opponent-right">相手陣右<input');
    expect(html).toContain('class="practice-detail-opponent-left">相手陣左<input');
    expect(html).toContain('class="practice-detail-faults">お手つき数<input');
    expect(html).toContain('class="practice-detail-own-left">自陣左<input');
    expect(html).toContain('class="practice-detail-own-right">自陣右<input');
    expect(html).toContain('.practice-details summary{width:max-content;border:0;background:transparent');
    expect(html).toMatch(/取得枚数[\s\S]*相手陣右[\s\S]*相手陣左[\s\S]*お手つき数[\s\S]*自陣左[\s\S]*自陣右[\s\S]*コメント/);
    expect(html).toContain('grid-template-areas:"cards faults" "opponent-right opponent-left" "own-left own-right" "comment comment"');
    expect(html).toContain("<h2>対戦結果を入力</h2>");
    expect(html).not.toContain("練習登録がなくても記録できます");
    expect(html).not.toContain("組み合わせは対戦相手を決めるための参考です");
    expect(html).not.toContain("外部の相手との対戦を自分の記録へ追加します");
    expect(html).not.toContain("参考組み合わせ");
    expect(html).toContain("練習一覧・組み合わせ");
    expect(html).toContain('<option value="">登録なし（自主練習）</option>');
    expect(html).toContain("function renderPractice()");
    expect(html).toContain("function saveInternalMatch(event)");
    expect(html).toContain("/api/practice/internal-matches");
    expect(html).toContain("function generatePracticeRound(event)");
    expect(html).toContain("級別の成績");
    expect(html).toContain("相手ごとの成績");
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
    expect(html).toContain('<option value="registration_open">回答受付中</option>');
    expect(html).toContain('<option value="application_pending">申込対応中</option>');
    expect(html).toContain('<option value="application_complete">申込完了</option>');
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
    expect(script).toContain("function resultMatchMark(match)");
    expect(script).toContain("mark+score");
    expect(script).toContain("function openProfileResultDetail(index)");
    expect(script).toContain("function saveProfile(event)");
    expect(script).toContain("function selectProfileView(name)");
    expect(script).toContain("function enhanceProfileTabs()");
    expect(script).toContain('data-profile-view="registration"');
    expect(script).toContain('data-profile-view="history"');
    expect(script).toContain('data-profile-view="matches">対戦記録</button>');
    expect(script).toContain('data-profile-view="history">大会出場履歴</button>');
    expect(script!.indexOf('data-profile-view="matches">対戦記録</button>')).toBeLessThan(
      script!.indexOf('data-profile-view="history">大会出場履歴</button>'),
    );
    expect(script).not.toContain("大会・サークル内練習・外部練習会の成績をまとめて表示します。");
    expect(script).toContain('class="practice-overall-statistics"');
    expect(script).toContain('class="practice-table practice-statistics-table"');
    expect(script).toContain("<th>対戦数</th><th>勝ち数</th><th>負け数</th><th>勝率</th>");
    expect(script).toContain('class="practice-opponent-statistics"');
    expect(script).toContain("個人別の対戦成績を表示");
    expect(script).not.toContain('<details class="practice-opponent-statistics" open>');
    expect(script).toContain("const practiceRecordsPerPage=10");
    expect(script).toContain("function practiceRecordPageItems(totalPages,currentPage)");
    expect(script).toContain("practice.records.slice(offset,offset+practiceRecordsPerPage)");
    expect(script).toContain('class="practice-pagination"');
    expect(script).toContain('aria-current="page"');
    expect(html).toContain('id="practice-record-detail-dialog"');
    expect(script).toContain('class="practice-record-detail-button"');
    expect(script).toContain("function openPracticeRecordDetail(event)");
    expect(script).toContain("row.opponentRightTaken");
    expect(script).toContain("row.ownLeftTaken");
    expect(html).toContain(".practice-overall-statistics,.practice-grade-statistics{margin-top:18px}");
    expect(html).toContain(".practice-pagination{display:flex");
    expect(html).toContain(".practice-record-detail-grid{display:grid");
    expect(html).toContain("#info-panel,#profile-content,#practice-panel{display:grid;grid-template-columns:180px minmax(0,1fr)");
    expect(html).toContain(".subtabs,.profile-tabs,.practice-tabs{position:sticky;top:16px;display:grid");
    expect(script).toContain("現在の登録情報");
    expect(script).toContain('id="profile-dialog"');
    expect(script).toContain(">編集</button>");
    expect(script).toContain(">更新</button>");
    expect(script).toContain("大会出場履歴");
    expect(script).toContain("function eventDate(value)");
    expect(script).toContain("year+'年'+month+'月'+day+'日'");
    expect(script).toContain("<th>開催日</th>");
    expect(script).not.toContain("<th>開催月</th>");
    expect(script).toContain('class="history-table"');
    expect(script).toContain('id="profile-result-dialog"');
    expect(script).toContain("結果：'+esc(item.result_text||'未登録')");
    expect(script).toContain("未登録");
    expect(script).toContain("参加費のサークル内支払期限を過ぎています");
    expect(script).toContain("function savePayment(event)");
    expect(script).toContain(">振込完了</button>");
    expect(script).toContain("function tournamentStage(group)");
    expect(script).toContain("function tournamentResourceLinks(group,stage)");
    expect(script).toContain("function renderDocumentIndex()");
    expect(script).toContain("group.every(item=>item.workflow_stage!=='canceled'&&item.status!=='canceled')");
    expect(html).toContain('id="info-tab"');
    expect(html).toContain('id="documents-view-tab"');
    expect(html).toContain('id="document-search"');
    expect(script).toContain("function selectInfoView(name,updateHash=true)");
    expect(script).toContain("let selectedInfoView='answer'");
    expect(script).toContain("['answer','tournaments','documents','archive']");
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

  it("labels only the development member portal", async () => {
    const developmentResponse = await handlePortalRequest(
      new Request("https://portal.example.com/"),
      { ...baseEnv, ENVIRONMENT: "development" },
      context,
    );
    const developmentHtml = await developmentResponse.text();
    expect(developmentHtml).toContain("大会参加確認（開発版）｜埼玉大学かるた会");
    expect(developmentHtml).toContain("<h1>大会参加確認（開発版）</h1>");
    expect(developmentHtml).toContain("埼玉大学かるた会 メンバーポータル</p>");

    const productionResponse = await handlePortalRequest(
      new Request("https://portal.example.com/"),
      baseEnv,
      context,
    );
    const productionHtml = await productionResponse.text();
    expect(productionHtml).toContain("<h1>大会参加確認</h1>");
    expect(productionHtml).not.toContain("大会参加確認（開発版）");
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
