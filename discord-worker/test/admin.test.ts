import { describe, expect, it, vi } from "vitest";
import {
  editTournaments,
  handleAdminRequest,
  listAdminTournaments,
  type AdminEnv,
} from "../src/admin";

const env = {
  DB: {} as D1Database,
} satisfies AdminEnv;

function authenticatedContext(waitUntil = vi.fn()) {
  return {
    access: {
      getIdentity: vi.fn().mockResolvedValue({ email: "admin@example.com" }),
    },
    waitUntil,
  } as unknown as Pick<ExecutionContext, "access" | "waitUntil">;
}

describe("Admin Worker", () => {
  it("rejects a request that did not pass Cloudflare Access", async () => {
    const response = await handleAdminRequest(
      new Request("https://admin.example.com/"),
      env,
      { waitUntil: vi.fn() },
    );

    expect(response.status).toBe(403);
  });

  it("redirects the root to the tournament registration page", async () => {
    const response = await handleAdminRequest(
      new Request("https://admin.example.com/"),
      env,
      authenticatedContext(),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/register");
  });

  it.each([
    ["register", "大会登録"],
    ["tournaments", "大会一覧"],
    ["members", "メンバー管理"],
  ])("serves the %s page with tab navigation", async (path, label) => {
    const response = await handleAdminRequest(
      new Request(`https://admin.example.com/${path}`),
      env,
      authenticatedContext(),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Security-Policy")).toContain(
      "frame-ancestors 'none'",
    );
    const html = await response.text();
    expect(html).toContain("大会管理（Discord版MVP）");
    expect(html).toContain(`>${label}`);
    expect(html).toContain(`href="/${path}" aria-current="page"`);
    expect(html).toContain(`data-page="${path}"`);
  });

  it("shows the queue notice only on the registration page", async () => {
    const response = await handleAdminRequest(
      new Request("https://admin.example.com/register"),
      env,
      authenticatedContext(),
    );

    const html = await response.text();
    expect(html).toContain("登録済みメンバー全員");
    expect(html).not.toContain("最大10人");
    expect(html).toContain('name="grades" value="all"');
    expect(html).toContain("selectedRegistrationGrades()");
  });

  it("renders compact response lists with grouping, sorting, and status filters", async () => {
    const response = await handleAdminRequest(
      new Request("https://admin.example.com/tournaments"),
      env,
      authenticatedContext(),
    );

    const html = await response.text();
    expect(html).toContain('id="tournament-sort"');
    expect(html).toContain('<option value="deadline_asc">締切日が近い順</option>');
    expect(html).toContain('id="tournament-status-filter"');
    expect(html).toContain("responseLabels[response] + '(' + people.length + '人)'");
    expect(html).toContain("groupTournaments(loadedTournaments)");
    expect(html).toContain("person.display_name_kana || 'よみがな未登録'");
    expect(html).not.toContain("回答者の内訳");
    expect(html).not.toContain('class="stats"');
  });

  it("shows tournament editing and grouped application-completion controls", async () => {
    const response = await handleAdminRequest(
      new Request("https://admin.example.com/tournaments"),
      env,
      authenticatedContext(),
    );

    const html = await response.text();
    expect(html).toContain('id="edit-tournament-dialog"');
    expect(html).toContain("大会情報を編集");
    expect(html).toContain("申込完了にする");
    expect(html).toContain("tournamentIds: tournaments.map");
    expect(html).toContain("開催級はこの画面では変更できません");
  });

  it("uses 23:59 as the default organizer deadline time", async () => {
    const response = await handleAdminRequest(
      new Request("https://admin.example.com/register"),
      env,
      authenticatedContext(),
    );

    const html = await response.text();
    expect(html).toContain("+ 'T23:59'");
    expect(html).toContain(
      "form.elements.internalDeadline.value = dateValue(threeDaysEarlier) + organizerDeadline.slice(10)",
    );
  });

  it("places the organizer deadline first and derives the internal deadline three days earlier", async () => {
    const response = await handleAdminRequest(
      new Request("https://admin.example.com/register"),
      env,
      authenticatedContext(),
    );

    const html = await response.text();
    expect(html.indexOf('name="trueDeadline"')).toBeLessThan(
      html.indexOf('name="internalDeadline"'),
    );
    expect(html).toContain("基本的に主催締切日の3日前を自動入力");
    expect(html).toContain("3 * 86400000");
    expect(html).toContain(
      "trueDeadline.addEventListener('input', setInternalDeadlineFromOrganizer)",
    );
  });

  it("shows the requested two-column layout with optional per-grade dates", async () => {
    const response = await handleAdminRequest(
      new Request("https://admin.example.com/register"),
      env,
      authenticatedContext(),
    );

    const html = await response.text();
    const formHtml = html.slice(
      html.indexOf('<form id="tournament-form"'),
      html.indexOf("</form>") + 7,
    );
    const orderedLabels = [
      "大会名",
      "開催級",
      "開催日",
      "大会種別",
      "主催締切日",
      "サークル内締切日",
      "会場",
      "大会要項",
    ];
    const positions = orderedLabels.map((label) => formHtml.indexOf(label));

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(formHtml).toContain('name="eventDate"');
    expect(formHtml).not.toContain('name="eventStartDate"');
    expect(formHtml).not.toContain('name="eventEndDate"');
    expect(html).toContain(
      "grid-template-columns: repeat(2, minmax(0, 1fr))",
    );
    expect(formHtml).toContain('class="grade-picker wide"');
    expect(formHtml).toContain(
      '<span>サークル内締切日 <span class="optional">（基本的に主催締切日の3日前を自動入力）</span></span>',
    );
    expect(html).toContain("payload.eventStartDate = payload.eventDate");
    expect(html).toContain("payload.eventEndDate = payload.eventDate");
    expect(formHtml).toContain('id="grade-date-settings"');
    expect(html).toContain("payload.eventDatesByGrade");
  });

  it("checks and clears every grade with the all-grades checkbox", async () => {
    const response = await handleAdminRequest(
      new Request("https://admin.example.com/register"),
      env,
      authenticatedContext(),
    );

    const html = await response.text();
    expect(html).toContain(
      "checkbox.checked = allGradesCheckbox.checked",
    );
    expect(html).toContain(
      "allGradesCheckbox?.addEventListener('change'",
    );
    expect(html).toContain("allGradesCheckbox?.checked");
    expect(html).toContain("return ['all']");
  });

  it("offers direct PDF upload for registration and editing", async () => {
    const response = await handleAdminRequest(
      new Request("https://admin.example.com/register"),
      env,
      authenticatedContext(),
    );

    const html = await response.text();
    expect(html.match(/type="file" name="documentFile"/g)).toHaveLength(2);
    expect(html).toContain("PDF形式、20MBまで");
    expect(html).toContain("fetch('/api/documents'");
  });

  it("clears the complete registration form after a successful submission", async () => {
    const response = await handleAdminRequest(
      new Request("https://admin.example.com/register"),
      env,
      authenticatedContext(),
    );

    const html = await response.text();
    expect(html).toContain("function resetTournamentForm()");
    expect(html).toContain("form.reset()");
    expect(html).toContain("gradeDateGrid.replaceChildren()");
    expect(html).toContain("gradeDateSettings.hidden = true");
    expect(html).toContain("previousCommonEventDate = ''");
    expect(html).toContain("resetTournamentForm()");
  });

  it("stores a valid tournament for the notification worker", async () => {
    const waitUntil = vi.fn();
    const creator = vi.fn().mockResolvedValue([
      {
        tournament_id: "T-test",
        title: "テスト大会",
        event_start_date: "2026-11-01",
        event_end_date: "2026-11-01",
        grade: "C",
        internal_deadline: "2026-10-25T14:59:00.000Z",
        true_deadline: "2026-10-28T14:59:00.000Z",
      },
    ]);
    const response = await handleAdminRequest(
      new Request("https://admin.example.com/api/tournaments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://admin.example.com",
        },
        body: JSON.stringify({
          title: "テスト大会",
          grade: "C",
          tournamentType: "official",
          eventStartDate: "2026-11-01",
          eventEndDate: "2026-11-01",
          internalDeadline: "2026-10-25T23:59:00+09:00",
          trueDeadline: "2026-10-28T23:59:00+09:00",
        }),
      }),
      env,
      authenticatedContext(waitUntil),
      creator,
    );

    expect(response.status).toBe(201);
    expect(creator).toHaveBeenCalledWith(
      env,
      [
        expect.objectContaining({
          title: "テスト大会",
          grade: "C",
          createdByEmail: "admin@example.com",
        }),
      ],
    );
    expect(waitUntil).not.toHaveBeenCalled();
  });

  it("registers the same tournament for multiple grades in one request", async () => {
    const creator = vi.fn().mockResolvedValue([
      { tournament_id: "T-grade-b" },
      { tournament_id: "T-grade-c" },
    ]);
    const response = await handleAdminRequest(
      new Request("https://admin.example.com/api/tournaments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://admin.example.com",
        },
        body: JSON.stringify({
          title: "複数級大会",
          grades: ["B", "C"],
          tournamentType: "official",
          eventStartDate: "2026-11-01",
          eventEndDate: "2026-11-01",
          eventDatesByGrade: { B: "2026-11-01", C: "2026-11-08" },
          internalDeadline: "2026-10-25T23:59:00+09:00",
          trueDeadline: "2026-10-28T23:59:00+09:00",
        }),
      }),
      env,
      authenticatedContext(),
      creator,
    );

    expect(response.status).toBe(201);
    expect(creator).toHaveBeenCalledWith(
      env,
      [
        expect.objectContaining({ grade: "B", title: "複数級大会", eventStartDate: "2026-11-01" }),
        expect.objectContaining({ grade: "C", title: "複数級大会", eventStartDate: "2026-11-08" }),
      ],
    );
    await expect(response.json()).resolves.toMatchObject({
      tournamentIds: ["T-grade-b", "T-grade-c"],
      message: expect.stringContaining("2件"),
    });
  });

  it("rejects selecting all grades together with an individual grade", async () => {
    const creator = vi.fn();
    const response = await handleAdminRequest(
      new Request("https://admin.example.com/api/tournaments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://admin.example.com",
        },
        body: JSON.stringify({ grades: ["all", "C"] }),
      }),
      env,
      authenticatedContext(),
      creator,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("同時に選択できません"),
    });
    expect(creator).not.toHaveBeenCalled();
  });

  it("rejects a cross-origin submission", async () => {
    const response = await handleAdminRequest(
      new Request("https://admin.example.com/api/tournaments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://attacker.example",
        },
        body: "{}",
      }),
      env,
      authenticatedContext(),
    );

    expect(response.status).toBe(403);
  });

  it("returns the tournament list and response summary", async () => {
    const lister = vi.fn().mockResolvedValue([
      {
        tournament_id: "T-11111111-1111-4111-8111-111111111111",
        title: "管理画面テスト大会",
        status: "active",
        response_yes: 1,
        response_maybe: 0,
        response_no: 0,
        response_pending: 0,
        responses: [{ display_name: "埼玉 花子", response: "yes" }],
      },
    ]);
    const response = await handleAdminRequest(
      new Request("https://admin.example.com/api/tournaments"),
      env,
      authenticatedContext(),
      undefined,
      lister,
    );

    expect(response.status).toBe(200);
    expect(lister).toHaveBeenCalledWith(env);
    await expect(response.json()).resolves.toMatchObject({
      tournaments: [
        {
          title: "管理画面テスト大会",
          response_yes: 1,
          responses: [{ display_name: "埼玉 花子", response: "yes" }],
        },
      ],
    });
  });

  it("includes unanswered eligible members with their grade and reading", async () => {
    const prepare = vi.fn((sql: string) => ({
      all: vi.fn(async () => ({
        results: sql.includes("INNER JOIN members")
          ? [
              {
                tournament_id: "T-11111111-1111-4111-8111-111111111111",
                response: "yes",
                display_name: "石田洋音",
                display_name_kana: "いしだひろね",
                grade: "C",
                is_eligible: 1,
                updated_at: "2026-10-18T00:00:00.000Z",
              },
              {
                tournament_id: "T-11111111-1111-4111-8111-111111111111",
                response: "pending",
                display_name: "山田花子",
                display_name_kana: "やまだはなこ",
                grade: "C",
                is_eligible: 1,
                updated_at: "2026-10-18T00:00:00.000Z",
              },
            ]
          : [
              {
                tournament_id: "T-11111111-1111-4111-8111-111111111111",
                registration_group_id: null,
                title: "一覧テスト大会",
                event_start_date: "2026-11-01",
                event_end_date: "2026-11-01",
                grade: "C",
                all_grades: 0,
                tournament_type: "official",
                venue: null,
                true_deadline: "2026-10-28T14:59:00.000Z",
                internal_deadline: "2026-10-25T14:59:00.000Z",
                document_url: null,
                status: "active",
                created_at: "2026-10-18T00:00:00.000Z",
                announcements_sent: 1,
                invitation_dms_sent: 2,
                notifications_queued: 0,
                notification_failures: 0,
              },
            ],
      })),
    }));

    const [tournament] = await listAdminTournaments({
      DB: { prepare } as unknown as D1Database,
    });

    expect(tournament).toMatchObject({
      response_yes: 1,
      response_pending: 1,
      response_total: 1,
      eligible_members: 2,
      responses: [
        { display_name: "石田洋音", display_name_kana: "いしだひろね", response: "yes" },
        { display_name: "山田花子", display_name_kana: "やまだはなこ", response: "pending" },
      ],
    });
  });

  it("updates a tournament status with the authenticated administrator", async () => {
    const statusUpdater = vi.fn().mockResolvedValue({
      tournamentId: "T-11111111-1111-4111-8111-111111111111",
      previousStatus: "active",
      status: "closed",
      changed: true,
    });
    const response = await handleAdminRequest(
      new Request(
        "https://admin.example.com/api/tournaments/T-11111111-1111-4111-8111-111111111111/status",
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Origin: "https://admin.example.com",
          },
          body: JSON.stringify({ status: "closed" }),
        },
      ),
      env,
      authenticatedContext(),
      undefined,
      undefined,
      statusUpdater,
    );

    expect(response.status).toBe(200);
    expect(statusUpdater).toHaveBeenCalledWith(
      env,
      "T-11111111-1111-4111-8111-111111111111",
      "closed",
      "admin@example.com",
    );
  });

  it("completes every grade in a tournament group in one request", async () => {
    const statusesUpdater = vi.fn().mockResolvedValue({
      tournamentIds: [
        "T-11111111-1111-4111-8111-111111111111",
        "T-22222222-2222-4222-8222-222222222222",
      ],
      status: "applied",
      changedCount: 2,
      completionNotificationQueued: true,
    });
    const response = await handleAdminRequest(
      new Request("https://admin.example.com/api/tournaments/status", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://admin.example.com",
        },
        body: JSON.stringify({
          tournamentIds: [
            "T-11111111-1111-4111-8111-111111111111",
            "T-22222222-2222-4222-8222-222222222222",
          ],
          status: "applied",
        }),
      }),
      env,
      authenticatedContext(),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      statusesUpdater,
    );

    expect(response.status).toBe(200);
    expect(statusesUpdater).toHaveBeenCalledWith(
      env,
      [
        "T-11111111-1111-4111-8111-111111111111",
        "T-22222222-2222-4222-8222-222222222222",
      ],
      "applied",
      "admin@example.com",
    );
    await expect(response.json()).resolves.toMatchObject({
      changedCount: 2,
      message: expect.stringContaining("告知チャンネル"),
    });
  });

  it("edits tournament information without changing its grade or ID", async () => {
    const tournamentEditor = vi.fn().mockResolvedValue({
      tournaments: [{ tournament_id: "T-11111111-1111-4111-8111-111111111111" }],
      notificationsQueued: 2,
    });
    const body = {
      tournamentIds: ["T-11111111-1111-4111-8111-111111111111"],
      title: "修正版大会",
      eventStartDate: "2026-11-02",
      tournamentType: "official",
      internalDeadline: "2026-10-26T14:59:00.000Z",
      trueDeadline: "2026-10-29T14:59:00.000Z",
      venue: "さいたま会館",
      documentUrl: "https://example.com/revised.pdf",
    };
    const response = await handleAdminRequest(
      new Request("https://admin.example.com/api/tournaments", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://admin.example.com",
        },
        body: JSON.stringify(body),
      }),
      env,
      authenticatedContext(),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      tournamentEditor,
    );

    expect(response.status).toBe(200);
    expect(tournamentEditor).toHaveBeenCalledWith(
      env,
      body.tournamentIds,
      expect.objectContaining({ title: "修正版大会" }),
      "admin@example.com",
    );
    await expect(response.json()).resolves.toMatchObject({
      message: expect.stringContaining("更新通知を予約"),
    });
  });

  it("keeps a grouped tournament while saving a different date for each grade", async () => {
    const updates: Array<{ sql: string; values: unknown[] }> = [];
    const tournaments = [
      {
        tournament_id: "T-11111111-1111-4111-8111-111111111111",
        registration_group_id: "TG-11111111-1111-4111-8111-111111111111",
        title: "複数日大会",
        event_start_date: "2026-11-01",
        event_end_date: "2026-11-01",
        grade: "B",
        all_grades: 0,
        tournament_type: "official",
        venue: null,
        true_deadline: "2026-10-28T14:59:00.000Z",
        internal_deadline: "2026-10-25T14:59:00.000Z",
        document_url: null,
        status: "draft",
      },
      {
        tournament_id: "T-22222222-2222-4222-8222-222222222222",
        registration_group_id: "TG-11111111-1111-4111-8111-111111111111",
        title: "複数日大会",
        event_start_date: "2026-11-01",
        event_end_date: "2026-11-01",
        grade: "C",
        all_grades: 0,
        tournament_type: "official",
        venue: null,
        true_deadline: "2026-10-28T14:59:00.000Z",
        internal_deadline: "2026-10-25T14:59:00.000Z",
        document_url: null,
        status: "draft",
      },
    ];
    const prepare = vi.fn((sql: string) => ({
      bind: vi.fn((...values: unknown[]) => ({
        all: vi.fn().mockResolvedValue({ results: tournaments }),
        first: vi.fn().mockResolvedValue({ count: 2 }),
        sql,
        values,
      })),
    }));
    const batch = vi.fn(async (statements: Array<{ sql: string; values: unknown[] }>) => {
      updates.push(...statements);
      return statements.map(() => ({ success: true }));
    });
    const editEnv = { DB: { prepare, batch } as unknown as D1Database };

    const result = await editTournaments(
      editEnv,
      tournaments.map((item) => item.tournament_id),
      {
        title: "複数日大会",
        eventStartDate: "2026-11-01",
        eventDatesByTournament: {
          [tournaments[0].tournament_id]: "2026-11-01",
          [tournaments[1].tournament_id]: "2026-11-08",
        },
        tournamentType: "official",
        trueDeadline: "2026-10-28T14:59:00.000Z",
        internalDeadline: "2026-10-25T14:59:00.000Z",
      },
      "admin@example.com",
    );

    expect(result.tournaments.map((item) => item.event_start_date)).toEqual([
      "2026-11-01",
      "2026-11-08",
    ]);
    const updateStatement = updates.find((item) => item.sql.includes("UPDATE tournaments"));
    expect(updateStatement?.values.slice(0, 2)).toEqual(["複数日大会", "2026-11-08"]);
  });

  it("rejects an unsupported tournament status", async () => {
    const statusUpdater = vi.fn();
    const response = await handleAdminRequest(
      new Request(
        "https://admin.example.com/api/tournaments/T-11111111-1111-4111-8111-111111111111/status",
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Origin: "https://admin.example.com",
          },
          body: JSON.stringify({ status: "deleted" }),
        },
      ),
      env,
      authenticatedContext(),
      undefined,
      undefined,
      statusUpdater,
    );

    expect(response.status).toBe(400);
    expect(statusUpdater).not.toHaveBeenCalled();
  });

  it("returns members without exposing Discord user IDs", async () => {
    const memberLister = vi.fn().mockResolvedValue([
      {
        memberId: "M-11111111-1111-4111-8111-111111111111",
        displayName: "石田 洋音",
        displayNameKana: "いしだ ようおん",
        grade: "C",
        rank: 2,
        status: "active",
        dmEnabled: true,
        discordLinked: true,
        createdAt: "2026-10-01T00:00:00.000Z",
        updatedAt: "2026-10-01T00:00:00.000Z",
      },
    ]);
    const response = await handleAdminRequest(
      new Request("https://admin.example.com/api/members"),
      env,
      authenticatedContext(),
      undefined,
      undefined,
      undefined,
      memberLister,
    );

    expect(response.status).toBe(200);
    const body = await response.json() as { members: Array<Record<string, unknown>> };
    expect(body.members[0]).toMatchObject({
      displayName: "石田 洋音",
      displayNameKana: "いしだ ようおん",
      discordLinked: true,
    });
    expect(body.members[0]).not.toHaveProperty("discordUserId");
  });

  it("updates a member with the authenticated administrator", async () => {
    const memberId = "M-11111111-1111-4111-8111-111111111111";
    const memberUpdater = vi.fn().mockResolvedValue({
      memberId,
      displayName: "石田 洋音",
      displayNameKana: "いしだ ようおん",
      grade: "B",
      rank: 3,
      status: "active",
      dmEnabled: false,
      discordLinked: true,
    });
    const input = {
      displayName: "石田 洋音",
      displayNameKana: "いしだ ようおん",
      grade: "B",
      rank: 3,
      status: "active",
      dmEnabled: false,
    };
    const response = await handleAdminRequest(
      new Request(`https://admin.example.com/api/members/${memberId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://admin.example.com",
        },
        body: JSON.stringify(input),
      }),
      env,
      authenticatedContext(),
      undefined,
      undefined,
      undefined,
      undefined,
      memberUpdater,
    );

    expect(response.status).toBe(200);
    expect(memberUpdater).toHaveBeenCalledWith(
      env,
      memberId,
      input,
      "admin@example.com",
    );
  });

  it("returns pending registration requests without exposing Discord user IDs", async () => {
    const registrationLister = vi.fn().mockResolvedValue([
      {
        requestId: "MR-11111111-1111-4111-8111-111111111111",
        requestType: "update",
        requestedDisplayName: "石田洋音",
        requestedDisplayNameKana: "いしだ ようおん",
        requestedGrade: "B",
        requestedRank: 3,
        currentDisplayName: "石田洋音",
        currentDisplayNameKana: "いしだ ようおん",
        currentGrade: "C",
        currentRank: 2,
        currentStatus: "active",
        submittedAt: "2026-10-18T00:00:00.000Z",
      },
    ]);
    const response = await handleAdminRequest(
      new Request("https://admin.example.com/api/member-requests"),
      env,
      authenticatedContext(),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      registrationLister,
    );

    expect(response.status).toBe(200);
    const body = await response.json() as { requests: Array<Record<string, unknown>> };
    expect(body.requests[0]).toMatchObject({
      requestType: "update",
      currentGrade: "C",
      requestedGrade: "B",
    });
    expect(body.requests[0]).not.toHaveProperty("discordUserId");
  });

  it("approves a registration request with the authenticated administrator", async () => {
    const requestId = "MR-11111111-1111-4111-8111-111111111111";
    const registrationDecider = vi.fn().mockResolvedValue({
      requestId,
      decision: "approved",
      memberId: "M-11111111-1111-4111-8111-111111111111",
    });
    const response = await handleAdminRequest(
      new Request(`https://admin.example.com/api/member-requests/${requestId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://admin.example.com",
        },
        body: JSON.stringify({ decision: "approved" }),
      }),
      env,
      authenticatedContext(),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      registrationDecider,
    );

    expect(response.status).toBe(200);
    expect(registrationDecider).toHaveBeenCalledWith(
      env,
      requestId,
      "approved",
      "admin@example.com",
    );
  });

  it("returns the pending registration count for the tab badge", async () => {
    const registrationCounter = vi.fn().mockResolvedValue(3);
    const response = await handleAdminRequest(
      new Request("https://admin.example.com/api/member-requests/count"),
      env,
      authenticatedContext(),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      registrationCounter,
    );

    expect(response.status).toBe(200);
    expect(registrationCounter).toHaveBeenCalledWith(env);
    await expect(response.json()).resolves.toEqual({ count: 3 });
  });

  it("includes the pending-request badge in the member tab", async () => {
    const response = await handleAdminRequest(
      new Request("https://admin.example.com/tournaments"),
      env,
      authenticatedContext(),
    );

    const html = await response.text();
    expect(html).toContain('id="pending-request-badge"');
    expect(html).toContain('class="request-badge"');
    expect(html).toContain("/api/member-requests/count");
    expect(html).toContain("よみがな");
    expect(html).toContain("displayNameKana: nameKanaInput.value");
  });
});
