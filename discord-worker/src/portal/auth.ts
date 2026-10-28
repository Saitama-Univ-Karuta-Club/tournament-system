import { htmlResponse, json, securityHeaders } from "./http";
import type { PortalEnv, PortalMemberRow, SessionPayload } from "./types";

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

export async function loadSessionMember(
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

export async function refreshedSessionCookie(
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

export async function beginDiscordLogin(request: Request, env: PortalEnv): Promise<Response> {
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

export async function finishDiscordLogin(
  request: Request,
  env: PortalEnv,
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
  if (!member) return memberOnlyPage();

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
  const body = `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>メンバー登録が必要です</title><style>body{margin:0;background:#f4f6fb;color:#17213a;font-family:system-ui,sans-serif}.card{max-width:560px;margin:12vh auto;background:#fff;border:1px solid #dbe2f0;border-radius:18px;padding:32px;box-shadow:0 14px 40px #27396614}h1{font-size:1.45rem}p{line-height:1.8}.button{display:inline-block;margin-top:10px;padding:12px 18px;border-radius:10px;background:#425ba8;color:#fff;text-decoration:none;font-weight:700}</style><main class="card"><h1>承認済みメンバーを確認できませんでした</h1><p>Discordで <code>/member-register</code> を実行し、担当者の承認後にもう一度ログインしてください。すでに登録済みの場合は、担当者へお問い合わせください。</p><a class="button" href="/auth/discord">もう一度ログイン</a></main></html>`;
  return htmlResponse(body, "no-store", 403);
}

export function logoutResponse(): Response {
  return new Response(null, {
    status: 302,
    headers: { ...securityHeaders, Location: "/", "Set-Cookie": cookie(SESSION_COOKIE, "", 0) },
  });
}
