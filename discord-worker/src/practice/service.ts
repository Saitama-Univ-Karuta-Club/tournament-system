import {
  cardNumbersForSelection,
  drawCardSelection,
  isCardScheme,
  type CardScheme,
} from "./cards";
import {
  generatePracticePairings,
  type PairHistory,
  type PairingParticipant,
  type PracticeGrade,
  type PracticePairingMode,
} from "./pairing";
import {
  buildMatchStatistics,
  type MatchOutcome,
  type MatchSource,
  type MemberMatchRecord,
} from "./statistics";

export interface PracticeEnv {
  DB: D1Database;
}

interface MemberRow {
  member_id: string;
  display_name: string;
  display_name_kana: string;
  grade: PracticeGrade;
}

interface SessionRow {
  session_id: string;
  practice_date: string;
  title: string;
  location: string | null;
  pairing_mode: PracticePairingMode;
  status: string;
  card_scheme: CardScheme | null;
  card_selection_json: string | null;
  reader_member_id: string | null;
  created_by_member_id: string;
  created_at: string;
  updated_at: string;
}

interface AttendanceRow extends MemberRow {
  session_id: string;
  grade_snapshot: PracticeGrade;
  attendance_status: string;
}

interface MatchRow {
  match_id: string;
  session_id: string;
  round_number: number;
  player1_member_id: string;
  player2_member_id: string | null;
  player1_grade_snapshot: PracticeGrade;
  player2_grade_snapshot: PracticeGrade | null;
  player1_name: string;
  player2_name: string | null;
  status: "scheduled" | "completed" | "canceled" | "bye";
  winner_member_id: string | null;
  score_difference: number | null;
  result_note: string | null;
}

interface InternalRecordRow {
  record_id: string;
  played_on: string;
  event_name: string;
  opponent_key: string;
  opponent_name: string;
  opponent_grade: PracticeGrade;
  outcome: MatchOutcome;
  score_difference: number | null;
  result_note: string | null;
  fault_count: number | null;
  cards_taken: number | null;
  opponent_right_taken: number | null;
  opponent_left_taken: number | null;
  own_right_taken: number | null;
  own_left_taken: number | null;
}

interface ExternalRecordRow {
  record_id: string;
  played_on: string;
  event_name: string;
  opponent_name: string;
  opponent_affiliation: string | null;
  opponent_grade: PracticeGrade;
  outcome: MatchOutcome;
  score_difference: number | null;
  result_note: string | null;
  fault_count: number | null;
  cards_taken: number | null;
  opponent_right_taken: number | null;
  opponent_left_taken: number | null;
  own_right_taken: number | null;
  own_left_taken: number | null;
}

interface TournamentRecordRow extends ExternalRecordRow {
  opponent_key: string;
}

const PRACTICE_ID = /^P-[0-9a-f-]{36}$/;
const MATCH_ID = /^PM-[0-9a-f-]{36}$/;
const MEMBER_ID = /^M-[0-9a-f-]{36}$/;
const GRADES = new Set<PracticeGrade>(["A", "B", "C", "D", "E", "F", "beginner"]);

export class PracticeError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

function isPairingMode(value: unknown): value is PracticePairingMode {
  return value === "near_grade" || value === "mixed";
}

function isGrade(value: unknown): value is PracticeGrade {
  return typeof value === "string" && GRADES.has(value as PracticeGrade);
}

function validateDate(value: unknown, label: string): string {
  const date = String(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw new PracticeError(`${label}を正しく入力してください。`);
  }
  return date;
}

function validateText(value: unknown, label: string, maxLength: number, required = true): string | null {
  const text = String(value ?? "").trim();
  if (required && !text) throw new PracticeError(`${label}を入力してください。`);
  if (text.length > maxLength) throw new PracticeError(`${label}は${maxLength}文字以内で入力してください。`);
  return text || null;
}

function validateOptionalCount(value: unknown, label: string): number | null {
  if (value === null || value === undefined || value === "") return null;
  const count = Number(value);
  if (!Number.isInteger(count) || count < 0 || count > 50) {
    throw new PracticeError(`${label}は0から50の整数で入力してください。`);
  }
  return count;
}

