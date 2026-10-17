import {
  createTournament,
  normalizeTournamentInput,
  type TournamentEnv,
  type TournamentInput,
  type TournamentRow,
} from "./tournaments";

export interface AdminEnv extends TournamentEnv {}

type AdminContext = Pick<ExecutionContext, "access" | "waitUntil">;
type TournamentCreator = (
  env: AdminEnv,
  input: TournamentInput,
) => Promise<TournamentRow>;

const securityHeaders = {
  "Cache-Control": "no-store",
  "Content-Security-Policy":
    "default-src 'none'; connect-src 'self'; img-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: securityHeaders });
}

function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("Origin");
  return origin === new URL(request.url).origin;
}

function adminHtml(): string {
  return String.raw`<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>大会登録 | 埼玉大学かるた会</title>
  <style>
    :root { color-scheme: light; font-family: system-ui, -apple-system, "Hiragino Sans", "Yu Gothic UI", sans-serif; color: #172033; background: #f4f6fa; }
    * { box-sizing: border-box; }
    body { margin: 0; }
    header { background: #293c74; color: white; padding: 18px 24px; box-shadow: 0 2px 8px #17203322; }
    header div { max-width: 920px; margin: auto; display: flex; align-items: baseline; justify-content: space-between; gap: 16px; }
    h1 { margin: 0; font-size: 1.25rem; }
    #identity { font-size: .82rem; opacity: .85; }
    main { max-width: 920px; margin: 28px auto; padding: 0 18px 48px; }
    .notice { border-left: 4px solid #da8c10; background: #fff7e8; padding: 12px 16px; margin-bottom: 18px; line-height: 1.7; }
    form { background: white; border: 1px solid #dce1eb; border-radius: 12px; padding: 24px; box-shadow: 0 8px 24px #1720330c; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
    label { display: grid; gap: 7px; font-weight: 650; font-size: .9rem; }
    label.wide { grid-column: 1 / -1; }
    .optional { color: #697386; font-size: .78rem; font-weight: 500; }
    input, select { width: 100%; border: 1px solid #b9c1d0; border-radius: 8px; padding: 11px 12px; font: inherit; color: inherit; background: white; }
    input:focus, select:focus { outline: 3px solid #7c9cff3b; border-color: #526fc4; }
    .actions { margin-top: 24px; display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
    button { border: 0; border-radius: 8px; padding: 12px 20px; background: #3658b2; color: white; font: inherit; font-weight: 700; cursor: pointer; }
    button:hover { background: #294796; }
    button:disabled { opacity: .55; cursor: wait; }
    #result { min-height: 1.5em; font-weight: 650; }
    #result.ok { color: #17643a; }
    #result.error { color: #b42318; }
    .footnote { margin-top: 16px; color: #697386; font-size: .84rem; line-height: 1.6; }
    @media (max-width: 680px) { .grid { grid-template-columns: 1fr; } label.wide { grid-column: auto; } form { padding: 18px; } header div { display: block; } #identity { margin-top: 6px; } }
  </style>
</head>
<body>
  <header><div><h1>大会登録（Discord版MVP）</h1><span id="identity">認証情報を確認中…</span></div></header>
  <main>
    <div class="notice"><strong>テスト運用中です。</strong> 登録後1分以内を目安に告知チャンネルへ投稿し、該当級の登録済み部員へDMを送ります。現在は誤配信防止のため1大会につき最大10人です。</div>
    <form id="tournament-form">
      <div class="grid">
        <label class="wide">大会名<input name="title" required maxlength="100" autocomplete="off"></label>
        <label>対象級<select name="grade" required><option value="">選択してください</option><option value="A">A級</option><option value="B">B級</option><option value="C">C級</option><option value="D">D級</option><option value="E">E級</option><option value="F">F級</option><option value="beginner">初心者</option></select></label>
        <label>大会種別<select name="tournamentType" required><option value="official">公認大会</option><option value="support">後援大会</option><option value="event">その他イベント</option></select></label>
        <label>開催開始日<input type="date" name="eventStartDate" required></label>
        <label>開催終了日<input type="date" name="eventEndDate" required></label>
        <label>サークル内締切<input type="datetime-local" name="internalDeadline" required></label>
        <label>主催者締切<input type="datetime-local" name="trueDeadline" required></label>
        <label class="wide">会場 <span class="optional">任意</span><input name="venue" maxlength="200" autocomplete="off"></label>
        <label class="wide">大会要項URL <span class="optional">任意・Google Drive等</span><input type="url" name="documentUrl" maxlength="500" placeholder="https://..."></label>
      </div>
      <div class="actions"><button id="submit" type="submit">登録して通知を開始</button><span id="result" role="status" aria-live="polite"></span></div>
      <div class="footnote">現段階では1回の登録につき1級です。級ごとに日程・締切が異なる大会を正確に扱えるよう、D1では級別の大会として保存します。</div>
    </form>
  </main>
  <script>
    const form = document.querySelector('#tournament-form');
    const submit = document.querySelector('#submit');
    const result = document.querySelector('#result');
    const identity = document.querySelector('#identity');

    function localJstToIso(value) {
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('締切日時を入力してください。');
      return new Date(value + ':00+09:00').toISOString();
    }

    function dateValue(date) {
      const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
      const get = (type) => parts.find((part) => part.type === type).value;
      return get('year') + '-' + get('month') + '-' + get('day');
    }

    function dateTimeValue(date) {
      const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
      const get = (type) => parts.find((part) => part.type === type).value;
      return get('year') + '-' + get('month') + '-' + get('day') + 'T' + get('hour') + ':' + get('minute');
    }

    const now = Date.now();
    form.elements.eventStartDate.value = dateValue(new Date(now + 14 * 86400000));
    form.elements.eventEndDate.value = form.elements.eventStartDate.value;
    form.elements.internalDeadline.value = dateTimeValue(new Date(now + 7 * 86400000));
    form.elements.trueDeadline.value = dateTimeValue(new Date(now + 10 * 86400000));
    form.elements.eventStartDate.addEventListener('change', () => {
      if (!form.elements.eventEndDate.value || form.elements.eventEndDate.value < form.elements.eventStartDate.value) form.elements.eventEndDate.value = form.elements.eventStartDate.value;
    });

    fetch('/api/session').then((response) => response.json()).then((data) => {
      identity.textContent = data.email || '認証済み';
    }).catch(() => { identity.textContent = '認証済み'; });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      submit.disabled = true;
      result.className = '';
      result.textContent = '保存中…';
      const data = new FormData(form);
      try {
        const payload = Object.fromEntries(data.entries());
        payload.internalDeadline = localJstToIso(payload.internalDeadline);
        payload.trueDeadline = localJstToIso(payload.trueDeadline);
        const response = await fetch('/api/tournaments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || '登録に失敗しました。');
        result.className = 'ok';
        result.textContent = '登録しました。Discord通知を予約しました。';
        form.elements.title.value = '';
        form.elements.venue.value = '';
        form.elements.documentUrl.value = '';
      } catch (error) {
        result.className = 'error';
        result.textContent = error instanceof Error ? error.message : '登録に失敗しました。';
      } finally {
        submit.disabled = false;
      }
    });
  </script>
</body>
</html>`;
}

