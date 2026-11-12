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

interface AggregatedHistoryCost {
  count: number;
  recencyCost: number;
  latestSequence: number;
}

function aggregatePairCosts(histories: PairHistory[], now: Date): Map<string, number> {
  const aggregates = new Map<string, AggregatedHistoryCost>();
  let globalLatestSequence = -1;
  for (const history of histories) {
    const key = pairKey(history.member1Id, history.member2Id);
    const aggregate = aggregates.get(key) ?? {
      count: 0,
      recencyCost: 0,
      latestSequence: -1,
    };
    aggregate.count += 1;
    const age = daysBetween(history.playedAt, now);
    if (age <= 1) aggregate.recencyCost += 10_000;
    else if (age <= 7) aggregate.recencyCost += 2_500;
    else if (age <= 30) aggregate.recencyCost += 600;
    else if (age <= 90) aggregate.recencyCost += 150;
    const sequence = history.sequence ?? -1;
    aggregate.latestSequence = Math.max(aggregate.latestSequence, sequence);
    globalLatestSequence = Math.max(globalLatestSequence, sequence);
    aggregates.set(key, aggregate);
  }

  const costs = new Map<string, number>();
  for (const [key, aggregate] of aggregates) {
    const latestCost = aggregate.latestSequence >= 0
        && aggregate.latestSequence === globalLatestSequence
      ? 20_000
      : 0;
    costs.set(key, aggregate.count * 500 + aggregate.recencyCost + latestCost);
  }
  return costs;
}

function aggregateByeCosts(histories: ByeHistory[], now: Date): Map<string, number> {
  const aggregates = new Map<string, AggregatedHistoryCost>();
  let globalLatestSequence = -1;
  for (const history of histories) {
    const aggregate = aggregates.get(history.memberId) ?? {
      count: 0,
      recencyCost: 0,
      latestSequence: -1,
    };
    aggregate.count += 1;
    const age = daysBetween(history.restedAt, now);
    if (age <= 1) aggregate.recencyCost += 20_000;
    else if (age <= 7) aggregate.recencyCost += 4_000;
    else if (age <= 30) aggregate.recencyCost += 800;
    const sequence = history.sequence ?? -1;
    aggregate.latestSequence = Math.max(aggregate.latestSequence, sequence);
    globalLatestSequence = Math.max(globalLatestSequence, sequence);
    aggregates.set(history.memberId, aggregate);
  }

  const costs = new Map<string, number>();
  for (const [memberId, aggregate] of aggregates) {
    const latestCost = aggregate.latestSequence >= 0
        && aggregate.latestSequence === globalLatestSequence
      ? 30_000
      : 0;
    costs.set(memberId, aggregate.count * 2_000 + aggregate.recencyCost + latestCost);
  }
  return costs;
}

function pairCost(
  left: PairingParticipant,
  right: PairingParticipant,
  historyCosts: Map<string, number>,
  mode: PracticePairingMode,
): number {
  let cost = 0;
  if (mode === "near_grade") {
    const gradeDistance = Math.abs(GRADE_ORDER[left.grade] - GRADE_ORDER[right.grade]);
    cost += gradeDistance * gradeDistance * 80;
  }
  return cost + (historyCosts.get(pairKey(left.memberId, right.memberId)) ?? 0);
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
  const pairHistoryCosts = aggregatePairCosts(histories, now);
  const byeHistoryCosts = aggregateByeCosts(byeHistories, now);
  const costFor = (left: PairingParticipant, right: PairingParticipant) =>
    pairCost(left, right, pairHistoryCosts, input.mode);
  const byeCostFor = (memberId: string) => byeHistoryCosts.get(memberId) ?? 0;
  const random = seededRandom(input.seed);
  const byeCandidates = input.participants.length % 2 === 0
    ? [null]
    : [...input.participants].sort((left, right) =>
      byeCostFor(left.memberId) - byeCostFor(right.memberId)
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
        + (bye ? byeCostFor(bye.memberId) : 0);
      if (!best || totalCost < best.totalCost) best = { pairs, bye, totalCost };
    }
  }

  return best!;
}
