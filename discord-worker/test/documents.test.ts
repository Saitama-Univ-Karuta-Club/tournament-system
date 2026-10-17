import { describe, expect, it, vi } from "vitest";
import {
  buildPdfFilename,
  serveTournamentDocument,
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
});
