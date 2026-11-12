import { describe, expect, it, vi } from "vitest";
import {
  generateApplicationRoster,
  generateDueApplicationRosters,
} from "../src/application-roster-generation";
import { readExcelCell } from "../src/excel-auto-fill";
import { standardExcelTemplate } from "./excel-auto-fill-fixtures";

const tournamentId = "T-11111111-1111-4111-8111-111111111111";
const groupKey = "TG-22222222-2222-4222-8222-222222222222";
const sourceKey = "documents/33333333-3333-4333-8333-333333333333/roster.xlsx";

function statement(result: {
  first?: unknown;
  all?: unknown[];
  run?: unknown;
}) {
  const bound = {
    first: vi.fn().mockResolvedValue(result.first ?? null),
    all: vi.fn().mockResolvedValue({ results: result.all ?? [] }),
    run: vi.fn().mockResolvedValue(result.run ?? { meta: { changes: 1 } }),
  };
  return { bind: vi.fn(() => bound), ...bound };
}

describe("application roster generation workflow", () => {
  it("loads applicants, fills the workbook, stores it in R2, and updates the application link", async () => {
    const updateStatement = statement({ run: { meta: { changes: 1 } } });
    const prepare = vi.fn((sql: string) => {
      if (sql.includes("FROM tournaments") && sql.includes("roster_document_url")) {
        return statement({
          first: {
            tournament_id: tournamentId,
            group_key: groupKey,
            title: "テスト大会",
            created_at: "2026-10-01T00:00:00.000Z",
            application_method: "excel_email",
            roster_document_url: `https://bot.example.com/${sourceKey}`,
            roster_file_name: "テスト大会_C級_申込名簿_埼玉大学かるた会.xlsx",
            roster_content_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          },
        });
      }
      if (sql.includes("FROM responses")) {
        return statement({
          all: [{
            member_id: "M-1",
            grade: "C",
            rank: 2,
            last_name: "石田",
            first_name: "洋音",
            last_name_kana: "いしだ",
            first_name_kana: "ひろね",
            appearance_count: 3,
          }],
        });
      }
      if (sql.startsWith("UPDATE tournament_application_methods")) return updateStatement;
      throw new Error(`unexpected SQL: ${sql}`);
    });
    const template = standardExcelTemplate();
    const put = vi.fn().mockResolvedValue(undefined);
    const result = await generateApplicationRoster(
      {
        DB: { prepare } as unknown as D1Database,
        DOCUMENTS: {
          get: vi.fn().mockResolvedValue({
            size: template.byteLength,
            customMetadata: { originalName: "香川大会CDE級申込み.xlsx" },
            arrayBuffer: () => Promise.resolve(
              template.buffer.slice(template.byteOffset, template.byteOffset + template.byteLength),
            ),
          }),
          put,
        } as unknown as R2Bucket,
        DOCUMENT_PUBLIC_BASE_URL: "https://bot.example.com",
        EXCEL_CONTACT_PHONE: "090-0000-0000",
      },
      tournamentId,
      "admin@example.com",
      { now: new Date("2026-10-23T00:00:00.000Z") },
    );

    expect(result.generated).toBe(true);
    expect(result.layoutId).toBe("all_japan_standard_20");
    expect(result.participantCount).toBe(1);
    expect(result.url).toMatch(/^https:\/\/bot\.example\.com\/documents\/[0-9a-f-]{36}\//);
    expect(put).toHaveBeenCalledOnce();
    const generatedBytes = new Uint8Array(put.mock.calls[0][1] as ArrayBuffer);
    expect(readExcelCell(generatedBytes, "Sheet1", "F12")).toBe("石田");
    expect(readExcelCell(generatedBytes, "Sheet1", "G12")).toBe("洋音");
    expect(put.mock.calls[0][2]).toEqual(expect.objectContaining({
      customMetadata: expect.objectContaining({
        sourceTemplateKey: sourceKey,
        autoFillGenerated: "true",
        autoFillParticipants: "1",
      }),
    }));
    expect(updateStatement.bind).toHaveBeenCalledWith(
      result.url,
      result.fileName,
      result.size,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "2026-10-23T00:00:00.000Z",
      groupKey,
    );
  });

  it("skips all database work when document storage is not configured", async () => {
    const prepare = vi.fn();
    await expect(generateDueApplicationRosters(
      { DB: { prepare } as unknown as D1Database },
    )).resolves.toEqual({ generated: 0, skipped: 0, failed: 0 });
    expect(prepare).not.toHaveBeenCalled();
  });
});
