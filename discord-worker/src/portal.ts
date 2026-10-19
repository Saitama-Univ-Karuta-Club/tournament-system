const RESPONSE_LABELS = {
  yes: "参加希望",
  maybe: "未定・条件付き",
  no: "不参加",
} as const;

type ResponseValue = keyof typeof RESPONSE_LABELS;

export interface PortalEnv {
  DB: D1Database;
  DOCUMENTS?: R2Bucket;
  DISCORD_APPLICATION_ID?: string;
  DISCORD_CLIENT_SECRET?: string;
  DISCORD_REDIRECT_URI?: string;
  SESSION_SECRET?: string;
}

interface SessionPayload {
  memberId: string;
  discordUserId: string;
  issuedAt: number;
  expiresAt: number;
}

interface PortalMemberRow {
  member_id: string;
  discord_user_id: string;
  display_name: string;
  display_name_kana: string;
  grade: string;
  rank: number;
  status: string;
}

interface PortalTournamentRow {
  tournament_id: string;
  registration_group_id: string | null;
  title: string;
  event_start_date: string;
  grade: string;
  all_grades: number;
  tournament_type: string;
  venue: string | null;
  true_deadline: string;
  internal_deadline: string;
  document_url: string | null;
  status: string;
  closure_reason: string | null;
  created_at: string;
  eligible: number;
  own_response: ResponseValue | null;
  own_entry_status: string | null;
  own_waitlist_number: number | null;
  archive_published_at: string | null;
}

interface ParticipantRow {
  tournament_id: string;
  display_name: string;
  display_name_kana: string;
  grade: string;
  entry_status: string | null;
  waitlist_number: number | null;
  payment_status: "unpaid" | "paid" | null;
  result_text: string | null;
}

interface PortalArchiveDocumentRow {
  group_key: string;
  document_type: "roster" | "results";
  file_name: string;
}

interface DiscordTokenResponse {
  access_token?: string;
  token_type?: string;
}

interface DiscordUserResponse {
  id?: string;
}

const SESSION_COOKIE = "__Host-sukc_portal_session";
const OAUTH_STATE_COOKIE = "__Host-sukc_oauth_state";
const OAUTH_VERIFIER_COOKIE = "__Host-sukc_oauth_verifier";
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const SESSION_REFRESH_THRESHOLD_SECONDS = 7 * 24 * 60 * 60;
const OAUTH_COOKIE_SECONDS = 10 * 60;
const SAFE_TOURNAMENT_ID = /^T-[0-9a-f-]{36}$/;

const securityHeaders: Record<string, string> = {
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https://cdn.discordapp.com",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self' https://discord.com",
  ].join("; "),
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(body, {
    status,
    headers: { ...securityHeaders, "Cache-Control": "no-store", ...headers },
  });
}

function utf8ToBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToUtf8(value: string): string {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function hmac(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return bytesToBase64Url(
    new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value))),
  );
}

function randomBase64Url(byteLength = 32): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

function parseCookies(request: Request): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const entry of (request.headers.get("Cookie") ?? "").split(";")) {
    const separator = entry.indexOf("=");
    if (separator < 1) continue;
    cookies.set(entry.slice(0, separator).trim(), entry.slice(separator + 1).trim());
  }
  return cookies;
}

