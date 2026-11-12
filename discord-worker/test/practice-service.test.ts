import { describe, expect, it } from "vitest";
import {
  createPracticeSession,
  generateNextPracticeRound,
  loadMemberMatchRecords,
  PracticeError,
  saveExternalPracticeMatch,
  saveInternalPracticeResult,
} from "../src/practice/service";

const memberId = "M-11111111-1111-4111-8111-111111111111";
const opponentId = "M-22222222-2222-4222-8222-222222222222";
const sessionId = "P-33333333-3333-4333-8333-333333333333";
const readerId = "M-44444444-4444-4444-8444-444444444444";

function practiceEnv(attendance = [
  { member_id: memberId, grade_snapshot: "C" },
  { member_id: opponentId, grade_snapshot: "B" },
]) {
  const inserts: { sql: string; values: unknown[] }[] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async all() {
              return { results: attendance };
            },
            async run() {
              inserts.push({ sql, values });
              return { success: true };
            },
          };
        },
      };
    },
  };
  return {
    env: { DB: db as unknown as D1Database },
    inserts,
  };
}

function adHocPracticeEnv(memberRows = [
  { member_id: memberId, grade: "C" },
  { member_id: opponentId, grade: "B" },
]) {
  type BoundStatement = {
    sql: string;
    values: unknown[];
    all: () => Promise<{ results: unknown[] }>;
    run: () => Promise<{ success: boolean }>;
    first: () => Promise<unknown>;
  };
  const batched: BoundStatement[] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]): BoundStatement {
          return {
            sql,
            values,
            async all() {
              return { results: memberRows };
            },
            async run() {
              return { success: true };
            },
            async first() {
              if (sql.includes("FROM practice_schedules")) {
                return { practice_date: "2026-10-29" };
              }
              return null;
            },
          };
        },
      };
    },
    async batch(statements: BoundStatement[]) {
      batched.push(...statements);
      return statements.map(() => ({ success: true }));
    },
  };
  return {
    env: { DB: db as unknown as D1Database },
    batched,
  };
}

describe("practice creation with a reader", () => {
  it("stores a checked participant as the reader", async () => {
    const { env, batched } = adHocPracticeEnv([
      { member_id: memberId, grade: "C" },
      { member_id: opponentId, grade: "B" },
      { member_id: readerId, grade: "A" },
    ]);

    const created = await createPracticeSession(env, memberId, {
      practiceDate: "2026-10-29",
      title: "通常練習",
      location: "大学会館",
      pairingMode: "near_grade",
      cardScheme: "hiragana",
      readerMemberId: readerId,
      memberIds: [memberId, opponentId, readerId],
    });

    expect(created.sessionId).toMatch(/^P-/);
    expect(batched).toHaveLength(4);
    expect(batched[0].sql).toContain("reader_member_id");
    expect(batched[0].values[8]).toBe(readerId);
    expect(batched[0].values[9]).toBe(memberId);
  });

  it("stores a guest without adding them to the member table", async () => {
    const { env, batched } = adHocPracticeEnv([
      { member_id: memberId, grade: "C" },
    ]);

    await createPracticeSession(env, memberId, {
      practiceDate: "2026-10-29",
      title: "通常練習",
      pairingMode: "near_grade",
      cardScheme: "hiragana",
      memberIds: [memberId],
      guests: [{ displayName: "ゲスト選手", grade: "B" }],
    });

    expect(batched).toHaveLength(3);
    expect(batched[2].sql).toContain("INSERT INTO practice_guests");
    expect(batched[2].values[0]).toMatch(/^G-/);
    expect(batched[2].values.slice(2)).toEqual(["ゲスト選手", "B"]);
  });

  it("links a created practice to the selected registered schedule", async () => {
    const { env, batched } = adHocPracticeEnv();
    const scheduleId = "PS-66666666-6666-4666-8666-666666666666";

    await createPracticeSession(env, memberId, {
      scheduleId,
      practiceDate: "2026-10-29",
      title: "水曜練習",
      location: "大学会館",
      pairingMode: "mixed",
      cardScheme: "alphabet",
      memberIds: [memberId, opponentId],
    });

    expect(batched[0].sql).toContain("session_id, schedule_id, practice_date");
    expect(batched[0].values[1]).toBe(scheduleId);
    expect(batched[0].values[3]).toBe("水曜練習");
    expect(batched[0].values[4]).toBe("大学会館");
  });

  it("rejects a reader who is not a checked participant", async () => {
    const { env } = adHocPracticeEnv();

    await expect(createPracticeSession(env, memberId, {
      practiceDate: "2026-10-29",
      title: "通常練習",
      pairingMode: "mixed",
      cardScheme: "alphabet",
      readerMemberId: readerId,
      memberIds: [memberId, opponentId],
    })).rejects.toEqual(expect.objectContaining<Partial<PracticeError>>({
      message: "読手は参加メンバーから選択してください。",
      status: 400,
    }));
  });
});

