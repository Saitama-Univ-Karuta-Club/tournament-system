import { answerTabHtml, answerTabScript } from "./answer-tab";
import { practiceTabHtml, practiceTabScript } from "./practice-tab";
import { profileTabHtml, profileTabScript } from "./profile-tab";
import { portalStyles } from "./styles";
import { tournamentTabHtml, tournamentTabScript } from "./tournament-tab";

const commonPortalScript = String.raw`
const responseLabels={yes:'参加希望',maybe:'未定・条件付き',no:'不参加'};
const statusLabels={registration_open:'回答受付中',application_pending:'申込対応中',application_complete:'申込完了',pre_lottery:'抽選前',confirmed:'参加者確定',archive:'大会記録',no_participants:'参加者なし終了',canceled:'中止'};
const entryStatusLabels={submitted:'申込済み（結果待ち）',selected:'出場確定',not_selected:'キャンセル待ち',withdrawn:'辞退'};
const gradeLabels={beginner:'初心者',all:'すべて'};
const rankLabels=['無段','初段','二段','三段','四段','五段','六段','七段','八段','九段','十段'];
const typeLabels={official:'公認大会',support:'後援大会',event:'イベント'};
let tournaments=[];
let profile=null;
let practice=null;
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const grade=value=>gradeLabels[value]||value+'級';
const date=value=>new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'numeric',day:'numeric',weekday:'short'}).format(new Date(value+'T00:00:00+09:00'));
const dateTime=value=>new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(value));
async function api(path,options={}){const response=await fetch(path,{...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...options.headers}});if(!response.ok){const body=await response.json().catch(()=>({}));throw Object.assign(new Error(body.error||'通信に失敗しました。'),{status:response.status});}return response.json();}
`;

const portalBootstrapScript = String.raw`
function render(){renderPaymentAlert();renderAnswers();renderTournamentList();renderDocumentIndex();renderArchives();renderProfile();renderPractice()}
let toastTimer;function showToast(text){const toast=document.querySelector('#toast');toast.textContent=text;toast.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{toast.hidden=true},2600)}
let selectedInfoView='tournaments';
function selectInfoView(name,updateHash=true){const selected=['documents','archive'].includes(name)?name:'tournaments';selectedInfoView=selected;document.querySelectorAll('.subtab').forEach(tab=>tab.setAttribute('aria-selected',String(tab.dataset.view===selected)));document.querySelector('#tournaments-panel').hidden=selected!=='tournaments';document.querySelector('#documents-panel').hidden=selected!=='documents';document.querySelector('#archive-panel').hidden=selected!=='archive';if(updateHash)history.replaceState(null,'','#'+selected)}
function selectTab(name,updateHash=true){const infoView=['tournaments','documents','archive'].includes(name)?name:null;const selected=infoView||name==='info'?'info':name==='profile'?'profile':name==='practice'?'practice':'answer';document.querySelectorAll('.tab').forEach(tab=>tab.setAttribute('aria-selected',String(tab.dataset.tab===selected)));document.querySelector('#answer-panel').hidden=selected!=='answer';document.querySelector('#info-panel').hidden=selected!=='info';document.querySelector('#profile-panel').hidden=selected!=='profile';document.querySelector('#practice-panel').hidden=selected!=='practice';if(selected==='info')selectInfoView(infoView||selectedInfoView,updateHash);else if(updateHash)history.replaceState(null,'','#'+selected)}
let refreshing=false;async function refreshTournaments(){if(refreshing)return;refreshing=true;try{const data=await api('/api/tournaments');tournaments=data.tournaments;render()}catch(error){console.error('大会情報の再読み込みに失敗しました。',error)}finally{refreshing=false}}
async function start(){try{const session=await api('/api/session');document.querySelector('#account').hidden=false;document.querySelector('#account-name').textContent=session.member.display_name;document.querySelector('#welcome').textContent=session.member.display_name+'さん';const [tournamentData,profileData,practiceData]=await Promise.all([api('/api/tournaments'),api('/api/profile'),api('/api/practice')]);tournaments=tournamentData.tournaments;profile=profileData.profile;practice=practiceData;document.querySelector('#loading').hidden=true;document.querySelector('#app').hidden=false;render();selectTab(location.hash.slice(1),false)}catch(error){document.querySelector('#loading').hidden=true;if(error.status===401){document.querySelector('#login').hidden=false}else{const fatal=document.querySelector('#fatal');fatal.hidden=false;fatal.textContent=error.message}}}
document.querySelectorAll('.tab').forEach(tab=>tab.addEventListener('click',()=>selectTab(tab.dataset.tab)));document.querySelectorAll('.subtab').forEach(tab=>tab.addEventListener('click',()=>selectInfoView(tab.dataset.view)));window.addEventListener('hashchange',()=>selectTab(location.hash.slice(1),false));window.addEventListener('focus',refreshTournaments);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshTournaments()});document.querySelector('#answer-status-filter').addEventListener('change',renderAnswers);document.querySelector('#status-filter').addEventListener('change',renderTournamentList);document.querySelector('#sort').addEventListener('change',renderTournamentList);document.querySelector('#document-search').addEventListener('input',renderDocumentIndex);document.querySelector('#document-sort').addEventListener('change',renderDocumentIndex);start();
`;

