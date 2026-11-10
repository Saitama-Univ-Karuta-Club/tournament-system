const escapeHtml = (value: string): string => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#39;");

const pageShell = (title: string, body: string): string => `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} | 裏方bot</title>
  <style>
    :root { color-scheme: light; --green:#668437; --ink:#182238; --muted:#65708a; --line:#d6deeb; --bg:#f4f7fb; }
    * { box-sizing:border-box; }
    body { margin:0; background:var(--bg); color:var(--ink); font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans JP",sans-serif; }
    main { width:min(820px,calc(100% - 24px)); margin:28px auto; background:#fff; border:1px solid var(--line); border-radius:20px; padding:28px; box-shadow:0 12px 32px rgba(24,34,56,.08); }
    h1 { margin:0 0 8px; font-size:clamp(24px,5vw,34px); }
    p.lead { margin:0 0 26px; color:var(--muted); }
    label { display:block; margin:18px 0 7px; font-weight:700; }
    input, textarea { width:100%; border:1px solid #bcc8dc; border-radius:12px; padding:12px 14px; color:var(--ink); background:#fff; font:inherit; }
    input:focus, textarea:focus { outline:3px solid rgba(102,132,55,.18); border-color:var(--green); }
    textarea { min-height:92px; resize:vertical; }
    fieldset { margin:24px 0 0; border:1px solid var(--line); border-radius:16px; padding:18px; }
    legend { padding:0 8px; font-weight:800; }
    .candidate { display:grid; grid-template-columns:minmax(0,1.5fr) minmax(120px,.8fr) auto; gap:10px; align-items:end; margin-bottom:12px; }
    .candidate label { margin:0 0 6px; font-size:14px; color:var(--muted); }
    button { border:0; border-radius:11px; padding:12px 16px; font:inherit; font-weight:700; cursor:pointer; }
    .remove { background:#eef1f6; color:#4f5b72; }
    .add { background:#eef4e6; color:#4b6527; }
    .submit { width:100%; margin-top:24px; background:var(--green); color:#fff; font-size:18px; padding:14px; }
    .hint { color:var(--muted); font-size:14px; margin:10px 0 0; }
    .message { padding:16px; border-radius:12px; background:#eef4e6; }
    .error { background:#fff0f0; color:#982f2f; }
    a { color:#43611e; font-weight:700; }
    @media (max-width:620px) {
      main { margin:12px auto; padding:20px; border-radius:16px; }
      .candidate { grid-template-columns:1fr 1fr; }
      .candidate .remove { grid-column:1 / -1; padding:9px; }
    }
  </style>
</head>
<body><main>${body}</main></body>
</html>`;

export function renderScheduleCreatePage(token: string): string {
  return pageShell("日程調整を作成", `
    <h1>日程調整を作成</h1>
    <p class="lead">候補日をカレンダーから選択してください。曜日は自動で付加されます。</p>
    <form method="post" action="/schedule/create" id="schedule-form">
      <input type="hidden" name="token" value="${escapeHtml(token)}">
      <label for="title">タイトル</label>
      <input id="title" name="title" maxlength="100" required placeholder="懇親会の日程調整">
      <label for="description">説明（任意）</label>
      <textarea id="description" name="description" maxlength="1000" placeholder="回答期限や補足事項"></textarea>
      <fieldset>
        <legend>候補日時</legend>
        <div id="candidates"></div>
        <button type="button" class="add" id="add-candidate">＋ 候補を追加</button>
        <p class="hint">候補は2件以上、最大20件です。時刻は省略できます。</p>
      </fieldset>
      <button type="submit" class="submit">Discordに日程調整を作成</button>
    </form>
    <template id="candidate-template">
      <div class="candidate">
        <div><label>日付</label><input type="date" name="candidate_date" required></div>
        <div><label>時刻（任意）</label><input type="time" name="candidate_time"></div>
        <button type="button" class="remove">削除</button>
      </div>
    </template>
    <script>
      const list = document.getElementById('candidates');
      const template = document.getElementById('candidate-template');
      const add = () => {
        if (list.children.length >= 20) return;
        const row = template.content.firstElementChild.cloneNode(true);
        row.querySelector('.remove').addEventListener('click', () => {
          if (list.children.length > 2) row.remove();
        });
        list.appendChild(row);
      };
      document.getElementById('add-candidate').addEventListener('click', add);
      add(); add();
    </script>
  `);
}

export function renderScheduleCreatedPage(messageUrl: string): string {
  return pageShell("作成しました", `
    <h1>作成しました</h1>
    <div class="message">Discordに日程調整を投稿しました。</div>
    <p><a href="${escapeHtml(messageUrl)}">Discordのメッセージを開く</a></p>
    <p class="hint">このページは閉じて構いません。</p>
  `);
}

export function renderScheduleErrorPage(message: string): string {
  return pageShell("入力を確認してください", `
    <h1>入力を確認してください</h1>
    <div class="message error">${escapeHtml(message)}</div>
    <p><button type="button" class="add" onclick="history.back()">入力画面に戻る</button></p>
  `);
}

function parseDate(value: string): { year: number; month: number; day: number; weekday: string } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error("候補日をカレンダーから選択してください。");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) throw new Error("存在しない日付が含まれています。");
  return { year, month, day, weekday: ["日", "月", "火", "水", "木", "金", "土"][date.getUTCDay()] };
}

export function parseScheduleCalendarForm(form: FormData): {
  token: string;
  title: string;
  description: string;
  candidates: string[];
} {
  const token = String(form.get("token") ?? "");
  const title = String(form.get("title") ?? "").trim();
  const description = String(form.get("description") ?? "").trim();
  const dates = form.getAll("candidate_date").map(String);
  const times = form.getAll("candidate_time").map(String);
  if (!token) throw new Error("作成用リンクを確認できませんでした。");
  if (!title) throw new Error("タイトルを入力してください。");
  if (title.length > 100) throw new Error("タイトルは100文字以内にしてください。");
  if (description.length > 1000) throw new Error("説明は1000文字以内にしてください。");
  if (dates.length < 2) throw new Error("候補日時を2件以上選択してください。");
  if (dates.length > 20) throw new Error("候補日時は20件までにしてください。");
  const candidates = dates.map((dateValue, index) => {
    const { year, month, day, weekday } = parseDate(dateValue);
    const time = times[index] ?? "";
    if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      throw new Error("時刻の形式を確認してください。");
    }
    return `${year}年${month}月${day}日（${weekday}）${time ? ` ${time}` : ""}`;
  });
  if (new Set(candidates).size !== candidates.length) {
    throw new Error("同じ候補日時が重複しています。");
  }
  return { token, title, description, candidates };
}
