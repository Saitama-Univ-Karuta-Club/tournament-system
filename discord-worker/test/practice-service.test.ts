import { describe, expect, it } from "vitest";
import {
  createPracticeSession,
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
    expect(batched[0].values[7]).toBe(readerId);
    expect(batched[0].values[8]).toBe(memberId);
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