export function portalHtml(environment?: string): string {
  const isDevelopment = environment === "development";
  const portalName = "埼玉大学かるた会 メンバーポータル";
  const pageHeading = isDevelopment ? "大会参加確認（開発版）" : "大会参加確認";
  const pageTitle = isDevelopment
    ? "大会参加確認（開発版）｜埼玉大学かるた会"
    : "大会参加確認｜埼玉大学かるた会";
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#273e7a">
  <title>${pageTitle}</title>
  <style>${portalStyles}</style>
</head>
<body>
  <header><div class="header-inner"><div class="brand"><h1>${pageHeading}</h1><p>${portalName}</p></div><div class="account" id="account" hidden><span id="account-name"></span><a href="/auth/logout">ログアウト</a></div></div></header>
  <main>
    <section class="login" id="login" hidden><h2>Discordでログイン</h2><p>承認済みメンバーだけが大会情報・参加希望者・大会要項を閲覧し、参加回答を変更できます。</p><a class="discord-button" href="/auth/discord"><span class="discord-mark">◈</span>Discordで続ける</a></section>
    <div id="app" hidden>
      <div class="welcome"><h2 id="welcome"></h2><p>回答はDiscordとWebで共通です。最後に保存した回答が反映されます。</p></div>
      <aside class="payment-alert" id="payment-alert" role="alert" hidden></aside>
      <nav class="tabs" role="tablist" aria-label="メンバーポータルの表示切替"><button class="tab" id="answer-tab" role="tab" aria-selected="true" aria-controls="answer-panel" data-tab="answer">参加回答<span class="tab-count" id="unanswered-count" hidden></span></button><button class="tab" id="info-tab" role="tab" aria-selected="false" aria-controls="info-panel" data-tab="info">大会情報</button><button class="tab" id="practice-tab" role="tab" aria-selected="false" aria-controls="practice-panel" data-tab="practice">練習</button><button class="tab" id="profile-tab" role="tab" aria-selected="false" aria-controls="profile-panel" data-tab="profile">マイページ</button></nav>
      ${answerTabHtml}
      ${tournamentTabHtml}
      ${profileTabHtml}
      ${practiceTabHtml}
    </div>
    <div class="loading" id="loading">大会情報を読み込んでいます…</div>
    <div class="fatal" id="fatal" hidden></div>
    <div class="toast" id="toast" role="status" aria-live="polite" hidden></div>
  </main>
  <script>
    ${commonPortalScript}
    ${tournamentTabScript}
    ${answerTabScript}
    ${profileTabScript}
    ${practiceTabScript}
    ${portalBootstrapScript}
  </script>
</body>
</html>`;
}

export function googleBackupInformationHtml(page: "home" | "privacy"): string {
  const privacyUrl = "/google-backup/privacy";
  const homeUrl = "/google-backup";
  const content = page === "home"
    ? `<h1>大会システム Google Driveバックアップ</h1>
      <p>埼玉大学かるた会が運用する大会管理システムのバックアップ機能です。</p>
      <h2>機能</h2>
      <p>大会情報データベースのバックアップと、システムへアップロードされた大会要項・選手名簿・大会結果などのファイルを、サークルが管理するGoogle Driveへ定期的に保存します。</p>
      <h2>Google Driveへのアクセス</h2>
      <p>この機能は、バックアップ用フォルダとファイルを作成・更新・整理するためにGoogle Drive APIを使用します。アクセス権限は、このアプリが作成または明示的に扱うファイルに限定され、Google Drive内の無関係なファイルは読み取りません。</p>
      <p><a class="button" href="${privacyUrl}">プライバシーポリシーを確認</a></p>`
    : `<h1>プライバシーポリシー</h1>
      <p>このページは、埼玉大学かるた会の大会システムにおけるGoogle Driveバックアップ機能のデータ取扱方針を説明します。</p>
      <h2>取得・利用する情報</h2>
      <p>Google OAuthを通じて、Google Drive上にバックアップ用のフォルダとファイルを作成し、このアプリが作成したファイルを確認・更新・整理する権限を利用します。</p>
      <h2>利用目的</h2>
      <p>Cloudflare上で運用する大会情報データベースと、大会システムへアップロードされた文書の障害・誤操作対策用バックアップを作成する目的にのみ利用します。</p>
      <h2>保存と共有</h2>
      <p>バックアップは、認証を許可したサークル管理のGoogle Driveに保存します。法令に基づく場合を除き、Googleユーザーデータを第三者へ販売または提供しません。OAuth認証情報は公開コードやデータベースへ保存せず、Cloudflareの暗号化されたSecretとして管理します。</p>
      <h2>保存期間</h2>
      <p>データベースの世代バックアップは原則365日間保持します。期限を過ぎたバックアップはGoogle Driveのゴミ箱へ移動します。文書のバックアップは、大会記録を保全するため必要な期間保持します。</p>
      <h2>権限の解除</h2>
      <p>Googleアカウントの「サードパーティ製のアプリとサービス」から、いつでもこのアプリのアクセス権を解除できます。解除後は新しいバックアップを作成できなくなります。</p>
      <h2>お問い合わせ</h2>
      <p>本機能に関する問い合わせは、埼玉大学かるた会の大会担当者へお寄せください。</p>
      <p><a href="${homeUrl}">アプリ説明へ戻る</a></p>`;

  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="index,follow">
  <title>${page === "home" ? "Google Driveバックアップ" : "プライバシーポリシー"}｜埼玉大学かるた会</title>
  <style>
    *{box-sizing:border-box}body{margin:0;background:#f3f6fb;color:#17213a;font-family:Inter,"Noto Sans JP",system-ui,-apple-system,sans-serif;line-height:1.8}
    header{background:linear-gradient(135deg,#253b73,#365499);color:#fff;padding:20px}.brand{max-width:760px;margin:auto;font-weight:800}
    main{max-width:760px;margin:32px auto 64px;padding:0 18px}.card{background:#fff;border:1px solid #dbe2ef;border-radius:18px;padding:clamp(22px,5vw,38px);box-shadow:0 8px 28px #27396610}
    h1{margin:0 0 18px;font-size:clamp(1.45rem,4vw,2rem);line-height:1.4}h2{margin:28px 0 6px;font-size:1.08rem}p{margin:8px 0;color:#34405a}
    a{color:#344f9d;font-weight:750}.button{display:inline-block;margin-top:12px;padding:10px 15px;border-radius:9px;background:#425ba8;color:#fff;text-decoration:none}
  </style>
</head>
<body>
  <header><div class="brand">埼玉大学かるた会 大会システム</div></header>
  <main><article class="card">${content}</article></main>
</body>
</html>`;
}