function cookie(name: string, value: string, maxAge: number): string {
  return `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

async function createSession(payload: SessionPayload, secret: string): Promise<string> {
  const encoded = utf8ToBase64Url(JSON.stringify(payload));
  return `${encoded}.${await hmac(encoded, secret)}`;
}

async function readSession(request: Request, secret: string): Promise<SessionPayload | null> {
  const raw = parseCookies(request).get(SESSION_COOKIE);
  if (!raw) return null;
  const [encoded, signature, extra] = raw.split(".");
  if (!encoded || !signature || extra) return null;
  const expected = await hmac(encoded, secret);
  if (signature.length !== expected.length) return null;
  let difference = 0;
  for (let index = 0; index < signature.length; index += 1) {
    difference |= signature.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  if (difference !== 0) return null;
  try {
    const payload = JSON.parse(base64UrlToUtf8(encoded)) as SessionPayload;
    if (
      !/^M-[0-9a-f-]{36}$/.test(payload.memberId) ||
      !/^\d{15,22}$/.test(payload.discordUserId) ||
      !Number.isFinite(payload.expiresAt) ||
      payload.expiresAt <= Math.floor(Date.now() / 1000)
    ) return null;
    return payload;
  } catch {
    return null;
  }
}

async function loadSessionMember(
  request: Request,
  env: PortalEnv,
): Promise<{ member: PortalMemberRow; session: SessionPayload } | null> {
  if (!env.SESSION_SECRET) return null;
  const session = await readSession(request, env.SESSION_SECRET);
  if (!session) return null;
  const member = await env.DB.prepare(
    `SELECT member_id, discord_user_id, display_name, display_name_kana,
            grade, rank, status
     FROM members
     WHERE member_id = ? AND discord_user_id = ? AND status = 'active'
     LIMIT 1`,
  ).bind(session.memberId, session.discordUserId).first<PortalMemberRow>();
  return member ? { member, session } : null;
}

async function refreshedSessionCookie(
  session: SessionPayload,
  secret: string | undefined,
): Promise<string | undefined> {
  if (!secret) return undefined;
  const now = Math.floor(Date.now() / 1000);
  if (session.expiresAt - now > SESSION_REFRESH_THRESHOLD_SECONDS) {
    return undefined;
  }
  const refreshed = await createSession({
    memberId: session.memberId,
    discordUserId: session.discordUserId,
    issuedAt: now,
    expiresAt: now + SESSION_SECONDS,
  }, secret);
  return cookie(SESSION_COOKIE, refreshed, SESSION_SECONDS);
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("Origin");
  return Boolean(origin && origin === new URL(request.url).origin);
}

async function beginDiscordLogin(request: Request, env: PortalEnv): Promise<Response> {
  if (!env.DISCORD_APPLICATION_ID || !env.DISCORD_REDIRECT_URI) {
    return json({ error: "Discordログイン設定が完了していません。" }, 503);
  }
  const state = randomBase64Url();
  const verifier = randomBase64Url(48);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const authorizeUrl = new URL("https://discord.com/oauth2/authorize");
  authorizeUrl.search = new URLSearchParams({
    response_type: "code",
    client_id: env.DISCORD_APPLICATION_ID,
    scope: "identify",
    redirect_uri: env.DISCORD_REDIRECT_URI,
    state,
    code_challenge: bytesToBase64Url(new Uint8Array(digest)),
    code_challenge_method: "S256",
  }).toString();
  const headers = new Headers({ Location: authorizeUrl.toString(), ...securityHeaders });
  headers.append("Set-Cookie", cookie(OAUTH_STATE_COOKIE, state, OAUTH_COOKIE_SECONDS));
  headers.append("Set-Cookie", cookie(OAUTH_VERIFIER_COOKIE, verifier, OAUTH_COOKIE_SECONDS));
  return new Response(null, { status: 302, headers });
}

async function finishDiscordLogin(
  request: Request,
  env: PortalEnv,
  ctx: Pick<ExecutionContext, "waitUntil">,
): Promise<Response> {
  if (
    !env.DISCORD_APPLICATION_ID ||
    !env.DISCORD_CLIENT_SECRET ||
    !env.DISCORD_REDIRECT_URI ||
    !env.SESSION_SECRET
  ) return json({ error: "Discordログイン設定が完了していません。" }, 503);

  const url = new URL(request.url);
  const cookies = parseCookies(request);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const issuer = url.searchParams.get("iss");
  if (
    !state ||
    !code ||
    state !== cookies.get(OAUTH_STATE_COOKIE) ||
    !cookies.get(OAUTH_VERIFIER_COOKIE) ||
    (issuer && issuer !== "https://discord.com")
  ) return json({ error: "Discordログインを確認できませんでした。最初からやり直してください。" }, 400);

  const tokenResponse = await fetch("https://discord.com/api/v10/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: env.DISCORD_APPLICATION_ID,
      client_secret: env.DISCORD_CLIENT_SECRET,
      redirect_uri: env.DISCORD_REDIRECT_URI,
      code_verifier: cookies.get(OAUTH_VERIFIER_COOKIE)!,
    }),
  });
  if (!tokenResponse.ok) {
    console.error("Discord OAuth token exchange failed", tokenResponse.status);
    return json({ error: "Discordログインに失敗しました。" }, 502);
  }
  const token = await tokenResponse.json<DiscordTokenResponse>();
  if (!token.access_token) return json({ error: "Discordログインに失敗しました。" }, 502);

  const userResponse = await fetch("https://discord.com/api/v10/users/@me", {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  if (!userResponse.ok) return json({ error: "Discordユーザーを確認できませんでした。" }, 502);
  const discordUser = await userResponse.json<DiscordUserResponse>();
  if (!discordUser.id || !/^\d{15,22}$/.test(discordUser.id)) {
    return json({ error: "Discordユーザーを確認できませんでした。" }, 502);
  }

  const member = await env.DB.prepare(
    `SELECT member_id, discord_user_id, display_name, display_name_kana,
            grade, rank, status
     FROM members
     WHERE discord_user_id = ? AND status = 'active'
     LIMIT 1`,
  ).bind(discordUser.id).first<PortalMemberRow>();
  if (!member) {
    return memberOnlyPage();
  }

  const now = Math.floor(Date.now() / 1000);
  const session = await createSession({
    memberId: member.member_id,
    discordUserId: member.discord_user_id,
    issuedAt: now,
    expiresAt: now + SESSION_SECONDS,
  }, env.SESSION_SECRET);
  const headers = new Headers({ Location: "/", ...securityHeaders });
  headers.append("Set-Cookie", cookie(SESSION_COOKIE, session, SESSION_SECONDS));
  headers.append("Set-Cookie", cookie(OAUTH_STATE_COOKIE, "", 0));
  headers.append("Set-Cookie", cookie(OAUTH_VERIFIER_COOKIE, "", 0));
  return new Response(null, { status: 302, headers });
}

function memberOnlyPage(): Response {
  const html = `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>メンバー登録が必要です</title><style>body{margin:0;background:#f4f6fb;color:#17213a;font-family:system-ui,sans-serif}.card{max-width:560px;margin:12vh auto;background:#fff;border:1px solid #dbe2f0;border-radius:18px;padding:32px;box-shadow:0 14px 40px #27396614}h1{font-size:1.45rem}p{line-height:1.8}.button{display:inline-block;margin-top:10px;padding:12px 18px;border-radius:10px;background:#425ba8;color:#fff;text-decoration:none;font-weight:700}</style><main class="card"><h1>承認済みメンバーを確認できませんでした</h1><p>Discordで <code>/member-register</code> を実行し、担当者の承認後にもう一度ログインしてください。すでに登録済みの場合は、担当者へお問い合わせください。</p><a class="button" href="/auth/discord">もう一度ログイン</a></main></html>`;
  return new Response(html, {
    status: 403,
    headers: { ...securityHeaders, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

async function listPortalTournaments(env: PortalEnv, member: PortalMemberRow): Promise<unknown> {
  const tournaments = await env.DB.prepare(
    `SELECT
      tournaments.tournament_id,
      tournaments.registration_group_id,
      tournaments.title,
      tournaments.event_start_date,
      tournaments.grade,
      tournaments.all_grades,
      tournaments.tournament_type,
      tournaments.venue,
      tournaments.true_deadline,
      tournaments.internal_deadline,
      tournaments.document_url,
      tournaments.status,
      tournaments.closure_reason,
      tournaments.archive_published_at,
      tournaments.created_at,
      CASE WHEN tournaments.all_grades = 1 OR tournaments.grade = ? THEN 1 ELSE 0 END AS eligible,
      (SELECT responses.response
       FROM responses
       WHERE responses.tournament_id = tournaments.tournament_id
         AND responses.member_id = ?
         AND responses.is_valid = 1
       LIMIT 1) AS own_response,
      (SELECT tournament_entries.status
       FROM tournament_entries
       WHERE tournament_entries.tournament_id = tournaments.tournament_id
         AND tournament_entries.member_id = ?
       LIMIT 1) AS own_entry_status,
      (SELECT tournament_entries.waitlist_number
       FROM tournament_entries
       WHERE tournament_entries.tournament_id = tournaments.tournament_id
         AND tournament_entries.member_id = ?
       LIMIT 1) AS own_waitlist_number
     FROM tournaments
     WHERE tournaments.status NOT IN ('draft', 'deleted')
     ORDER BY tournaments.internal_deadline ASC, tournaments.event_start_date ASC`,
  ).bind(
    member.grade,
    member.member_id,
    member.member_id,
    member.member_id,
  ).all<PortalTournamentRow>();

  const participants = await env.DB.prepare(
    `SELECT
      responses.tournament_id,
      COALESCE(tournament_entries.archive_display_name, members.display_name) AS display_name,
      COALESCE(
        NULLIF(tournament_entries.archive_display_name_kana, ''),
        NULLIF(members.display_name_kana, ''),
        NULLIF(TRIM(members.last_name_kana || ' ' || members.first_name_kana), ''),
        ''
      ) AS display_name_kana,
      COALESCE(tournament_entries.archive_grade, members.grade) AS grade,
      tournament_entries.status AS entry_status,
      tournament_entries.waitlist_number,
      tournament_entry_payments.status AS payment_status,
      tournament_entries.result_text
     FROM responses
     INNER JOIN members ON members.member_id = responses.member_id
     INNER JOIN tournaments ON tournaments.tournament_id = responses.tournament_id
     LEFT JOIN tournament_entries
       ON tournament_entries.tournament_id = responses.tournament_id
      AND tournament_entries.member_id = responses.member_id
     LEFT JOIN tournament_entry_payments
       ON tournament_entry_payments.tournament_id = responses.tournament_id
      AND tournament_entry_payments.member_id = responses.member_id
     WHERE responses.response = 'yes'
       AND responses.is_valid = 1
       AND (members.status = 'active' OR tournaments.archive_published_at IS NOT NULL)
       AND tournaments.status NOT IN ('draft', 'deleted')
     ORDER BY members.grade, display_name_kana, members.display_name`,
  ).all<ParticipantRow>();

  const archiveDocuments = await env.DB.prepare(
    `SELECT tournament_archive_documents.group_key,
            tournament_archive_documents.document_type,
            tournament_archive_documents.file_name
     FROM tournament_archive_documents
     WHERE EXISTS (
       SELECT 1 FROM tournaments
       WHERE COALESCE(tournaments.registration_group_id, tournaments.tournament_id)
         = tournament_archive_documents.group_key
         AND tournaments.archive_published_at IS NOT NULL
     )
     ORDER BY tournament_archive_documents.document_type`,
  ).all<PortalArchiveDocumentRow>();

  const byTournament = new Map<string, ParticipantRow[]>();
  for (const participant of participants.results) {
    const current = byTournament.get(participant.tournament_id) ?? [];
    current.push(participant);
    byTournament.set(participant.tournament_id, current);
  }
  const documentsByGroup = new Map<string, PortalArchiveDocumentRow[]>();
  for (const document of archiveDocuments.results) {
    const current = documentsByGroup.get(document.group_key) ?? [];
    current.push(document);
    documentsByGroup.set(document.group_key, current);
  }
  return tournaments.results.map((tournament) => ({
    ...tournament,
    eligible: Number(tournament.eligible) === 1,
    all_grades: Number(tournament.all_grades),
    participants: byTournament.get(tournament.tournament_id) ?? [],
    has_document: Boolean(tournament.document_url),
    document_url: undefined,
    archive_documents: documentsByGroup.get(
      tournament.registration_group_id ?? tournament.tournament_id,
    ) ?? [],
  }));
}

async function saveWebResponse(
  env: PortalEnv,
  member: PortalMemberRow,
  tournamentId: string,
  response: unknown,
): Promise<ResponseValue> {
  if (!SAFE_TOURNAMENT_ID.test(tournamentId)) throw new PortalError("大会IDが不正です。", 400);
  if (
    typeof response !== "string" ||
    !Object.prototype.hasOwnProperty.call(RESPONSE_LABELS, response)
  ) {
    throw new PortalError("回答を選択してください。", 400);
  }
  const tournament = await env.DB.prepare(
    `SELECT tournament_id, internal_deadline
     FROM tournaments
     WHERE tournament_id = ?
       AND status = 'active'
       AND (all_grades = 1 OR grade = ?)
     LIMIT 1`,
  ).bind(tournamentId, member.grade).first<{ tournament_id: string; internal_deadline: string }>();
  if (!tournament) throw new PortalError("この大会への回答権限を確認できません。", 403);
  if (new Date(tournament.internal_deadline).getTime() < Date.now()) {
    throw new PortalError("サークル内締切を過ぎています。", 409);
  }
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO responses (
      tournament_id, member_id, response, source, is_valid, created_at, updated_at
    ) VALUES (?, ?, ?, 'web', 1, ?, ?)
    ON CONFLICT(tournament_id, member_id) DO UPDATE SET
      response = excluded.response,
      source = 'web',
      is_valid = 1,
      invalidated_at = NULL,
      invalidated_reason = NULL,
      updated_at = excluded.updated_at`,
  ).bind(tournamentId, member.member_id, response, now, now).run();
  return response as ResponseValue;
}

class PortalError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function r2KeyFromDocumentUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    const key = url.pathname.slice(1).split("/").map(decodeURIComponent).join("/");
    const parts = key.split("/");
    if (
      parts.length !== 3 ||
      parts[0] !== "documents" ||
      !/^[0-9a-f-]{36}$/i.test(parts[1]) ||
      !parts[2].toLowerCase().endsWith(".pdf")
    ) return null;
    return key;
  } catch {
    return null;
  }
}

async function servePortalDocument(
  env: PortalEnv,
  member: PortalMemberRow,
  tournamentId: string,
): Promise<Response> {
  if (!SAFE_TOURNAMENT_ID.test(tournamentId)) return new Response("Not Found", { status: 404 });
  const tournament = await env.DB.prepare(
    `SELECT document_url FROM tournaments
     WHERE tournament_id = ? AND status NOT IN ('draft', 'deleted')
     LIMIT 1`,
  ).bind(tournamentId).first<{ document_url: string | null }>();
  if (!tournament?.document_url) return new Response("Not Found", { status: 404 });
  return serveStoredDocumentUrl(env, tournament.document_url);
}

async function serveStoredDocumentUrl(
  env: PortalEnv,
  documentUrl: string,
): Promise<Response> {
  const key = r2KeyFromDocumentUrl(documentUrl);
  if (!key || !env.DOCUMENTS) {
    let external: URL;
    try {
      external = new URL(documentUrl);
    } catch {
      return new Response("Not Found", { status: 404 });
    }
    if (!['https:', 'http:'].includes(external.protocol)) return new Response("Not Found", { status: 404 });
    return new Response(null, { status: 302, headers: { ...securityHeaders, Location: external.toString() } });
  }
  const object = await env.DOCUMENTS.get(key);
  if (!object?.body) return new Response("Not Found", { status: 404 });
  const headers = new Headers({
    ...securityHeaders,
    "Cache-Control": "private, max-age=3600",
    "Content-Type": object.httpMetadata?.contentType ?? "application/pdf",
    "Content-Disposition": object.httpMetadata?.contentDisposition ?? "inline",
    ETag: object.httpEtag,
  });
  return new Response(object.body, { headers });
}

async function servePortalArchiveDocument(
  env: PortalEnv,
  groupKey: string,
  documentType: string,
): Promise<Response> {
  if (!/^(?:T|TG)-[0-9a-f-]{36}$/.test(groupKey)) {
    return new Response("Not Found", { status: 404 });
  }
  if (documentType !== "roster" && documentType !== "results") {
    return new Response("Not Found", { status: 404 });
  }
  const document = await env.DB.prepare(
    `SELECT tournament_archive_documents.document_url
     FROM tournament_archive_documents
     WHERE tournament_archive_documents.group_key = ?
       AND tournament_archive_documents.document_type = ?
       AND EXISTS (
         SELECT 1 FROM tournaments
         WHERE COALESCE(tournaments.registration_group_id, tournaments.tournament_id) = ?
           AND tournaments.archive_published_at IS NOT NULL
       )
     LIMIT 1`,
  ).bind(groupKey, documentType, groupKey).first<{ document_url: string }>();
  if (!document?.document_url) return new Response("Not Found", { status: 404 });
  return serveStoredDocumentUrl(env, document.document_url);
}

function portalHtml(): string {
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#273e7a">
  <title>大会参加確認｜埼玉大学かるた会</title>
  <style>
    :root{color-scheme:light;--navy:#253b73;--blue:#4262ad;--ink:#17213a;--muted:#67738d;--line:#dbe2ef;--bg:#f3f6fb;--card:#fff;--yes:#16734a;--maybe:#a2600b;--no:#8b3141}
    *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:Inter,"Noto Sans JP",system-ui,-apple-system,sans-serif;line-height:1.6}
    header{background:linear-gradient(135deg,#253b73,#365499);color:#fff;padding:22px 20px;box-shadow:0 4px 18px #2035672b}.header-inner{max-width:1040px;margin:auto;display:flex;align-items:center;justify-content:space-between;gap:18px}.brand h1{font-size:clamp(1.2rem,3vw,1.65rem);margin:0}.brand p{margin:2px 0 0;color:#dce5ff;font-size:.88rem}.account{display:flex;align-items:center;gap:12px;font-size:.9rem}.account a{color:#fff;text-decoration:none;border:1px solid #ffffff55;padding:6px 10px;border-radius:8px}
    main{max-width:1040px;margin:24px auto 64px;padding:0 18px}.login{max-width:620px;margin:10vh auto;background:#fff;border:1px solid var(--line);border-radius:22px;padding:38px;box-shadow:0 18px 50px #27396618;text-align:center}.login h2{font-size:1.55rem;margin:0 0 12px}.login p{color:var(--muted);margin:0 auto 24px;max-width:480px}.discord-button{display:inline-flex;align-items:center;gap:10px;background:#5865f2;color:#fff;text-decoration:none;font-weight:800;padding:13px 20px;border-radius:11px}.discord-mark{font-size:1.25rem}
    .welcome{margin-bottom:18px}.welcome h2{margin:0;font-size:1.25rem}.welcome p{margin:2px 0 0;color:var(--muted);font-size:.9rem}.tabs{display:flex;gap:6px;border-bottom:1px solid var(--line);margin-bottom:20px;padding:0 5px}.tab{position:relative;appearance:none;border:0;background:transparent;color:var(--muted);font:inherit;font-weight:800;padding:11px 18px 12px;cursor:pointer}.tab[aria-selected="true"]{color:var(--navy)}.tab[aria-selected="true"]::after{content:"";position:absolute;left:8px;right:8px;bottom:-1px;height:3px;border-radius:3px 3px 0 0;background:var(--blue)}.tab-count{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;margin-left:6px;padding:0 6px;border-radius:999px;background:#bb332d;color:#fff;font-size:.72rem}.panel[hidden]{display:none}.notice{background:#eef3ff;border-left:4px solid var(--blue);padding:12px 15px;border-radius:4px 10px 10px 4px;margin-bottom:18px;font-size:.9rem}
    .toolbar{display:flex;flex-wrap:wrap;align-items:end;justify-content:flex-end;gap:14px;margin-bottom:14px}.filters{display:flex;gap:10px;flex-wrap:wrap}.filters label{font-size:.78rem;color:var(--muted);font-weight:700}.filters select{display:block;margin-top:3px;border:1px solid #cbd5e6;background:#fff;border-radius:9px;padding:8px 34px 8px 10px;color:var(--ink)}.list{display:grid;gap:14px}.card{background:var(--card);border:1px solid var(--line);border-radius:17px;padding:18px;box-shadow:0 5px 18px #2739660b}.card-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px}.title-row{display:flex;align-items:center;flex-wrap:wrap;gap:8px}.title{font-size:1.08rem;font-weight:850;margin:0}.status{font-size:.72rem;font-weight:800;padding:4px 9px;border-radius:999px;background:#edf1f7;color:#536079;white-space:nowrap}.status.active{background:#e0f5e9;color:#12653f}.status.applied{background:#e8edff;color:#344f9d}.status.no_participants{background:#fff1d6;color:#6f4b12}.status.canceled{background:#f8e8eb;color:#8b3141}.status.answered{background:#e8edff;color:#344f9d}.status.pending{background:#edf1f7;color:#536079}.count{display:inline-flex;align-items:center;justify-content:center;min-width:48px;padding:5px 12px;border-radius:999px;background:#e8edff;color:#344f9d;font-size:.82rem;font-weight:850}.meta{display:flex;flex-wrap:wrap;gap:4px 16px;color:var(--muted);font-size:.88rem;margin:8px 0 13px}.meta span{display:inline-flex;gap:5px}.info-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:13px 0 16px}.info-cell{border:1px solid #dbe2ef;border-radius:10px;padding:9px 12px;background:#fff}.info-label{display:block;color:var(--muted);font-size:.76rem;margin-bottom:2px}.info-value{font-size:.92rem;font-weight:650}.info-value a{color:#344f9d;font-weight:800}.grade-dates{display:grid;gap:5px;background:#f7f9fd;border-radius:10px;padding:10px 12px;margin:10px 0;font-size:.88rem}.grade-date{display:flex;justify-content:space-between;gap:14px}.section-title{font-size:.86rem;font-weight:850;margin:13px 0 6px}.participants{margin:0;padding:0;list-style:none;display:grid;gap:4px;font-size:.9rem}.participants li{display:grid;grid-template-columns:4.4em 1fr;gap:8px}.participants li.empty{display:block;white-space:nowrap}.participants small{color:var(--muted)}.empty{color:#8a94a9;font-size:.88rem}.document{display:inline-flex;align-items:center;gap:6px;color:#344f9d;font-weight:800;text-decoration:none;font-size:.9rem}.answer-area{margin-top:6px}.answer-label{display:block;font-size:.9rem;font-weight:850;margin-bottom:8px}.buttons{display:flex;gap:8px;flex-wrap:wrap}.answer{appearance:none;border:1px solid #cbd4e4;background:#fff;color:var(--ink);font-weight:750;border-radius:9px;padding:8px 13px;cursor:pointer;box-shadow:none}.answer:hover{border-color:var(--blue);background:#f1f5ff}.answer.selected.yes{background:#dff4e9;border-color:#80c6a3;color:var(--yes)}.answer.selected.maybe{background:#fff0d8;border-color:#e7bb75;color:var(--maybe)}.answer.selected.no{background:#f9e7ea;border-color:#d79ca7;color:var(--no)}.answer:disabled{opacity:.52;cursor:not-allowed;box-shadow:none}.message{font-size:.8rem;margin:8px 0 0;color:var(--muted)}.message.error{color:#a12b3f}.venue-note{font-size:.82rem;color:var(--muted);margin:3px 0 0}.toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:10;background:#17213a;color:#fff;border-radius:10px;padding:10px 16px;box-shadow:0 8px 28px #0003;font-size:.88rem}.loading,.fatal{text-align:center;padding:55px 20px;color:var(--muted)}
    @media(max-width:760px){.info-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
    @media(max-width:640px){header{padding:17px 14px}.brand p{display:none}.account span{display:none}main{margin-top:18px;padding:0 12px}.login{margin:7vh 8px;padding:30px 20px}.tabs{padding:0}.tab{flex:1;padding-inline:8px}.card{padding:15px}.card-head{align-items:center}.toolbar{justify-content:stretch}.filters{width:100%}.filters label{flex:1}.filters select{width:100%}.participants li{grid-template-columns:3.5em 1fr}.buttons{display:grid;grid-template-columns:repeat(3,1fr);gap:7px}.answer{padding:9px 4px;font-size:.8rem}}
  </style>
</head>
<body>
  <header><div class="header-inner"><div class="brand"><h1>大会参加確認</h1><p>埼玉大学かるた会 メンバーポータル</p></div><div class="account" id="account" hidden><span id="account-name"></span><a href="/auth/logout">ログアウト</a></div></div></header>
  <main>
    <section class="login" id="login" hidden><h2>Discordでログイン</h2><p>承認済みメンバーだけが大会情報・参加希望者・大会要項を閲覧し、参加回答を変更できます。</p><a class="discord-button" href="/auth/discord"><span class="discord-mark">◈</span>Discordで続ける</a></section>
    <div id="app" hidden>
      <div class="welcome"><h2 id="welcome"></h2><p>回答はDiscordとWebで共通です。最後に保存した回答が反映されます。</p></div>
      <nav class="tabs" role="tablist" aria-label="大会情報の表示切替"><button class="tab" id="answer-tab" role="tab" aria-selected="true" aria-controls="answer-panel" data-tab="answer">参加回答<span class="tab-count" id="unanswered-count" hidden></span></button><button class="tab" id="tournaments-tab" role="tab" aria-selected="false" aria-controls="tournaments-panel" data-tab="tournaments">大会一覧</button><button class="tab" id="archive-tab" role="tab" aria-selected="false" aria-controls="archive-panel" data-tab="archive">過去の大会結果</button></nav>
      <section class="panel" id="answer-panel" role="tabpanel" aria-labelledby="answer-tab"><div class="notice">DMが届かない場合も、ここから回答できます。参加希望者の一覧は「大会一覧」タブで確認できます。</div><div class="toolbar"><div class="filters"><label>回答状況<select id="answer-status-filter"><option value="all">すべて</option><option value="open" selected>回答受付中</option><option value="unanswered">未回答</option><option value="yes">参加希望</option><option value="maybe">未定・条件付き</option><option value="no">不参加</option><option value="closed">受付終了</option></select></label><label>並び順<select id="answer-sort"><option value="action">回答が必要な順</option><option value="deadline">締切が近い順</option><option value="event">開催日が近い順</option><option value="created">登録が新しい順</option></select></label></div></div><div class="list" id="answer-list"></div></section>
      <section class="panel" id="tournaments-panel" role="tabpanel" aria-labelledby="tournaments-tab" hidden><div class="toolbar"><div class="filters"><label>表示<select id="status-filter"><option value="current">受付中・今後</option><option value="all">すべて</option><option value="active">回答受付中</option><option value="applied">申込済み</option><option value="closed">終了</option></select></label><label>並び順<select id="sort"><option value="deadline">締切が近い順</option><option value="event">開催日が近い順</option><option value="created">登録が新しい順</option></select></label></div></div><div class="list" id="tournament-list"></div></section>
      <section class="panel" id="archive-panel" role="tabpanel" aria-labelledby="archive-tab" hidden><div class="notice">大会要項・選手名簿・大会結果と、サークルから出場したメンバーの成績を大会ごとにまとめています。</div><div class="list" id="archive-list"></div></section>
    </div>
    <div class="loading" id="loading">大会情報を読み込んでいます…</div>
    <div class="fatal" id="fatal" hidden></div>
    <div class="toast" id="toast" role="status" aria-live="polite" hidden></div>
  </main>
  <script>
    const responseLabels={yes:'参加希望',maybe:'未定・条件付き',no:'不参加'};
    const statusLabels={active:'回答受付中',applied:'申込済み',closed:'終了',no_participants:'参加者なし終了',canceled:'中止'};
    const entryStatusLabels={submitted:'申込済み（結果待ち）',selected:'出場確定',not_selected:'キャンセル待ち',withdrawn:'辞退'};
    const gradeLabels={beginner:'初心者',all:'すべて'};
    const typeLabels={official:'公認大会',support:'後援大会',event:'イベント'};
    let tournaments=[];
    const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
    const grade=value=>gradeLabels[value]||value+'級';
    const date=value=>new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'numeric',day:'numeric',weekday:'short'}).format(new Date(value+'T00:00:00+09:00'));
    const dateTime=value=>new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(value));
    async function api(path,options={}){const response=await fetch(path,{...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...options.headers}});if(!response.ok){const body=await response.json().catch(()=>({}));throw Object.assign(new Error(body.error||'通信に失敗しました。'),{status:response.status});}return response.json();}
    function groupRows(rows){const groups=new Map();for(const row of rows){const key=row.registration_group_id||row.tournament_id;const current=groups.get(key)||[];current.push(row);groups.set(key,current)}return [...groups.values()]}
    function filteredGroups(){const filter=document.querySelector('#status-filter').value;const sort=document.querySelector('#sort').value;const now=Date.now();let groups=groupRows(tournaments).filter(group=>{if(filter==='all')return true;if(filter==='current')return group.some(item=>item.status==='active'||new Date(item.event_start_date+'T23:59:59+09:00').getTime()>=now);return group.some(item=>item.status===filter)});groups.sort((a,b)=>{const get=(group)=>{if(sort==='event')return Math.min(...group.map(item=>new Date(item.event_start_date+'T00:00:00+09:00').getTime()));if(sort==='created')return -Math.max(...group.map(item=>new Date(item.created_at).getTime()));return Math.min(...group.map(item=>new Date(item.internal_deadline).getTime()))};return get(a)-get(b)});return groups}
    function documentLink(group,label='大会要項PDF'){const item=group.find(candidate=>candidate.has_document);return item?'<a class="document" href="/api/tournaments/'+encodeURIComponent(item.tournament_id)+'/document" target="_blank" rel="noopener">'+esc(label)+'</a>':'<span class="empty">なし</span>'}
    function archiveDocumentLink(group,type,label){const first=group[0];const groupKey=first.registration_group_id||first.tournament_id;const found=(first.archive_documents||[]).find(item=>item.document_type===type);return found?'<a class="document" href="/api/archives/'+encodeURIComponent(groupKey)+'/documents/'+encodeURIComponent(type)+'" target="_blank" rel="noopener">'+esc(label)+'</a>':'<span class="empty">なし</span>'}
    function eligibleAnswerGroups(){return groupRows(tournaments).map(group=>({group,target:group.find(item=>item.eligible)})).filter(item=>item.target)}
    function canAnswer(target){return target.status==='active'&&new Date(target.internal_deadline).getTime()>=Date.now()}
    function displayStatus(target){return target.status==='closed'&&target.closure_reason==='no_participants'?'no_participants':target.status}
    function answerGroups(){const filter=document.querySelector('#answer-status-filter').value;const sort=document.querySelector('#answer-sort').value;const groups=eligibleAnswerGroups().filter(({target})=>{const open=canAnswer(target);if(filter==='all')return true;if(filter==='open')return open;if(filter==='unanswered')return open&&!target.own_response;if(filter==='closed')return !open;return target.own_response===filter});const value=({target})=>{if(sort==='event')return new Date(target.event_start_date+'T00:00:00+09:00').getTime();if(sort==='created')return -new Date(target.created_at).getTime();return new Date(target.internal_deadline).getTime()};groups.sort((a,b)=>{if(sort==='action'){const priority=({target})=>canAnswer(target)&&!target.own_response?0:canAnswer(target)?1:2;const difference=priority(a)-priority(b);if(difference)return difference}return value(a)-value(b)});return groups}
    function renderAnswers(){const list=document.querySelector('#answer-list');const allGroups=eligibleAnswerGroups();const groups=answerGroups();const unanswered=allGroups.filter(({target})=>canAnswer(target)&&!target.own_response).length;const badge=document.querySelector('#unanswered-count');badge.hidden=unanswered===0;badge.textContent=String(unanswered);if(!allGroups.length){list.innerHTML='<div class="card empty">現在の級が対象になっている大会はありません。</div>';return}if(!groups.length){list.innerHTML='<div class="card empty">条件に一致する大会はありません。</div>';return}list.innerHTML=groups.map(({group,target})=>{const answerable=canAnswer(target);const answer=target.own_response||'';const targetStatus=displayStatus(target);const badgeLabel=answer?'回答済み':answerable?'未回答':statusLabels[targetStatus]||'受付終了';const badgeClass=answer?'answered':answerable?'pending':targetStatus;const buttons=Object.entries(responseLabels).map(([value,label])=>'<button class="answer '+(answer===value?'selected '+value:'')+'" data-id="'+esc(target.tournament_id)+'" data-response="'+value+'" '+(answerable?'':'disabled')+'>'+label+'</button>').join('');const gradeName=target.all_grades?'すべて':grade(target.grade);const waitlist=target.own_entry_status==='not_selected'&&target.own_waitlist_number?' '+target.own_waitlist_number+'番':'';const entryResult=target.own_entry_status?' ／ 申込・抽選結果: '+(entryStatusLabels[target.own_entry_status]||target.own_entry_status)+waitlist:'';return '<article class="card response-card"><div class="card-head"><div class="title-row"><h3 class="title">'+esc(target.title)+'</h3></div><span class="status '+esc(badgeClass)+'">'+esc(badgeLabel)+'</span></div><div class="info-grid"><div class="info-cell"><span class="info-label">大会日程</span><span class="info-value">'+esc(date(target.event_start_date))+'</span></div><div class="info-cell"><span class="info-label">開催級</span><span class="info-value">'+esc(gradeName)+'</span></div><div class="info-cell"><span class="info-label">回答締切</span><span class="info-value">'+esc(dateTime(target.internal_deadline))+'</span></div><div class="info-cell"><span class="info-label">要項</span><span class="info-value">'+documentLink(group,'PDFを開く')+'</span></div></div>'+(target.venue?'<p class="venue-note">会場 '+esc(target.venue)+'</p>':'')+'<div class="answer-area"><span class="answer-label">回答</span><div class="buttons">'+buttons+'</div><p class="message">'+(answerable?'現在の回答: '+esc(answer?responseLabels[answer]:'未回答'):'現在は回答を変更できません。')+esc(entryResult)+'</p></div></article>'}).join('');document.querySelectorAll('#answer-list .answer').forEach(button=>button.addEventListener('click',saveAnswer))}
    function renderTournamentList(){const list=document.querySelector('#tournament-list');const groups=filteredGroups();if(!groups.length){list.innerHTML='<div class="card empty">条件に一致する大会はありません。</div>';return}list.innerHTML=groups.map(group=>{const first=group[0];const displayStatuses=[...new Set(group.map(displayStatus))];const groupStatus=displayStatuses.length===1?displayStatuses[0]:'active';const gradeNames=[...new Set(group.map(item=>item.all_grades?'すべて':grade(item.grade)))];const uniqueDates=[...new Set(group.map(item=>item.event_start_date))];const dateLabel=uniqueDates.length===1?date(uniqueDates[0]):group.map(item=>(item.all_grades?'すべて':grade(item.grade))+' '+date(item.event_start_date)).join(' / ');const participants=group.flatMap(item=>item.participants.map(person=>({...person,tournamentGrade:item.all_grades?person.grade:item.grade})));const people=participants.length?participants.map(person=>{const waitlist=person.entry_status==='not_selected'&&person.waitlist_number?' '+person.waitlist_number+'番':'';const result=person.entry_status?' ／ '+(entryStatusLabels[person.entry_status]||person.entry_status)+waitlist:'';const payment=person.entry_status==='selected'?' ／ '+(person.payment_status==='paid'?'支払済み':'未納'):'';return '<li><strong>'+esc(grade(person.tournamentGrade))+'</strong><span>'+esc(person.display_name)+(person.display_name_kana?' <small>('+esc(person.display_name_kana)+')</small>':'')+esc(result+payment)+'</span></li>'}).join(''):'<li class="empty">まだ参加希望者はいません。</li>';return '<article class="card tournament-card"><div class="card-head"><div class="title-row"><h3 class="title">'+esc(first.title)+'</h3><span class="status '+esc(groupStatus)+'">'+esc(statusLabels[groupStatus]||groupStatus)+'</span></div><span class="count">'+participants.length+'名</span></div><div class="meta"><span>大会日 '+esc(dateLabel)+'</span><span>締切 '+esc(dateTime(first.internal_deadline))+'</span><span>開催級 '+esc(gradeNames.join('、'))+'</span>'+(first.venue?'<span>会場 '+esc(first.venue)+'</span>':'')+'</div><ul class="participants">'+people+'</ul><div class="section-title">'+documentLink(group,'▣ 大会要項PDFを開く')+'</div></article>'}).join('')}
    function renderArchives(){const list=document.querySelector('#archive-list');const groups=groupRows(tournaments).filter(group=>group.some(item=>item.archive_published_at)).sort((a,b)=>Math.max(...b.map(item=>new Date(item.event_start_date+'T00:00:00+09:00').getTime()))-Math.max(...a.map(item=>new Date(item.event_start_date+'T00:00:00+09:00').getTime())));if(!groups.length){list.innerHTML='<div class="card empty">公開済みの大会記録はまだありません。</div>';return}list.innerHTML=groups.map(group=>{const first=group[0];const uniqueDates=[...new Set(group.map(item=>item.event_start_date))];const dateLabel=uniqueDates.length===1?date(uniqueDates[0]):group.map(item=>(item.all_grades?'すべて':grade(item.grade))+' '+date(item.event_start_date)).join(' / ');const entrants=group.flatMap(item=>item.participants.filter(person=>person.entry_status==='submitted'||person.entry_status==='selected').map(person=>({...person,tournamentGrade:item.all_grades?person.grade:item.grade})));const rows=entrants.map(person=>'<li><strong>'+esc(grade(person.tournamentGrade))+'</strong><span>'+esc(person.display_name)+(person.display_name_kana?' <small>('+esc(person.display_name_kana)+')</small>':'')+' — '+esc(person.result_text||'成績未登録')+'</span></li>').join('');return '<article class="card archive-card"><div class="card-head"><div class="title-row"><h3 class="title">'+esc(first.title)+'</h3><span class="status applied">大会記録</span></div><span class="count">'+entrants.length+'名</span></div><div class="meta"><span>大会日 '+esc(dateLabel)+'</span>'+(first.venue?'<span>会場 '+esc(first.venue)+'</span>':'')+'</div><div class="section-title">出場者・成績</div><ul class="participants">'+rows+'</ul><div class="section-title">'+documentLink(group,'▣ 大会要項')+'　'+archiveDocumentLink(group,'roster','▣ 選手名簿')+'　'+archiveDocumentLink(group,'results','▣ 結果ファイル')+'</div></article>'}).join('')}
    function render(){renderAnswers();renderTournamentList();renderArchives()}
    let toastTimer;function showToast(text){const toast=document.querySelector('#toast');toast.textContent=text;toast.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{toast.hidden=true},2600)}
    function selectTab(name,updateHash=true){const selected=name==='tournaments'||name==='archive'?name:'answer';document.querySelectorAll('.tab').forEach(tab=>tab.setAttribute('aria-selected',String(tab.dataset.tab===selected)));document.querySelector('#answer-panel').hidden=selected!=='answer';document.querySelector('#tournaments-panel').hidden=selected!=='tournaments';document.querySelector('#archive-panel').hidden=selected!=='archive';if(updateHash)history.replaceState(null,'','#'+selected)}
    async function saveAnswer(event){const button=event.currentTarget;const card=button.closest('.card');const buttons=[...card.querySelectorAll('.answer')];buttons.forEach(item=>item.disabled=true);const message=card.querySelector('.message');message.classList.remove('error');message.textContent='保存しています…';try{await api('/api/tournaments/'+encodeURIComponent(button.dataset.id)+'/response',{method:'PUT',body:JSON.stringify({response:button.dataset.response})});const target=tournaments.find(item=>item.tournament_id===button.dataset.id);if(target)target.own_response=button.dataset.response;render();showToast('回答を保存しました。')}catch(error){message.textContent=error.message;message.classList.add('error');buttons.forEach(item=>item.disabled=false)}}
    async function start(){try{const session=await api('/api/session');document.querySelector('#account').hidden=false;document.querySelector('#account-name').textContent=session.member.display_name;document.querySelector('#welcome').textContent=session.member.display_name+'さん';const data=await api('/api/tournaments');tournaments=data.tournaments;document.querySelector('#loading').hidden=true;document.querySelector('#app').hidden=false;render();selectTab(location.hash.slice(1),false)}catch(error){document.querySelector('#loading').hidden=true;if(error.status===401){document.querySelector('#login').hidden=false}else{const fatal=document.querySelector('#fatal');fatal.hidden=false;fatal.textContent=error.message}}}
    document.querySelectorAll('.tab').forEach(tab=>tab.addEventListener('click',()=>selectTab(tab.dataset.tab)));window.addEventListener('hashchange',()=>selectTab(location.hash.slice(1),false));document.querySelector('#answer-status-filter').addEventListener('change',renderAnswers);document.querySelector('#answer-sort').addEventListener('change',renderAnswers);document.querySelector('#status-filter').addEventListener('change',renderTournamentList);document.querySelector('#sort').addEventListener('change',renderTournamentList);start();
  </script>
</body>
</html>`;
}

function googleBackupInformationHtml(page: "home" | "privacy"): string {
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

export async function handlePortalRequest(
  request: Request,
  env: PortalEnv,
  ctx: Pick<ExecutionContext, "waitUntil">,
): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/google-backup") {
    return new Response(googleBackupInformationHtml("home"), {
      headers: { ...securityHeaders, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=3600" },
    });
  }
  if (request.method === "GET" && url.pathname === "/google-backup/privacy") {
    return new Response(googleBackupInformationHtml("privacy"), {
      headers: { ...securityHeaders, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=3600" },
    });
  }
  if (request.method === "GET" && url.pathname === "/") {
    return new Response(portalHtml(), {
      headers: { ...securityHeaders, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
  if (request.method === "GET" && url.pathname === "/auth/discord") {
    return beginDiscordLogin(request, env);
  }
  if (request.method === "GET" && url.pathname === "/auth/discord/callback") {
    return finishDiscordLogin(request, env, ctx);
  }
  if (request.method === "GET" && url.pathname === "/auth/logout") {
    return new Response(null, {
      status: 302,
      headers: { ...securityHeaders, Location: "/", "Set-Cookie": cookie(SESSION_COOKIE, "", 0) },
    });
  }

  const authenticated = await loadSessionMember(request, env);
  if (!authenticated) return json({ error: "ログインが必要です。" }, 401);
  const { member, session } = authenticated;

  if (request.method === "GET" && url.pathname === "/api/session") {
    const refreshedCookie = await refreshedSessionCookie(
      session,
      env.SESSION_SECRET,
    );
    return json({
      member: {
        display_name: member.display_name,
        display_name_kana: member.display_name_kana,
        grade: member.grade,
        rank: member.rank,
      },
    }, 200, refreshedCookie ? { "Set-Cookie": refreshedCookie } : undefined);
  }
  if (request.method === "GET" && url.pathname === "/api/tournaments") {
    try {
      return json({ tournaments: await listPortalTournaments(env, member) });
    } catch (error) {
      console.error("Portal tournament list error", error);
      return json({ error: "大会一覧を取得できませんでした。" }, 500);
    }
  }
  const responsePath = url.pathname.match(/^\/api\/tournaments\/(T-[0-9a-f-]{36})\/response$/);
  if (request.method === "PUT" && responsePath) {
    if (!sameOrigin(request)) return json({ error: "不正な送信元です。" }, 403);
    if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
      return json({ error: "JSON形式で送信してください。" }, 415);
    }
    try {
      const body = await request.json<{ response?: unknown }>();
      const saved = await saveWebResponse(env, member, responsePath[1], body.response);
      return json({ response: saved, label: RESPONSE_LABELS[saved] });
    } catch (error) {
      if (error instanceof PortalError) return json({ error: error.message }, error.status);
      console.error("Portal response save error", error);
      return json({ error: "回答を保存できませんでした。" }, 500);
    }
  }
  const documentPath = url.pathname.match(/^\/api\/tournaments\/(T-[0-9a-f-]{36})\/document$/);
  if (request.method === "GET" && documentPath) {
    return servePortalDocument(env, member, documentPath[1]);
  }
  const archiveDocumentPath = url.pathname.match(
    /^\/api\/archives\/((?:T|TG)-[0-9a-f-]{36})\/documents\/(roster|results)$/,
  );
  if (request.method === "GET" && archiveDocumentPath) {
    return servePortalArchiveDocument(env, archiveDocumentPath[1], archiveDocumentPath[2]);
  }
  return new Response("Not Found", { status: 404, headers: securityHeaders });
}

export default {
  fetch(request: Request, env: PortalEnv, ctx: ExecutionContext): Promise<Response> {
    return handlePortalRequest(request, env, ctx);
  },
} satisfies ExportedHandler<PortalEnv>;
