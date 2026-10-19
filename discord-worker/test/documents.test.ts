import { describe, expect, it, vi } from "vitest";
import {
  buildApplicationRosterFilename,
  buildArchivePdfFilename,
  buildConfirmationRosterFilename,
  buildGuidanceFilename,
  buildOrganizerPaymentFilename,
  buildPdfFilename,
  serveTournamentDocument,
  storeParticipantGuidanceDocument,
  uploadApplicationRoster,
  uploadTournamentDocument,
} from "../src/documents";

describe("tournament PDF documents", () => {
  it("renames a PDF with all event months, title, and grades", () => {
    expect(
      buildPdfFilename(
        "第1回/埼玉大会",
        ["B", "C"],
        ["2026-11-01", "2026-12-02"],
      ),
    ).toBe("2026年11月・2026年12月_第1回_埼玉大会_B級・C級.pdf");
  });

  it("adds the archive document type to roster and result filenames", () => {
    expect(buildArchivePdfFilename(
      "埼玉大会",
      ["C"],
      ["2026-11-01"],
      "roster",
    )).toBe("2026年11月_埼玉大会_C級_選手名簿.pdf");
    expect(buildArchivePdfFilename(
      "埼玉大会",
      ["C"],
      ["2026-11-01"],
      "results",
    )).toBe("2026年11月_埼玉大会_C級_大会結果.pdf");
  });

  it("builds a participant-guidance filename for PDF or Word", () => {
    expect(buildGuidanceFilename(
      "埼玉大会",
      ["C"],
      ["2026-11-01"],
      "docx",
    )).toBe("2026年11月_埼玉大会_C級_参加者向け案内.docx");
  });

  it("builds a manager-only organizer-payment filename", () => {
    expect(buildOrganizerPaymentFilename(
      "埼玉大会",
      ["C"],
      ["2026-11-01"],
      "pdf",
    )).toBe("2026年11月_埼玉大会_C級_主催者振込情報.pdf");
  });

  it("builds a confirmation-roster filename for PDF, Word, or Excel", () => {
    expect(buildConfirmationRosterFilename(
      "埼玉大会",
      ["B", "C"],
      ["2026-11-01"],
      "pdf",
    )).toBe("2026年11月_埼玉大会_B級・C級_申込確認名簿.pdf");
    expect(buildConfirmationRosterFilename(
      "埼玉大会",
      ["B", "C"],
      ["2026-11-01"],
      "xlsx",
    )).toBe("2026年11月_埼玉大会_B級・C級_申込確認名簿.xlsx");
  });

  it("builds the standard application-roster filename and preserves a specified name", () => {
    expect(buildApplicationRosterFilename(
      "埼玉大会",
      ["B", "C"],
      "xlsx",
    )).toBe("埼玉大会_B級・C級_申込名簿_埼玉大学かるた会.xlsx");
    expect(buildApplicationRosterFilename(
      "埼玉大会",
      ["C"],
      "xlsx",
      "主催者指定名",
    )).toBe("主催者指定名.xlsx");
  });

  it("uploads an Excel application roster using a custom filename", async () => {
    const put = vi.fn().mockResolvedValue(undefined);
    const convertR2DocumentToPdf = vi.fn();
    const form = new FormData();
    form.append("file", new File(
      [new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0])],
      "source.xlsx",
      { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
    ));
    form.append("title", "埼玉大会");
    form.append("grades", JSON.stringify(["C"]));
    form.append("customFileName", "指定申込書.xlsx");

    const result = await uploadApplicationRoster(
      new Request("https://admin.example.com/api/application-roster", { method: "POST", body: form }),
      {
        DOCUMENTS: { put } as unknown as R2Bucket,
        DOCUMENT_PUBLIC_BASE_URL: "https://bot.example.com",
        DB: { prepare: vi.fn() } as unknown as D1Database,
        DOCUMENT_CONVERTER: { convertR2DocumentToPdf },
      },
      "admin@example.com",
    );

    expect(result.fileName).toBe("指定申込書.xlsx");
    expect(result.contentType).toContain("spreadsheetml");
    expect(String(put.mock.calls[0][0])).toContain("指定申込書.xlsx");
    expect(convertR2DocumentToPdf).not.toHaveBeenCalled();
  });

  it("stores a valid PDF in a private R2 bucket and returns its Worker URL", async () => {
    const put = vi.fn().mockResolvedValue(undefined);
    const form = new FormData();
    form.append("file", new File(["%PDF-1.7\nbody"], "original.pdf", { type: "application/pdf" }));
    form.append("title", "埼玉大会");
    form.append("grades", JSON.stringify(["B", "C"]));
    form.append("eventDates", JSON.stringify(["2026-11-01", "2026-11-08"]));

    const result = await uploadTournamentDocument(
      new Request("https://admin.example.com/api/documents", { method: "POST", body: form }),
      {
        DOCUMENTS: { put } as unknown as R2Bucket,
        DOCUMENT_PUBLIC_BASE_URL: "https://bot.example.com",
      },
      "admin@example.com",
    );

    expect(put).toHaveBeenCalledOnce();
    expect(String(put.mock.calls[0][0])).toMatch(/^documents\/[0-9a-f-]{36}\//);
    expect(String(put.mock.calls[0][0])).toContain("2026年11月_埼玉大会_B級・C級.pdf");
    expect(result.url).toContain("https://bot.example.com/documents/");
  });

  it("serves an uploaded PDF without exposing bucket listing", async () => {
    const body = new Blob(["%PDF-1.7\nbody"]);
    const get = vi.fn().mockResolvedValue({
      body,
      httpEtag: '"etag"',
      httpMetadata: { contentType: "application/pdf" },
    });
    const response = await serveTournamentDocument(
      new Request("https://bot.example.com/documents/11111111-1111-4111-8111-111111111111/test.pdf"),
      { get } as unknown as R2Bucket,
    );

    expect(response?.status).toBe(200);
    expect(response?.headers.get("Content-Type")).toBe("application/pdf");
    expect(response?.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("serves an uploaded Excel roster as an attachment", async () => {
    const body = new Blob([new Uint8Array([0x50, 0x4b, 0x03, 0x04])]);
    const get = vi.fn().mockResolvedValue({
      body,
      httpEtag: '"excel-etag"',
      httpMetadata: {
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        contentDisposition: "attachment; filename=roster.xlsx",
      },
    });
    const response = await serveTournamentDocument(
      new Request("https://bot.example.com/documents/11111111-1111-4111-8111-111111111111/roster.xlsx"),
      { get } as unknown as R2Bucket,
    );

    expect(response?.status).toBe(200);
    expect(response?.headers.get("Content-Type")).toContain("spreadsheetml");
    expect(response?.headers.get("Content-Disposition")).toContain("attachment");
    expect((await response?.arrayBuffer())?.byteLength).toBe(4);
  });

  it("answers HEAD requests for stored documents without a response body", async () => {
    const get = vi.fn().mockResolvedValue({
      body: new Blob(["%PDF-1.7"]),
      httpEtag: '"pdf-etag"',
      httpMetadata: { contentType: "application/pdf" },
    });
    const response = await serveTournamentDocument(
      new Request("https://bot.example.com/documents/11111111-1111-4111-8111-111111111111/guide.pdf", { method: "HEAD" }),
      { get } as unknown as R2Bucket,
    );

    expect(response?.status).toBe(200);
    expect(await response?.text()).toBe("");
  });

  it("rejects content that only has a PDF filename", async () => {
    const form = new FormData();
    form.append("file", new File(["not a pdf"], "fake.pdf", { type: "application/pdf" }));
    form.append("title", "埼玉大会");
    form.append("grades", JSON.stringify(["C"]));
    form.append("eventDates", JSON.stringify(["2026-11-01"]));

    await expect(
      uploadTournamentDocument(
        new Request("https://admin.example.com/api/documents", { method: "POST", body: form }),
        {
          DOCUMENTS: { put: vi.fn() } as unknown as R2Bucket,
          DOCUMENT_PUBLIC_BASE_URL: "https://bot.example.com",
        },
        "admin@example.com",
      ),
    ).rejects.toThrow("PDF形式");
  });

  it("stores a Word participant-guidance file with download metadata", async () => {
    const put = vi.fn().mockResolvedValue(undefined);
    const file = new File(
      [new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0])],
      "guide.docx",
      { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
    );
    const result = await storeParticipantGuidanceDocument(
      file,
      {
        DOCUMENTS: { put } as unknown as R2Bucket,
        DOCUMENT_PUBLIC_BASE_URL: "https://bot.example.com",
      },
      "admin@example.com",
      "2026年11月_埼玉大会_C級_参加者向け案内.docx",
    );

    expect(result.contentType).toContain("wordprocessingml");
    expect(result.url).toContain(".docx");
    expect(put.mock.calls[0][2].httpMetadata.contentDisposition).toContain("attachment");
  });

  it("keeps a Word original and exposes its generated PDF through a stable URL", async () => {
    const put = vi.fn().mockResolvedValue(undefined);
    const run = vi.fn().mockResolvedValue({ success: true });
    const prepare = vi.fn().mockImplementation(() => ({
      bind: vi.fn().mockReturnValue({ run }),
    }));
    const convertR2DocumentToPdf = vi.fn().mockResolvedValue({
      targetKey: "documents/id/preview/guide.pdf",
      size: 1234,
    });
    const result = await storeParticipantGuidanceDocument(
      new File(
        [new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0])],
        "guide.docx",
      ),
      {
        DOCUMENTS: { put } as unknown as R2Bucket,
        DOCUMENT_PUBLIC_BASE_URL: "https://bot.example.com",
        DB: { prepare } as unknown as D1Database,
        DOCUMENT_CONVERTER: { convertR2DocumentToPdf },
      },
      "admin@example.com",
      "2026年11月_埼玉大会_C級_参加者向け案内.docx",
    );

    expect(result.url).toMatch(/^https:\/\/bot\.example\.com\/document-files\/[0-9a-f-]{36}$/);
    expect(result.sourceUrl).toBe(`${result.url}/source`);
    expect(result.fileName).toMatch(/\.pdf$/);
    expect(result.sourceFileName).toMatch(/\.docx$/);
    expect(result.conversionStatus).toBe("ready");
    expect(convertR2DocumentToPdf).toHaveBeenCalledWith(expect.objectContaining({
      sourceContentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      targetFileName: expect.stringMatching(/\.pdf$/),
    }));
    expect(prepare).toHaveBeenCalledTimes(2);
  });

  it("serves a generated PDF and its Word original from stable document URLs", async () => {
    const row = {
      source_key: "documents/id/source/guide.docx",
      source_file_name: "guide.docx",
      source_content_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      preferred_key: "documents/id/preview/guide.pdf",
      preferred_file_name: "guide.pdf",
      preferred_content_type: "application/pdf",
    };
    const first = vi.fn().mockResolvedValue(row);
    const db = {
      prepare: vi.fn().mockReturnValue({ bind: vi.fn().mockReturnValue({ first }) }),
    } as unknown as D1Database;
    const get = vi.fn().mockImplementation((key: string) => Promise.resolve({
      body: new Blob([key.endsWith(".pdf") ? "%PDF-preview" : "word"]),
      httpEtag: '"etag"',
      httpMetadata: key.endsWith(".pdf")
        ? { contentType: "application/pdf" }
        : { contentType: row.source_content_type },
    }));
    const bucket = { get } as unknown as R2Bucket;
    const id = "11111111-1111-4111-8111-111111111111";

    const preview = await serveTournamentDocument(
      new Request(`https://bot.example.com/document-files/${id}`),
      bucket,
      db,
    );
    expect(preview?.headers.get("Content-Type")).toBe("application/pdf");
    expect(get).toHaveBeenLastCalledWith(row.preferred_key);

    const source = await serveTournamentDocument(
      new Request(`https://bot.example.com/document-files/${id}/source`),
      bucket,
      db,
    );
    expect(source?.headers.get("Content-Type")).toContain("wordprocessingml");
    expect(get).toHaveBeenLastCalledWith(row.source_key);
  });

  it("stores an Excel confirmation-roster file with the spreadsheet MIME type", async () => {
    const put = vi.fn().mockResolvedValue(undefined);
    const file = new File(
      [new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0])],
      "roster.xlsx",
      { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
    );
    const result = await storeParticipantGuidanceDocument(
      file,
      {
        DOCUMENTS: { put } as unknown as R2Bucket,
        DOCUMENT_PUBLIC_BASE_URL: "https://bot.example.com",
      },
      "admin@example.com",
      "2026年11月_埼玉大会_C級_申込確認名簿.xlsx",
    );

    expect(result.contentType).toContain("spreadsheetml");
    expect(result.url).toContain(".xlsx");
    expect(put.mock.calls[0][2].httpMetadata.contentDisposition).toContain("attachment");
  });

  it("keeps an Excel roster original and exposes a generated searchable PDF", async () => {
    const put = vi.fn().mockResolvedValue(undefined);
    const run = vi.fn().mockResolvedValue({ success: true });
    const prepare = vi.fn().mockImplementation(() => ({
      bind: vi.fn().mockReturnValue({ run }),
    }));
    const convertR2DocumentToPdf = vi.fn().mockResolvedValue({
      targetKey: "documents/id/preview/roster.pdf",
      size: 4321,
    });
    const result = await storeParticipantGuidanceDocument(
      new File(
        [new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0])],
        "roster.xlsx",
      ),
      {
        DOCUMENTS: { put } as unknown as R2Bucket,
        DOCUMENT_PUBLIC_BASE_URL: "https://bot.example.com",
        DB: { prepare } as unknown as D1Database,
        DOCUMENT_CONVERTER: { convertR2DocumentToPdf },
      },
      "admin@example.com",
      "2026年11月_埼玉大会_C級_確定名簿.xlsx",
    );

    expect(result.fileName).toBe("2026年11月_埼玉大会_C級_確定名簿.pdf");
    expect(result.sourceFileName).toBe("2026年11月_埼玉大会_C級_確定名簿.xlsx");
    expect(result.contentType).toBe("application/pdf");
    expect(result.conversionStatus).toBe("ready");
    expect(convertR2DocumentToPdf).toHaveBeenCalledWith(expect.objectContaining({
      sourceContentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      sourceFileName: expect.stringMatching(/\.xlsx$/),
      targetFileName: expect.stringMatching(/\.pdf$/),
    }));
  });
});
