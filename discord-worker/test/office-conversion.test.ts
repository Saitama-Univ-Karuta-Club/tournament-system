import { describe, expect, it, vi } from "vitest";
import {
  convertStoredLegacyExcelToXlsx,
  convertStoredOfficeDocumentToPdf,
} from "../src/office-conversion";

describe("Office document PDF conversion", () => {
  it("imports a Word document, exports PDF, stores it, and removes the temporary Drive file", async () => {
    const get = vi.fn().mockResolvedValue({
      arrayBuffer: () => Promise.resolve(new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer),
    });
    const put = vi.fn().mockResolvedValue(undefined);
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ access_token: "access-token" }))
      .mockResolvedValueOnce(Response.json({ id: "temporary-drive-file" }))
      .mockResolvedValueOnce(new Response("%PDF-1.7\nconverted"))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const result = await convertStoredOfficeDocumentToPdf(
      {
        DOCUMENTS: { get, put } as unknown as R2Bucket,
        GOOGLE_CLIENT_ID: "client-id",
        GOOGLE_CLIENT_SECRET: "client-secret",
        GOOGLE_REFRESH_TOKEN: "refresh-token",
      },
      {
        sourceKey: "documents/id/source/guide.docx",
        targetKey: "documents/id/preview/guide.pdf",
        sourceContentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        sourceFileName: "guide.docx",
        targetFileName: "guide.pdf",
      },
      fetcher as unknown as typeof fetch,
    );

    expect(result).toEqual({
      targetKey: "documents/id/preview/guide.pdf",
      size: 18,
    });
    expect(put).toHaveBeenCalledWith(
      "documents/id/preview/guide.pdf",
      expect.any(ArrayBuffer),
      expect.objectContaining({
        httpMetadata: expect.objectContaining({ contentType: "application/pdf" }),
      }),
    );
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(fetcher.mock.calls[3][1]).toMatchObject({ method: "DELETE" });
  });

  it("removes the temporary Drive file when PDF export fails", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ access_token: "access-token" }))
      .mockResolvedValueOnce(Response.json({ id: "temporary-drive-file" }))
      .mockResolvedValueOnce(new Response("export failed", { status: 500 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(convertStoredOfficeDocumentToPdf(
      {
        DOCUMENTS: {
          get: vi.fn().mockResolvedValue({
            arrayBuffer: () => Promise.resolve(new Uint8Array([0x50, 0x4b]).buffer),
          }),
          put: vi.fn(),
        } as unknown as R2Bucket,
        GOOGLE_CLIENT_ID: "client-id",
        GOOGLE_CLIENT_SECRET: "client-secret",
        GOOGLE_REFRESH_TOKEN: "refresh-token",
      },
      {
        sourceKey: "source.docx",
        targetKey: "preview.pdf",
        sourceContentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        sourceFileName: "source.docx",
        targetFileName: "preview.pdf",
      },
      fetcher as unknown as typeof fetch,
    )).rejects.toThrow("PDF書き出しエラー");

    expect(fetcher.mock.calls[3][1]).toMatchObject({ method: "DELETE" });
  });

  it("imports Excel as Google Sheets before exporting a text-preserving PDF", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ access_token: "access-token" }))
      .mockResolvedValueOnce(Response.json({ id: "temporary-sheet" }))
      .mockResolvedValueOnce(new Response("%PDF-1.7\nsearchable roster"))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const put = vi.fn().mockResolvedValue(undefined);

    await convertStoredOfficeDocumentToPdf(
      {
        DOCUMENTS: {
          get: vi.fn().mockResolvedValue({
            arrayBuffer: () => Promise.resolve(new Uint8Array([0x50, 0x4b]).buffer),
          }),
          put,
        } as unknown as R2Bucket,
        GOOGLE_CLIENT_ID: "client-id",
        GOOGLE_CLIENT_SECRET: "client-secret",
        GOOGLE_REFRESH_TOKEN: "refresh-token",
      },
      {
        sourceKey: "roster.xlsx",
        targetKey: "roster.pdf",
        sourceContentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        sourceFileName: "roster.xlsx",
        targetFileName: "roster.pdf",
      },
      fetcher as unknown as typeof fetch,
    );

    const multipartBody = fetcher.mock.calls[1][1]?.body as Blob;
    expect(await multipartBody.text()).toContain("application/vnd.google-apps.spreadsheet");
    expect(put).toHaveBeenCalledWith(
      "roster.pdf",
      expect.any(ArrayBuffer),
      expect.objectContaining({ httpMetadata: expect.objectContaining({ contentType: "application/pdf" }) }),
    );
  });

  it("converts a legacy .xls roster to .xlsx for auto-fill", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ access_token: "access-token" }))
      .mockResolvedValueOnce(Response.json({ id: "temporary-sheet" }))
      .mockResolvedValueOnce(new Response(new Uint8Array([0x50, 0x4b, 0x03, 0x04])))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const put = vi.fn().mockResolvedValue(undefined);

    const result = await convertStoredLegacyExcelToXlsx(
      {
        DOCUMENTS: {
          get: vi.fn().mockResolvedValue({
            arrayBuffer: () => Promise.resolve(
              new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]).buffer,
            ),
          }),
          put,
        } as unknown as R2Bucket,
        GOOGLE_CLIENT_ID: "client-id",
        GOOGLE_CLIENT_SECRET: "client-secret",
        GOOGLE_REFRESH_TOKEN: "refresh-token",
      },
      {
        sourceKey: "roster.xls",
        targetKey: "temporary/roster.xlsx",
        sourceContentType: "application/vnd.ms-excel",
        sourceFileName: "roster.xls",
        targetFileName: "roster.xlsx",
      },
      fetcher as unknown as typeof fetch,
    );

    expect(result).toEqual({ targetKey: "temporary/roster.xlsx", size: 4 });
    expect(String(fetcher.mock.calls[2][0])).toContain(encodeURIComponent(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ));
    expect(put).toHaveBeenCalledWith(
      "temporary/roster.xlsx",
      expect.any(ArrayBuffer),
      expect.objectContaining({
        httpMetadata: expect.objectContaining({
          contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
      }),
    );
    expect(fetcher.mock.calls[3][1]).toMatchObject({ method: "DELETE" });
  });
});
