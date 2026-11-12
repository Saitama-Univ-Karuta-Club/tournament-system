import { securityHeaders } from "./http";
import type { PortalEnv } from "./types";

const SAFE_TOURNAMENT_ID = /^T-[0-9a-f-]{36}$/;
const SAFE_GROUP_KEY = /^(?:T|TG)-[0-9a-f-]{36}$/;

interface PortalGuidanceRow {
  group_key: string;
  body_text: string | null;
  document_url: string | null;
  file_name: string | null;
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
    if (!["https:", "http:"].includes(external.protocol)) {
      return new Response("Not Found", { status: 404 });
    }
    return new Response(null, {
      status: 302,
      headers: { ...securityHeaders, Location: external.toString() },
    });
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

export async function servePortalDocument(
  env: PortalEnv,
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

export async function servePortalArchiveDocument(
  env: PortalEnv,
  groupKey: string,
  documentType: string,
): Promise<Response> {
  if (!SAFE_GROUP_KEY.test(groupKey)) return new Response("Not Found", { status: 404 });
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

export async function servePortalConfirmationRoster(
  env: PortalEnv,
  groupKey: string,
): Promise<Response> {
  if (!SAFE_GROUP_KEY.test(groupKey)) return new Response("Not Found", { status: 404 });
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
  if (!SAFE_GROUP_KEY.test(groupKey)) return null;
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

export async function servePortalGuidance(
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

export async function servePortalGuidanceDocument(
  env: PortalEnv,
  groupKey: string,
): Promise<Response> {
  const guidance = await loadVisibleParticipantGuidance(env, groupKey);
  if (!guidance?.document_url) return new Response("Not Found", { status: 404 });
  return serveStoredDocumentUrl(env, guidance.document_url);
}
