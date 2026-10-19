export interface AdminAuthEnv {
  DB: D1Database;
  DISCORD_APPLICATION_ID?: string;
  DISCORD_CLIENT_SECRET?: string;
  DISCORD_REDIRECT_URI?: string;
  DISCORD_GUILD_ID?: string;
  SESSION_SECRET?: string;
}

export interface AdminPrincipal {
  provider: "discord";
  displayName: string;
  auditIdentity: string;
  discordUserId: string;
}

interface AdminSessionPayload {
  discordUserId: string;
  displayName: string;
  issuedAt: number;
  expiresAt: number;
}

interface DiscordTokenResponse {
  access_token?: string;
}

interface DiscordUserResponse {
  id?: string;
  username?: string;
  global_name?: string | null;
}

interface DiscordGuildMemberResponse {
  nick?: string | null;
  roles?: string[];
}

const SESSION_COOKIE = "__Host-sukc_admin_session";
const OAUTH_STATE_COOKIE = "__Host-sukc_admin_oauth_state";
const OAUTH_VERIFIER_COOKIE = "__Host-sukc_admin_oauth_verifier";
const OAUTH_RETURN_COOKIE = "__Host-sukc_admin_oauth_return";
const SESSION_SECONDS = 8 * 60 * 60;
const OAUTH_COOKIE_SECONDS = 10 * 60;
const DISCORD_ID = /^\d{15,22}$/;

const securityHeaders: Record<string, string> = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self' https://discord.com",
  ].join("; "),
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: securityHeaders });
}

