import type { PracticeGrade } from "./pairing";

export type MatchSource = "internal_practice" | "external_practice" | "tournament";
export type MatchOutcome = "win" | "loss";

export interface MemberMatchRecord {
  recordId: string;
  source: MatchSource;
  playedOn: string;
  eventName: string;
  opponentKey: string;
  opponentName: string;
  opponentAffiliation: string | null;
  opponentGrade: PracticeGrade;
  outcome: MatchOutcome;
  scoreDifference: number | null;
  note: string | null;
}

export interface StatisticRow {
  key: string;
  label: string;
  matches: number;
  wins: number;
  losses: number;
  winRate: number;
  lastPlayedOn: string | null;
}

export interface MatchStatistics {
  overall: StatisticRow;
  byGrade: StatisticRow[];
  byOpponent: Array<StatisticRow & { affiliation: string | null; grade: PracticeGrade }>;
  bySource: StatisticRow[];
}

const GRADE_ORDER: PracticeGrade[] = ["A", "B", "C", "D", "E", "F", "beginner"];

function winRate(wins: number, matches: number): number {
  return matches === 0 ? 0 : Math.round((wins / matches) * 1_000) / 10;
}

function summarize(key: string, label: string, records: MemberMatchRecord[]): StatisticRow {
  const wins = records.filter((record) => record.outcome === "win").length;
  return {
    key,
    label,
    matches: records.length,
    wins,
    losses: records.length - wins,
    winRate: winRate(wins, records.length),
    lastPlayedOn: records.reduce<string | null>(
      (latest, record) => !latest || record.playedOn > latest ? record.playedOn : latest,
      null,
    ),
  };
}

export function buildMatchStatistics(records: MemberMatchRecord[]): MatchStatistics {
  const byGrade = GRADE_ORDER.map((grade) =>
    summarize(grade, grade === "beginner" ? "初心者" : `${grade}級`, records.filter((record) =>
      record.opponentGrade === grade
    ))
  ).filter((row) => row.matches > 0);

  const opponentGroups = new Map<string, MemberMatchRecord[]>();
  for (const record of records) {
    const current = opponentGroups.get(record.opponentKey) ?? [];
    current.push(record);
    opponentGroups.set(record.opponentKey, current);
  }
  const byOpponent = [...opponentGroups.entries()].map(([key, group]) => ({
    ...summarize(key, group[0].opponentName, group),
    affiliation: group[0].opponentAffiliation,
    grade: group[0].opponentGrade,
  })).sort((left, right) =>
    right.matches - left.matches
    || (right.lastPlayedOn ?? "").localeCompare(left.lastPlayedOn ?? "")
    || left.label.localeCompare(right.label, "ja")
  );

  const sourceLabels: Record<MatchSource, string> = {
    internal_practice: "サークル内練習",
    external_practice: "外部練習会",
    tournament: "大会",
  };
  const bySource = (Object.keys(sourceLabels) as MatchSource[]).map((source) =>
    summarize(source, sourceLabels[source], records.filter((record) => record.source === source))
  ).filter((row) => row.matches > 0);

  return {
    overall: summarize("all", "全対戦", records),
    byGrade,
    byOpponent,
    bySource,
  };
}