describe("practice pairing history selection", () => {
  it("loads histories only for the current attending players", async () => {
    const prepared: Array<{ sql: string; values: unknown[] }> = [];
    type BoundStatement = {
      sql: string;
      values: unknown[];
      all: () => Promise<{ results: unknown[] }>;
      first: () => Promise<unknown>;
    };
    const db = {
      prepare(sql: string) {
        return {
          bind(...values: unknown[]): BoundStatement {
            const statement = {
              sql,
              values,
              async all() {
                if (sql.includes("FROM practice_attendance") && sql.includes("members.display_name")) {
                  return {
                    results: [
                      { participant_id: memberId, display_name: "参加者", grade: "C" },
                      { participant_id: "G-55555555-5555-4555-8555-555555555555", display_name: "ゲスト", grade: "B" },
                    ],
                  };
                }
                return { results: [] };
              },
              async first() {
                if (sql.includes("SELECT session_id, pairing_mode")) {
                  return {
                    session_id: sessionId,
                    pairing_mode: "near_grade",
                    created_by_member_id: memberId,
                  };
                }
                if (sql.includes("MAX(round_number)")) return { last_round: 0 };
                return null;
              },
            };
            prepared.push({ sql, values });
            return statement;
          },
        };
      },
      async batch(statements: BoundStatement[]) {
        return statements.map(() => ({ success: true }));
      },
    };

    const result = await generateNextPracticeRound(
      { DB: db as unknown as D1Database },
      sessionId,
      memberId,
    );

    expect(result.pairs).toHaveLength(1);
    expect(result.pairs[0]).toEqual(expect.objectContaining({
      player1: expect.objectContaining({ displayName: expect.any(String) }),
      player2: expect.objectContaining({ displayName: expect.any(String) }),
    }));
    const pair = result.pairs[0] as {
      player1: { displayName: string };
      player2: { displayName: string };
    };
    expect([pair.player1.displayName, pair.player2.displayName])
      .toContain("ゲスト");
    const historyQuery = prepared.find(({ sql }) =>
      sql.includes("FROM internal_practice_results")
    );
    expect(historyQuery?.sql).toContain("selected_participants AS");
    expect(historyQuery?.sql).toContain(
      "player1_member_id IN (SELECT participant_id FROM selected_participants)",
    );
    expect(historyQuery?.sql).toContain(
      "player2_member_id IN (SELECT participant_id FROM selected_participants)",
    );
    expect(historyQuery?.sql).toContain("player1_participant_id");
    expect(historyQuery?.values).toEqual([sessionId]);
    const byeQuery = prepared.find(({ sql }) =>
      sql.includes("WHERE status = 'bye'")
    );
    expect(byeQuery?.sql).toContain(
      "player1_participant_id IN (SELECT participant_id FROM selected_participants)",
    );
    expect(byeQuery?.values).toEqual([sessionId]);
  });
});

