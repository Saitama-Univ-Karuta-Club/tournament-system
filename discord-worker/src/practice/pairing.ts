import { seededRandom } from "./cards";

export type PracticePairingMode = "near_grade" | "mixed";
export type PracticeGrade = "A" | "B" | "C" | "D" | "E" | "F" | "beginner";

export interface PairingParticipant {
  memberId: string;
  displayName: string;
  grade: PracticeGrade;
}

export interface PairHistory {
  member1Id: string;
  member2Id: string;
  playedAt: string;
  sequence?: number;
}

export interface ByeHistory {
  memberId: string;
  restedAt: string;
  sequence?: number;
}

export interface PracticePair {
  player1: PairingParticipant;
  player2: PairingParticipant;
  cost: number;
}

export interface PairingResult {
  pairs: PracticePair[];
  bye: PairingParticipant | null;
  totalCost: number;
}

const GRADE_ORDER: Record<PracticeGrade, number> = {
  A: 0,
  B: 1,
  C: 2,
  D: 3,
  E: 4,
  F: 5,
  beginner: 6,
};

function pairKey(left: string, right: string): string {
  return left < right ? `${left}:${right}` : `${right}:${left}`;
}

function daysBetween(left: string, right: Date): number {
  const timestamp = new Date(left).getTime();
  if (!Number.isFinite(timestamp)) return Number.POSITIVE_INFINITY;
  return Math.max(0, (right.getTime() - timestamp) / 86_400_000);
}

function pairCost(
  left: PairingParticipant,
  right: PairingParticipant,
  histories: PairHistory[],
  mode: PracticePairingMode,
  now: Date,
): number {
  let cost = 0;
  if (mode === "near_grade") {
    const gradeDistance = Math.abs(GRADE_ORDER[left.grade] - GRADE_ORDER[right.grade]);
    cost += gradeDistance * gradeDistance * 80;
  }

  const previous = histories.filter((history) =>
    pairKey(history.member1Id, history.member2Id) === pairKey(left.memberId, right.memberId)
  );
  cost += previous.length * 500;
  for (const history of previous) {
    const age = daysBetween(history.playedAt, now);
    if (age <= 1) cost += 10_000;
    else if (age <= 7) cost += 2_500;
    else if (age <= 30) cost += 600;
    else if (age <= 90) cost += 150;
  }
  const latestSequence = Math.max(...previous.map((history) => history.sequence ?? -1), -1);
  const globalLatestSequence = Math.max(...histories.map((history) => history.sequence ?? -1), -1);
  if (latestSequence >= 0 && latestSequence === globalLatestSequence) cost += 20_000;
  return cost;
}

function byeCost(memberId: string, histories: ByeHistory[], now: Date): number {
  const previous = histories.filter((history) => history.memberId === memberId);
  let cost = previous.length * 2_000;
  for (const history of previous) {
    const age = daysBetween(history.restedAt, now);
    if (age <= 1) cost += 20_000;
    else if (age <= 7) cost += 4_000;
    else if (age <= 30) cost += 800;
  }
  const latestSequence = Math.max(...previous.map((history) => history.sequence ?? -1), -1);
  const globalLatestSequence = Math.max(...histories.map((history) => history.sequence ?? -1), -1);
  if (latestSequence >= 0 && latestSequence === globalLatestSequence) cost += 30_000;
  return cost;
}

function improvePairs(pairs: PracticePair[], costFor: (left: PairingParticipant, right: PairingParticipant) => number): PracticePair[] {
  const result = pairs.map((pair) => ({ ...pair }));
  let changed = true;
  while (changed) {
    changed = false;
    for (let leftIndex = 0; leftIndex < result.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < result.length; rightIndex += 1) {
        const left = result[leftIndex];
        const right = result[rightIndex];
        const current = left.cost + right.cost;
        const alternatives = [
          [left.player1, right.player1, left.player2, right.player2],
          [left.player1, right.player2, left.player2, right.player1],
        ] as const;
        for (const [a, b, c, d] of alternatives) {
          const firstCost = costFor(a, b);
          const secondCost = costFor(c, d);
          if (firstCost + secondCost < current) {
            result[leftIndex] = { player1: a, player2: b, cost: firstCost };
            result[rightIndex] = { player1: c, player2: d, cost: secondCost };
            changed = true;
            break;
          }
        }
      }
    }
  }
  return result;
}

function candidateMatching(
  participants: PairingParticipant[],
  costFor: (left: PairingParticipant, right: PairingParticipant) => number,
  random: () => number,
): PracticePair[] {
  const remaining = [...participants].sort(() => random() - 0.5);
  const pairs: PracticePair[] = [];
  while (remaining.length >= 2) {
    const player1 = remaining.shift()!;
    const candidates = remaining.map((player, index) => ({
      index,
      player,
      cost: costFor(player1, player),
      tie: random(),
    })).sort((left, right) => left.cost - right.cost || left.tie - right.tie);
    const selected = candidates[0];
    remaining.splice(selected.index, 1);
    pairs.push({ player1, player2: selected.player, cost: selected.cost });
  }
  return improvePairs(pairs, costFor);
}

export function generatePracticePairings(input: {
  participants: PairingParticipant[];
  pairHistory?: PairHistory[];
  byeHistory?: ByeHistory[];
  mode: PracticePairingMode;
  seed: string;
  now?: Date;
  iterations?: number;
}): PairingResult {
  const unique = new Map(input.participants.map((participant) => [participant.memberId, participant]));
  if (unique.size !== input.participants.length) {
    throw new Error("参加者が重複しています。");
  }
  if (input.participants.length < 2) {
    throw new Error("組み合わせ生成には2人以上必要です。");
  }
  const histories = input.pairHistory ?? [];
  const byeHistories = input.byeHistory ?? [];
  const now = input.now ?? new Date();
  const costFor = (left: PairingParticipant, right: PairingParticipant) =>
    pairCost(left, right, histories, input.mode, now);
  const random = seededRandom(input.seed);
  const byeCandidates = input.participants.length % 2 === 0
    ? [null]
    : [...input.participants].sort((left, right) =>
      byeCost(left.memberId, byeHistories, now) - byeCost(right.memberId, byeHistories, now)
      || left.memberId.localeCompare(right.memberId)
    );
  let best: PairingResult | null = null;
  const iterations = Math.max(20, Math.min(input.iterations ?? 250, 2_000));

  for (const bye of byeCandidates) {
    const available = bye
      ? input.participants.filter((participant) => participant.memberId !== bye.memberId)
      : input.participants;
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      const pairs = candidateMatching(available, costFor, random);
      const totalCost = pairs.reduce((sum, pair) => sum + pair.cost, 0)
        + (bye ? byeCost(bye.memberId, byeHistories, now) : 0);
      if (!best || totalCost < best.totalCost) best = { pairs, bye, totalCost };
    }
  }

  return best!;
}
