import {
  beginDiscordLogin,
  finishDiscordLogin,
  loadSessionMember,
  logoutResponse,
  refreshedSessionCookie,
} from "./portal/auth";
import {
  servePortalArchiveDocument,
  servePortalConfirmationRoster,
  servePortalDocument,
  servePortalGuidance,
  servePortalGuidanceDocument,
} from "./portal/documents";
import { htmlResponse, json, sameOrigin, securityHeaders } from "./portal/http";
import { loadPortalProfile, submitPortalProfileRequest } from "./portal/profile";
import { handlePracticePortalRequest } from "./portal/practice";
import {
  listPortalTournaments,
  PortalError,
  RESPONSE_LABELS,
  saveParticipantPayment,
  saveWebResponse,
} from "./portal/tournaments";
import type { PortalEnv } from "./portal/types";
import { googleBackupInformationHtml, portalHtml } from "./portal/ui/shell";

export type { PortalEnv } from "./portal/types";

export async function handlePortalRequest(
  request: Request,
  env: PortalEnv,
  ctx: Pick<ExecutionContext, "waitUntil">,
): Promise<Response> {
  void ctx;
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/google-backup") {
    return htmlResponse(googleBackupInformationHtml("home"), "public, max-age=3600");
  }
  if (request.method === "GET" && url.pathname === "/google-backup/privacy") {
    return htmlResponse(googleBackupInformationHtml("privacy"), "public, max-age=3600");
  }
  if (request.method === "GET" && url.pathname === "/") {
    return htmlResponse(portalHtml(env.ENVIRONMENT));
  }
  if (request.method === "GET" && url.pathname === "/auth/discord") {
    return beginDiscordLogin(request, env);
  }
  if (request.method === "GET" && url.pathname === "/auth/discord/callback") {
    return finishDiscordLogin(request, env);
  }
  if (request.method === "GET" && url.pathname === "/auth/logout") {
    return logoutResponse();
  }

  const authenticated = await loadSessionMember(request, env);
  if (!authenticated) return json({ error: "ログインが必要です。" }, 401);
  const { member, session } = authenticated;

  const practiceResponse = await handlePracticePortalRequest(request, url, env, member);
  if (practiceResponse) return practiceResponse;

  if (request.method === "GET" && url.pathname === "/api/session") {
    const refreshedCookie = await refreshedSessionCookie(session, env.SESSION_SECRET);
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
      return json({ profile: await submitPortalProfileRequest(env, member, body) });
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
      await saveParticipantPayment(env, member, paymentPath[1]);
      return json({ status: "paid" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "振込完了を保存できませんでした。";
      console.error("Portal payment save error", error);
      return json({ error: message }, 409);
    }
  }

  const documentPath = url.pathname.match(/^\/api\/tournaments\/(T-[0-9a-f-]{36})\/document$/);
  if (request.method === "GET" && documentPath) {
    return servePortalDocument(env, documentPath[1]);
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
