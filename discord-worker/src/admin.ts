import {
  createTournament,
  normalizeTournamentInput,
  type TournamentEnv,
  type TournamentInput,
  type TournamentRow,
} from "./tournaments";
import {
  listAdminMembers,
  MemberAdminError,
  updateAdminMember,
  type AdminMember,
  type MemberUpdateInput,
} from "./admin-members";

export interface AdminEnv extends TournamentEnv {}

type AdminContext = Pick<ExecutionContext, "access" | "waitUntil">;
type TournamentCreator = (
  env: AdminEnv,
  input: TournamentInput,
) => Promise<TournamentRow>;
type TournamentLister = (env: AdminEnv) => Promise<AdminTournament[]>;
type TournamentStatusUpdater = (
  env: AdminEnv,
  tournamentId: string,
  status: string,
  changedByEmail: string,
) => Promise<TournamentStatusUpdate>;
type MemberLister = (env: AdminEnv) => Promise<AdminMember[]>;
type MemberUpdater = (
  env: AdminEnv,
  memberId: string,
  input: MemberUpdateInput,
  changedByEmail: string,
) => Promise<AdminMember>;

interface AdminTournamentRow extends TournamentRow {
  status: string;
  created_at: string;
  response_yes: number;
  response_maybe: number;
  response_no: number;
  eligible_members: number;
  announcements_sent: number;
  invitation_dms_sent: number;
  notifications_queued: number;
  notification_failures: number;
}

interface AdminResponseRow {
  tournament_id: string;
  response: string;
  display_name: string;
  updated_at: string;
}

export interface AdminTournament extends AdminTournamentRow {
  response_total: number;
  response_pending: number;
  responses: AdminResponseRow[];
}

export interface TournamentStatusUpdate {
  tournamentId: string;
  previousStatus: string;
  status: string;
  changed: boolean;
}

class AdminRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const MANAGEABLE_STATUSES = new Set([
  "draft",
  "active",
  "applied",
  "closed",
  "canceled",
]);