function validateMatchDetails(input: Record<string, unknown>) {
  return {
    faultCount: validateOptionalCount(input.faultCount, "お手つきの回数"),
    cardsTaken: validateOptionalCount(input.cardsTaken, "取得枚数"),
    opponentRightTaken: validateOptionalCount(input.opponentRightTaken, "相手陣右の取得枚数"),
    opponentLeftTaken: validateOptionalCount(input.opponentLeftTaken, "相手陣左の取得枚数"),
    ownRightTaken: validateOptionalCount(input.ownRightTaken, "自陣右の取得枚数"),
    ownLeftTaken: validateOptionalCount(input.ownLeftTaken, "自陣左の取得枚数"),
    comment: validateText(input.comment ?? input.note, "コメント", 1000, false),
  };
}

function placeholders(length: number): string {
  return Array.from({ length }, () => "?").join(", ");
}

function parseLabels(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : [];
  } catch {
    return [];
  }
}

function sessionView(row: SessionRow, participants: AttendanceRow[], matches: MatchRow[]) {
  const labels = parseLabels(row.card_selection_json);
  return {
    session_id: row.session_id,
    practice_date: row.practice_date,
    title: row.title,
    location: row.location,
    pairing_mode: row.pairing_mode,
    status: row.status,
    card_selection: row.card_scheme ? {
      scheme: row.card_scheme,
      labels,
      card_numbers: cardNumbersForSelection(row.card_scheme, labels),
    } : null,
    reader_member_id: row.reader_member_id,
    created_by_member_id: row.created_by_member_id,
    participants: participants.filter((participant) => participant.session_id === row.session_id).map((participant) => ({
      member_id: participant.member_id,
      display_name: participant.display_name,
      display_name_kana: participant.display_name_kana,
      grade: participant.grade_snapshot,
      attendance_status: participant.attendance_status,
      is_reader: participant.member_id === row.reader_member_id,
    })),
    matches: matches.filter((match) => match.session_id === row.session_id).map((match) => ({
      ...match,
      round_number: Number(match.round_number),
      score_difference: match.score_difference === null ? null : Number(match.score_difference),
    })),
  };
}

export async function listPracticeMembers(env: PracticeEnv): Promise<MemberRow[]> {
  const rows = await env.DB.prepare(
    `SELECT member_id, display_name, display_name_kana, grade
     FROM members
     WHERE status = 'active'
     ORDER BY CASE grade
       WHEN 'A' THEN 1 WHEN 'B' THEN 2 WHEN 'C' THEN 3 WHEN 'D' THEN 4
       WHEN 'E' THEN 5 WHEN 'F' THEN 6 ELSE 7 END,
       display_name_kana, display_name`,
  ).all<MemberRow>();
  return rows.results;
}

export async function listPracticeSessions(env: PracticeEnv): Promise<unknown[]> {
  const [sessionRows, participantRows, matchRows] = await Promise.all([
    env.DB.prepare(
      `SELECT session_id, practice_date, title, location, pairing_mode, status,
              card_scheme, card_selection_json, reader_member_id,
              created_by_member_id, created_at, updated_at
       FROM practice_sessions
       WHERE status NOT IN ('completed', 'canceled')
       ORDER BY practice_date DESC, created_at DESC
       LIMIT 30`,
    ).all<SessionRow>(),
    env.DB.prepare(
      `SELECT practice_attendance.session_id, practice_attendance.member_id,
              practice_attendance.grade_snapshot, practice_attendance.attendance_status,
              members.display_name, members.display_name_kana, members.grade
       FROM practice_attendance
       INNER JOIN members ON members.member_id = practice_attendance.member_id
       INNER JOIN practice_sessions ON practice_sessions.session_id = practice_attendance.session_id
       WHERE practice_sessions.status NOT IN ('completed', 'canceled')
       ORDER BY members.display_name_kana, members.display_name`,
    ).all<AttendanceRow>(),
    env.DB.prepare(
      `SELECT practice_matches.match_id, practice_matches.session_id,
              practice_matches.round_number, practice_matches.player1_member_id,
              practice_matches.player2_member_id, practice_matches.player1_grade_snapshot,
              practice_matches.player2_grade_snapshot, practice_matches.status,
              practice_matches.winner_member_id, practice_matches.score_difference,
              practice_matches.result_note, player1.display_name AS player1_name,
              player2.display_name AS player2_name
       FROM practice_matches
       INNER JOIN members AS player1 ON player1.member_id = practice_matches.player1_member_id
       LEFT JOIN members AS player2 ON player2.member_id = practice_matches.player2_member_id
       INNER JOIN practice_sessions ON practice_sessions.session_id = practice_matches.session_id
       WHERE practice_sessions.status NOT IN ('completed', 'canceled')
       ORDER BY practice_matches.session_id, practice_matches.round_number,
                practice_matches.created_at`,
    ).all<MatchRow>(),
  ]);
  return sessionRows.results.map((row) => sessionView(row, participantRows.results, matchRows.results));
}