function htmlPage(title: string, message: string, status: number): Response {
  const html = `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>*{box-sizing:border-box}body{margin:0;background:#f4f6fa;color:#172033;font-family:system-ui,-apple-system,"Hiragino Sans","Yu Gothic UI",sans-serif}.card{max-width:560px;margin:12vh auto;padding:32px;background:#fff;border:1px solid #dce1eb;border-radius:16px;box-shadow:0 14px 40px #17203314}h1{margin:0 0 14px;font-size:1.35rem}p{margin:0;line-height:1.8}.button{display:inline-block;margin-top:20px;padding:11px 17px;border-radius:9px;background:#3658b2;color:#fff;text-decoration:none;font-weight:750}</style><main class="card"><h1>${title}</h1><p>${message}</p><a class="button" href="/auth/discord">Discordでログインし直す</a></main></html>`;
  return new Response(html, {
    status,
    headers: { ...securityHeaders, "Content-Type": "text/html; charset=utf-8" },
  });
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function utf8ToBase64Url(value: string): string {
  return bytesToBase64Url(new TextEncoder().encode(value));
}

function base64UrlToUtf8(value: string): string {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  return new TextDecoder().decode(
    Uint8Array.from(binary, (character) => character.charCodeAt(0)),
  );
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
  const result = new Map<string, string>();
  for (const entry of (request.headers.get("Cookie") ?? "").split(";")) {
    const separator = entry.indexOf("=");
    if (separator < 1) continue;
    result.set(entry.slice(0, separator).trim(), entry.slice(separator + 1).trim());
  }
  return result;
}

function cookie(name: string, value: string, maxAge: number): string {
  return `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

function safeReturnTo(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/register";
  return raw;
}

async function createSession(payload: AdminSessionPayload, secret: string): Promise<string> {
  const encoded = utf8ToBase64Url(JSON.stringify(payload));
  return `${encoded}.${await hmac(encoded, secret)}`;
}

async function readSession(request: Request, secret: string): Promise<AdminSessionPayload | null> {
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
    const payload = JSON.parse(base64UrlToUtf8(encoded)) as AdminSessionPayload;
    if (
      !DISCORD_ID.test(payload.discordUserId) ||
      typeof payload.displayName !== "string" ||
      payload.displayName.length === 0 ||
      !Number.isFinite(payload.expiresAt) ||
      payload.expiresAt <= Math.floor(Date.now() / 1000)
    ) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function readAdminDiscordPrincipal(
  request: Request,
  env: AdminAuthEnv,
): Promise<AdminPrincipal | null> {
  if (!env.SESSION_SECRET) return null;
  const session = await readSession(request, env.SESSION_SECRET);
  if (!session) return null;
  return {
    provider: "discord",
    displayName: session.displayName,
    auditIdentity: `discord:${session.discordUserId}`,
    discordUserId: session.discordUserId,
  };
}

async function beginDiscordLogin(request: Request, env: AdminAuthEnv): Promise<Response> {
  if (!env.DISCORD_APPLICATION_ID || !env.DISCORD_REDIRECT_URI) {
    return json({ error: "Discord担当者ログインの設定が完了していません。" }, 503);
  }
  const state = randomBase64Url();
  const verifier = randomBase64Url(48);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const authorizeUrl = new URL("https://discord.com/oauth2/authorize");
  authorizeUrl.search = new URLSearchParams({
    response_type: "code",
    client_id: env.DISCORD_APPLICATION_ID,
    scope: "identify guilds.members.read",
    redirect_uri: env.DISCORD_REDIRECT_URI,
    state,
    code_challenge: bytesToBase64Url(new Uint8Array(digest)),
    code_challenge_method: "S256",
  }).toString();
  const returnTo = safeReturnTo(new URL(request.url).searchParams.get("return_to"));
  const headers = new Headers({ Location: authorizeUrl.toString(), ...securityHeaders });
  headers.append("Set-Cookie", cookie(OAUTH_STATE_COOKIE, state, OAUTH_COOKIE_SECONDS));
  headers.append("Set-Cookie", cookie(OAUTH_VERIFIER_COOKIE, verifier, OAUTH_COOKIE_SECONDS));
  headers.append("Set-Cookie", cookie(OAUTH_RETURN_COOKIE, encodeURIComponent(returnTo), OAUTH_COOKIE_SECONDS));
  return new Response(null, { status: 302, headers });
}

async function finishDiscordLogin(request: Request, env: AdminAuthEnv): Promise<Response> {
  if (
    !env.DISCORD_APPLICATION_ID ||
    !env.DISCORD_CLIENT_SECRET ||
    !env.DISCORD_REDIRECT_URI ||
    !env.DISCORD_GUILD_ID ||
    !env.SESSION_SECRET
  ) return json({ error: "Discord担当者ログインの設定が完了していません。" }, 503);

  const url = new URL(request.url);
  const cookies = parseCookies(request);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const issuer = url.searchParams.get("iss");
  const verifier = cookies.get(OAUTH_VERIFIER_COOKIE);
  if (
    !state ||
    !code ||
    state !== cookies.get(OAUTH_STATE_COOKIE) ||
    !verifier ||
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
      code_verifier: verifier,
    }),
  });
  if (!tokenResponse.ok) {
    console.error("Discord admin OAuth token exchange failed", tokenResponse.status);
    return json({ error: "Discordログインに失敗しました。" }, 502);
  }
  const token = await tokenResponse.json<DiscordTokenResponse>();
  if (!token.access_token) return json({ error: "Discordログインに失敗しました。" }, 502);

  const authorization = { Authorization: `Bearer ${token.access_token}` };
  const [userResponse, memberResponse] = await Promise.all([
    fetch("https://discord.com/api/v10/users/@me", { headers: authorization }),
    fetch(`https://discord.com/api/v10/users/@me/guilds/${env.DISCORD_GUILD_ID}/member`, {
      headers: authorization,
    }),
  ]);
  if (!userResponse.ok || !memberResponse.ok) {
    return htmlPage(
      "サーバー所属を確認できません",
      "本番Discordサーバーへ参加しているアカウントでログインしてください。",
      403,
    );
  }
  const user = await userResponse.json<DiscordUserResponse>();
  const member = await memberResponse.json<DiscordGuildMemberResponse>();
  if (!user.id || !DISCORD_ID.test(user.id)) {
    return json({ error: "Discordユーザーを確認できませんでした。" }, 502);
  }

  const settings = await env.DB.prepare(
    `SELECT admin_role_id FROM discord_settings WHERE guild_id = ? LIMIT 1`,
  ).bind(env.DISCORD_GUILD_ID).first<{ admin_role_id: string | null }>();
  const adminRoleId = settings?.admin_role_id?.trim();
  if (!adminRoleId || !DISCORD_ID.test(adminRoleId)) {
    return htmlPage(
      "大会担当者ロールが未設定です",
      "Discordの大会担当者ロールIDをシステムへ登録してから、もう一度お試しください。",
      503,
    );
  }
  if (!Array.isArray(member.roles) || !member.roles.includes(adminRoleId)) {
    return htmlPage(
      "大会担当者権限がありません",
      "この管理画面は、Discordで大会担当者ロールを付与されたメンバーだけが利用できます。",
      403,
    );
  }

  const displayName = (member.nick || user.global_name || user.username || "Discord担当者").slice(0, 100);
  const now = Math.floor(Date.now() / 1000);
  const session = await createSession({
    discordUserId: user.id,
    displayName,
    issuedAt: now,
    expiresAt: now + SESSION_SECONDS,
  }, env.SESSION_SECRET);
  let returnTo = "/register";
  try {
    returnTo = safeReturnTo(decodeURIComponent(cookies.get(OAUTH_RETURN_COOKIE) ?? ""));
  } catch {
    returnTo = "/register";
  }
  const headers = new Headers({ Location: returnTo, ...securityHeaders });
  headers.append("Set-Cookie", cookie(SESSION_COOKIE, session, SESSION_SECONDS));
  headers.append("Set-Cookie", cookie(OAUTH_STATE_COOKIE, "", 0));
  headers.append("Set-Cookie", cookie(OAUTH_VERIFIER_COOKIE, "", 0));
  headers.append("Set-Cookie", cookie(OAUTH_RETURN_COOKIE, "", 0));
  return new Response(null, { status: 302, headers });
}

function logout(): Response {
  const headers = new Headers({ Location: "/", ...securityHeaders });
  headers.append("Set-Cookie", cookie(SESSION_COOKIE, "", 0));
  return new Response(null, { status: 302, headers });
}

export async function handleAdminAuthRequest(
  request: Request,
  env: AdminAuthEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/auth/discord") {
    return beginDiscordLogin(request, env);
  }
  if (request.method === "GET" && url.pathname === "/auth/discord/callback") {
    return finishDiscordLogin(request, env);
  }
  if (request.method === "GET" && url.pathname === "/auth/logout") {
    return logout();
  }
  return null;
}