export async function listAdminTournaments(
  env: AdminEnv,
): Promise<AdminTournament[]> {
  const tournaments = await env.DB.prepare(
    `SELECT
      tournaments.tournament_id,
      tournaments.title,
      tournaments.event_start_date,
      tournaments.event_end_date,
      tournaments.grade,
      tournaments.tournament_type,
      tournaments.venue,
      tournaments.true_deadline,
      tournaments.internal_deadline,
      tournaments.document_url,
      tournaments.status,
      tournaments.created_at,
      (SELECT COUNT(*) FROM responses
        WHERE responses.tournament_id = tournaments.tournament_id
          AND responses.response = 'yes') AS response_yes,
      (SELECT COUNT(*) FROM responses
        WHERE responses.tournament_id = tournaments.tournament_id
          AND responses.response = 'maybe') AS response_maybe,
      (SELECT COUNT(*) FROM responses
        WHERE responses.tournament_id = tournaments.tournament_id
          AND responses.response = 'no') AS response_no,
      (SELECT COUNT(*) FROM members
        WHERE members.status = 'active'
          AND members.dm_enabled = 1
          AND members.grade = tournaments.grade
          AND members.discord_user_id IS NOT NULL) AS eligible_members,
      (SELECT COUNT(*) FROM notification_deliveries
        WHERE notification_deliveries.tournament_id = tournaments.tournament_id
          AND notification_deliveries.notification_type = 'announcement'
          AND notification_deliveries.status = 'sent') AS announcements_sent,
      (SELECT COUNT(*) FROM notification_deliveries
        WHERE notification_deliveries.tournament_id = tournaments.tournament_id
          AND notification_deliveries.notification_type = 'invitation_dm'
          AND notification_deliveries.status = 'sent') AS invitation_dms_sent,
      (SELECT COUNT(*) FROM notification_deliveries
        WHERE notification_deliveries.tournament_id = tournaments.tournament_id
          AND (
            notification_deliveries.status = 'pending'
            OR (
              notification_deliveries.status = 'failed'
              AND notification_deliveries.attempt_count < 5
            )
          )) AS notifications_queued,
      (SELECT COUNT(*) FROM notification_deliveries
        WHERE notification_deliveries.tournament_id = tournaments.tournament_id
          AND notification_deliveries.status = 'failed'
          AND notification_deliveries.attempt_count >= 5) AS notification_failures
    FROM tournaments
    WHERE tournaments.status <> 'deleted'
    ORDER BY tournaments.created_at DESC
    LIMIT 100`,
  ).all<AdminTournamentRow>();

  const responseRows = await env.DB.prepare(
    `SELECT
      responses.tournament_id,
      responses.response,
      members.display_name,
      responses.updated_at
    FROM responses
    INNER JOIN members ON members.member_id = responses.member_id
    INNER JOIN tournaments
      ON tournaments.tournament_id = responses.tournament_id
    WHERE tournaments.status <> 'deleted'
    ORDER BY responses.updated_at DESC`,
  ).all<AdminResponseRow>();

  const responsesByTournament = new Map<string, AdminResponseRow[]>();
  for (const response of responseRows.results) {
    const current = responsesByTournament.get(response.tournament_id) ?? [];
    current.push(response);
    responsesByTournament.set(response.tournament_id, current);
  }

  return tournaments.results.map((tournament) => {
    const responseTotal =
      Number(tournament.response_yes) +
      Number(tournament.response_maybe) +
      Number(tournament.response_no);
    return {
      ...tournament,
      response_yes: Number(tournament.response_yes),
      response_maybe: Number(tournament.response_maybe),
      response_no: Number(tournament.response_no),
      eligible_members: Number(tournament.eligible_members),
      announcements_sent: Number(tournament.announcements_sent),
      invitation_dms_sent: Number(tournament.invitation_dms_sent),
      notifications_queued: Number(tournament.notifications_queued),
      notification_failures: Number(tournament.notification_failures),
      response_total: responseTotal,
      response_pending: Math.max(
        Number(tournament.eligible_members) - responseTotal,
        0,
      ),
      responses: responsesByTournament.get(tournament.tournament_id) ?? [],
    };
  });
}