export async function createPracticeSession(
  env: PracticeEnv,
  creatorMemberId: string,
  input: Record<string, unknown>,
): Promise<{ sessionId: string }> {
  const practiceDate = validateDate(input.practiceDate, "練習日");
  const title = validateText(input.title ?? "通常練習", "練習名", 100)!;
  const location = validateText(input.location, "会場", 100, false);
  if (!isPairingMode(input.pairingMode)) throw new PracticeError("組み合わせ方式を選択してください。");
  if (!isCardScheme(input.cardScheme)) throw new PracticeError("札組方式を選択してください。");
  const rawMemberIds = Array.isArray(input.memberIds) ? input.memberIds : [];
  const memberIds = [...new Set(rawMemberIds.map(String))];
  if (memberIds.length < 2) throw new PracticeError("参加メンバーを2人以上選択してください。");
  if (memberIds.some((id) => !/^M-[0-9a-f-]{36}$/.test(id))) {
    throw new PracticeError("参加メンバーを確認できませんでした。");
  }
  const readerMemberId = input.readerMemberId ? String(input.readerMemberId) : null;
  if (readerMemberId && (!MEMBER_ID.test(readerMemberId) || !memberIds.includes(readerMemberId))) {
    throw new PracticeError("読手は参加メンバーから選択してください。");
  }
  if (readerMemberId && memberIds.length < 3) {
    throw new PracticeError("読手以外の参加メンバーを2人以上選択してください。");
  }
  const members = await env.DB.prepare(
    `SELECT member_id, display_name, display_name_kana, grade
     FROM members
     WHERE status = 'active' AND member_id IN (${placeholders(memberIds.length)})`,
  ).bind(...memberIds).all<MemberRow>();
  if (members.results.length !== memberIds.length) {
    throw new PracticeError("無効なメンバーが含まれています。", 409);
  }

  const sessionId = `P-${crypto.randomUUID()}`;
  const selection = drawCardSelection(input.cardScheme, sessionId);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO practice_sessions (
         session_id, practice_date, title, location, pairing_mode,
         card_scheme, card_selection_json, reader_member_id, created_by_member_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      sessionId,
      practiceDate,
      title,
      location,
      input.pairingMode,
      input.cardScheme,
      JSON.stringify(selection.labels),
      readerMemberId,
      creatorMemberId,
    ),
    ...members.results.map((member) => env.DB.prepare(
      `INSERT INTO practice_attendance (session_id, member_id, grade_snapshot)
       VALUES (?, ?, ?)`,
    ).bind(sessionId, member.member_id, member.grade)),
  ]);
  return { sessionId };
}