describe("internal practice results", () => {
  it("records the actual opponent independently from suggested pairings", async () => {
    const { env, inserts } = practiceEnv();

    const result = await saveInternalPracticeResult(env, { member_id: memberId }, {
      sessionId,
      opponentMemberId: opponentId,
      outcome: "loss",
      scoreDifference: "7",
      faultCount: "2",
      cardsTaken: "14",
      opponentRightTaken: "4",
      opponentLeftTaken: "3",
      ownRightTaken: "5",
      ownLeftTaken: "2",
      comment: "展開の記録",
    });

    expect(result.resultId).toMatch(/^PR-/);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].sql).toContain("INSERT INTO internal_practice_results");
    expect(inserts[0].values).toEqual([
      result.resultId,
      sessionId,
      memberId,
      opponentId,
      "C",
      "B",
      opponentId,
      7,
      2,
      14,
      4,
      3,
      5,
      2,
      "展開の記録",
      memberId,
    ]);
  });

  it("rejects an opponent who is not attending the selected practice", async () => {
    const { env } = practiceEnv([
      { member_id: memberId, grade_snapshot: "C" },
    ]);

    await expect(saveInternalPracticeResult(env, { member_id: memberId }, {
      sessionId,
      opponentMemberId: opponentId,
      outcome: "win",
    })).rejects.toEqual(expect.objectContaining<Partial<PracticeError>>({
      message: "この練習に参加している相手を選択してください。",
      status: 409,
    }));
  });

  it("records an ad hoc match without a pre-registered practice", async () => {
    const { env, batched } = adHocPracticeEnv();

    const result = await saveInternalPracticeResult(env, { member_id: memberId }, {
      sessionId: "",
      playedOn: "2026-10-29",
      opponentMemberId: opponentId,
      outcome: "win",
      scoreDifference: "3",
    });

    expect(result.resultId).toMatch(/^PR-/);
    expect(batched).toHaveLength(4);
    expect(batched[0].sql).toContain("INSERT INTO practice_sessions");
    expect(batched[0].sql).toContain("'自主練習'");
    expect(batched[0].values[0]).toMatch(/^P-/);
    expect(batched[0].values[1]).toBe("2026-10-29");
    expect(batched[3].sql).toContain("INSERT INTO internal_practice_results");
    expect(batched[3].values).toEqual([
      result.resultId,
      batched[0].values[0],
      memberId,
      opponentId,
      "C",
      "B",
      memberId,
      3,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      memberId,
    ]);
  });

  it("rejects a non-integer optional detail", async () => {
    const { env } = practiceEnv();

    await expect(saveInternalPracticeResult(env, { member_id: memberId }, {
      sessionId,
      opponentMemberId: opponentId,
      outcome: "win",
      faultCount: "1.5",
    })).rejects.toEqual(expect.objectContaining<Partial<PracticeError>>({
      message: "お手つきの回数は0から50の整数で入力してください。",
      status: 400,
    }));
  });
});

describe("external practice results", () => {
  it("records every optional match detail", async () => {
    const { env, inserts } = practiceEnv();

    const result = await saveExternalPracticeMatch(env, { member_id: memberId, grade: "C" }, {
      playedOn: "2026-10-29",
      eventName: "合同練習会",
      opponentName: "外部選手",
      opponentAffiliation: "他大学",
      opponentGrade: "B",
      outcome: "win",
      scoreDifference: "5",
      faultCount: "1",
      cardsTaken: "12",
      opponentRightTaken: "3",
      opponentLeftTaken: "4",
      ownRightTaken: "2",
      ownLeftTaken: "3",
      comment: "終盤に逆転",
    });

    expect(result.externalMatchId).toMatch(/^PE-/);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].sql).toContain("INSERT INTO external_practice_matches");
    expect(inserts[0].values).toEqual([
      result.externalMatchId,
      memberId,
      "2026-10-29",
      "合同練習会",
      "外部選手",
      "他大学",
      "B",
      "C",
      "win",
      5,
      1,
      12,
      3,
      4,
      2,
      3,
      "終盤に逆転",
    ]);
  });
});

describe("practice result details", () => {
  it("returns saved optional details for the member portal popup", async () => {
    const db = {
      prepare(sql: string) {
        return {
          bind: (..._values: unknown[]) => ({
            async all() {
              if (!sql.includes("FROM internal_practice_results")) return { results: [] };
              return { results: [{
                record_id: "PR-1",
                played_on: "2026-11-01",
                event_name: "通常練習",
                opponent_key: opponentId,
                opponent_name: "対戦相手",
                opponent_grade: "B",
                outcome: "win",
                score_difference: 5,
                result_note: "終盤に逆転",
                fault_count: 1,
                cards_taken: 12,
                opponent_right_taken: 3,
                opponent_left_taken: 4,
                own_right_taken: 2,
                own_left_taken: 3,
              }] };
            },
          }),
        };
      },
    };

    const records = await loadMemberMatchRecords(
      { DB: db as unknown as D1Database },
      memberId,
    );

    expect(records[0]).toMatchObject({
      recordId: "PR-1",
      faultCount: 1,
      cardsTaken: 12,
      opponentRightTaken: 3,
      opponentLeftTaken: 4,
      ownRightTaken: 2,
      ownLeftTaken: 3,
      note: "終盤に逆転",
    });
  });
});