export async function updateTournamentStatus(
  env: AdminEnv,
  tournamentId: string,
  status: string,
  changedByEmail: string,
): Promise<TournamentStatusUpdate> {
  if (!/^T-[0-9a-f-]{36}$/.test(tournamentId)) {
    throw new AdminRequestError("大会IDが不正です。", 400);
  }
  if (!MANAGEABLE_STATUSES.has(status)) {
    throw new AdminRequestError("変更先のステータスが不正です。", 400);
  }

  const existing = await env.DB.prepare(
    `SELECT status FROM tournaments
     WHERE tournament_id = ? AND status <> 'deleted'`,
  )
    .bind(tournamentId)
    .first<{ status: string }>();
  if (!existing) {
    throw new AdminRequestError("対象の大会が見つかりません。", 404);
  }
  if (existing.status === status) {
    return {
      tournamentId,
      previousStatus: existing.status,
      status,
      changed: false,
    };
  }

  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE tournaments
       SET status = ?, updated_at = ?,
         applied_at = CASE WHEN ? = 'applied' THEN ? ELSE applied_at END
       WHERE tournament_id = ? AND status = ?`,
    ).bind(status, now, status, now, tournamentId, existing.status),
    env.DB.prepare(
      `INSERT INTO tournament_status_history (
        tournament_id, previous_status, new_status, changed_by_email, changed_at
      ) VALUES (?, ?, ?, ?, ?)`,
    ).bind(tournamentId, existing.status, status, changedByEmail, now),
  ]);

  return {
    tournamentId,
    previousStatus: existing.status,
    status,
    changed: true,
  };
}

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
  <title>大会管理 | 埼玉大学かるた会</title>
  <style>
    :root { color-scheme: light; font-family: system-ui, -apple-system, "Hiragino Sans", "Yu Gothic UI", sans-serif; color: #172033; background: #f4f6fa; }
    * { box-sizing: border-box; }
    body { margin: 0; }
    header { background: #293c74; color: white; padding: 18px 24px; box-shadow: 0 2px 8px #17203322; }
    header div { max-width: 1080px; margin: auto; display: flex; align-items: baseline; justify-content: space-between; gap: 16px; }
    h1 { margin: 0; font-size: 1.25rem; }
    h2 { margin: 0 0 20px; font-size: 1.15rem; }
    h3 { margin: 0; font-size: 1.05rem; }
    #identity { font-size: .82rem; opacity: .85; }
    main { max-width: 1080px; margin: 28px auto; padding: 0 18px 48px; }
    .notice { border-left: 4px solid #da8c10; background: #fff7e8; padding: 12px 16px; margin-bottom: 18px; line-height: 1.7; }
    .panel { background: white; border: 1px solid #dce1eb; border-radius: 12px; padding: 24px; box-shadow: 0 8px 24px #1720330c; }
    .panel + .panel { margin-top: 26px; }
    #tournament-form { margin-bottom: 26px; }
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
    button.secondary { padding: 9px 14px; color: #294796; background: #edf1ff; }
    button.secondary:hover { background: #dfe6ff; }
    #result { min-height: 1.5em; font-weight: 650; }
    #result.ok { color: #17643a; }
    #result.error { color: #b42318; }
    .footnote { margin-top: 16px; color: #697386; font-size: .84rem; line-height: 1.6; }
    .list-heading, .card-heading, .status-row { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
    #list-status { color: #697386; margin-bottom: 12px; }
    #tournament-list { display: grid; gap: 14px; }
    .tournament-card { border: 1px solid #dce1eb; border-radius: 10px; padding: 18px; }
    .meta { color: #596579; margin: 8px 0 14px; font-size: .88rem; line-height: 1.6; }
    .badge { display: inline-flex; align-items: center; border-radius: 999px; padding: 5px 10px; font-size: .78rem; font-weight: 750; white-space: nowrap; }
    .badge.active { color: #17643a; background: #e4f7ec; }
    .badge.applied { color: #2452a4; background: #e7efff; }
    .badge.closed { color: #596579; background: #edf0f5; }
    .badge.canceled { color: #a12822; background: #fdecea; }
    .badge.draft { color: #875c12; background: #fff2d8; }
    .stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin: 14px 0; }
    .stat { border-radius: 8px; padding: 10px; background: #f5f7fb; text-align: center; }
    .stat strong { display: block; font-size: 1.25rem; }
    .stat span { color: #697386; font-size: .78rem; }
    details { margin-top: 12px; border-top: 1px solid #e7eaf0; padding-top: 12px; }
    summary { cursor: pointer; font-weight: 700; }
    .response-groups { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-top: 12px; }
    .response-group { background: #f8f9fc; border-radius: 8px; padding: 10px; min-height: 72px; }
    .response-group strong { display: block; margin-bottom: 6px; font-size: .84rem; }
    .response-group div { color: #465166; font-size: .85rem; line-height: 1.6; }
    .status-row { margin-top: 15px; padding-top: 14px; border-top: 1px solid #e7eaf0; justify-content: flex-start; flex-wrap: wrap; }
    .status-row label { display: flex; align-items: center; gap: 9px; }
    .status-row select { width: auto; min-width: 145px; padding: 8px 10px; }
    .status-message { font-size: .84rem; font-weight: 650; }
    .status-message.error { color: #b42318; }
    .notification-note { color: #697386; font-size: .78rem; margin-top: 10px; }
    #member-status { color: #697386; margin-bottom: 12px; }
    #member-list { display: grid; gap: 12px; }
    .member-card { border: 1px solid #dce1eb; border-radius: 10px; padding: 16px; }
    .member-grid { display: grid; grid-template-columns: minmax(180px, 2fr) minmax(105px, .8fr) minmax(130px, 1fr) auto; gap: 12px; align-items: end; }
    .member-grid .checkbox { display: flex; align-items: center; gap: 8px; min-height: 42px; }
    .member-grid .checkbox input { width: auto; }
    .member-actions { display: flex; align-items: center; gap: 12px; margin-top: 12px; flex-wrap: wrap; }
    .member-link { color: #596579; font-size: .8rem; }
    .empty { color: #697386; text-align: center; padding: 30px 10px; }
    @media (max-width: 680px) { .grid, .response-groups, .member-grid { grid-template-columns: 1fr; } .stats { grid-template-columns: 1fr 1fr; } label.wide { grid-column: auto; } .panel { padding: 18px; } header div { display: block; } #identity { margin-top: 6px; } .card-heading { align-items: flex-start; } }
  </style>
</head>
<body>
  <header><div><h1>大会管理（Discord版MVP）</h1><span id="identity">認証情報を確認中…</span></div></header>
  <main>
    <div class="notice"><strong>テスト運用中です。</strong> 登録後1分以内を目安に告知チャンネルへ投稿し、該当級の登録済みメンバー全員へのDMをキューに登録します。送信失敗時は最大5回まで自動再送します。</div>
    <form id="tournament-form" class="panel">
      <h2>大会登録</h2>
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
    <section class="panel" aria-labelledby="tournament-list-title">
      <div class="list-heading">
        <h2 id="tournament-list-title">大会一覧・回答集計</h2>
        <button id="refresh-list" type="button" class="secondary">再読み込み</button>
      </div>
      <div id="list-status" role="status" aria-live="polite">読み込み中…</div>
      <div id="tournament-list"></div>
    </section>
    <section class="panel" aria-labelledby="member-list-title">
      <div class="list-heading">
        <h2 id="member-list-title">メンバー管理</h2>
        <button id="refresh-members" type="button" class="secondary">再読み込み</button>
      </div>
      <div id="member-status" role="status" aria-live="polite">読み込み中…</div>
      <div id="member-list"></div>
      <div class="footnote">Discord IDそのものは管理画面に表示しません。氏名・出場級・在籍状態・DM送信設定の変更履歴は管理者メールとともに保存されます。</div>
    </section>
  </main>
  <script>
    const form = document.querySelector('#tournament-form');
    const submit = document.querySelector('#submit');
    const result = document.querySelector('#result');
    const identity = document.querySelector('#identity');
    const tournamentList = document.querySelector('#tournament-list');
    const listStatus = document.querySelector('#list-status');
    const refreshList = document.querySelector('#refresh-list');
    const memberList = document.querySelector('#member-list');
    const memberStatus = document.querySelector('#member-status');
    const refreshMembers = document.querySelector('#refresh-members');
    const statusLabels = {
      draft: '下書き',
      active: '回答受付中',
      applied: '申込完了',
      closed: '締切済み',
      canceled: '中止',
    };
    const responseLabels = {
      yes: '参加',
      maybe: '未定',
      no: '不参加',
    };
    const memberStatusLabels = {
      active: '有効',
      inactive: '無効',
      pending: '確認待ち',
      rejected: '却下',
    };

    function element(tag, className, text) {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    }

    function gradeLabel(grade) {
      return grade === 'beginner' ? '初心者' : grade + '級';
    }

    function dateTimeLabel(value) {
      return new Intl.DateTimeFormat('ja-JP', {
        timeZone: 'Asia/Tokyo',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit',
      }).format(new Date(value));
    }

    function stat(label, count) {
      const item = element('div', 'stat');
      item.append(element('strong', '', String(count)), element('span', '', label));
      return item;
    }

    function responseGroup(tournament, response) {
      const group = element('div', 'response-group');
      group.append(element('strong', '', responseLabels[response]));
      const names = tournament.responses
        .filter((item) => item.response === response)
        .map((item) => item.display_name);
      group.append(element('div', '', names.length ? names.join('、') : 'なし'));
      return group;
    }

    function renderTournament(tournament) {
      const card = element('article', 'tournament-card');
      const heading = element('div', 'card-heading');
      heading.append(
        element('h3', '', tournament.title),
        element('span', 'badge ' + tournament.status, statusLabels[tournament.status] || tournament.status),
      );
      card.append(heading);

      const eventDates = tournament.event_start_date === tournament.event_end_date
        ? tournament.event_start_date
        : tournament.event_start_date + '〜' + tournament.event_end_date;
      const metaParts = [
        gradeLabel(tournament.grade),
        eventDates,
        'サークル内締切 ' + dateTimeLabel(tournament.internal_deadline),
      ];
      if (tournament.venue) metaParts.push(tournament.venue);
      const meta = element('div', 'meta', metaParts.join(' ／ '));
      card.append(meta);
      if (tournament.document_url) {
        const link = element('a', '', '大会要項を開く');
        link.href = tournament.document_url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        meta.append(document.createTextNode(' ／ '), link);
      }

      const stats = element('div', 'stats');
      stats.append(
        stat('参加', tournament.response_yes),
        stat('未定', tournament.response_maybe),
        stat('不参加', tournament.response_no),
        stat('未回答', tournament.response_pending),
      );
      card.append(stats);

      const details = document.createElement('details');
      details.append(element('summary', '', '回答者の内訳（回答 ' + tournament.response_total + ' / 対象 ' + tournament.eligible_members + '）'));
      const groups = element('div', 'response-groups');
      groups.append(
        responseGroup(tournament, 'yes'),
        responseGroup(tournament, 'maybe'),
        responseGroup(tournament, 'no'),
      );
      details.append(groups);
      card.append(details);

      const statusRow = element('div', 'status-row');
      const statusLabel = element('label', '', 'ステータス');
      const select = document.createElement('select');
      Object.entries(statusLabels).forEach(([value, label]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        option.selected = value === tournament.status;
        select.append(option);
      });
      statusLabel.append(select);
      const updateButton = element('button', 'secondary', '変更を保存');
      updateButton.type = 'button';
      const statusMessage = element('span', 'status-message', '');
      updateButton.addEventListener('click', async () => {
        updateButton.disabled = true;
        statusMessage.className = 'status-message';
        statusMessage.textContent = '変更中…';
        try {
          const response = await fetch('/api/tournaments/' + encodeURIComponent(tournament.tournament_id) + '/status', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: select.value }),
          });
          const body = await response.json();
          if (!response.ok) throw new Error(body.error || '変更に失敗しました。');
          statusMessage.textContent = body.changed ? '変更しました。' : '変更はありません。';
          await loadTournaments();
        } catch (error) {
          statusMessage.className = 'status-message error';
          statusMessage.textContent = error instanceof Error ? error.message : '変更に失敗しました。';
        } finally {
          updateButton.disabled = false;
        }
      });
      statusRow.append(statusLabel, updateButton, statusMessage);
      card.append(statusRow);

      const notificationParts = [
        '告知 ' + tournament.announcements_sent + '件',
        'DM ' + tournament.invitation_dms_sent + '件送信済み',
      ];
      if (tournament.notifications_queued) notificationParts.push('キュー・再送待ち ' + tournament.notifications_queued + '件');
      if (tournament.notification_failures) notificationParts.push('送信失敗 ' + tournament.notification_failures + '件');
      const notificationText = notificationParts.join('・');
      card.append(element('div', 'notification-note', notificationText));
      return card;
    }

    function renderMember(member) {
      const card = element('article', 'member-card');
      const grid = element('div', 'member-grid');
      const nameLabel = element('label', '', '氏名');
      const nameInput = document.createElement('input');
      nameInput.value = member.displayName;
      nameInput.maxLength = 50;
      nameLabel.append(nameInput);

      const gradeLabelNode = element('label', '', '出場級');
      const gradeSelect = document.createElement('select');
      ['A', 'B', 'C', 'D', 'E', 'F', 'beginner'].forEach((grade) => {
        const option = document.createElement('option');
        option.value = grade;
        option.textContent = gradeLabel(grade);
        option.selected = grade === member.grade;
        gradeSelect.append(option);
      });
      gradeLabelNode.append(gradeSelect);

      const statusLabel = element('label', '', '状態');
      const statusSelect = document.createElement('select');
      Object.entries(memberStatusLabels).forEach(([value, label]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        option.selected = value === member.status;
        statusSelect.append(option);
      });
      statusLabel.append(statusSelect);

      const dmLabel = element('label', 'checkbox');
      const dmCheckbox = document.createElement('input');
      dmCheckbox.type = 'checkbox';
      dmCheckbox.checked = member.dmEnabled;
      dmLabel.append(dmCheckbox, document.createTextNode('DMを送る'));
      grid.append(nameLabel, gradeLabelNode, statusLabel, dmLabel);
      card.append(grid);

      const actions = element('div', 'member-actions');
      const save = element('button', 'secondary', '変更を保存');
      save.type = 'button';
      const message = element('span', 'status-message', '');
      const linkState = element('span', 'member-link', member.discordLinked ? 'Discord連携済み' : 'Discord未連携');
      save.addEventListener('click', async () => {
        save.disabled = true;
        message.className = 'status-message';
        message.textContent = '変更中…';
        try {
          const response = await fetch('/api/members/' + encodeURIComponent(member.memberId), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              displayName: nameInput.value,
              grade: gradeSelect.value,
              status: statusSelect.value,
              dmEnabled: dmCheckbox.checked,
            }),
          });
          const body = await response.json();
          if (!response.ok) throw new Error(body.error || '変更に失敗しました。');
          message.textContent = '変更しました。';
          await loadMembers();
        } catch (error) {
          message.className = 'status-message error';
          message.textContent = error instanceof Error ? error.message : '変更に失敗しました。';
        } finally {
          save.disabled = false;
        }
      });
      actions.append(save, message, linkState);
      card.append(actions);
      return card;
    }

    async function loadTournaments() {
      refreshList.disabled = true;
      listStatus.textContent = '読み込み中…';
      try {
        const response = await fetch('/api/tournaments');
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || '大会一覧を取得できませんでした。');
        tournamentList.replaceChildren();
        if (!body.tournaments.length) {
          tournamentList.append(element('div', 'empty', '登録された大会はありません。'));
        } else {
          body.tournaments.forEach((tournament) => tournamentList.append(renderTournament(tournament)));
        }
        listStatus.textContent = body.tournaments.length + '件の大会';
      } catch (error) {
        listStatus.textContent = error instanceof Error ? error.message : '大会一覧を取得できませんでした。';
      } finally {
        refreshList.disabled = false;
      }
    }

    async function loadMembers() {
      refreshMembers.disabled = true;
      memberStatus.textContent = '読み込み中…';
      try {
        const response = await fetch('/api/members');
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'メンバー一覧を取得できませんでした。');
        memberList.replaceChildren();
        if (!body.members.length) {
          memberList.append(element('div', 'empty', '登録されたメンバーはいません。'));
        } else {
          body.members.forEach((member) => memberList.append(renderMember(member)));
        }
        const active = body.members.filter((member) => member.status === 'active').length;
        const dmEnabled = body.members.filter((member) => member.status === 'active' && member.dmEnabled).length;
        memberStatus.textContent = body.members.length + '人（有効 ' + active + '人・DM対象 ' + dmEnabled + '人）';
      } catch (error) {
        memberStatus.textContent = error instanceof Error ? error.message : 'メンバー一覧を取得できませんでした。';
      } finally {
        refreshMembers.disabled = false;
      }
    }

    function localJstToIso(value) {
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('締切日時を入力してください。');
      return new Date(value + ':00+09:00').toISOString();
    }

    function dateValue(date) {
      const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
      const get = (type) => parts.find((part) => part.type === type).value;
      return get('year') + '-' + get('month') + '-' + get('day');
    }

    const now = Date.now();
    form.elements.eventStartDate.value = dateValue(new Date(now + 14 * 86400000));
    form.elements.eventEndDate.value = form.elements.eventStartDate.value;
    form.elements.internalDeadline.value = dateValue(new Date(now + 7 * 86400000)) + 'T23:59';
    form.elements.trueDeadline.value = dateValue(new Date(now + 10 * 86400000)) + 'T23:59';
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
        await loadTournaments();
      } catch (error) {
        result.className = 'error';
        result.textContent = error instanceof Error ? error.message : '登録に失敗しました。';
      } finally {
        submit.disabled = false;
      }
    });
    refreshList.addEventListener('click', loadTournaments);
    refreshMembers.addEventListener('click', loadMembers);
    loadTournaments();
    loadMembers();
  </script>
</body>
</html>`;
}

