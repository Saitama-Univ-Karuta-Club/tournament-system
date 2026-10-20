import { recordParticipantPaymentResponse } from "./participant-guidance";
import { submitMemberRegistrationRequest } from "./members";

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
  last_name: string;
  first_name: string;
  last_name_kana: string;
  first_name_kana: string;
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
  result_text: string | null;
}

interface PortalArchiveDocumentRow {
  group_key: string;
  document_type: "roster" | "results";
  file_name: string;
}

interface PortalConfirmationRosterRow {
  group_key: string;
  file_name: string;
}

interface PortalOverduePaymentRow {
  tournament_id: string;
  payment_deadline: string;
}

interface PortalPendingMemberRequestRow {
  request_id: string;
  requested_last_name: string;
  requested_first_name: string;
  requested_last_name_kana: string;
  requested_first_name_kana: string;
  requested_grade: string;
  requested_rank: number;
  submitted_at: string;
}

interface PortalAppearanceRow {
  group_key: string;
  title: string;
  event_start_date: string;
  grade: string;
  result_text: string | null;
}

interface PortalGuidanceRow {
  group_key: string;
  body_text: string | null;
  document_url: string | null;
  file_name: string | null;
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
    `SELECT member_id, discord_user_id, last_name, first_name,
            last_name_kana, first_name_kana, display_name, display_name_kana,
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
    `SELECT member_id, discord_user_id, last_name, first_name,
            last_name_kana, first_name_kana, display_name, display_name_kana,
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

function currentJstDate(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function currentJstFiscalYear(): number {
  const [year, month] = currentJstDate().split("-").map(Number);
  return month >= 4 ? year : year - 1;
}

async function loadPortalProfile(
  env: PortalEnv,
  member: PortalMemberRow,
): Promise<unknown> {
  const [pending, appearanceRows] = await Promise.all([
    env.DB.prepare(
      `SELECT request_id, requested_last_name, requested_first_name,
              requested_last_name_kana, requested_first_name_kana,
              requested_grade, requested_rank, submitted_at
       FROM member_registration_requests
       WHERE discord_user_id = ? AND status = 'pending'
       LIMIT 1`,
    ).bind(member.discord_user_id).first<PortalPendingMemberRequestRow>(),
    env.DB.prepare(
      `SELECT
         COALESCE(tournaments.registration_group_id, tournaments.tournament_id) AS group_key,
         tournaments.title,
         tournaments.event_start_date,
         CASE
           WHEN tournaments.all_grades = 1
             THEN COALESCE(NULLIF(tournament_entries.archive_grade, ''), ?)
           ELSE tournaments.grade
         END AS grade,
         tournament_entries.result_text
       FROM tournament_entries
       INNER JOIN tournaments
         ON tournaments.tournament_id = tournament_entries.tournament_id
       WHERE tournament_entries.member_id = ?
         AND tournament_entries.status = 'selected'
         AND tournaments.event_start_date <= ?
         AND tournaments.status NOT IN ('canceled', 'deleted')
       ORDER BY tournaments.event_start_date DESC, tournaments.created_at DESC`,
    ).bind(member.grade, member.member_id, currentJstDate()).all<PortalAppearanceRow>(),
  ]);
  const seenGroups = new Set<string>();
  const appearances = appearanceRows.results.filter((appearance) => {
    if (seenGroups.has(appearance.group_key)) return false;
    seenGroups.add(appearance.group_key);
    return true;
  });
  const fiscalYear = currentJstFiscalYear();
  const fiscalStart = `${fiscalYear}-04-01`;
  const fiscalEnd = `${fiscalYear + 1}-03-31`;
  const fiscalGradeCounts: Record<string, number> = {};
  for (const appearance of appearances) {
    if (appearance.event_start_date < fiscalStart || appearance.event_start_date > fiscalEnd) continue;
    fiscalGradeCounts[appearance.grade] = (fiscalGradeCounts[appearance.grade] ?? 0) + 1;
  }
  return {
    member: {
      last_name: member.last_name,
      first_name: member.first_name,
      last_name_kana: member.last_name_kana,
      first_name_kana: member.first_name_kana,
      display_name: member.display_name,
      display_name_kana: member.display_name_kana,
      grade: member.grade,
      rank: Number(member.rank),
    },
    pending_request: pending ? {
      ...pending,
      requested_rank: Number(pending.requested_rank),
    } : null,
    fiscal_year: fiscalYear,
    fiscal_grade_counts: fiscalGradeCounts,
    appearances,
  };
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
      tournament_entries.result_text
     FROM responses
     INNER JOIN members ON members.member_id = responses.member_id
     INNER JOIN tournaments ON tournaments.tournament_id = responses.tournament_id
     LEFT JOIN tournament_entries
       ON tournament_entries.tournament_id = responses.tournament_id
      AND tournament_entries.member_id = responses.member_id
     WHERE responses.response = 'yes'
       AND responses.is_valid = 1
       AND (members.status = 'active' OR tournaments.archive_published_at IS NOT NULL)
       AND tournaments.status NOT IN ('draft', 'deleted')
     ORDER BY members.grade, display_name_kana, members.display_name`,
  ).all<ParticipantRow>();

  const overduePayments = await env.DB.prepare(
    `SELECT tournament_entries.tournament_id,
            tournament_participant_guidance.payment_deadline
     FROM tournament_entries
     INNER JOIN tournaments
       ON tournaments.tournament_id = tournament_entries.tournament_id
     INNER JOIN tournament_participant_guidance
       ON tournament_participant_guidance.group_key =
          COALESCE(tournaments.registration_group_id, tournaments.tournament_id)
     LEFT JOIN tournament_entry_payments
       ON tournament_entry_payments.tournament_id = tournament_entries.tournament_id
      AND tournament_entry_payments.member_id = tournament_entries.member_id
     WHERE tournament_entries.member_id = ?
       AND tournament_entries.status = 'selected'
       AND tournaments.status = 'applied'
       AND tournament_participant_guidance.payment_collection_method = 'advance_manager'
       AND tournament_participant_guidance.payment_deadline IS NOT NULL
       AND tournament_participant_guidance.payment_deadline < ?
       AND COALESCE(tournament_entry_payments.status, 'unpaid') = 'unpaid'`,
  ).bind(member.member_id, new Date().toISOString()).all<PortalOverduePaymentRow>();

  const archiveDocuments = await env.DB.prepare(
    `SELECT tournament_archive_documents.group_key,
            tournament_archive_documents.document_type,
            tournament_archive_documents.file_name
     FROM tournament_archive_documents
     WHERE tournament_archive_documents.document_type = 'roster'
        OR EXISTS (
          SELECT 1 FROM tournaments
          WHERE COALESCE(tournaments.registration_group_id, tournaments.tournament_id)
            = tournament_archive_documents.group_key
            AND tournaments.archive_published_at IS NOT NULL
        )
     ORDER BY tournament_archive_documents.document_type`,
  ).all<PortalArchiveDocumentRow>();

  const confirmationRosters = await env.DB.prepare(
    `SELECT group_key, file_name
     FROM tournament_confirmation_rosters`,
  ).all<PortalConfirmationRosterRow>();

  const participantGuidance = await env.DB.prepare(
    `SELECT tournament_participant_guidance.group_key,
            tournament_participant_guidance.body_text,
            tournament_participant_guidance.document_url,
            tournament_participant_guidance.file_name
     FROM tournament_participant_guidance
     WHERE EXISTS (
       SELECT 1
       FROM tournaments
       INNER JOIN tournament_entries
         ON tournament_entries.tournament_id = tournaments.tournament_id
       WHERE COALESCE(tournaments.registration_group_id, tournaments.tournament_id)
         = tournament_participant_guidance.group_key
         AND tournament_entries.status = 'selected'
     )`,
  ).all<PortalGuidanceRow>();

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
  const guidanceByGroup = new Map(
    participantGuidance.results.map((guidance) => [guidance.group_key, {
      has_text: Boolean(guidance.body_text),
      has_document: Boolean(guidance.document_url),
      file_name: guidance.file_name,
    }]),
  );
  const confirmationRosterByGroup = new Map(
    confirmationRosters.results.map((roster) => [roster.group_key, roster]),
  );
  const overduePaymentByTournament = new Map(
    overduePayments.results.map((payment) => [payment.tournament_id, payment.payment_deadline]),
  );
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
    confirmation_roster: confirmationRosterByGroup.get(
      tournament.registration_group_id ?? tournament.tournament_id,
    ) ?? null,
    own_payment_overdue: overduePaymentByTournament.has(tournament.tournament_id),
    own_payment_deadline: overduePaymentByTournament.get(tournament.tournament_id) ?? null,
    participant_guidance: guidanceByGroup.get(
      tournament.registration_group_id ?? tournament.tournament_id,
    ) ?? null,
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
           AND (
             (? = 'roster' AND EXISTS (
               SELECT 1 FROM tournament_entries
               WHERE tournament_entries.tournament_id = tournaments.tournament_id
                 AND tournament_entries.status = 'selected'
             ))
             OR (? = 'results' AND tournaments.archive_published_at IS NOT NULL)
           )
       )
     LIMIT 1`,
  ).bind(groupKey, documentType, groupKey, documentType, documentType)
    .first<{ document_url: string }>();
  if (!document?.document_url) return new Response("Not Found", { status: 404 });
  return serveStoredDocumentUrl(env, document.document_url);
}

async function servePortalConfirmationRoster(
  env: PortalEnv,
  groupKey: string,
): Promise<Response> {
  if (!/^(?:T|TG)-[0-9a-f-]{36}$/.test(groupKey)) {
    return new Response("Not Found", { status: 404 });
  }
  const roster = await env.DB.prepare(
    `SELECT tournament_confirmation_rosters.document_url
     FROM tournament_confirmation_rosters
     WHERE tournament_confirmation_rosters.group_key = ?
       AND EXISTS (
         SELECT 1 FROM tournaments
         WHERE COALESCE(tournaments.registration_group_id, tournaments.tournament_id) = ?
           AND tournaments.status = 'applied'
       )
     LIMIT 1`,
  ).bind(groupKey, groupKey).first<{ document_url: string }>();
  if (!roster?.document_url) return new Response("Not Found", { status: 404 });
  return serveStoredDocumentUrl(env, roster.document_url);
}

function escapePortalHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function loadVisibleParticipantGuidance(
  env: PortalEnv,
  groupKey: string,
): Promise<PortalGuidanceRow | null> {
  if (!/^(?:T|TG)-[0-9a-f-]{36}$/.test(groupKey)) return null;
  return env.DB.prepare(
    `SELECT tournament_participant_guidance.group_key,
            tournament_participant_guidance.body_text,
            tournament_participant_guidance.document_url,
            tournament_participant_guidance.file_name
     FROM tournament_participant_guidance
     WHERE tournament_participant_guidance.group_key = ?
       AND EXISTS (
         SELECT 1
         FROM tournaments
         INNER JOIN tournament_entries
           ON tournament_entries.tournament_id = tournaments.tournament_id
         WHERE COALESCE(tournaments.registration_group_id, tournaments.tournament_id) = ?
           AND tournament_entries.status = 'selected'
       )
     LIMIT 1`,
  ).bind(groupKey, groupKey).first<PortalGuidanceRow>();
}

async function servePortalGuidance(
  env: PortalEnv,
  groupKey: string,
): Promise<Response> {
  const guidance = await loadVisibleParticipantGuidance(env, groupKey);
  if (!guidance || (!guidance.body_text && !guidance.document_url)) {
    return new Response("Not Found", { status: 404 });
  }
  const body = guidance.body_text
    ? `<section><h2>案内本文</h2><div class="guidance-text">${escapePortalHtml(guidance.body_text)}</div></section>`
    : "";
  const document = guidance.document_url
    ? `<a class="button" href="/api/archives/${encodeURIComponent(groupKey)}/guidance/document" target="_blank" rel="noopener">${escapePortalHtml(guidance.file_name || "当日案内ファイルを開く")}</a>`
    : "";
  const html = `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>参加者向け当日案内</title><style>:root{font-family:system-ui,-apple-system,"Hiragino Sans",sans-serif;color:#17213a;background:#f3f6fb}body{margin:0;padding:24px}.card{max-width:760px;margin:auto;padding:24px;background:#fff;border:1px solid #dbe2ef;border-radius:16px;box-shadow:0 8px 28px #27396612}h1{margin:0 0 18px;font-size:1.35rem}h2{font-size:1rem;margin:18px 0 7px}.guidance-text{white-space:pre-wrap;line-height:1.8;padding:14px;border-radius:10px;background:#f7f9fd}.button{display:inline-flex;margin-top:18px;padding:10px 15px;border-radius:9px;background:#4262ad;color:#fff;text-decoration:none;font-weight:800}@media(max-width:600px){body{padding:12px}.card{padding:18px}}</style><main class="card"><h1>参加者向け当日案内</h1>${body}${document}</main></html>`;
  return new Response(html, {
    headers: {
      ...securityHeaders,
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "private, no-store",
    },
  });
}

async function servePortalGuidanceDocument(
  env: PortalEnv,
  groupKey: string,
): Promise<Response> {
  const guidance = await loadVisibleParticipantGuidance(env, groupKey);
  if (!guidance?.document_url) return new Response("Not Found", { status: 404 });
  return serveStoredDocumentUrl(env, guidance.document_url);
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
    .welcome{margin-bottom:18px}.welcome h2{margin:0;font-size:1.25rem}.welcome p{margin:2px 0 0;color:var(--muted);font-size:.9rem}.payment-alert{margin:0 0 16px;padding:13px 15px;border:1px solid #efb5b5;border-left:5px solid #c83d3d;border-radius:10px;background:#fff0f0;color:#762525}.payment-alert strong{display:block;margin-bottom:3px}.payment-alert ul{display:grid;gap:8px;margin:8px 0 0;padding:0;list-style:none}.payment-alert li{display:flex;align-items:center;justify-content:space-between;gap:12px}.payment-complete{appearance:none;border:0;border-radius:8px;background:#18794e;color:#fff;padding:7px 12px;font:inherit;font-size:.82rem;font-weight:800;white-space:nowrap;cursor:pointer}.payment-complete:disabled{opacity:.65;cursor:wait}.tabs{display:flex;gap:6px;border-bottom:1px solid var(--line);margin-bottom:20px;padding:0 5px}.tab{position:relative;appearance:none;border:0;background:transparent;color:var(--muted);font:inherit;font-weight:800;padding:11px 18px 12px;cursor:pointer}.tab[aria-selected="true"]{color:var(--navy)}.tab[aria-selected="true"]::after{content:"";position:absolute;left:8px;right:8px;bottom:-1px;height:3px;border-radius:3px 3px 0 0;background:var(--blue)}.tab-count{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;margin-left:6px;padding:0 6px;border-radius:999px;background:#bb332d;color:#fff;font-size:.72rem}.tab-count[hidden],.payment-alert[hidden]{display:none}.panel[hidden],.info-view[hidden]{display:none}.subtabs{display:inline-flex;gap:4px;margin:0 0 18px;padding:4px;border:1px solid var(--line);border-radius:11px;background:#e9eef7}.subtab{appearance:none;border:0;border-radius:8px;background:transparent;color:var(--muted);padding:8px 15px;font:inherit;font-size:.86rem;font-weight:800;cursor:pointer}.subtab[aria-selected="true"]{background:#fff;color:var(--navy);box-shadow:0 2px 8px #27396617}.notice{background:#eef3ff;border-left:4px solid var(--blue);padding:12px 15px;border-radius:4px 10px 10px 4px;margin-bottom:18px;font-size:.9rem}
    .toolbar{display:flex;flex-wrap:wrap;align-items:end;justify-content:flex-end;gap:14px;margin-bottom:14px}.filters{display:flex;gap:10px;flex-wrap:wrap}.filters label{font-size:.78rem;color:var(--muted);font-weight:700}.filters select,.filters input{display:block;margin-top:3px;border:1px solid #cbd5e6;background:#fff;border-radius:9px;padding:8px 10px;color:var(--ink);font:inherit}.filters select{padding-right:34px}.list{display:grid;gap:14px}.card{background:var(--card);border:1px solid var(--line);border-radius:17px;padding:18px;box-shadow:0 5px 18px #2739660b}.card-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px}.title-row{display:flex;align-items:center;flex-wrap:wrap;gap:8px}.title{font-size:1.08rem;font-weight:850;margin:0}.status{font-size:.72rem;font-weight:800;padding:4px 9px;border-radius:999px;background:#edf1f7;color:#536079;white-space:nowrap}.status.active{background:#e0f5e9;color:#12653f}.status.applied{background:#e8edff;color:#344f9d}.status.pre_lottery{background:#fff1d6;color:#795313}.status.confirmed{background:#e7f3ff;color:#1f5e96}.status.no_participants{background:#fff1d6;color:#6f4b12}.status.canceled{background:#f8e8eb;color:#8b3141}.status.answered{background:#e8edff;color:#344f9d}.status.pending{background:#edf1f7;color:#536079}.count{display:inline-flex;align-items:center;justify-content:center;min-width:48px;padding:5px 12px;border-radius:999px;background:#e8edff;color:#344f9d;font-size:.82rem;font-weight:850}.meta{display:flex;flex-wrap:wrap;gap:4px 16px;color:var(--muted);font-size:.88rem;margin:8px 0 13px}.meta span{display:inline-flex;gap:5px}.info-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:13px 0 16px}.info-cell{border:1px solid #dbe2ef;border-radius:10px;padding:9px 12px;background:#fff}.info-label{display:block;color:var(--muted);font-size:.76rem;margin-bottom:2px}.info-value{font-size:.92rem;font-weight:650}.info-value a{color:#344f9d;font-weight:800}.grade-dates{display:grid;gap:5px;background:#f7f9fd;border-radius:10px;padding:10px 12px;margin:10px 0;font-size:.88rem}.grade-date{display:flex;justify-content:space-between;gap:14px}.section-title{font-size:.86rem;font-weight:850;margin:13px 0 6px}.participants{margin:0;padding:0;list-style:none;display:grid;gap:4px;font-size:.9rem}.participants li{display:grid;grid-template-columns:4.4em 1fr;gap:8px}.participants li.empty{display:block;white-space:nowrap}.participants small{color:var(--muted)}.empty{color:#8a94a9;font-size:.88rem}.document{display:inline-flex;align-items:center;gap:6px;color:#344f9d;font-weight:800;text-decoration:none;font-size:.9rem}.resource-links{display:flex;align-items:center;flex-wrap:wrap;gap:8px 18px;margin-top:13px;padding-top:12px;border-top:1px solid #e7ebf3}.document-index{display:grid;gap:8px}.document-index-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:10px 18px;background:#fff;border:1px solid var(--line);border-radius:13px;padding:13px 16px}.document-index-title{font-weight:850}.document-index-meta{display:flex;flex-wrap:wrap;gap:3px 14px;color:var(--muted);font-size:.82rem}.document-index-count{margin-right:auto;color:var(--muted);font-size:.85rem}.answer-area{margin-top:6px}.answer-label{display:block;font-size:.9rem;font-weight:850;margin-bottom:8px}.buttons{display:flex;gap:8px;flex-wrap:wrap}.answer{appearance:none;border:1px solid #cbd4e4;background:#fff;color:var(--ink);font-weight:750;border-radius:9px;padding:8px 13px;cursor:pointer;box-shadow:none}.answer:hover{border-color:var(--blue);background:#f1f5ff}.answer.selected.yes{background:#dff4e9;border-color:#80c6a3;color:var(--yes)}.answer.selected.maybe{background:#fff0d8;border-color:#e7bb75;color:var(--maybe)}.answer.selected.no{background:#f9e7ea;border-color:#d79ca7;color:var(--no)}.answer:disabled{opacity:.52;cursor:not-allowed;box-shadow:none}.message{font-size:.8rem;margin:8px 0 0;color:var(--muted)}.message.error{color:#a12b3f}.venue-note{font-size:.82rem;color:var(--muted);margin:3px 0 0}.toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:10;background:#17213a;color:#fff;border-radius:10px;padding:10px 16px;box-shadow:0 8px 28px #0003;font-size:.88rem}.loading,.fatal{text-align:center;padding:55px 20px;color:var(--muted)}
    .profile-layout{display:grid;gap:14px}.profile-section{background:#fff;border:1px solid var(--line);border-radius:16px;padding:18px}.profile-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}.profile-heading h3{margin:0;font-size:1rem}.profile-edit-button{appearance:none;border:1px solid #c5cee0;border-radius:8px;background:#fff;color:#344f9d;padding:6px 12px;font:inherit;font-size:.85rem;font-weight:800;cursor:pointer}.profile-values{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.profile-value{padding:10px 12px;border-radius:10px;background:#f7f9fd}.profile-value small{display:block;color:var(--muted)}.profile-value strong{display:block}.profile-pending{border-color:#e8c278;background:#fff9eb}.profile-pending strong{display:block}.profile-pending p{margin:3px 0;font-size:.88rem}.history-heading{display:flex;align-items:baseline;flex-wrap:wrap;gap:5px 10px;margin-bottom:10px}.history-heading h3{margin:0;font-size:1rem}.history-summary{color:var(--muted);font-size:.86rem}.history-table-wrap{overflow-x:auto}.history-table{width:100%;border-collapse:collapse;white-space:nowrap}.history-table th,.history-table td{padding:9px 11px;border-bottom:1px solid #e7ebf3;text-align:left}.history-table th{color:var(--muted);font-size:.78rem}.history-table td{font-size:.9rem}.history-table tr:last-child td{border-bottom:0}.profile-dialog{width:min(620px,calc(100% - 24px));max-height:calc(100vh - 32px);overflow:auto;border:0;border-radius:16px;padding:0;color:var(--ink);box-shadow:0 22px 70px #11182f44}.profile-dialog::backdrop{background:#17213a80}.profile-dialog-head{display:flex;align-items:center;justify-content:space-between;padding:16px 18px;border-bottom:1px solid var(--line)}.profile-dialog-head h3{margin:0;font-size:1.05rem}.profile-dialog-close{appearance:none;border:0;background:transparent;color:var(--muted);font-size:1.4rem;line-height:1;cursor:pointer}.profile-form{padding:18px}.profile-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.profile-fields label{font-size:.82rem;color:var(--muted);font-weight:750}.profile-fields input,.profile-fields select{display:block;width:100%;margin-top:4px;border:1px solid #c5cee0;border-radius:9px;background:#fff;color:var(--ink);font:inherit;padding:9px 11px}.profile-actions{display:flex;align-items:center;justify-content:flex-end;gap:12px;margin-top:16px}.profile-cancel{appearance:none;border:1px solid #c5cee0;border-radius:9px;background:#fff;color:var(--ink);padding:9px 14px;font:inherit;font-weight:750;cursor:pointer}.profile-submit{appearance:none;border:0;border-radius:9px;background:var(--blue);color:#fff;padding:10px 15px;font:inherit;font-weight:800;cursor:pointer}.profile-submit:disabled{opacity:.6;cursor:wait}.profile-note{color:var(--muted);font-size:.82rem;margin:0 0 12px}
    @media(max-width:760px){.info-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
    @media(max-width:640px){header{padding:17px 14px}.brand p{display:none}.account span{display:none}main{margin-top:18px;padding:0 12px}.login{margin:7vh 8px;padding:30px 20px}.payment-alert li{align-items:flex-start;flex-direction:column}.tabs{padding:0}.tab{flex:1;padding-inline:8px}.subtabs{display:grid;grid-template-columns:repeat(3,1fr);width:100%}.subtab{padding:8px 5px;font-size:.8rem}.card{padding:15px}.card-head{align-items:center}.toolbar{justify-content:stretch}.filters{width:100%}.filters label{flex:1}.filters select,.filters input{width:100%}.document-index-row{grid-template-columns:1fr;padding:12px 14px}.participants li{grid-template-columns:3.5em 1fr}.buttons{display:grid;grid-template-columns:repeat(3,1fr);gap:7px}.answer{padding:9px 4px;font-size:.8rem}.profile-values,.profile-fields{grid-template-columns:1fr 1fr}.profile-section{padding:15px}.history-table th,.history-table td{padding:8px 9px}}
    #info-panel,#profile-content{display:grid;grid-template-columns:180px minmax(0,1fr);gap:28px;align-items:start}#info-panel[hidden]{display:none}.subtabs,.profile-tabs{position:sticky;top:16px;display:grid;gap:2px;margin:0;padding:2px 18px 2px 0;border:0;border-right:1px solid var(--line);border-radius:0;background:transparent}.subtab,.profile-tab{position:relative;appearance:none;width:100%;border:0;border-left:3px solid transparent;border-radius:0;background:transparent;color:var(--muted);padding:10px 12px;font:inherit;font-size:.86rem;font-weight:800;text-align:left;cursor:pointer;transition:color .15s ease,background .15s ease,border-color .15s ease}.subtab:hover,.profile-tab:hover{color:var(--navy);background:#f4f6fb}.subtab[aria-selected="true"],.profile-tab[aria-selected="true"]{border-left-color:var(--blue);background:#eef2fb;color:var(--navy);box-shadow:none}.subtab[aria-selected="true"]::after,.profile-tab[aria-selected="true"]::after{content:none}.info-view,.profile-view{grid-column:2;grid-row:1;min-width:0}.profile-layout{display:grid}.profile-view[hidden]{display:none}.profile-view>.profile-section+.profile-section{margin-top:14px}.profile-section{padding:0;border:0;border-radius:0;background:transparent}.profile-heading{padding-bottom:10px;border-bottom:1px solid var(--line)}.profile-values{gap:0 18px;border-bottom:1px solid var(--line)}.profile-value{padding:11px 0;border-radius:0;background:transparent}.profile-pending{padding:12px 14px;border:0;border-left:4px solid #d29a32;border-radius:0;background:#fff8e7}.history-heading{padding-bottom:10px;border-bottom:1px solid var(--line)}.profile-dialog{grid-column:1/-1}
    @media(max-width:720px){#info-panel,#profile-content{grid-template-columns:minmax(0,1fr);gap:18px}.subtabs,.profile-tabs{position:static;grid-template-columns:repeat(3,minmax(0,1fr));gap:0;padding:0 0 10px;border-right:0;border-bottom:1px solid var(--line)}.profile-tabs{grid-template-columns:repeat(2,minmax(0,1fr))}.subtab,.profile-tab{padding:9px 5px;border-left:0;border-bottom:3px solid transparent;font-size:.8rem;text-align:center}.subtab[aria-selected="true"],.profile-tab[aria-selected="true"]{border-bottom-color:var(--blue);background:transparent}.info-view,.profile-view{grid-column:1;grid-row:2}.profile-section{padding:0}.profile-pending{padding:12px 14px}.profile-dialog{grid-column:1}}
  </style>
</head>
<body>
  <header><div class="header-inner"><div class="brand"><h1>大会参加確認</h1><p>埼玉大学かるた会 メンバーポータル</p></div><div class="account" id="account" hidden><span id="account-name"></span><a href="/auth/logout">ログアウト</a></div></div></header>
  <main>
    <section class="login" id="login" hidden><h2>Discordでログイン</h2><p>承認済みメンバーだけが大会情報・参加希望者・大会要項を閲覧し、参加回答を変更できます。</p><a class="discord-button" href="/auth/discord"><span class="discord-mark">◈</span>Discordで続ける</a></section>
    <div id="app" hidden>
      <div class="welcome"><h2 id="welcome"></h2><p>回答はDiscordとWebで共通です。最後に保存した回答が反映されます。</p></div>
      <aside class="payment-alert" id="payment-alert" role="alert" hidden></aside>
      <nav class="tabs" role="tablist" aria-label="メンバーポータルの表示切替"><button class="tab" id="answer-tab" role="tab" aria-selected="true" aria-controls="answer-panel" data-tab="answer">参加回答<span class="tab-count" id="unanswered-count" hidden></span></button><button class="tab" id="info-tab" role="tab" aria-selected="false" aria-controls="info-panel" data-tab="info">大会情報</button><button class="tab" id="profile-tab" role="tab" aria-selected="false" aria-controls="profile-panel" data-tab="profile">マイページ</button></nav>
      <section class="panel" id="answer-panel" role="tabpanel" aria-labelledby="answer-tab"><div class="notice">DMが届かない場合も、ここから回答できます。参加希望者の一覧は「大会情報」の「開催予定」で確認できます。</div><div class="toolbar"><div class="filters"><label>回答状況<select id="answer-status-filter"><option value="all" selected>すべて</option><option value="yes">参加希望</option><option value="no">不参加</option><option value="maybe">未定</option><option value="unanswered">未回答</option></select></label></div></div><div class="list" id="answer-list"></div></section>
      <section class="panel" id="info-panel" role="tabpanel" aria-labelledby="info-tab" hidden><nav class="subtabs" role="tablist" aria-label="大会情報の表示切替"><button class="subtab" id="tournaments-view-tab" role="tab" aria-selected="true" aria-controls="tournaments-panel" data-view="tournaments">開催予定</button><button class="subtab" id="documents-view-tab" role="tab" aria-selected="false" aria-controls="documents-panel" data-view="documents">大会案内一覧</button><button class="subtab" id="archive-view-tab" role="tab" aria-selected="false" aria-controls="archive-panel" data-view="archive">過去の結果</button></nav>
        <section class="info-view" id="tournaments-panel" role="tabpanel" aria-labelledby="tournaments-view-tab"><div class="toolbar"><div class="filters"><label>表示<select id="status-filter"><option value="current">すべての進行中</option><option value="active">申込受付中</option><option value="applied">申込済み</option><option value="pre_lottery">抽選前</option><option value="confirmed">参加者確定</option></select></label><label>並び順<select id="sort"><option value="deadline">締切が近い順</option><option value="event">開催日が近い順</option><option value="created">登録が新しい順</option></select></label></div></div><div class="list" id="tournament-list"></div></section>
        <section class="info-view" id="documents-panel" role="tabpanel" aria-labelledby="documents-view-tab" hidden><div class="toolbar"><span class="document-index-count" id="document-index-count"></span><div class="filters"><label>大会名検索<input id="document-search" type="search" placeholder="大会名を入力"></label><label>並び順<select id="document-sort"><option value="newest">開催日が新しい順</option><option value="oldest">開催日が古い順</option></select></label></div></div><div class="document-index" id="document-index"></div></section>
        <section class="info-view" id="archive-panel" role="tabpanel" aria-labelledby="archive-view-tab" hidden><div class="list" id="archive-list"></div></section>
      </section>
      <section class="panel" id="profile-panel" role="tabpanel" aria-labelledby="profile-tab" hidden><div class="profile-layout" id="profile-content"></div></section>
    </div>
    <div class="loading" id="loading">大会情報を読み込んでいます…</div>
    <div class="fatal" id="fatal" hidden></div>
    <div class="toast" id="toast" role="status" aria-live="polite" hidden></div>
  </main>
  <script>
    const responseLabels={yes:'参加希望',maybe:'未定・条件付き',no:'不参加'};
    const statusLabels={active:'申込受付中',applied:'申込済み',pre_lottery:'抽選前',confirmed:'参加者確定',closed:'終了',no_participants:'参加者なし終了',canceled:'中止'};
    const entryStatusLabels={submitted:'申込済み（結果待ち）',selected:'出場確定',not_selected:'キャンセル待ち',withdrawn:'辞退'};
    const gradeLabels={beginner:'初心者',all:'すべて'};
    const rankLabels=['無段','初段','二段','三段','四段','五段','六段','七段','八段','九段','十段'];
    const typeLabels={official:'公認大会',support:'後援大会',event:'イベント'};
    let tournaments=[];
    let profile=null;
    const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
    const grade=value=>gradeLabels[value]||value+'級';
    const date=value=>new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'numeric',day:'numeric',weekday:'short'}).format(new Date(value+'T00:00:00+09:00'));
    const dateTime=value=>new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(value));
    async function api(path,options={}){const response=await fetch(path,{...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...options.headers}});if(!response.ok){const body=await response.json().catch(()=>({}));throw Object.assign(new Error(body.error||'通信に失敗しました。'),{status:response.status});}return response.json();}
    function groupRows(rows){const groups=new Map();for(const row of rows){const key=row.registration_group_id||row.tournament_id;const current=groups.get(key)||[];current.push(row);groups.set(key,current)}return [...groups.values()]}
    function tournamentStage(group){if(group.some(item=>item.status==='active'))return 'active';if(!group.some(item=>item.status==='applied'))return null;if(group.some(item=>item.participants.some(person=>person.entry_status==='selected')))return 'confirmed';if(group[0].confirmation_roster)return 'pre_lottery';return 'applied'}
    function filteredGroups(){const filter=document.querySelector('#status-filter').value;const sort=document.querySelector('#sort').value;let groups=groupRows(tournaments).filter(group=>{const stage=tournamentStage(group);return stage&&(filter==='current'||stage===filter)});groups.sort((a,b)=>{const get=(group)=>{if(sort==='event')return Math.min(...group.map(item=>new Date(item.event_start_date+'T00:00:00+09:00').getTime()));if(sort==='created')return -Math.max(...group.map(item=>new Date(item.created_at).getTime()));return Math.min(...group.map(item=>new Date(item.internal_deadline).getTime()))};return get(a)-get(b)});return groups}
    function documentLink(group,label='大会要項PDF'){const item=group.find(candidate=>candidate.has_document);return item?'<a class="document" href="/api/tournaments/'+encodeURIComponent(item.tournament_id)+'/document" target="_blank" rel="noopener">'+esc(label)+'</a>':'<span class="empty">なし</span>'}
    function archiveDocumentLink(group,type,label){const first=group[0];const groupKey=first.registration_group_id||first.tournament_id;const found=(first.archive_documents||[]).find(item=>item.document_type===type);return found?'<a class="document" href="/api/archives/'+encodeURIComponent(groupKey)+'/documents/'+encodeURIComponent(type)+'" target="_blank" rel="noopener">'+esc(label)+'</a>':'<span class="empty">なし</span>'}
    function tournamentResourceLinks(group,stage){const first=group[0];const groupKey=first.registration_group_id||first.tournament_id;const links=[documentLink(group,'▣ 大会要項PDF')];if(stage==='pre_lottery'&&first.confirmation_roster)links.push('<a class="document" href="/api/archives/'+encodeURIComponent(groupKey)+'/confirmation-roster" target="_blank" rel="noopener">▣ 申込確認名簿</a>');if(stage==='confirmed'){const roster=(first.archive_documents||[]).some(item=>item.document_type==='roster');if(roster)links.push(archiveDocumentLink(group,'roster','▣ 確定選手名簿'));if(first.participant_guidance){const guidancePath=first.participant_guidance.has_document?'guidance/document':'guidance';links.push('<a class="document" href="/api/archives/'+encodeURIComponent(groupKey)+'/'+guidancePath+'" target="_blank" rel="noopener">▣ 当日案内</a>')}}return '<div class="resource-links">'+links.join('')+'</div>'}
    function eligibleAnswerGroups(){return groupRows(tournaments).map(group=>({group,target:group.find(item=>item.eligible)})).filter(item=>item.target)}
    function canAnswer(target){const now=Date.now();const eventEnd=new Date(target.event_start_date+'T23:59:59.999+09:00').getTime();return target.status==='active'&&new Date(target.internal_deadline).getTime()>=now&&eventEnd>=now}
    function displayStatus(target){return target.status==='closed'&&target.closure_reason==='no_participants'?'no_participants':target.status}
    function renderPaymentAlert(){const alert=document.querySelector('#payment-alert');const overdue=groupRows(tournaments).map(group=>group.find(item=>item.own_payment_overdue)).filter(Boolean);if(!overdue.length){alert.hidden=true;alert.replaceChildren();return}alert.innerHTML='<strong>参加費のサークル内支払期限を過ぎています</strong><div>お早めに大会担当者へお支払いください。</div><ul>'+overdue.map(item=>'<li><span>'+esc(item.title)+'（期限 '+esc(dateTime(item.own_payment_deadline))+'）</span><button class="payment-complete" type="button" data-id="'+esc(item.tournament_id)+'">振込完了</button></li>').join('')+'</ul>';alert.hidden=false;alert.querySelectorAll('.payment-complete').forEach(button=>button.addEventListener('click',savePayment))}
    function answerGroups(){const filter=document.querySelector('#answer-status-filter').value;const statusOrder={unanswered:0,yes:1,no:2,maybe:3};const groups=eligibleAnswerGroups().filter(({target})=>canAnswer(target)).filter(({target})=>filter==='all'?(true):filter==='unanswered'?!target.own_response:target.own_response===filter);groups.sort((a,b)=>{const aStatus=a.target.own_response||'unanswered';const bStatus=b.target.own_response||'unanswered';const statusDifference=statusOrder[aStatus]-statusOrder[bStatus];if(statusDifference)return statusDifference;return new Date(a.target.internal_deadline).getTime()-new Date(b.target.internal_deadline).getTime()});return groups}
    function renderAnswers(){const list=document.querySelector('#answer-list');const availableGroups=eligibleAnswerGroups().filter(({target})=>canAnswer(target));const groups=answerGroups();const unanswered=availableGroups.filter(({target})=>!target.own_response).length;const badge=document.querySelector('#unanswered-count');badge.hidden=unanswered===0;badge.textContent=String(unanswered);if(!availableGroups.length){list.innerHTML='<div class="card empty">現在回答できる大会はありません。</div>';return}if(!groups.length){list.innerHTML='<div class="card empty">条件に一致する大会はありません。</div>';return}list.innerHTML=groups.map(({group,target})=>{const answerable=canAnswer(target);const answer=target.own_response||'';const targetStatus=displayStatus(target);const badgeLabel=answer?'回答済み':answerable?'未回答':statusLabels[targetStatus]||'受付終了';const badgeClass=answer?'answered':answerable?'pending':targetStatus;const buttons=Object.entries(responseLabels).map(([value,label])=>'<button class="answer '+(answer===value?'selected '+value:'')+'" data-id="'+esc(target.tournament_id)+'" data-response="'+value+'" '+(answerable?'':'disabled')+'>'+label+'</button>').join('');const gradeName=target.all_grades?'すべて':grade(target.grade);const waitlist=target.own_entry_status==='not_selected'&&target.own_waitlist_number?' '+target.own_waitlist_number+'番':'';const entryResult=target.own_entry_status?' ／ 申込・抽選結果: '+(entryStatusLabels[target.own_entry_status]||target.own_entry_status)+waitlist:'';return '<article class="card response-card"><div class="card-head"><div class="title-row"><h3 class="title">'+esc(target.title)+'</h3></div><span class="status '+esc(badgeClass)+'">'+esc(badgeLabel)+'</span></div><div class="info-grid"><div class="info-cell"><span class="info-label">大会日程</span><span class="info-value">'+esc(date(target.event_start_date))+'</span></div><div class="info-cell"><span class="info-label">開催級</span><span class="info-value">'+esc(gradeName)+'</span></div><div class="info-cell"><span class="info-label">回答締切</span><span class="info-value">'+esc(dateTime(target.internal_deadline))+'</span></div><div class="info-cell"><span class="info-label">要項</span><span class="info-value">'+documentLink(group,'PDFを開く')+'</span></div></div>'+(target.venue?'<p class="venue-note">会場 '+esc(target.venue)+'</p>':'')+'<div class="answer-area"><span class="answer-label">回答</span><div class="buttons">'+buttons+'</div><p class="message">'+(answerable?'現在の回答: '+esc(answer?responseLabels[answer]:'未回答'):'現在は回答を変更できません。')+esc(entryResult)+'</p></div></article>'}).join('');document.querySelectorAll('#answer-list .answer').forEach(button=>button.addEventListener('click',saveAnswer))}
    function renderTournamentList(){const list=document.querySelector('#tournament-list');const groups=filteredGroups();if(!groups.length){list.innerHTML='<div class="card empty">条件に一致する大会はありません。</div>';return}list.innerHTML=groups.map(group=>{const first=group[0];const stage=tournamentStage(group);const gradeNames=[...new Set(group.map(item=>item.all_grades?'すべて':grade(item.grade)))];const uniqueDates=[...new Set(group.map(item=>item.event_start_date))];const dateLabel=uniqueDates.length===1?date(uniqueDates[0]):group.map(item=>(item.all_grades?'すべて':grade(item.grade))+' '+date(item.event_start_date)).join(' / ');const participants=group.flatMap(item=>item.participants.map(person=>({...person,tournamentGrade:item.all_grades?person.grade:item.grade})));const people=participants.length?participants.map(person=>{const waitlist=person.entry_status==='not_selected'&&person.waitlist_number?' '+person.waitlist_number+'番':'';const result=person.entry_status?' ／ '+(entryStatusLabels[person.entry_status]||person.entry_status)+waitlist:'';return '<li><strong>'+esc(grade(person.tournamentGrade))+'</strong><span>'+esc(person.display_name)+(person.display_name_kana?' <small>('+esc(person.display_name_kana)+')</small>':'')+esc(result)+'</span></li>'}).join(''):'<li class="empty">まだ参加希望者はいません。</li>';return '<article class="card tournament-card"><div class="card-head"><div class="title-row"><h3 class="title">'+esc(first.title)+'</h3><span class="status '+esc(stage)+'">'+esc(statusLabels[stage]||stage)+'</span></div><span class="count">'+participants.length+'名</span></div><div class="meta"><span>大会日 '+esc(dateLabel)+'</span><span>締切 '+esc(dateTime(first.internal_deadline))+'</span><span>開催級 '+esc(gradeNames.join('、'))+'</span>'+(first.venue?'<span>会場 '+esc(first.venue)+'</span>':'')+'</div><ul class="participants">'+people+'</ul>'+tournamentResourceLinks(group,stage)+'</article>'}).join('')}
    function renderDocumentIndex(){const list=document.querySelector('#document-index');const count=document.querySelector('#document-index-count');const query=document.querySelector('#document-search').value.trim().toLocaleLowerCase('ja');const direction=document.querySelector('#document-sort').value==='oldest'?1:-1;const groups=groupRows(tournaments).filter(group=>group.some(item=>item.has_document)).filter(group=>{if(!query)return true;const grades=[...new Set(group.map(item=>item.all_grades?'すべて':grade(item.grade)))].join('、');return (group[0].title+' '+grades).toLocaleLowerCase('ja').includes(query)}).sort((a,b)=>direction*(Math.max(...a.map(item=>new Date(item.event_start_date+'T00:00:00+09:00').getTime()))-Math.max(...b.map(item=>new Date(item.event_start_date+'T00:00:00+09:00').getTime()))));count.textContent=groups.length+'件';if(!groups.length){list.innerHTML='<div class="card empty">条件に一致する大会案内はありません。</div>';return}list.innerHTML=groups.map(group=>{const first=group[0];const gradeNames=[...new Set(group.map(item=>item.all_grades?'すべて':grade(item.grade)))];const uniqueDates=[...new Set(group.map(item=>item.event_start_date))];const dateLabel=uniqueDates.length===1?date(uniqueDates[0]):group.map(item=>(item.all_grades?'すべて':grade(item.grade))+' '+date(item.event_start_date)).join(' / ');return '<article class="document-index-row"><div><div class="document-index-title">'+esc(first.title)+'</div><div class="document-index-meta"><span>大会日 '+esc(dateLabel)+'</span><span>開催級 '+esc(gradeNames.join('、'))+'</span></div></div>'+documentLink(group,'▣ 要項PDFを開く')+'</article>'}).join('')}
    function renderArchives(){const list=document.querySelector('#archive-list');const groups=groupRows(tournaments).filter(group=>group.some(item=>item.archive_published_at)).sort((a,b)=>Math.max(...b.map(item=>new Date(item.event_start_date+'T00:00:00+09:00').getTime()))-Math.max(...a.map(item=>new Date(item.event_start_date+'T00:00:00+09:00').getTime())));if(!groups.length){list.innerHTML='<div class="card empty">公開済みの大会記録はまだありません。</div>';return}list.innerHTML=groups.map(group=>{const first=group[0];const uniqueDates=[...new Set(group.map(item=>item.event_start_date))];const dateLabel=uniqueDates.length===1?date(uniqueDates[0]):group.map(item=>(item.all_grades?'すべて':grade(item.grade))+' '+date(item.event_start_date)).join(' / ');const entrants=group.flatMap(item=>item.participants.filter(person=>person.entry_status==='submitted'||person.entry_status==='selected').map(person=>({...person,tournamentGrade:item.all_grades?person.grade:item.grade})));const rows=entrants.map(person=>'<li><strong>'+esc(grade(person.tournamentGrade))+'</strong><span>'+esc(person.display_name)+(person.display_name_kana?' <small>('+esc(person.display_name_kana)+')</small>':'')+' — '+esc(person.result_text||'成績未登録')+'</span></li>').join('');return '<article class="card archive-card"><div class="card-head"><div class="title-row"><h3 class="title">'+esc(first.title)+'</h3><span class="status applied">大会記録</span></div><span class="count">'+entrants.length+'名</span></div><div class="meta"><span>大会日 '+esc(dateLabel)+'</span>'+(first.venue?'<span>会場 '+esc(first.venue)+'</span>':'')+'</div><div class="section-title">出場者・成績</div><ul class="participants">'+rows+'</ul><div class="section-title">'+documentLink(group,'▣ 大会要項')+'　'+archiveDocumentLink(group,'roster','▣ 選手名簿')+'　'+archiveDocumentLink(group,'results','▣ 結果ファイル')+'</div></article>'}).join('')}
    function profileGrade(value){return value==='beginner'?'初心者':value+'級'}
    function eventMonth(value){const [year,month]=value.split('-').map(Number);return year+'年'+month+'月'}
    function fiscalGradeSummary(){const counts=profile.fiscal_grade_counts||{};const items=['A','B','C','D','E','F','beginner'].filter(value=>Number(counts[value]||0)>0).map(value=>profileGrade(value)+Number(counts[value])+'回');return profile.fiscal_year+'年度：'+(items.length?items.join('、'):'出場なし')}
    function profileRequestValues(){const pending=profile.pending_request;return pending?{last_name:pending.requested_last_name,first_name:pending.requested_first_name,last_name_kana:pending.requested_last_name_kana,first_name_kana:pending.requested_first_name_kana,grade:pending.requested_grade,rank:pending.requested_rank}:profile.member}
    function renderProfile(){const root=document.querySelector('#profile-content');if(!profile){root.innerHTML='<div class="card empty">マイページを読み込んでいます…</div>';return}const member=profile.member;const pending=profile.pending_request;const values=profileRequestValues();const gradeOptions=['A','B','C','D','E','F','beginner'].map(value=>'<option value="'+value+'" '+(values.grade===value?'selected':'')+'>'+esc(profileGrade(value))+'</option>').join('');const rankOptions=rankLabels.map((label,value)=>'<option value="'+value+'" '+(Number(values.rank)===value?'selected':'')+'>'+esc(label)+'</option>').join('');const pendingBox=pending?'<section class="profile-section profile-pending"><strong>登録内容の変更申請は承認待ちです</strong><p>'+esc(pending.requested_last_name+pending.requested_first_name)+'（'+esc(pending.requested_last_name_kana+pending.requested_first_name_kana)+'）・'+esc(profileGrade(pending.requested_grade))+'・'+esc(rankLabels[pending.requested_rank]||'段位不明')+'</p></section>':'';const historyRows=profile.appearances.length?profile.appearances.map(item=>'<tr><td>'+esc(eventMonth(item.event_start_date))+'</td><td>'+esc(item.title)+'</td><td>'+esc(profileGrade(item.grade))+'</td><td>'+esc(item.result_text||'未登録')+'</td></tr>').join(''):'<tr><td colspan="4" class="empty">出場履歴はありません。</td></tr>';root.innerHTML='<section class="profile-section"><div class="profile-heading"><h3>現在の登録情報</h3><button class="profile-edit-button" id="profile-edit-button" type="button">編集</button></div><div class="profile-values"><div class="profile-value"><small>氏名</small><strong>'+esc(member.last_name+member.first_name)+'</strong></div><div class="profile-value"><small>よみがな</small><strong>'+esc(member.last_name_kana+member.first_name_kana)+'</strong></div><div class="profile-value"><small>出場級</small><strong>'+esc(profileGrade(member.grade))+'</strong></div><div class="profile-value"><small>段位</small><strong>'+esc(rankLabels[member.rank]||'段位不明')+'</strong></div></div></section>'+pendingBox+'<section class="profile-section"><div class="history-heading"><h3>大会出場履歴</h3><span class="history-summary">（'+esc(fiscalGradeSummary())+'）</span></div><div class="history-table-wrap"><table class="history-table"><thead><tr><th>開催月</th><th>大会名</th><th>出場級</th><th>戦績</th></tr></thead><tbody>'+historyRows+'</tbody></table></div></section><dialog class="profile-dialog" id="profile-dialog"><div class="profile-dialog-head"><h3>登録情報を編集</h3><button class="profile-dialog-close" type="button" aria-label="閉じる">×</button></div><form class="profile-form" id="profile-form"><p class="profile-note">「更新」を押すと変更依頼が送信され、担当者の承認後にマイページへ反映されます。</p><div class="profile-fields"><label>苗字<input name="lastName" required maxlength="50" autocomplete="family-name" value="'+esc(values.last_name)+'"></label><label>名前<input name="firstName" required maxlength="50" autocomplete="given-name" value="'+esc(values.first_name)+'"></label><label>苗字よみがな<input name="lastNameKana" required maxlength="100" value="'+esc(values.last_name_kana)+'"></label><label>名前よみがな<input name="firstNameKana" required maxlength="100" value="'+esc(values.first_name_kana)+'"></label><label>出場級<select name="grade" required>'+gradeOptions+'</select></label><label>段位<select name="rank" required>'+rankOptions+'</select></label></div><div class="profile-actions"><span class="message" id="profile-message"></span><button class="profile-cancel" type="button">キャンセル</button><button class="profile-submit" type="submit">更新</button></div></form></dialog>';const dialog=document.querySelector('#profile-dialog');document.querySelector('#profile-edit-button').addEventListener('click',()=>dialog.showModal());dialog.querySelector('.profile-dialog-close').addEventListener('click',()=>dialog.close());dialog.querySelector('.profile-cancel').addEventListener('click',()=>dialog.close());dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close()});document.querySelector('#profile-form').addEventListener('submit',saveProfile)}
    let selectedProfileView='registration';
    function selectProfileView(name){const selected=name==='history'?'history':'registration';selectedProfileView=selected;document.querySelectorAll('#profile-content .profile-tab').forEach(tab=>tab.setAttribute('aria-selected',String(tab.dataset.profileView===selected)));const registration=document.querySelector('#profile-registration-view');const history=document.querySelector('#profile-history-view');if(registration)registration.hidden=selected!=='registration';if(history)history.hidden=selected!=='history'}
    function enhanceProfileTabs(){const root=document.querySelector('#profile-content');if(!profile||root.querySelector('.profile-tabs'))return;const sections=[...root.querySelectorAll(':scope > .profile-section')];const historySection=sections.find(section=>section.querySelector('.history-table'));const dialog=root.querySelector(':scope > .profile-dialog');if(!historySection||!dialog)return;const tabs=document.createElement('nav');tabs.className='profile-tabs';tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','マイページの表示切替');tabs.innerHTML='<button class="profile-tab" id="profile-registration-tab" type="button" role="tab" aria-selected="true" aria-controls="profile-registration-view" data-profile-view="registration">登録情報</button><button class="profile-tab" id="profile-history-tab" type="button" role="tab" aria-selected="false" aria-controls="profile-history-view" data-profile-view="history">出場履歴</button>';const registrationView=document.createElement('div');registrationView.className='profile-view';registrationView.id='profile-registration-view';registrationView.setAttribute('role','tabpanel');registrationView.setAttribute('aria-labelledby','profile-registration-tab');sections.filter(section=>section!==historySection).forEach(section=>registrationView.append(section));const historyView=document.createElement('div');historyView.className='profile-view';historyView.id='profile-history-view';historyView.setAttribute('role','tabpanel');historyView.setAttribute('aria-labelledby','profile-history-tab');historyView.append(historySection);root.insertBefore(tabs,dialog);root.insertBefore(registrationView,dialog);root.insertBefore(historyView,dialog);tabs.querySelectorAll('.profile-tab').forEach(tab=>tab.addEventListener('click',()=>selectProfileView(tab.dataset.profileView)));selectProfileView(selectedProfileView)}
    new MutationObserver(()=>enhanceProfileTabs()).observe(document.querySelector('#profile-content'),{childList:true});
    function render(){renderPaymentAlert();renderAnswers();renderTournamentList();renderDocumentIndex();renderArchives();renderProfile()}
    let toastTimer;function showToast(text){const toast=document.querySelector('#toast');toast.textContent=text;toast.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{toast.hidden=true},2600)}
    let selectedInfoView='tournaments';
    function selectInfoView(name,updateHash=true){const selected=['documents','archive'].includes(name)?name:'tournaments';selectedInfoView=selected;document.querySelectorAll('.subtab').forEach(tab=>tab.setAttribute('aria-selected',String(tab.dataset.view===selected)));document.querySelector('#tournaments-panel').hidden=selected!=='tournaments';document.querySelector('#documents-panel').hidden=selected!=='documents';document.querySelector('#archive-panel').hidden=selected!=='archive';if(updateHash)history.replaceState(null,'','#'+selected)}
    function selectTab(name,updateHash=true){const infoView=['tournaments','documents','archive'].includes(name)?name:null;const selected=infoView||name==='info'?'info':name==='profile'?'profile':'answer';document.querySelectorAll('.tab').forEach(tab=>tab.setAttribute('aria-selected',String(tab.dataset.tab===selected)));document.querySelector('#answer-panel').hidden=selected!=='answer';document.querySelector('#info-panel').hidden=selected!=='info';document.querySelector('#profile-panel').hidden=selected!=='profile';if(selected==='info')selectInfoView(infoView||selectedInfoView,updateHash);else if(updateHash)history.replaceState(null,'','#'+selected)}
    async function saveAnswer(event){const button=event.currentTarget;const card=button.closest('.card');const buttons=[...card.querySelectorAll('.answer')];buttons.forEach(item=>item.disabled=true);const message=card.querySelector('.message');message.classList.remove('error');message.textContent='保存しています…';try{await api('/api/tournaments/'+encodeURIComponent(button.dataset.id)+'/response',{method:'PUT',body:JSON.stringify({response:button.dataset.response})});const target=tournaments.find(item=>item.tournament_id===button.dataset.id);if(target)target.own_response=button.dataset.response;render();showToast('回答を保存しました。')}catch(error){message.textContent=error.message;message.classList.add('error');buttons.forEach(item=>item.disabled=false)}}
    async function savePayment(event){const button=event.currentTarget;const label=button.textContent;button.disabled=true;button.textContent='保存中…';try{await api('/api/tournaments/'+encodeURIComponent(button.dataset.id)+'/payment',{method:'PUT'});tournaments.filter(item=>item.tournament_id===button.dataset.id).forEach(item=>{item.own_payment_overdue=false;item.own_payment_deadline=null});renderPaymentAlert();showToast('振込完了を保存しました。')}catch(error){button.disabled=false;button.textContent=label;showToast(error.message)}}
    async function saveProfile(event){event.preventDefault();const form=event.currentTarget;const button=form.querySelector('.profile-submit');const message=form.querySelector('#profile-message');button.disabled=true;message.textContent='申請中…';const fields=new FormData(form);try{const data=await api('/api/profile',{method:'PUT',body:JSON.stringify({lastName:fields.get('lastName'),firstName:fields.get('firstName'),lastNameKana:fields.get('lastNameKana'),firstNameKana:fields.get('firstNameKana'),grade:fields.get('grade'),rank:Number(fields.get('rank'))})});profile=data.profile;renderProfile();showToast('登録内容の変更を申請しました。')}catch(error){button.disabled=false;message.textContent=error.message;message.classList.add('error')}}
    let refreshing=false;async function refreshTournaments(){if(refreshing)return;refreshing=true;try{const data=await api('/api/tournaments');tournaments=data.tournaments;render()}catch(error){console.error('大会情報の再読み込みに失敗しました。',error)}finally{refreshing=false}}
    async function start(){try{const session=await api('/api/session');document.querySelector('#account').hidden=false;document.querySelector('#account-name').textContent=session.member.display_name;document.querySelector('#welcome').textContent=session.member.display_name+'さん';const [tournamentData,profileData]=await Promise.all([api('/api/tournaments'),api('/api/profile')]);tournaments=tournamentData.tournaments;profile=profileData.profile;document.querySelector('#loading').hidden=true;document.querySelector('#app').hidden=false;render();selectTab(location.hash.slice(1),false)}catch(error){document.querySelector('#loading').hidden=true;if(error.status===401){document.querySelector('#login').hidden=false}else{const fatal=document.querySelector('#fatal');fatal.hidden=false;fatal.textContent=error.message}}}
    document.querySelectorAll('.tab').forEach(tab=>tab.addEventListener('click',()=>selectTab(tab.dataset.tab)));document.querySelectorAll('.subtab').forEach(tab=>tab.addEventListener('click',()=>selectInfoView(tab.dataset.view)));window.addEventListener('hashchange',()=>selectTab(location.hash.slice(1),false));window.addEventListener('focus',refreshTournaments);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshTournaments()});document.querySelector('#answer-status-filter').addEventListener('change',renderAnswers);document.querySelector('#status-filter').addEventListener('change',renderTournamentList);document.querySelector('#sort').addEventListener('change',renderTournamentList);document.querySelector('#document-search').addEventListener('input',renderDocumentIndex);document.querySelector('#document-sort').addEventListener('change',renderDocumentIndex);start();
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
  if (request.method === "GET" && url.pathname === "/api/profile") {
    try {
      return json({ profile: await loadPortalProfile(env, member) });
    } catch (error) {
      console.error("Portal profile load error", error);
      return json({ error: "マイページを取得できませんでした。" }, 500);
    }
  }
  if (request.method === "PUT" && url.pathname === "/api/profile") {
    if (!sameOrigin(request)) return json({ error: "不正な送信元です。" }, 403);
    if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
      return json({ error: "JSON形式で送信してください。" }, 415);
    }
    try {
      const body = await request.json<Record<string, unknown>>();
      await submitMemberRegistrationRequest(env.DB, {
        discordUserId: member.discord_user_id,
        lastName: String(body.lastName ?? ""),
        firstName: String(body.firstName ?? ""),
        lastNameKana: String(body.lastNameKana ?? ""),
        firstNameKana: String(body.firstNameKana ?? ""),
        grade: String(body.grade ?? ""),
        rank: Number(body.rank),
      });
      return json({ profile: await loadPortalProfile(env, member) });
    } catch (error) {
      const message = error instanceof Error ? error.message : "変更申請を保存できませんでした。";
      return json({ error: message }, 400);
    }
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
  const paymentPath = url.pathname.match(/^\/api\/tournaments\/(T-[0-9a-f-]{36})\/payment$/);
  if (request.method === "PUT" && paymentPath) {
    if (!sameOrigin(request)) return json({ error: "不正な送信元です。" }, 403);
    try {
      await recordParticipantPaymentResponse(env, {
        tournamentId: paymentPath[1],
        discordUserId: member.discord_user_id,
        status: "paid",
        changedBy: `portal:${member.discord_user_id}`,
      });
      return json({ status: "paid" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "振込完了を保存できませんでした。";
      console.error("Portal payment save error", error);
      return json({ error: message }, 409);
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
  const confirmationRosterPath = url.pathname.match(
    /^\/api\/archives\/((?:T|TG)-[0-9a-f-]{36})\/confirmation-roster$/,
  );
  if (request.method === "GET" && confirmationRosterPath) {
    return servePortalConfirmationRoster(env, confirmationRosterPath[1]);
  }
  const guidancePath = url.pathname.match(
    /^\/api\/archives\/((?:T|TG)-[0-9a-f-]{36})\/guidance$/,
  );
  if (request.method === "GET" && guidancePath) {
    return servePortalGuidance(env, guidancePath[1]);
  }
  const guidanceDocumentPath = url.pathname.match(
    /^\/api\/archives\/((?:T|TG)-[0-9a-f-]{36})\/guidance\/document$/,
  );
  if (request.method === "GET" && guidanceDocumentPath) {
    return servePortalGuidanceDocument(env, guidanceDocumentPath[1]);
  }
  return new Response("Not Found", { status: 404, headers: securityHeaders });
}

export default {
  fetch(request: Request, env: PortalEnv, ctx: ExecutionContext): Promise<Response> {
    return handlePortalRequest(request, env, ctx);
  },
} satisfies ExportedHandler<PortalEnv>;
