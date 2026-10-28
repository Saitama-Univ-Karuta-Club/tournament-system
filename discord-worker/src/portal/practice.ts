import {
  createPracticeSession,
  generateNextPracticeRound,
  listPracticeMembers,
  listPracticeSessions,
  loadMemberMatchStatistics,
  PracticeError,
  saveExternalPracticeMatch,
  savePracticeMatchResult,
} from "../practice/service";
import { json, sameOrigin } from "./http";
import type { PortalEnv, PortalMemberRow } from "./types";

async function dashboard(env: PortalEnv, member: PortalMemberRow) {
  const [members, sessions, matchData] = await Promise.all([
    listPracticeMembers(env),
    listPracticeSessions(env),
    loadMemberMatchStatistics(env, member.member_id),
  ]);
  return {
    current_member_id: member.member_id,
    members,
    sessions,
    ...matchData,
  };
}

function requireJson(request: Request): Response | null {
  if (!sameOrigin(request)) return json({ error: "不正な送信元です。" }, 403);
  if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
    return json({ error: "JSON形式で送信してください。" }, 415);
  }
  return null;
}

export async function handlePracticePortalRequest(
  request: Request,
  url: URL,
  env: PortalEnv,
  member: PortalMemberRow,
): Promise<Response | null> {
  if (request.method === "GET" && url.pathname === "/api/practice") {
    try {
      return json(await dashboard(env, member));
    } catch (error) {
      console.error("Practice dashboard load error", error);
      return json({ error: "練習情報を取得できませんでした。" }, 500);
    }
  }

  if (request.method === "POST" && url.pathname === "/api/practice/sessions") {
    const invalid = requireJson(request);
    if (invalid) return invalid;
    try {
      const body = await request.json<Record<string, unknown>>();
      const created = await createPracticeSession(env, member.member_id, body);
      return json({ ...created, practice: await dashboard(env, member) }, 201);
    } catch (error) {
      if (error instanceof PracticeError) return json({ error: error.message }, error.status);
      console.error("Practice session creation error", error);
      return json({ error: "練習を作成できませんでした。" }, 500);
    }
  }

  const roundPath = url.pathname.match(/^\/api\/practice\/sessions\/(P-[0-9a-f-]{36})\/rounds$/);
  if (request.method === "POST" && roundPath) {
    if (!sameOrigin(request)) return json({ error: "不正な送信元です。" }, 403);
    try {
      const generated = await generateNextPracticeRound(env, roundPath[1], member.member_id);
      return json({ ...generated, practice: await dashboard(env, member) }, 201);
    } catch (error) {
      if (error instanceof PracticeError) return json({ error: error.message }, error.status);
      console.error("Practice pairing generation error", error);
      return json({ error: "組み合わせを生成できませんでした。" }, 500);
    }
  }

  const resultPath = url.pathname.match(/^\/api\/practice\/matches\/(PM-[0-9a-f-]{36})\/result$/);
  if (request.method === "PUT" && resultPath) {
    const invalid = requireJson(request);
    if (invalid) return invalid;
    try {
      const body = await request.json<Record<string, unknown>>();
      await savePracticeMatchResult(env, resultPath[1], member.member_id, body);
      return json({ practice: await dashboard(env, member) });
    } catch (error) {
      if (error instanceof PracticeError) return json({ error: error.message }, error.status);
      console.error("Practice result save error", error);
      return json({ error: "対戦結果を保存できませんでした。" }, 500);
    }
  }

  if (request.method === "POST" && url.pathname === "/api/practice/external-matches") {
    const invalid = requireJson(request);
    if (invalid) return invalid;
    try {
      const body = await request.json<Record<string, unknown>>();
      const created = await saveExternalPracticeMatch(env, member, body);
      return json({ ...created, practice: await dashboard(env, member) }, 201);
    } catch (error) {
      if (error instanceof PracticeError) return json({ error: error.message }, error.status);
      console.error("External practice result save error", error);
      return json({ error: "外部練習会の対戦結果を保存できませんでした。" }, 500);
    }
  }

  return null;
}