export async function handleAdminRequest(
  request: Request,
  env: AdminEnv,
  ctx: AdminContext,
  creator: TournamentCreator = createTournament,
  lister: TournamentLister = listAdminTournaments,
  statusUpdater: TournamentStatusUpdater = updateTournamentStatus,
  memberLister: MemberLister = listAdminMembers,
  memberUpdater: MemberUpdater = updateAdminMember,
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

  if (request.method === "GET" && url.pathname === "/api/tournaments") {
    try {
      return json({ tournaments: await lister(env) });
    } catch (error: unknown) {
      console.error("大会一覧・回答集計の取得エラー", error);
      return json({ error: "大会一覧を取得できませんでした。" }, 500);
    }
  }

  if (request.method === "GET" && url.pathname === "/api/members") {
    try {
      return json({ members: await memberLister(env) });
    } catch (error: unknown) {
      console.error("メンバー一覧の取得エラー", error);
      return json({ error: "メンバー一覧を取得できませんでした。" }, 500);
    }
  }

  const memberPath = url.pathname.match(/^\/api\/members\/(M-[0-9a-f-]{36})$/);
  if (request.method === "PATCH" && memberPath) {
    if (!isSameOrigin(request)) {
      return json({ error: "不正な送信元です。" }, 403);
    }
    if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
      return json({ error: "JSON形式で送信してください。" }, 415);
    }

    let body: MemberUpdateInput;
    try {
      body = (await request.json()) as MemberUpdateInput;
    } catch {
      return json({ error: "入力内容を確認してください。" }, 400);
    }

    try {
      const member = await memberUpdater(env, memberPath[1], body, email);
      return json({ member });
    } catch (error: unknown) {
      if (error instanceof MemberAdminError) {
        return json({ error: error.message }, error.statusCode);
      }
      console.error("メンバー情報の変更エラー", error);
      return json({ error: "メンバー情報を変更できませんでした。" }, 500);
    }
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

  const statusPath = url.pathname.match(
    /^\/api\/tournaments\/(T-[0-9a-f-]{36})\/status$/,
  );
  if (request.method === "PATCH" && statusPath) {
    if (!isSameOrigin(request)) {
      return json({ error: "不正な送信元です。" }, 403);
    }
    if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
      return json({ error: "JSON形式で送信してください。" }, 415);
    }

    let status: string;
    try {
      const body = (await request.json()) as { status?: unknown };
      status = typeof body.status === "string" ? body.status : "";
      if (!MANAGEABLE_STATUSES.has(status)) {
        throw new AdminRequestError("変更先のステータスが不正です。", 400);
      }
    } catch (error: unknown) {
      const requestError =
        error instanceof AdminRequestError
          ? error
          : new AdminRequestError("入力内容を確認してください。", 400);
      return json({ error: requestError.message }, requestError.status);
    }

    try {
      return json(
        await statusUpdater(env, statusPath[1], status, email),
      );
    } catch (error: unknown) {
      if (error instanceof AdminRequestError) {
        return json({ error: error.message }, error.status);
      }
      console.error("大会ステータス変更エラー", error);
      return json({ error: "ステータスを変更できませんでした。" }, 500);
    }
  }

  return json({ error: "Not Found" }, 404);
}

export default {
  fetch(request: Request, env: AdminEnv, ctx: ExecutionContext): Promise<Response> {
    return handleAdminRequest(request, env, ctx);
  },
} satisfies ExportedHandler<AdminEnv>;
