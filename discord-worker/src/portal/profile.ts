import { submitMemberRegistrationRequest } from "../members";
import type { PortalEnv, PortalMemberRow } from "./types";

interface PortalPendingMemberRequestRow {
  request_id: string;
  requested_last_name: string;
  requested_first_name: string;
  requested_last_name_kana: string;
  requested_first_name_kana: string;
  requested_grade: string;
  requested_rank: number;
  submitted_at: string;
}

interface PortalAppearanceRow {
  tournament_id: string;
  group_key: string;
  title: string;
  event_start_date: string;
  grade: string;
  result_text: string | null;
}

interface PortalMatchRow {
  tournament_id: string;
  round_number: number;
  outcome: "win" | "loss";
  score_difference: number | null;
  result_note: string | null;
  opponent_name: string | null;
  opponent_affiliation: string | null;
}

function currentJstDate(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function currentJstFiscalYear(): number {
  const [year, month] = currentJstDate().split("-").map(Number);
  return month >= 4 ? year : year - 1;
}

export async function loadPortalProfile(
  env: PortalEnv,
  member: PortalMemberRow,
): Promise<unknown> {
  const [pending, appearanceRows, matchRows] = await Promise.all([
    env.DB.prepare(
      `SELECT request_id, requested_last_name, requested_first_name,
              requested_last_name_kana, requested_first_name_kana,
              requested_grade, requested_rank, submitted_at
       FROM member_registration_requests
       WHERE discord_user_id = ? AND status = 'pending'
       LIMIT 1`,
    ).bind(member.discord_user_id).first<PortalPendingMemberRequestRow>(),
    env.DB.prepare(
      `SELECT
         tournaments.tournament_id,
         COALESCE(tournaments.registration_group_id, tournaments.tournament_id) AS group_key,
         tournaments.title,
         tournaments.event_start_date,
         CASE
           WHEN tournaments.all_grades = 1
             THEN COALESCE(NULLIF(tournament_entries.archive_grade, ''), ?)
           ELSE tournaments.grade
         END AS grade,
         tournament_entries.result_text
       FROM tournament_entries
       INNER JOIN tournaments
         ON tournaments.tournament_id = tournament_entries.tournament_id
       WHERE tournament_entries.member_id = ?
         AND tournament_entries.status = 'selected'
         AND tournaments.event_start_date <= ?
         AND tournaments.status NOT IN ('canceled', 'deleted')
       ORDER BY tournaments.event_start_date DESC, tournaments.created_at DESC`,
    ).bind(member.grade, member.member_id, currentJstDate()).all<PortalAppearanceRow>(),
    env.DB.prepare(
      `SELECT tournament_id, round_number, outcome, score_difference,
        result_note, opponent_name, opponent_affiliation
       FROM tournament_entry_matches
       WHERE member_id = ?
       ORDER BY tournament_id, round_number`,
    ).bind(member.member_id).all<PortalMatchRow>(),
  ]);
  const seenGroups = new Set<string>();
  const matchesByTournament = new Map<string, Array<{
    round_number: number;
    outcome: "win" | "loss";
    score_difference: number | null;
    result_note: string | null;
    opponent_name: string | null;
    opponent_affiliation: string | null;
  }>>();
  for (const match of matchRows.results) {
    const current = matchesByTournament.get(match.tournament_id) ?? [];
    current.push({
      round_number: Number(match.round_number),
      outcome: match.outcome,
      score_difference: match.score_difference === null ? null : Number(match.score_difference),
      result_note: match.result_note,
      opponent_name: match.opponent_name,
      opponent_affiliation: match.opponent_affiliation,
    });
    matchesByTournament.set(match.tournament_id, current);
  }
  const appearances = appearanceRows.results.filter((appearance) => {
    if (seenGroups.has(appearance.group_key)) return false;
    seenGroups.add(appearance.group_key);
    return true;
  }).map((appearance) => ({
    ...appearance,
    matches: matchesByTournament.get(appearance.tournament_id) ?? [],
  }));
  const fiscalYear = currentJstFiscalYear();
  const fiscalStart = `${fiscalYear}-04-01`;
  const fiscalEnd = `${fiscalYear + 1}-03-31`;
  const fiscalGradeCounts: Record<string, number> = {};
  for (const appearance of appearances) {
    if (appearance.event_start_date < fiscalStart || appearance.event_start_date > fiscalEnd) continue;
    fiscalGradeCounts[appearance.grade] = (fiscalGradeCounts[appearance.grade] ?? 0) + 1;
  }
  return {
    member: {
      last_name: member.last_name,
      first_name: member.first_name,
      last_name_kana: member.last_name_kana || member.display_name_kana || "",
      first_name_kana: member.first_name_kana,
      display_name: member.display_name,
      display_name_kana: member.display_name_kana,
      grade: member.grade,
      rank: Number(member.rank),
    },
    pending_request: pending ? {
      ...pending,
      requested_rank: Number(pending.requested_rank),
    } : null,
    fiscal_year: fiscalYear,
    fiscal_grade_counts: fiscalGradeCounts,
    appearances,
  };
}

export async function submitPortalProfileRequest(
  env: PortalEnv,
  member: PortalMemberRow,
  body: Record<string, unknown>,
): Promise<unknown> {
  await submitMemberRegistrationRequest(env.DB, {
    discordUserId: member.discord_user_id,
    lastName: String(body.lastName ?? ""),
    firstName: String(body.firstName ?? ""),
    lastNameKana: String(body.lastNameKana ?? ""),
    firstNameKana: String(body.firstNameKana ?? ""),
    grade: String(body.grade ?? ""),
    rank: Number(body.rank),
  });
  return loadPortalProfile(env, member);
}
