import type { PracticeEnv } from "./service";
import type { PracticeGrade } from "./pairing";

const MEMBER_ID = /^M-[0-9a-f-]{36}$/;
const GUEST_PROFILE_ID = /^GP-[0-9a-f-]{36}$/;

interface GuestProfileRow {
  guest_profile_id: string;
  display_name: string;
  normalized_name: string;
  last_used_at: string | null;
  participation_count: number;
  last_grade: PracticeGrade | null;
  linked_member_id: string | null;
  linked_member_name: string | null;
  linked_at: string | null;
}

export interface PracticeGuestProfile {
  guestProfileId: string;
  displayName: string;
  lastUsedAt: string | null;
  participationCount: number;
  lastGrade: PracticeGrade | null;
}

export interface AdminPracticeGuestProfile extends PracticeGuestProfile {
  linkedMemberId: string | null;
  linkedMemberName: string | null;
  linkedAt: string | null;
  suggested: boolean;
}

export class GuestIdentityError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export function normalizeGuestName(value: string): string {
  return value.normalize("NFKC").trim().replace(/[\s　]+/g, "").toLocaleLowerCase("ja");
}

const guestProfileSelect = `
  SELECT practice_guest_profiles.guest_profile_id,
         practice_guest_profiles.display_name,
         practice_guest_profiles.normalized_name,
         practice_guest_profiles.last_used_at,
         COUNT(practice_guests.guest_id) AS participation_count,
         (
           SELECT recent_guest.grade_snapshot
           FROM practice_guests AS recent_guest
           WHERE recent_guest.guest_profile_id = practice_guest_profiles.guest_profile_id
           ORDER BY recent_guest.created_at DESC
           LIMIT 1
         ) AS last_grade,
         practice_guest_member_links.member_id AS linked_member_id,
         linked_member.display_name AS linked_member_name,
         practice_guest_member_links.linked_at
  FROM practice_guest_profiles
  LEFT JOIN practice_guests
    ON practice_guests.guest_profile_id = practice_guest_profiles.guest_profile_id
  LEFT JOIN practice_guest_member_links
    ON practice_guest_member_links.guest_profile_id = practice_guest_profiles.guest_profile_id
  LEFT JOIN members AS linked_member
    ON linked_member.member_id = practice_guest_member_links.member_id`;

function toGuestProfile(row: GuestProfileRow): PracticeGuestProfile {
  return {
    guestProfileId: row.guest_profile_id,
    displayName: row.display_name,
    lastUsedAt: row.last_used_at,
    participationCount: Number(row.participation_count),
    lastGrade: row.last_grade,
  };
}

export async function listReusableGuestProfiles(
  env: PracticeEnv,
): Promise<PracticeGuestProfile[]> {
  const rows = await env.DB.prepare(
    `${guestProfileSelect}
     WHERE practice_guest_profiles.status = 'active'
       AND practice_guest_member_links.guest_profile_id IS NULL
     GROUP BY practice_guest_profiles.guest_profile_id
     ORDER BY practice_guest_profiles.last_used_at DESC,
              practice_guest_profiles.display_name`,
  ).all<GuestProfileRow>();
  return rows.results.map(toGuestProfile);
}

export async function listGuestProfilesForMember(
  env: PracticeEnv,
  memberId: string,
): Promise<AdminPracticeGuestProfile[]> {
  if (!MEMBER_ID.test(memberId)) throw new GuestIdentityError("会員を確認できませんでした。", 404);
  const member = await env.DB.prepare(
    `SELECT display_name, display_name_kana FROM members WHERE member_id = ?`,
  ).bind(memberId).first<{ display_name: string; display_name_kana: string }>();
  if (!member) throw new GuestIdentityError("会員を確認できませんでした。", 404);

  const normalizedCandidates = new Set([
    normalizeGuestName(member.display_name),
    normalizeGuestName(member.display_name_kana),
  ].filter(Boolean));
  const rows = await env.DB.prepare(
    `${guestProfileSelect}
     WHERE practice_guest_profiles.status = 'active'
     GROUP BY practice_guest_profiles.guest_profile_id
     ORDER BY CASE WHEN practice_guest_member_links.member_id = ? THEN 0
                   WHEN practice_guest_member_links.member_id IS NULL THEN 1 ELSE 2 END,
              practice_guest_profiles.last_used_at DESC,
              practice_guest_profiles.display_name`,
  ).bind(memberId).all<GuestProfileRow>();
  return rows.results.map((row) => ({
    ...toGuestProfile(row),
    linkedMemberId: row.linked_member_id,
    linkedMemberName: row.linked_member_name,
    linkedAt: row.linked_at,
    suggested: normalizedCandidates.has(row.normalized_name),
  }));
}

