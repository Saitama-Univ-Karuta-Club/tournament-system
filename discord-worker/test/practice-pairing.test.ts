import { describe, expect, it } from "vitest";
import { generatePracticePairings, type PairingParticipant } from "../src/practice/pairing";

const participants: PairingParticipant[] = [
  { memberId: "A", displayName: "Aさん", grade: "A" },
  { memberId: "B", displayName: "Bさん", grade: "B" },
  { memberId: "C", displayName: "Cさん", grade: "C" },
  { memberId: "D", displayName: "Dさん", grade: "D" },
  { memberId: "E", displayName: "Eさん", grade: "E" },
  { memberId: "F", displayName: "Fさん", grade: "F" },
];

function pairKeys(result: ReturnType<typeof generatePracticePairings>): string[] {
  return result.pairs.map(({ player1, player2 }) =>
    [player1.memberId, player2.memberId].sort().join(":"),
  ).sort();
}

describe("practice pairing", () => {
  it("pairs everyone exactly once and is stable for a seed", () => {
    const first = generatePracticePairings({
      participants,
      mode: "mixed",
      seed: "round-1",
      now: new Date("2026-10-28T00:00:00Z"),
    });
    const second = generatePracticePairings({
      participants,
      mode: "mixed",
      seed: "round-1",
      now: new Date("2026-10-28T00:00:00Z"),
    });

    expect(pairKeys(first)).toEqual(pairKeys(second));
    expect(first.pairs).toHaveLength(3);
    expect(new Set(first.pairs.flatMap((pair) => [pair.player1.memberId, pair.player2.memberId])))
      .toHaveLength(6);
    expect(first.bye).toBeNull();
  });

  it("avoids a very recent pairing when alternatives exist", () => {
    const result = generatePracticePairings({
      participants: participants.slice(0, 4),
      mode: "mixed",
      seed: "round-2",
      now: new Date("2026-10-28T00:00:00Z"),
      pairHistory: [
        { member1Id: "A", member2Id: "B", playedAt: "2026-10-28T00:00:00Z", sequence: 10 },
        { member1Id: "C", member2Id: "D", playedAt: "2026-10-28T00:00:00Z", sequence: 10 },
      ],
    });

    expect(pairKeys(result)).not.toContain("A:B");
    expect(pairKeys(result)).not.toContain("C:D");
  });

  it("uses nearby grades in near-grade mode", () => {
    const result = generatePracticePairings({
      participants,
      mode: "near_grade",
      seed: "near-grades",
      now: new Date("2026-10-28T00:00:00Z"),
    });

    expect(pairKeys(result)).toEqual(["A:B", "C:D", "E:F"]);
  });

  it("gives the bye to someone who has rested less often", () => {
    const result = generatePracticePairings({
      participants: participants.slice(0, 5),
      mode: "mixed",
      seed: "odd-round",
      now: new Date("2026-10-28T00:00:00Z"),
      byeHistory: [
        { memberId: "A", restedAt: "2026-10-27T00:00:00Z", sequence: 2 },
        { memberId: "B", restedAt: "2026-10-20T00:00:00Z", sequence: 1 },
        { memberId: "C", restedAt: "2026-10-20T00:00:00Z", sequence: 1 },
        { memberId: "D", restedAt: "2026-10-20T00:00:00Z", sequence: 1 },
      ],
    });

    expect(result.bye?.memberId).toBe("E");
  });

  it("rejects duplicate participants", () => {
    expect(() => generatePracticePairings({
      participants: [participants[0], participants[0]],
      mode: "mixed",
      seed: "duplicate",
    })).toThrow("参加者が重複");
  });
});