export async function handleAdminRequest(
  request: Request,
  env: AdminEnv,
  ctx: AdminContext,
  creator: TournamentCreator = createTournament,
): Promise<Response> {
  if (!ctx.access) {
    return json({ error: "Cloudflare Accessによる認証が必要です。" }, 403);
  }

  const identity = await ctx.access.getIdentity();
  const email = identity?.email?.trim();
  if (!email) {
    return json({ error: "認証済みメールアドレスを確認できません。" }, 403);
  }

  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/") {
    return new Response(adminHtml(), {
      headers: { ...securityHeaders, "Content-Type": "text/html; charset=utf-8" },
    });
  }

  if (request.method === "GET" && url.pathname === "/api/session") {
    return json({ email });
  }

  if (request.method === "POST" && url.pathname === "/api/tournaments") {
    if (!isSameOrigin(request)) {
      return json({ error: "不正な送信元です。" }, 403);
    }
    if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
      return json({ error: "JSON形式で送信してください。" }, 415);
    }

    let input: TournamentInput;
    try {
      const body = (await request.json()) as TournamentInput;
      input = normalizeTournamentInput({ ...body, createdByEmail: email });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "入力内容を確認してください。";
      return json({ error: message }, 400);
    }

    try {
      const tournament = await creator(env, input);
      return json(
        {
          ok: true,
          tournamentId: tournament.tournament_id,
          message: "大会を登録し、Discord通知を予約しました。",
        },
        201,
      );
    } catch (error: unknown) {
      console.error("Web管理画面からの大会登録エラー", error);
      return json({ error: "大会の保存に失敗しました。" }, 500);
    }
  }

  return json({ error: "Not Found" }, 404);
}

export default {
  fetch(request: Request, env: AdminEnv, ctx: ExecutionContext): Promise<Response> {
    return handleAdminRequest(request, env, ctx);
  },
} satisfies ExportedHandler<AdminEnv>;
