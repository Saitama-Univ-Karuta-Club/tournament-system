import { describe, expect, it } from "vitest";
import { buildMatchStatistics, type MemberMatchRecord } from "../src/practice/statistics";

const records: MemberMatchRecord[] = [
  {
    recordId: "1",
    source: "internal_practice",
    playedOn: "2026-10-01",
    eventName: "通常練習",
    opponentKey: "member:A",
    opponentName: "相手A",
    opponentAffiliation: "埼玉大学かるた会",
    opponentGrade: "C",
    outcome: "win",
    scoreDifference: 5,
    note: null,
  },
  {
    recordId: "2",
    source: "tournament",
    playedOn: "2026-10-20",
    eventName: "C級大会",
    opponentKey: "external:相手A:他会",
    opponentName: "相手A",
    opponentAffiliation: "他会",
    opponentGrade: "C",
    outcome: "loss",
    scoreDifference: 3,
    note: null,
  },
  {
    recordId: "3",
    source: "external_practice",
    playedOn: "2026-10-28",
    eventName: "合同練習",
    opponentKey: "external:相手B:他会",
    opponentName: "相手B",
    opponentAffiliation: "他会",
    opponentGrade: "B",
    outcome: "win",
    scoreDifference: 7,
    note: null,
  },
];

describe("practice statistics", () => {
  it("aggregates overall and grade win rates", () => {
    const statistics = buildMatchStatistics(records);

    expect(statistics.overall).toMatchObject({ matches: 3, wins: 2, losses: 1, winRate: 66.7 });
    expect(statistics.byGrade).toEqual([
      expect.objectContaining({ key: "B", matches: 1, wins: 1, winRate: 100 }),
      expect.objectContaining({ key: "C", matches: 2, wins: 1, winRate: 50 }),
    ]);
  });

  it("keeps club members and outside opponents with the same name separate", () => {
    const statistics = buildMatchStatistics(records);

    expect(statistics.byOpponent).toHaveLength(3);
    expect(statistics.byOpponent.filter((row) => row.label === "相手A")).toHaveLength(2);
  });

  it("aggregates each source separately", () => {
    const statistics = buildMatchStatistics(records);

    expect(statistics.bySource.map((row) => [row.key, row.matches])).toEqual([
      ["internal_practice", 1],
      ["external_practice", 1],
      ["tournament", 1],
    ]);
  });
});
