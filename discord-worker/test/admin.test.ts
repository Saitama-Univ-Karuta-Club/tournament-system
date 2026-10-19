import { describe, expect, it, vi } from "vitest";
import {
  buildAdminTodoItems,
  editTournaments,
  handleAdminRequest,
  listAdminTournaments,
  setTournamentArchivePublished,
  uploadTournamentArchiveDocument,
  updateTournamentEntriesBatch,
  updateTournamentEntryStatus,
  updateTournamentEntryResult,
  updateTournamentEntryResultsBatch,
  updateTournamentStatuses,
  type AdminEnv,
  type AdminTournament,
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
  it("serves syntactically valid management-page JavaScript", async () => {
    const response = await handleAdminRequest(
      new Request("https://admin.example.com/tournaments"),
      env,
      authenticatedContext(),
    );
    const html = await response.text();
    const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1];

    expect(script).toBeTruthy();
    expect(() => new Function(script ?? "")).not.toThrow();
  });

  it("renders an on-demand member appearance history dialog", async () => {
    const response = await handleAdminRequest(
      new Request("https://admin.example.com/members"),
      env,
      authenticatedContext(),
    );
    const html = await response.text();

    expect(html).toContain('id="member-history-dialog"');
    expect(html).toContain("['氏名', 'よみがな', '出場級', '段位', '出場歴', '状態', 'DM', '操作']");
    expect(html).toContain("function openMemberHistory(member)");
    expect(html).toContain("'/api/members/' + encodeURIComponent(member.memberId)");
    expect(html).toContain("history.fiscalYear + '年度：'");
    expect(html).toContain("['開催月', '大会名', '出場級', '戦績']");
  });

  it("redirects an unauthenticated browser to Discord login", async () => {
    const response = await handleAdminRequest(
      new Request("https://admin.example.com/"),
      env,
      { waitUntil: vi.fn() },
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      "/auth/discord?return_to=%2F",
    );
  });

  it("rejects unauthenticated API access without redirecting", async () => {
    const response = await handleAdminRequest(
      new Request("https://admin.example.com/api/tournaments"),
      env,
      { waitUntil: vi.fn() },
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Discordでの大会担当者ログインが必要です。",
    });
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
    ["todo", "TODO"],
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
    const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1];
    expect(script).toBeTruthy();
    expect(() => new Function(script!)).not.toThrow();
  });

  it("renders a simple TODO page with one-tap completion actions", async () => {
    const response = await handleAdminRequest(
      new Request("https://admin.example.com/todo"),
      env,
      authenticatedContext(),
    );

    const html = await response.text();
    expect(html).toContain('id="todo-list"');
    expect(html).toContain('id="todo-count-badge"');
    expect(html).toContain("todoCountBadge.hidden = normalized === 0");
    expect(html).toContain("setTodoCountBadge(body.todos.length)");
    expect(html).toContain("申込完了にする");
    expect(html).toContain("振込完了にする");
    expect(html).toContain("結果を入力する");
    expect(html).toContain("participant.grade");
    expect(html).toContain("申込メールを作成");
    expect(html).toContain("申込フォームを開く");
    expect(html).toContain("合計 '");
    expect(html).toContain("振込情報を確認");
    expect(html).toContain("/api/todos");
    expect(html).toContain("section=results");
    expect(html).toContain("section=guidance");
  });

  it("builds grouped deadline TODOs and keeps urgent unfinished work visible", () => {
    const memberResponse = (entryStatus: string | null = null) => ({
      member_id: "M-11111111-1111-4111-8111-111111111111",
      response: "yes",
      entry_status: entryStatus,
    });
    const tournament = (overrides: Record<string, unknown>): AdminTournament => ({
      tournament_id: "T-11111111-1111-4111-8111-111111111111",
      registration_group_id: "G-default",
      title: "テスト大会",
      event_start_date: "2026-10-25",
      event_end_date: "2026-10-25",
      grade: "C",
      all_grades: 0,
      tournament_type: "official",
      internal_deadline: "2026-10-19T14:59:00.000Z",
      true_deadline: "2026-10-22T14:59:00.000Z",
      created_at: "2026-10-01T00:00:00.000Z",
      status: "active",
      closure_reason: null,
      archive_published_at: null,
      responses: [memberResponse()],
      participant_guidance: null,
      ...overrides,
    } as AdminTournament);
    const paymentGuidance = {
      payment_collection_method: "advance_manager",
      organizer_payment_status: "unpaid",
      payment_deadline: "2026-10-19T14:59:00.000Z",
      organizer_payment_deadline: "2026-10-21T14:59:00.000Z",
    };
    const tournaments = [
      tournament({ registration_group_id: "G-application" }),
      tournament({
        tournament_id: "T-22222222-2222-4222-8222-222222222222",
        registration_group_id: "G-urgent-application",
        title: "本日締切大会",
        true_deadline: "2026-10-20T14:59:00.000Z",
      }),
      tournament({
        tournament_id: "T-33333333-3333-4333-8333-333333333333",
        registration_group_id: "G-payment",
        title: "振込大会",
        status: "applied",
        responses: [memberResponse("selected")],
        participant_guidance: paymentGuidance,
      }),
      tournament({
        tournament_id: "T-44444444-4444-4444-8444-444444444444",
        registration_group_id: "G-urgent-payment",
        title: "振込超過大会",
        status: "applied",
        responses: [memberResponse("selected")],
        participant_guidance: {
          ...paymentGuidance,
          payment_deadline: "2026-10-18T14:59:00.000Z",
          organizer_payment_deadline: "2026-10-19T14:59:00.000Z",
        },
      }),
      tournament({
        tournament_id: "T-55555555-5555-4555-8555-555555555555",
        registration_group_id: "G-results",
        title: "結果待ち大会",
        event_start_date: "2026-10-19",
        event_end_date: "2026-10-19",
        status: "applied",
        responses: [memberResponse("selected")],
      }),
    ];

    const todos = buildAdminTodoItems(
      tournaments,
      new Date("2026-10-20T06:00:00.000Z"),
    );

    expect(todos).toHaveLength(5);
    expect(todos.find((item) => item.title === "本日締切大会")).toMatchObject({
      kind: "application",
      urgency: "urgent",
      timing: "today",
    });
    expect(todos.find((item) => item.title === "振込超過大会")).toMatchObject({
      kind: "payment",
      urgency: "urgent",
    });
    expect(todos.find((item) => item.title === "結果待ち大会")).toMatchObject({
      kind: "results",
      participantCount: 1,
    });
    expect(buildAdminTodoItems(
      tournaments,
      new Date("2026-10-19T14:59:59.999Z"),
    ).some((item) => item.kind === "results")).toBe(false);
    expect(buildAdminTodoItems(
      tournaments,
      new Date("2026-10-19T15:00:00.000Z"),
    ).some((item) => item.kind === "results")).toBe(true);
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

  it("shows read-only member summaries until an editor is opened", async () => {
    const response = await handleAdminRequest(
      new Request("https://admin.example.com/members"),
      env,
      authenticatedContext(),
    );

    const html = await response.text();
    expect(html).toContain("['氏名', 'よみがな', '出場級', '段位', '出場歴', '状態', 'DM', '操作']");
    expect(html).toContain("renderMemberTableHeader()");
    expect(html).toContain("member-summary-grid");
    expect(html).toContain("item.dataset.label = label");
    expect(html).toContain("summaryItem('DM', member.dmEnabled ? '送信する' : '送信しない')");
    expect(html).toContain("const edit = element('button', 'secondary', '編集')");
    expect(html).toContain("editor.hidden = true");
    expect(html).toContain("const cancel = element('button', 'secondary', 'キャンセル')");
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
    expect(html).toContain('<option value="default" selected>通常表示（中止・参加者なしを除く）</option>');
    expect(html).toContain("displayStatus !== 'canceled' && displayStatus !== 'no_participants'");
    expect(html).toContain("responseLabels[response] + '(' + people.length + '人)'");
    expect(html).toContain("yes: '参加希望'");
    expect(html).toContain("person.entry_status === 'selected'");
    expect(html).toContain("person.payment_status === 'paid' ? '支払済み' : '未納'");
    expect(html).toContain("item.status === 'applied' || item.status === 'closed'");
    expect(html).toContain("if (!applicationCompleted)");
    expect(html).toContain("groupTournaments(loadedTournaments)");
    expect(html).toContain("person.display_name_kana || 'よみがな未登録'");
    expect(html).not.toContain("回答者の内訳");
    expect(html).not.toContain('class="stats"');
  });

  it("shows tournament editing and grouped status controls", async () => {
    const response = await handleAdminRequest(
      new Request("https://admin.example.com/tournaments"),
      env,
      authenticatedContext(),
    );

    const html = await response.text();
    expect(html).toContain('id="edit-tournament-dialog"');
    expect(html).toContain("大会情報を編集");
    expect(html).toContain("ステータスを変更");
    expect(html).toContain("tournamentIds: tournaments.map");
    expect(html).toContain("開催級はこの画面では変更できません");
    expect(html).toContain("1. 申込確認名簿（抽選前・");
    expect(html).toContain("抽選なしで全員を受け入れる大会では、この項目を飛ばし");
    expect(html).toContain("2. 抽選結果・確定名簿・参加費・当日案内");
    expect(html).toContain("3. 大会結果");
    expect(html).toContain("結果を保存して公開");
    expect(html).toContain("/api/tournament-results/batch");
    expect(html).toContain("選手ごとの当落・入金状態");
    expect(html).toContain("確定名簿（PDF・Excel／Excelは検索可能なPDFへ自動変換）");
    expect(html).toContain("参加費・当日案内");
    expect(html).toContain("キャンセル待ち");
    expect(html).toContain("waitlistNumber");
    expect(html).toContain("送信時に全員分をまとめて保存");
    expect(html).toContain("/api/tournament-entries/batch");
    expect(html).toContain("document.createElement('details')");
    expect(html).toContain("entry-management-body");
    expect(html).toContain("archive-management-body");
    expect(html).toContain("抽選結果・確定名簿・当日案内を送信");
    expect(html).toContain("/api/lottery-results/send");
    expect(html).toContain("参加者なし終了");
    expect(html).toContain("applicationBlocked");
    expect(html).toContain("一度ほかのステータスへ変更してください");
    expect(html).not.toContain("function renderTournamentStatusControl");
    const entryManagementSource = html.slice(
      html.indexOf("function renderEntryManagement"),
      html.indexOf("function renderArchiveManagement"),
    );
    expect(entryManagementSource).not.toContain("成績を保存");
    expect(entryManagementSource).not.toContain("entry-save");
    expect(html).toContain("選手ごとの個人成績");
  });

  it("saves all entrant statuses and payments in one D1 batch", async () => {
    const tournamentId = "T-11111111-1111-4111-8111-111111111111";
    const selectedMemberId = "M-11111111-1111-4111-8111-111111111111";
    const waitlistedMemberId = "M-22222222-2222-4222-8222-222222222222";
    const statements: Array<{ sql: string; values: unknown[] }> = [];
    const prepare = vi.fn((sql: string) => ({
      bind: vi.fn((...values: unknown[]) => ({
        all: vi.fn().mockResolvedValue({
          results: [
            {
              tournament_id: tournamentId,
              member_id: selectedMemberId,
              entry_status: "submitted",
              waitlist_number: null,
              payment_status: null,
            },
            {
              tournament_id: tournamentId,
              member_id: waitlistedMemberId,
              entry_status: "submitted",
              waitlist_number: null,
              payment_status: null,
            },
          ],
        }),
        sql,
        values,
      })),
    }));
    const batch = vi.fn(async (items: Array<{ sql: string; values: unknown[] }>) => {
      statements.push(...items);
      return items.map(() => ({ success: true }));
    });

    const result = await updateTournamentEntriesBatch(
      { DB: { prepare, batch } as unknown as D1Database },
      [
        {
          tournamentId,
          memberId: selectedMemberId,
          status: "selected",
          waitlistNumber: null,
          paymentStatus: "unpaid",
        },
        {
          tournamentId,
          memberId: waitlistedMemberId,
          status: "not_selected",
          waitlistNumber: 1,
          paymentStatus: null,
        },
      ],
      "discord:admin",
    );

    expect(result).toEqual({ entryCount: 2, changedCount: 2 });
    expect(batch).toHaveBeenCalledTimes(1);
    expect(statements.filter((item) => item.sql.includes("INSERT INTO tournament_entries"))).toHaveLength(2);
    expect(statements.some((item) => item.sql.includes("INSERT INTO tournament_entry_payments"))).toBe(true);
  });

  it("rejects an invalid waitlist number before a bulk database write", async () => {
    const prepare = vi.fn();
    const batch = vi.fn();

    await expect(updateTournamentEntriesBatch(
      { DB: { prepare, batch } as unknown as D1Database },
      [{
        tournamentId: "T-11111111-1111-4111-8111-111111111111",
        memberId: "M-11111111-1111-4111-8111-111111111111",
        status: "not_selected",
        waitlistNumber: null,
        paymentStatus: null,
      }],
      "discord:admin",
    )).rejects.toMatchObject({
      message: expect.stringContaining("キャンセル待ち番号"),
      status: 400,
    });
    expect(prepare).not.toHaveBeenCalled();
    expect(batch).not.toHaveBeenCalled();
  });

  it.each([
    { documentType: "roster", fileLabel: "選手名簿" },
    { documentType: "results", fileLabel: "大会結果" },
  ])("stores an Excel file as $documentType", async ({ documentType, fileLabel }) => {
    const tournamentId = "T-11111111-1111-4111-8111-111111111111";
    const put = vi.fn().mockResolvedValue(undefined);
    const run = vi.fn().mockResolvedValue({ success: true });
    const prepare = vi.fn((sql: string) => ({
      bind: vi.fn(() => ({
        all: vi.fn().mockResolvedValue({
          results: [{
            tournament_id: tournamentId,
            registration_group_id: null,
            title: "埼玉大会",
            event_start_date: "2026-11-01",
            event_end_date: "2026-11-01",
            grade: "C",
            all_grades: 0,
            tournament_type: "official",
            venue: null,
            true_deadline: "2026-10-28T14:59:00.000Z",
            internal_deadline: "2026-10-25T14:59:00.000Z",
            document_url: null,
            status: "applied",
            closure_reason: null,
          }],
        }),
        run,
      })),
      sql,
    }));
    const form = new FormData();
    form.append("file", new File(
      [new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0])],
      "confirmed.xlsx",
      { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
    ));
    form.append("documentType", documentType);
    form.append("tournamentIds", JSON.stringify([tournamentId]));

    const result = await uploadTournamentArchiveDocument(
      {
        DB: { prepare } as unknown as D1Database,
        DOCUMENTS: { put } as unknown as R2Bucket,
        DOCUMENT_PUBLIC_BASE_URL: "https://bot.example.com",
        DOCUMENT_CONVERTER: {
          convertR2DocumentToPdf: vi.fn().mockResolvedValue({
            targetKey: "documents/id/preview/converted.pdf",
            size: 1234,
          }),
        },
      },
      new Request("https://admin.example.com/api/archive-documents", { method: "POST", body: form }),
      "admin@example.com",
    );

    expect(result.file_name).toBe(`2026年11月_埼玉大会_C級_${fileLabel}.pdf`);
    expect(result.conversion_status).toBe("ready");
    expect(result.source_file_name).toBe(`2026年11月_埼玉大会_C級_${fileLabel}.xlsx`);
    expect(put).toHaveBeenCalledOnce();
    expect(put.mock.calls[0][2].httpMetadata.contentType).toContain("spreadsheetml");
    expect(run).toHaveBeenCalledTimes(3);
  });

  it.each([
    { status: "canceled", closureReason: null },
    { status: "closed", closureReason: "no_participants" },
  ])("prevents application completion for $status tournaments", async ({ status, closureReason }) => {
    const tournament = {
      tournament_id: "T-11111111-1111-4111-8111-111111111111",
      registration_group_id: null,
      title: "申込不可大会",
      event_start_date: "2026-11-01",
      event_end_date: "2026-11-01",
      grade: "C",
      all_grades: 0,
      tournament_type: "official",
      venue: null,
      true_deadline: "2026-10-28T14:59:00.000Z",
      internal_deadline: "2026-10-25T14:59:00.000Z",
      document_url: null,
      status,
      closure_reason: closureReason,
    };
    const all = vi.fn().mockResolvedValue({ results: [tournament] });
    const batch = vi.fn();
    const prepare = vi.fn().mockReturnValue({
      bind: vi.fn().mockReturnValue({ all }),
    });

    await expect(updateTournamentStatuses(
      { DB: { prepare, batch } as unknown as D1Database },
      [tournament.tournament_id],
      "applied",
      "admin@example.com",
    )).rejects.toMatchObject({
      message: expect.stringContaining("申込完了にできません"),
      status: 409,
    });
    expect(batch).not.toHaveBeenCalled();
  });

  it("stores a lottery result separately from the participation response", async () => {
    const statements: Array<{ sql: string; values: unknown[] }> = [];
    const prepare = vi.fn((sql: string) => ({
      bind: vi.fn((...values: unknown[]) => ({
        first: vi.fn().mockResolvedValue({
          entry_status: "submitted",
          waitlist_number: null,
        }),
        sql,
        values,
      })),
    }));
    const batch = vi.fn(async (items: Array<{ sql: string; values: unknown[] }>) => {
      statements.push(...items);
      return items.map(() => ({ success: true }));
    });

    const result = await updateTournamentEntryStatus(
      { DB: { prepare, batch } as unknown as D1Database },
      "T-11111111-1111-4111-8111-111111111111",
      "M-11111111-1111-4111-8111-111111111111",
      "not_selected",
      45,
      "discord:admin",
    );

    expect(result).toMatchObject({
      previousStatus: "submitted",
      previousWaitlistNumber: null,
      status: "not_selected",
      waitlistNumber: 45,
      changed: true,
    });
    expect(statements.some((item) => item.sql.includes("INSERT INTO tournament_entries"))).toBe(true);
    expect(statements.some((item) => item.sql.includes("INSERT INTO tournament_entry_history"))).toBe(true);
    expect(statements.every((item) => !item.sql.includes("UPDATE responses"))).toBe(true);
  });

  it("requires a positive waitlist number for a waitlisted entrant", async () => {
    const prepare = vi.fn();
    await expect(updateTournamentEntryStatus(
      { DB: { prepare } as unknown as D1Database },
      "T-11111111-1111-4111-8111-111111111111",
      "M-11111111-1111-4111-8111-111111111111",
      "not_selected",
      null,
      "discord:admin",
    )).rejects.toMatchObject({
      message: expect.stringContaining("キャンセル待ち番号"),
      status: 400,
    });
    expect(prepare).not.toHaveBeenCalled();
  });

  it("stores an entrant result without changing the participation response", async () => {
    const statements: Array<{ sql: string; values: unknown[] }> = [];
    const prepare = vi.fn((sql: string) => ({
      bind: vi.fn((...values: unknown[]) => ({
        first: vi.fn().mockResolvedValue({ result_text: null }),
        sql,
        values,
      })),
    }));
    const batch = vi.fn(async (items: Array<{ sql: string; values: unknown[] }>) => {
      statements.push(...items);
      return items.map(() => ({ success: true }));
    });

    const result = await updateTournamentEntryResult(
      { DB: { prepare, batch } as unknown as D1Database },
      "T-11111111-1111-4111-8111-111111111111",
      "M-11111111-1111-4111-8111-111111111111",
      " 3回戦敗退 ",
      "discord:admin",
    );

    expect(result).toMatchObject({ resultText: "3回戦敗退", changed: true });
    expect(statements.some((item) => item.sql.includes("UPDATE tournament_entries"))).toBe(true);
    expect(statements.some((item) => item.sql.includes("tournament_entry_result_history"))).toBe(true);
    expect(statements.every((item) => !item.sql.includes("UPDATE responses"))).toBe(true);
  });

  it("rejects an entrant result outside the selectable options", async () => {
    const prepare = vi.fn();
    await expect(updateTournamentEntryResult(
      { DB: { prepare } as unknown as D1Database },
      "T-11111111-1111-4111-8111-111111111111",
      "M-11111111-1111-4111-8111-111111111111",
      "ベスト8",
      "discord:admin",
    )).rejects.toMatchObject({
      message: expect.stringContaining("選択肢"),
      status: 400,
    });
    expect(prepare).not.toHaveBeenCalled();
  });

  it("saves all entrant results through one batch operation", async () => {
    const prepare = vi.fn((sql: string) => ({
      bind: vi.fn(() => ({
        first: vi.fn().mockResolvedValue({ result_text: null }),
        sql,
      })),
    }));
    const batch = vi.fn(async (items: unknown[]) => items.map(() => ({ success: true })));

    const result = await updateTournamentEntryResultsBatch(
      { DB: { prepare, batch } as unknown as D1Database },
      [
        {
          tournamentId: "T-11111111-1111-4111-8111-111111111111",
          memberId: "M-11111111-1111-4111-8111-111111111111",
          resultText: "3回戦敗退",
        },
        {
          tournamentId: "T-11111111-1111-4111-8111-111111111111",
          memberId: "M-22222222-2222-4222-8222-222222222222",
          resultText: "準優勝",
        },
      ],
      "discord:admin",
    );

    expect(result).toEqual({ entryCount: 2, changedCount: 2 });
    expect(batch).toHaveBeenCalledTimes(2);
  });

  it("publishes a complete tournament archive", async () => {
    const updates: Array<{ sql: string; values: unknown[] }> = [];
    const tournament = {
      tournament_id: "T-11111111-1111-4111-8111-111111111111",
      registration_group_id: null,
      title: "記録テスト大会",
      event_start_date: "2026-11-01",
      event_end_date: "2026-11-01",
      grade: "C",
      all_grades: 0,
      tournament_type: "official",
      venue: null,
      true_deadline: "2026-10-28T14:59:00.000Z",
      internal_deadline: "2026-10-25T14:59:00.000Z",
      document_url: "https://example.com/guide.pdf",
      status: "applied",
    };
    const prepare = vi.fn((sql: string) => ({
      bind: vi.fn((...values: unknown[]) => ({
        all: vi.fn().mockResolvedValue({
          results: sql.includes("tournament_archive_documents")
            ? [{ document_type: "roster" }, { document_type: "results" }]
            : [tournament],
        }),
        first: vi.fn().mockResolvedValue({ participant_count: 1, missing_results: 0 }),
        sql,
        values,
      })),
    }));
    const batch = vi.fn(async (items: Array<{ sql: string; values: unknown[] }>) => {
      updates.push(...items);
      return items.map(() => ({ success: true }));
    });

    const result = await setTournamentArchivePublished(
      { DB: { prepare, batch } as unknown as D1Database },
      [tournament.tournament_id],
      true,
      "discord:admin",
    );

    expect(result.published).toBe(true);
    expect(result.publishedAt).toBeTruthy();
    expect(updates).toHaveLength(2);
    expect(updates.some((item) => item.sql.includes("archive_display_name"))).toBe(true);
    expect(updates.some((item) => item.sql.includes("archive_published_at"))).toBe(true);
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
    expect(formHtml).not.toContain('name="venue"');
    expect(formHtml).not.toContain('name="documentUrl"');
  });

  it("keeps date and deadline inputs within the mobile viewport", async () => {
    const response = await handleAdminRequest(
      new Request("https://admin.example.com/register"),
      env,
      authenticatedContext(),
    );

    const html = await response.text();
    expect(html).toContain(
      '.grade-date-grid > label { width: 100%; min-width: 0; }',
    );
    expect(html).toContain(
      'input, select, textarea { width: 100%; min-width: 0; max-width: 100%;',
    );
    expect(html).toContain('inline-size: 100%;');
    expect(html).toContain('min-inline-size: 0;');
    expect(html).toContain('-webkit-appearance: none;');
    expect(html).toContain(
      'input[type="datetime-local"]::-webkit-datetime-edit',
    );
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

  it("offers direct PDF or Word upload for registration and editing", async () => {
    const response = await handleAdminRequest(
      new Request("https://admin.example.com/register"),
      env,
      authenticatedContext(),
    );

    const html = await response.text();
    expect(html.match(/type="file" name="documentFile"/g)).toHaveLength(2);
    expect(html).toContain("大会要項（PDF・Word）");
    expect(html).toContain("Wordは原本を保存し、ブラウザ閲覧用PDFを自動生成します");
    expect(html).toContain("fetch('/api/documents'");
  });

  it("supports drag and drop while preserving native file selection", async () => {
    const response = await handleAdminRequest(
      new Request("https://admin.example.com/register"),
      env,
      authenticatedContext(),
    );

    const html = await response.text();
    expect(html).toContain("element('div', 'file-drop-zone')");
    expect(html).toContain('メールの添付ファイルをここにドロップ');
    expect(html).toContain("zone.addEventListener('drop'");
    expect(html).toContain('const transfer = new DataTransfer()');
    expect(html).toContain("root.querySelectorAll?.('input[type=\"file\"]')");
    expect(html).toContain('new MutationObserver');
    expect(html).toContain('input.type !== \'file\'');
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

  it("switches registration instructions for all three application methods", async () => {
    const response = await handleAdminRequest(
      new Request("https://admin.example.com/register"),
      env,
      authenticatedContext(),
    );

    const html = await response.text();
    expect(html).toContain('value="excel_email"');
    expect(html).toContain('value="excel_form"');
    expect(html).toContain('value="direct_form"');
    expect(html).toContain('name="applicationRosterFile"');
    expect(html).toContain('name="applicationFormUrl"');
    expect(html).toContain('name="applicationEmail"');
    expect(html).toContain("const usesEmail = method === 'excel_email'");
    expect(html).toContain('name="applicationRosterFilenameMode"');
    expect(html).toContain('name="applicationRosterCustomFileName"');
    expect(html).toContain("fetch('/api/application-roster'");
    expect(html).toContain("refreshApplicationMethodFields()");
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
          applicationMethod: "direct_form",
          applicationFormUrl: "https://example.com/apply",
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
          applicationMethod: "direct_form",
          applicationFormUrl: "https://example.com/apply",
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
        lastName: "石田",
        firstName: "洋音",
        lastNameKana: "いしだ",
        firstNameKana: "ひろね",
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
      lastName: "石田",
      firstName: "洋音",
      lastNameKana: "いしだ",
      firstNameKana: "ひろね",
      displayName: "石田 洋音",
      displayNameKana: "いしだ ようおん",
      grade: "B",
      rank: 3,
      status: "active",
      dmEnabled: false,
      discordLinked: true,
    });
    const input = {
      lastName: "石田",
      firstName: "洋音",
      lastNameKana: "いしだ",
      firstNameKana: "ひろね",
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
    expect(html).toContain("lastName: lastNameInput.value");
    expect(html).toContain("firstName: firstNameInput.value");
    expect(html).toContain("lastNameKana: lastNameKanaInput.value");
    expect(html).toContain("firstNameKana: firstNameKanaInput.value");
  });
});