export async function generateNextPracticeRound(
  env: PracticeEnv,
  sessionId: string,
  requestedByMemberId: string,
): Promise<{ roundNumber: number; pairs: unknown[]; bye: unknown | null }> {
  if (!PRACTICE_ID.test(sessionId)) throw new PracticeError("練習を確認できませんでした。", 404);
  const session = await env.DB.prepare(
    `SELECT session_id, pairing_mode, created_by_member_id
     FROM practice_sessions
     WHERE session_id = ? AND status NOT IN ('completed', 'canceled')`,
  ).bind(sessionId).first<{
    session_id: string;
    pairing_mode: PracticePairingMode;
    created_by_member_id: string;
  }>();
  if (!session) throw new PracticeError("組み合わせを作成できる練習ではありません。", 409);
  if (session.created_by_member_id !== requestedByMemberId) {
    throw new PracticeError("この練習の組み合わせを変更できるのは作成者だけです。", 403);
  }

  const [participantRows, historyRows, byeRows, roundRow] = await Promise.all([
    env.DB.prepare(
      `SELECT practice_attendance.member_id, members.display_name,
              practice_attendance.grade_snapshot AS grade
       FROM practice_attendance
       INNER JOIN members ON members.member_id = practice_attendance.member_id
       INNER JOIN practice_sessions ON practice_sessions.session_id = practice_attendance.session_id
       WHERE practice_attendance.session_id = ?
         AND practice_attendance.attendance_status = 'attending'
         AND (practice_sessions.reader_member_id IS NULL
              OR practice_attendance.member_id <> practice_sessions.reader_member_id)`,
    ).bind(sessionId).all<PairingParticipant & { member_id: string; display_name: string }>(),
    env.DB.prepare(
      `SELECT player1_member_id AS member1Id, player2_member_id AS member2Id,
              created_at AS playedAt,
              CAST(strftime('%s', created_at) AS INTEGER) AS sequence
       FROM internal_practice_results
       UNION ALL
       SELECT player1_member_id AS member1Id, player2_member_id AS member2Id,
              created_at AS playedAt,
              CAST(strftime('%s', created_at) AS INTEGER) AS sequence
       FROM practice_matches
       WHERE player2_member_id IS NOT NULL AND status = 'completed'`,
    ).all<PairHistory>(),
    env.DB.prepare(
      `SELECT player1_member_id AS memberId, created_at AS restedAt,
              CAST(strftime('%s', created_at) AS INTEGER) AS sequence
       FROM practice_matches
       WHERE status = 'bye'`,
    ).all<{ memberId: string; restedAt: string; sequence: number }>(),
    env.DB.prepare(
      `SELECT COALESCE(MAX(round_number), 0) AS last_round
       FROM practice_matches WHERE session_id = ?`,
    ).bind(sessionId).first<{ last_round: number }>(),
  ]);
  const participants: PairingParticipant[] = participantRows.results.map((row) => ({
    memberId: row.member_id,
    displayName: row.display_name,
    grade: row.grade,
  }));
  const roundNumber = Number(roundRow?.last_round ?? 0) + 1;
  const result = generatePracticePairings({
    participants,
    pairHistory: historyRows.results,
    byeHistory: byeRows.results,
    mode: session.pairing_mode,
    seed: `${sessionId}:${roundNumber}`,
  });
  const statements = result.pairs.map((pair) => env.DB.prepare(
    `INSERT INTO practice_matches (
       match_id, session_id, round_number, player1_member_id, player2_member_id,
       player1_grade_snapshot, player2_grade_snapshot
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    `PM-${crypto.randomUUID()}`,
    sessionId,
    roundNumber,
    pair.player1.memberId,
    pair.player2.memberId,
    pair.player1.grade,
    pair.player2.grade,
  ));
  if (result.bye) {
    statements.push(env.DB.prepare(
      `INSERT INTO practice_matches (
         match_id, session_id, round_number, player1_member_id,
         player1_grade_snapshot, status
       ) VALUES (?, ?, ?, ?, ?, 'bye')`,
    ).bind(
      `PM-${crypto.randomUUID()}`,
      sessionId,
      roundNumber,
      result.bye.memberId,
      result.bye.grade,
    ));
  }
  statements.push(
    env.DB.prepare(
      `UPDATE practice_sessions
       SET status = 'in_progress', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE session_id = ?`,
    ).bind(sessionId),
    env.DB.prepare(
      `INSERT INTO practice_notification_queue (
         idempotency_key, session_id, round_number, notification_type
       ) VALUES (?, ?, ?, 'pairings')`,
    ).bind(`practice:${sessionId}:round:${roundNumber}:pairings`, sessionId, roundNumber),
  );
  await env.DB.batch(statements);
  return {
    roundNumber,
    pairs: result.pairs.map((pair) => ({
      player1: pair.player1,
      player2: pair.player2,
    })),
    bye: result.bye,
  };
}

export async function savePracticeMatchResult(
  env: PracticeEnv,
  matchId: string,
  memberId: string,
  input: Record<string, unknown>,
): Promise<void> {
  if (!MATCH_ID.test(matchId)) throw new PracticeError("対戦を確認できませんでした。", 404);
  const match = await env.DB.prepare(
    `SELECT player1_member_id, player2_member_id, status
     FROM practice_matches WHERE match_id = ?`,
  ).bind(matchId).first<{
    player1_member_id: string;
    player2_member_id: string | null;
    status: string;
  }>();
  if (!match || !match.player2_member_id || match.status === "bye" || match.status === "canceled") {
    throw new PracticeError("結果を登録できる対戦ではありません。", 409);
  }
  if (memberId !== match.player1_member_id && memberId !== match.player2_member_id) {
    throw new PracticeError("自分が参加した対戦だけ結果を登録できます。", 403);
  }
  const winnerMemberId = String(input.winnerMemberId ?? "");
  if (winnerMemberId !== match.player1_member_id && winnerMemberId !== match.player2_member_id) {
    throw new PracticeError("勝者を選択してください。");
  }
  const scoreDifference = input.scoreDifference === null || input.scoreDifference === undefined || input.scoreDifference === ""
    ? null
    : Number(input.scoreDifference);
  if (scoreDifference !== null && (!Number.isInteger(scoreDifference) || scoreDifference < 0 || scoreDifference > 50)) {
    throw new PracticeError("枚数差は0から50の整数で入力してください。");
  }
  const note = validateText(input.note, "備考", 500, false);
  await env.DB.prepare(
    `UPDATE practice_matches
     SET status = 'completed', winner_member_id = ?, score_difference = ?,
         result_note = ?, recorded_by_member_id = ?,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE match_id = ?`,
  ).bind(winnerMemberId, scoreDifference, note, memberId, matchId).run();
}

export async function saveInternalPracticeResult(
  env: PracticeEnv,
  member: { member_id: string },
  input: Record<string, unknown>,
): Promise<{ resultId: string }> {
  const requestedSessionId = String(input.sessionId ?? "");
  if (requestedSessionId && !PRACTICE_ID.test(requestedSessionId)) {
    throw new PracticeError("練習を確認できませんでした。");
  }
  const opponentMemberId = String(input.opponentMemberId ?? "");
  if (!MEMBER_ID.test(opponentMemberId) || opponentMemberId === member.member_id) {
    throw new PracticeError("対戦相手を選択してください。");
  }
  if (input.outcome !== "win" && input.outcome !== "loss") {
    throw new PracticeError("勝敗を選択してください。");
  }
  let sessionId = requestedSessionId;
  let ownGrade: PracticeGrade;
  let opponentGrade: PracticeGrade;
  const setupStatements: D1PreparedStatement[] = [];
  if (sessionId) {
    const attendance = await env.DB.prepare(
      `SELECT practice_attendance.member_id, practice_attendance.grade_snapshot
       FROM practice_attendance
       INNER JOIN practice_sessions
         ON practice_sessions.session_id = practice_attendance.session_id
       WHERE practice_attendance.session_id = ?
         AND practice_attendance.member_id IN (?, ?)
         AND practice_attendance.attendance_status = 'attending'
         AND practice_sessions.status <> 'canceled'`,
    ).bind(sessionId, member.member_id, opponentMemberId).all<{
      member_id: string;
      grade_snapshot: PracticeGrade;
    }>();
    if (attendance.results.length !== 2) {
      throw new PracticeError("この練習に参加している相手を選択してください。", 409);
    }
    const ownAttendance = attendance.results.find((row) => row.member_id === member.member_id);
    const opponentAttendance = attendance.results.find((row) => row.member_id === opponentMemberId);
    if (!ownAttendance || !opponentAttendance) {
      throw new PracticeError("参加情報を確認できませんでした。", 409);
    }
    ownGrade = ownAttendance.grade_snapshot;
    opponentGrade = opponentAttendance.grade_snapshot;
  } else {
    const playedOn = validateDate(input.playedOn, "対戦日");
    const members = await env.DB.prepare(
      `SELECT member_id, grade
       FROM members
       WHERE status = 'active' AND member_id IN (?, ?)`,
    ).bind(member.member_id, opponentMemberId).all<{
      member_id: string;
      grade: PracticeGrade;
    }>();
    const ownMember = members.results.find((row) => row.member_id === member.member_id);
    const opponentMember = members.results.find((row) => row.member_id === opponentMemberId);
    if (!ownMember || !opponentMember) {
      throw new PracticeError("対戦相手を確認できませんでした。", 409);
    }
    ownGrade = ownMember.grade;
    opponentGrade = opponentMember.grade;
    sessionId = `P-${crypto.randomUUID()}`;
    setupStatements.push(
      env.DB.prepare(
        `INSERT INTO practice_sessions (
           session_id, practice_date, title, pairing_mode, status,
           created_by_member_id
         ) VALUES (?, ?, '自主練習', 'mixed', 'completed', ?)`,
      ).bind(sessionId, playedOn, member.member_id),
      env.DB.prepare(
        `INSERT INTO practice_attendance (session_id, member_id, grade_snapshot)
         VALUES (?, ?, ?)`,
      ).bind(sessionId, member.member_id, ownGrade),
      env.DB.prepare(
        `INSERT INTO practice_attendance (session_id, member_id, grade_snapshot)
         VALUES (?, ?, ?)`,
      ).bind(sessionId, opponentMemberId, opponentGrade),
    );
  }
  const scoreDifference = input.scoreDifference === null || input.scoreDifference === undefined || input.scoreDifference === ""
    ? null
    : Number(input.scoreDifference);
  if (scoreDifference !== null && (!Number.isInteger(scoreDifference) || scoreDifference < 0 || scoreDifference > 50)) {
    throw new PracticeError("枚数差は0から50の整数で入力してください。");
  }
  const details = validateMatchDetails(input);
  const resultId = `PR-${crypto.randomUUID()}`;
  const winnerMemberId = input.outcome === "win" ? member.member_id : opponentMemberId;
  const resultStatement = env.DB.prepare(
    `INSERT INTO internal_practice_results (
       result_id, session_id, player1_member_id, player2_member_id,
       player1_grade_snapshot, player2_grade_snapshot, winner_member_id,
       score_difference, fault_count, cards_taken, opponent_right_taken,
       opponent_left_taken, own_right_taken, own_left_taken, result_note,
       recorded_by_member_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    resultId,
    sessionId,
    member.member_id,
    opponentMemberId,
    ownGrade,
    opponentGrade,
    winnerMemberId,
    scoreDifference,
    details.faultCount,
    details.cardsTaken,
    details.opponentRightTaken,
    details.opponentLeftTaken,
    details.ownRightTaken,
    details.ownLeftTaken,
    details.comment,
    member.member_id,
  );
  if (setupStatements.length) {
    await env.DB.batch([...setupStatements, resultStatement]);
  } else {
    await resultStatement.run();
  }
  return { resultId };
}

export async function saveExternalPracticeMatch(
  env: PracticeEnv,
  member: { member_id: string; grade: string },
  input: Record<string, unknown>,
): Promise<{ externalMatchId: string }> {
  const playedOn = validateDate(input.playedOn, "対戦日");
  const eventName = validateText(input.eventName, "練習会名", 100)!;
  const opponentName = validateText(input.opponentName, "対戦相手", 100)!;
  const opponentAffiliation = validateText(input.opponentAffiliation, "所属", 100, false);
  if (!isGrade(input.opponentGrade)) throw new PracticeError("対戦相手の級を選択してください。");
  if (input.outcome !== "win" && input.outcome !== "loss") {
    throw new PracticeError("勝敗を選択してください。");
  }
  if (!isGrade(member.grade)) throw new PracticeError("現在の級を確認できませんでした。", 409);
  const scoreDifference = input.scoreDifference === null || input.scoreDifference === undefined || input.scoreDifference === ""
    ? null
    : Number(input.scoreDifference);
  if (scoreDifference !== null && (!Number.isInteger(scoreDifference) || scoreDifference < 0 || scoreDifference > 50)) {
    throw new PracticeError("枚数差は0から50の整数で入力してください。");
  }
  const details = validateMatchDetails(input);
  const externalMatchId = `PE-${crypto.randomUUID()}`;
  await env.DB.prepare(
    `INSERT INTO external_practice_matches (
       external_match_id, member_id, played_on, event_name, opponent_name,
       opponent_affiliation, opponent_grade, member_grade_snapshot, outcome,
       score_difference, fault_count, cards_taken, opponent_right_taken,
       opponent_left_taken, own_right_taken, own_left_taken, result_note
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    externalMatchId,
    member.member_id,
    playedOn,
    eventName,
    opponentName,
    opponentAffiliation,
    input.opponentGrade,
    member.grade,
    input.outcome,
    scoreDifference,
    details.faultCount,
    details.cardsTaken,
    details.opponentRightTaken,
    details.opponentLeftTaken,
    details.ownRightTaken,
    details.ownLeftTaken,
    details.comment,
  ).run();
  return { externalMatchId };
}

export async function loadMemberMatchRecords(
  env: PracticeEnv,
  memberId: string,
): Promise<MemberMatchRecord[]> {
  const [internalRows, legacyInternalRows, externalRows, tournamentRows] = await Promise.all([
    env.DB.prepare(
      `SELECT internal_practice_results.result_id AS record_id,
              practice_sessions.practice_date AS played_on,
              practice_sessions.title AS event_name,
              CASE WHEN internal_practice_results.player1_member_id = ?
                THEN internal_practice_results.player2_member_id
                ELSE internal_practice_results.player1_member_id END AS opponent_key,
              CASE WHEN internal_practice_results.player1_member_id = ?
                THEN player2.display_name ELSE player1.display_name END AS opponent_name,
              CASE WHEN internal_practice_results.player1_member_id = ?
                THEN internal_practice_results.player2_grade_snapshot
                ELSE internal_practice_results.player1_grade_snapshot END AS opponent_grade,
              CASE WHEN internal_practice_results.winner_member_id = ? THEN 'win' ELSE 'loss' END AS outcome,
              internal_practice_results.score_difference, internal_practice_results.result_note,
              internal_practice_results.fault_count, internal_practice_results.cards_taken,
              internal_practice_results.opponent_right_taken,
              internal_practice_results.opponent_left_taken,
              internal_practice_results.own_right_taken,
              internal_practice_results.own_left_taken
       FROM internal_practice_results
       INNER JOIN practice_sessions
         ON practice_sessions.session_id = internal_practice_results.session_id
       INNER JOIN members AS player1
         ON player1.member_id = internal_practice_results.player1_member_id
       INNER JOIN members AS player2
         ON player2.member_id = internal_practice_results.player2_member_id
       WHERE ? = internal_practice_results.player1_member_id
          OR ? = internal_practice_results.player2_member_id`,
    ).bind(memberId, memberId, memberId, memberId, memberId, memberId).all<InternalRecordRow>(),
    env.DB.prepare(
      `SELECT practice_matches.match_id AS record_id,
              practice_sessions.practice_date AS played_on,
              practice_sessions.title AS event_name,
              CASE WHEN practice_matches.player1_member_id = ?
                THEN practice_matches.player2_member_id
                ELSE practice_matches.player1_member_id END AS opponent_key,
              CASE WHEN practice_matches.player1_member_id = ?
                THEN player2.display_name ELSE player1.display_name END AS opponent_name,
              CASE WHEN practice_matches.player1_member_id = ?
                THEN practice_matches.player2_grade_snapshot
                ELSE practice_matches.player1_grade_snapshot END AS opponent_grade,
              CASE WHEN practice_matches.winner_member_id = ? THEN 'win' ELSE 'loss' END AS outcome,
              practice_matches.score_difference, practice_matches.result_note,
              NULL AS fault_count, NULL AS cards_taken,
              NULL AS opponent_right_taken, NULL AS opponent_left_taken,
              NULL AS own_right_taken, NULL AS own_left_taken
       FROM practice_matches
       INNER JOIN practice_sessions ON practice_sessions.session_id = practice_matches.session_id
       INNER JOIN members AS player1 ON player1.member_id = practice_matches.player1_member_id
       INNER JOIN members AS player2 ON player2.member_id = practice_matches.player2_member_id
       WHERE practice_matches.status = 'completed'
         AND (? = practice_matches.player1_member_id OR ? = practice_matches.player2_member_id)`,
    ).bind(memberId, memberId, memberId, memberId, memberId, memberId).all<InternalRecordRow>(),
    env.DB.prepare(
      `SELECT external_match_id AS record_id, played_on, event_name, opponent_name,
              opponent_affiliation, opponent_grade, outcome, score_difference, result_note,
              fault_count, cards_taken, opponent_right_taken, opponent_left_taken,
              own_right_taken, own_left_taken
       FROM external_practice_matches
       WHERE member_id = ?`,
    ).bind(memberId).all<ExternalRecordRow>(),
    env.DB.prepare(
      `SELECT tournament_entry_matches.tournament_id || ':' || tournament_entry_matches.round_number AS record_id,
              tournaments.event_start_date AS played_on, tournaments.title AS event_name,
              'external:' || lower(trim(COALESCE(tournament_entry_matches.opponent_name, '相手不明')))
                || ':' || lower(trim(COALESCE(tournament_entry_matches.opponent_affiliation, ''))) AS opponent_key,
              COALESCE(tournament_entry_matches.opponent_name, '対戦相手記録なし') AS opponent_name,
              tournament_entry_matches.opponent_affiliation,
              CASE WHEN tournaments.all_grades = 1
                THEN COALESCE(NULLIF(tournament_entries.archive_grade, ''), members.grade)
                ELSE tournaments.grade END AS opponent_grade,
              tournament_entry_matches.outcome, tournament_entry_matches.score_difference,
              tournament_entry_matches.result_note
       FROM tournament_entry_matches
       INNER JOIN tournaments ON tournaments.tournament_id = tournament_entry_matches.tournament_id
       INNER JOIN tournament_entries
         ON tournament_entries.tournament_id = tournament_entry_matches.tournament_id
        AND tournament_entries.member_id = tournament_entry_matches.member_id
       INNER JOIN members ON members.member_id = tournament_entry_matches.member_id
       WHERE tournament_entry_matches.member_id = ?
         AND tournaments.status NOT IN ('canceled', 'deleted')`,
    ).bind(memberId).all<TournamentRecordRow>(),
  ]);

  const records: MemberMatchRecord[] = [
    ...[...internalRows.results, ...legacyInternalRows.results].map((row) => ({
      recordId: row.record_id,
      source: "internal_practice" as MatchSource,
      playedOn: row.played_on,
      eventName: row.event_name,
      opponentKey: `member:${row.opponent_key}`,
      opponentName: row.opponent_name,
      opponentAffiliation: "埼玉大学かるた会",
      opponentGrade: row.opponent_grade,
      outcome: row.outcome,
      scoreDifference: row.score_difference === null ? null : Number(row.score_difference),
      note: row.result_note,
      faultCount: row.fault_count,
      cardsTaken: row.cards_taken,
      opponentRightTaken: row.opponent_right_taken,
      opponentLeftTaken: row.opponent_left_taken,
      ownRightTaken: row.own_right_taken,
      ownLeftTaken: row.own_left_taken,
    })),
    ...externalRows.results.map((row) => ({
      recordId: row.record_id,
      source: "external_practice" as MatchSource,
      playedOn: row.played_on,
      eventName: row.event_name,
      opponentKey: `external:${row.opponent_name.trim().toLocaleLowerCase("ja")}:${(row.opponent_affiliation ?? "").trim().toLocaleLowerCase("ja")}`,
      opponentName: row.opponent_name,
      opponentAffiliation: row.opponent_affiliation,
      opponentGrade: row.opponent_grade,
      outcome: row.outcome,
      scoreDifference: row.score_difference === null ? null : Number(row.score_difference),
      note: row.result_note,
      faultCount: row.fault_count,
      cardsTaken: row.cards_taken,
      opponentRightTaken: row.opponent_right_taken,
      opponentLeftTaken: row.opponent_left_taken,
      ownRightTaken: row.own_right_taken,
      ownLeftTaken: row.own_left_taken,
    })),
    ...tournamentRows.results.map((row) => ({
      recordId: row.record_id,
      source: "tournament" as MatchSource,
      playedOn: row.played_on,
      eventName: row.event_name,
      opponentKey: row.opponent_key,
      opponentName: row.opponent_name,
      opponentAffiliation: row.opponent_affiliation,
      opponentGrade: row.opponent_grade,
      outcome: row.outcome,
      scoreDifference: row.score_difference === null ? null : Number(row.score_difference),
      note: row.result_note,
      faultCount: null,
      cardsTaken: null,
      opponentRightTaken: null,
      opponentLeftTaken: null,
      ownRightTaken: null,
      ownLeftTaken: null,
    })),
  ];
  return records.sort((left, right) =>
    right.playedOn.localeCompare(left.playedOn) || left.recordId.localeCompare(right.recordId)
  );
}

export async function loadMemberMatchStatistics(env: PracticeEnv, memberId: string) {
  const records = await loadMemberMatchRecords(env, memberId);
  return { records, statistics: buildMatchStatistics(records) };
}
