import { describe, expect, it, vi } from "vitest";
import {
  decideMemberRegistration,
  listAdminMemberAppearances,
  MemberAdminError,
} from "../src/admin-members";

function decisionEnvironment(requestRow: Record<string, unknown>) {
  const sqlStatements: string[] = [];
  const first = vi.fn().mockResolvedValue(requestRow);
  const run = vi.fn().mockResolvedValue({ success: true });
  const bind = vi.fn().mockReturnValue({ first, run });
  const prepare = vi.fn((sql: string) => {
    sqlStatements.push(sql);
    return { bind };
  });
  const batch = vi.fn().mockResolvedValue([]);
  return {
    env: { DB: { prepare, batch } as unknown as D1Database },
    batch,
    sqlStatements,
  };
}

describe("member registration decisions", () => {
  it("summarizes confirmed appearances by grade for the current fiscal year", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-20T12:00:00+09:00"));
    const prepare = vi.fn((sql: string) => ({
      bind: vi.fn().mockReturnValue({
        all: vi.fn().mockResolvedValue({
          results: sql.includes("FROM tournament_entry_matches")
            ? [
              {
                tournament_id: "T-new",
                round_number: 1,
                outcome: "win",
                score_difference: 8,
                result_note: null,
                opponent_name: "山田太郎",
                opponent_affiliation: "世界大学かるた会",
              },
              {
                tournament_id: "T-new",
                round_number: 2,
                outcome: "loss",
                score_difference: 2,
                result_note: null,
                opponent_name: "佐藤花子",
                opponent_affiliation: "ちはやふるかるた会",
              },
            ]
            : [
              { tournament_id: "T-new", group_key: "G-new", title: "秋大会", event_start_date: "2026-10-19", grade: "C", result_text: "優勝" },
              { tournament_id: "T-summer", group_key: "G-summer", title: "夏大会", event_start_date: "2026-06-10", grade: "B", result_text: null },
              { tournament_id: "T-summer-duplicate", group_key: "G-summer", title: "夏大会", event_start_date: "2026-06-10", grade: "B", result_text: null },
              { tournament_id: "T-old", group_key: "G-old", title: "春季大会", event_start_date: "2026-03-20", grade: "C", result_text: "2回戦敗退" },
            ],
        }),
      }),
    }));
    const memberId = "M-11111111-1111-4111-8111-111111111111";

    const history = await listAdminMemberAppearances(
      { DB: { prepare } as unknown as D1Database },
      memberId,
    );

    expect(history).toEqual({
      memberId,
      fiscalYear: 2026,
      gradeCounts: { C: 1, B: 1 },
      appearances: [
        {
          tournamentId: "T-new",
          title: "秋大会",
          eventDate: "2026-10-19",
          grade: "C",
          resultText: "優勝",
          matches: [
            {
              roundNumber: 1,
              outcome: "win",
              scoreDifference: 8,
              resultNote: null,
              opponentName: "山田太郎",
              opponentAffiliation: "世界大学かるた会",
            },
            {
              roundNumber: 2,
              outcome: "loss",
              scoreDifference: 2,
              resultNote: null,
              opponentName: "佐藤花子",
              opponentAffiliation: "ちはやふるかるた会",
            },
          ],
        },
        { tournamentId: "T-summer", title: "夏大会", eventDate: "2026-06-10", grade: "B", resultText: null, matches: [] },
        { tournamentId: "T-old", title: "春季大会", eventDate: "2026-03-20", grade: "C", resultText: "2回戦敗退", matches: [] },
      ],
    });
    expect(prepare.mock.results[0].value.bind).toHaveBeenCalledWith(memberId, "2026-10-20");
    expect(prepare.mock.results[1].value.bind).toHaveBeenCalledWith(memberId);
    expect(prepare.mock.calls[0][0]).toContain("tournament_entries.status = 'selected'");
    expect(prepare.mock.calls[0][0]).toContain("tournaments.status NOT IN ('canceled', 'deleted')");
    vi.useRealTimers();
  });

  it("approves an existing member update while preserving the member ID", async () => {
    const requestId = "MR-11111111-1111-4111-8111-111111111111";
    const { env, batch, sqlStatements } = decisionEnvironment({
      request_id: requestId,
      member_id: "M-11111111-1111-4111-8111-111111111111",
      discord_user_id: "discord-ishida",
      request_type: "update",
      requested_display_name: "石田洋音",
      requested_display_name_kana: "いしだ ようおん",
      requested_last_name: "石田",
      requested_first_name: "洋音",
      requested_last_name_kana: "いしだ",
      requested_first_name_kana: "ひろね",
      requested_grade: "B",
      requested_rank: 3,
      submitted_at: "2026-10-18T00:00:00.000Z",
      current_display_name: "石田洋音",
      current_display_name_kana: "いしだ ようおん",
      current_last_name: "石田",
      current_first_name: "洋音",
      current_last_name_kana: "いしだ",
      current_first_name_kana: "ひろね",
      current_grade: "C",
      current_rank: 2,
      current_status: "active",
      current_dm_enabled: 1,
    });

    const result = await decideMemberRegistration(
      env,
      requestId,
      "approved",
      "admin@example.com",
    );

    expect(result).toEqual({
      requestId,
      decision: "approved",
      memberId: "M-11111111-1111-4111-8111-111111111111",
    });
    expect(batch).toHaveBeenCalledOnce();
    expect(batch.mock.calls[0][0]).toHaveLength(5);
    const invalidationSql = sqlStatements.find(
      (sql) => sql.includes("UPDATE responses") && sql.includes("is_valid = 0"),
    );
    expect(invalidationSql).toContain("tournaments.all_grades = 0");
    expect(sqlStatements.some((sql) =>
      sql.includes("INSERT INTO member_notification_deliveries")
    )).toBe(true);
  });

  it("does not invalidate responses when an update keeps the same grade", async () => {
    const requestId = "MR-22222222-2222-4222-8222-222222222222";
    const { env, batch, sqlStatements } = decisionEnvironment({
      request_id: requestId,
      member_id: "M-22222222-2222-4222-8222-222222222222",
      discord_user_id: "discord-ishida",
      request_type: "update",
      requested_display_name: "石田 洋音",
      requested_display_name_kana: "いしだ ようおん",
      requested_last_name: "石田",
      requested_first_name: "洋音",
      requested_last_name_kana: "いしだ",
      requested_first_name_kana: "ひろね",
      requested_grade: "C",
      requested_rank: 2,
      submitted_at: "2026-10-18T00:00:00.000Z",
      current_display_name: "石田洋音",
      current_display_name_kana: "いしだ ようおん",
      current_last_name: "石田",
      current_first_name: "洋音",
      current_last_name_kana: "いしだ",
      current_first_name_kana: "ひろね",
      current_grade: "C",
      current_rank: 2,
      current_status: "active",
      current_dm_enabled: 1,
    });

    await decideMemberRegistration(
      env,
      requestId,
      "approved",
      "admin@example.com",
    );

    expect(batch.mock.calls[0][0]).toHaveLength(4);
    expect(sqlStatements.some((sql) => sql.includes("UPDATE responses"))).toBe(
      false,
    );
  });

  it("queues a distinct approval DM for a new registration", async () => {
    const requestId = "MR-33333333-3333-4333-8333-333333333333";
    const { env, batch, sqlStatements } = decisionEnvironment({
      request_id: requestId,
      member_id: null,
      discord_user_id: "discord-new-member",
      request_type: "new",
      requested_display_name: "埼玉花子",
      requested_display_name_kana: "さいたま はなこ",
      requested_last_name: "埼玉",
      requested_first_name: "花子",
      requested_last_name_kana: "さいたま",
      requested_first_name_kana: "はなこ",
      requested_grade: "C",
      requested_rank: 1,
      submitted_at: "2026-10-18T00:00:00.000Z",
      current_display_name: null,
      current_display_name_kana: null,
      current_last_name: null,
      current_first_name: null,
      current_last_name_kana: null,
      current_first_name_kana: null,
      current_grade: null,
      current_rank: null,
      current_status: null,
      current_dm_enabled: null,
    });

    const result = await decideMemberRegistration(
      env,
      requestId,
      "approved",
      "admin@example.com",
    );

    expect(result.decision).toBe("approved");
    expect(result.memberId).toMatch(/^M-/);
    expect(batch.mock.calls[0][0]).toHaveLength(3);
    expect(sqlStatements.some((sql) =>
      sql.includes("INSERT INTO member_notification_deliveries")
    )).toBe(true);
  });

  it("rejects an unsupported decision before changing the database", async () => {
    const { env, batch } = decisionEnvironment({});

    await expect(
      decideMemberRegistration(
        env,
        "MR-11111111-1111-4111-8111-111111111111",
        "later",
        "admin@example.com",
      ),
    ).rejects.toBeInstanceOf(MemberAdminError);
    expect(batch).not.toHaveBeenCalled();
  });
});