export async function replaceMemberGuestProfileLinks(
  env: PracticeEnv,
  memberId: string,
  rawGuestProfileIds: unknown,
  actorEmail: string,
): Promise<AdminPracticeGuestProfile[]> {
  if (!MEMBER_ID.test(memberId)) throw new GuestIdentityError("会員を確認できませんでした。", 404);
  if (!Array.isArray(rawGuestProfileIds)) {
    throw new GuestIdentityError("紐付けるゲストを選択してください。");
  }
  const guestProfileIds = [...new Set(rawGuestProfileIds.map(String))];
  if (guestProfileIds.some((id) => !GUEST_PROFILE_ID.test(id))) {
    throw new GuestIdentityError("ゲスト情報を確認できませんでした。");
  }
  const member = await env.DB.prepare(
    `SELECT member_id FROM members WHERE member_id = ?`,
  ).bind(memberId).first<{ member_id: string }>();
  if (!member) throw new GuestIdentityError("会員を確認できませんでした。", 404);

  const desiredRows = guestProfileIds.length
    ? await env.DB.prepare(
      `SELECT practice_guest_profiles.guest_profile_id,
              practice_guest_member_links.member_id AS linked_member_id
       FROM practice_guest_profiles
       LEFT JOIN practice_guest_member_links
         ON practice_guest_member_links.guest_profile_id = practice_guest_profiles.guest_profile_id
       WHERE practice_guest_profiles.status = 'active'
         AND practice_guest_profiles.guest_profile_id IN (${guestProfileIds.map(() => "?").join(", ")})`,
    ).bind(...guestProfileIds).all<{ guest_profile_id: string; linked_member_id: string | null }>()
    : { results: [] as Array<{ guest_profile_id: string; linked_member_id: string | null }> };
  if (desiredRows.results.length !== guestProfileIds.length) {
    throw new GuestIdentityError("選択したゲスト情報が見つかりませんでした。", 404);
  }
  const conflict = desiredRows.results.find((row) => row.linked_member_id && row.linked_member_id !== memberId);
  if (conflict) {
    throw new GuestIdentityError("別の会員に紐付いているゲストが含まれています。先に現在の紐付けを解除してください。", 409);
  }

  const currentRows = await env.DB.prepare(
    `SELECT guest_profile_id FROM practice_guest_member_links WHERE member_id = ?`,
  ).bind(memberId).all<{ guest_profile_id: string }>();
  const current = new Set(currentRows.results.map((row) => row.guest_profile_id));
  const desired = new Set(guestProfileIds);
  const removed = [...current].filter((id) => !desired.has(id));
  const added = [...desired].filter((id) => !current.has(id));
  const statements: D1PreparedStatement[] = [];
  for (const guestProfileId of removed) {
    statements.push(
      env.DB.prepare(
        `DELETE FROM practice_guest_member_links
         WHERE guest_profile_id = ? AND member_id = ?`,
      ).bind(guestProfileId, memberId),
      env.DB.prepare(
        `INSERT INTO practice_guest_member_link_events (
           event_id, guest_profile_id, member_id, action, acted_by_email
         ) VALUES (?, ?, ?, 'unlink', ?)`,
      ).bind(`GPLE-${crypto.randomUUID()}`, guestProfileId, memberId, actorEmail),
    );
  }
  for (const guestProfileId of added) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO practice_guest_member_links (
           guest_profile_id, member_id, linked_by_email
         ) VALUES (?, ?, ?)`,
      ).bind(guestProfileId, memberId, actorEmail),
      env.DB.prepare(
        `INSERT INTO practice_guest_member_link_events (
           event_id, guest_profile_id, member_id, action, acted_by_email
         ) VALUES (?, ?, ?, 'link', ?)`,
      ).bind(`GPLE-${crypto.randomUUID()}`, guestProfileId, memberId, actorEmail),
    );
  }
  if (statements.length) await env.DB.batch(statements);
  return listGuestProfilesForMember(env, memberId);
}
