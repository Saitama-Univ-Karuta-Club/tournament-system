import { describe, expect, it, vi } from "vitest";
import {
  BackupConfigurationError,
  assertBackupConfiguration,
  backupDocumentPage,
  databaseBackupFilename,
  getGoogleAccessToken,
  handleBackupRequest,
  pollD1Export,
  startD1Export,
  type BackupEnv,
} from "../src/backup";

function configuredEnv(overrides: Partial<BackupEnv> = {}): BackupEnv {
  return {
    DB: {} as D1Database,
    DOCUMENTS: {} as R2Bucket,
    BACKUP_WORKFLOW: {} as Workflow<{ source: "scheduled" | "manual" }>,
    DOCUMENT_BACKUP_WORKFLOW: {} as BackupEnv["DOCUMENT_BACKUP_WORKFLOW"],
    ACCOUNT_ID: "account-id",
    DATABASE_ID: "database-id",
    CLOUDFLARE_D1_API_TOKEN: "cloudflare-token",
    GOOGLE_CLIENT_ID: "google-client-id",
    GOOGLE_CLIENT_SECRET: "google-client-secret",
    GOOGLE_REFRESH_TOKEN: "google-refresh-token",
    BACKUP_TRIGGER_SECRET: "manual-trigger-secret",
    ...overrides,
  };
}

describe("Google Drive backup Worker", () => {
  it("detects missing secrets without exposing values", () => {
    const env = configuredEnv({ GOOGLE_REFRESH_TOKEN: undefined });

    expect(() => assertBackupConfiguration(env)).toThrow(BackupConfigurationError);
    expect(() => assertBackupConfiguration(env)).toThrow("GOOGLE_REFRESH_TOKEN");
  });

  it("uses a readable JST timestamp in database backup filenames", () => {
    expect(databaseBackupFilename(new Date("2026-10-19T18:00:00.000Z"))).toBe(
      "sukc-tournament-discord-db_2026-10-20_03-00-00.sql",
    );
  });

  it("refreshes a Google access token without placing credentials in the URL", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      Response.json({ access_token: "temporary-access-token" }),
    );

    await expect(getGoogleAccessToken(configuredEnv(), fetcher)).resolves.toBe(
      "temporary-access-token",
    );
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("https://oauth2.googleapis.com/token");
    expect(init.method).toBe("POST");
    expect(String(init.body)).toContain("refresh_token=google-refresh-token");
    expect(String(url)).not.toContain("google-refresh-token");
  });

  it("starts and polls a D1 export using the configured API token", async () => {
    const startFetcher = vi.fn().mockResolvedValue(
      Response.json({ success: true, result: { at_bookmark: "bookmark-1" } }),
    );
    await expect(startD1Export(configuredEnv(), startFetcher)).resolves.toEqual({
      bookmark: "bookmark-1",
    });
    expect(startFetcher.mock.calls[0][1].headers.Authorization).toBe(
      "Bearer cloudflare-token",
    );

    const pollFetcher = vi.fn().mockResolvedValue(
      Response.json({
        success: true,
        result: {
          status: "complete",
          success: true,
          result: {
            signed_url: "https://example.com/database.sql",
            filename: "database.sql",
          },
        },
      }),
    );
    await expect(
      pollD1Export(configuredEnv(), "bookmark-1", pollFetcher),
    ).resolves.toEqual({
      signedUrl: "https://example.com/database.sql",
      sourceFilename: "database.sql",
    });
    expect(JSON.parse(String(pollFetcher.mock.calls[0][1].body))).toEqual({
      output_format: "polling",
      current_bookmark: "bookmark-1",
    });
  });

  it("retries when the D1 export is not ready yet", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      Response.json({ success: true, result: { at_bookmark: "bookmark-1" } }),
    );

    await expect(
      pollD1Export(configuredEnv(), "bookmark-1", fetcher),
    ).rejects.toThrow("まだ準備中");
  });

  it("reports configuration and the latest run without revealing secrets", async () => {
    const first = vi.fn().mockResolvedValue({
      backup_run_id: "run-1",
      status: "succeeded",
      database_file_name: "backup.sql",
    });
    const env = configuredEnv({
      DB: {
        prepare: vi.fn().mockReturnValue({ first }),
      } as unknown as D1Database,
    });

    const response = await handleBackupRequest(
      new Request("https://backup.example/health"),
      env,
    );
    const payload = await response.json<Record<string, unknown>>();

    expect(response.status).toBe(200);
    expect(payload.configured).toBe(true);
    expect(JSON.stringify(payload)).not.toContain("google-refresh-token");
    expect(JSON.stringify(payload)).not.toContain("cloudflare-token");
  });

  it("protects manual backup execution with a bearer secret", async () => {
    const create = vi.fn().mockResolvedValue({ id: "manual-workflow-id" });
    const env = configuredEnv({
      BACKUP_WORKFLOW: { create } as unknown as Workflow<{
        source: "scheduled" | "manual";
      }>,
    });

    const rejected = await handleBackupRequest(
      new Request("https://backup.example/run", { method: "POST" }),
      env,
    );
    expect(rejected.status).toBe(401);
    expect(create).not.toHaveBeenCalled();

    const accepted = await handleBackupRequest(
      new Request("https://backup.example/run", {
        method: "POST",
        headers: { Authorization: "Bearer manual-trigger-secret" },
      }),
      env,
    );
    expect(accepted.status).toBe(202);
    await expect(accepted.json()).resolves.toMatchObject({
      ok: true,
      instanceId: "manual-workflow-id",
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ params: { source: "manual" } }),
    );
  });

  it("uploads an unrecorded R2 document and records its Drive file ID", async () => {
    const run = vi.fn().mockResolvedValue({ meta: { changes: 1 } });
    const first = vi.fn().mockResolvedValue(null);
    const bind = vi.fn().mockReturnValue({ first, run });
    const prepare = vi.fn().mockReturnValue({ bind });
    const get = vi.fn().mockResolvedValue({
      body: new Blob(["%PDF-1.7\nbody"]).stream(),
      size: 13,
      httpMetadata: { contentType: "application/pdf" },
    });
    const list = vi.fn().mockResolvedValue({
      objects: [
        {
          key: "documents/11111111-1111-4111-8111-111111111111/大会要項.pdf",
          etag: "etag-1",
          size: 13,
        },
      ],
      truncated: false,
    });
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "https://oauth2.googleapis.com/token") {
        return Response.json({ access_token: "temporary-access-token" });
      }
      if (url.startsWith("https://www.googleapis.com/drive/v3/files?")) {
        return Response.json({ files: [] });
      }
      if (url.startsWith("https://www.googleapis.com/upload/drive/v3/files?")) {
        return new Response(null, {
          status: 200,
          headers: { Location: "https://upload.example/session-1" },
        });
      }
      if (url === "https://upload.example/session-1") {
        return Response.json({ id: "drive-file-id", name: "大会要項.pdf" });
      }
      throw new Error(`Unexpected request: ${url}`);
    }) as unknown as typeof fetch;
    const env = configuredEnv({
      DB: { prepare } as unknown as D1Database,
      DOCUMENTS: { list, get } as unknown as R2Bucket,
    });

    await expect(
      backupDocumentPage(env, "documents-folder-id", undefined, fetcher),
    ).resolves.toEqual({ cursor: null, scanned: 1, uploaded: 1 });
    expect(list).toHaveBeenCalledWith({
      prefix: "documents/",
      limit: 5,
      cursor: undefined,
    });
    expect(get).toHaveBeenCalledWith(
      "documents/11111111-1111-4111-8111-111111111111/大会要項.pdf",
    );
    expect(run).toHaveBeenCalled();
  });

  it("skips recently verified unchanged documents without calling Google", async () => {
    const first = vi.fn().mockResolvedValue({
      r2_etag: "etag-1",
      google_drive_file_id: "drive-file-id",
      last_verified_at: new Date().toISOString(),
    });
    const run = vi.fn();
    const prepare = vi.fn().mockReturnValue({
      bind: vi.fn().mockReturnValue({ first, run }),
    });
    const list = vi.fn().mockResolvedValue({
      objects: [{ key: "documents/id/file.pdf", etag: "etag-1", size: 13 }],
      truncated: false,
    });
    const fetcher = vi.fn() as unknown as typeof fetch;
    const env = configuredEnv({
      DB: { prepare } as unknown as D1Database,
      DOCUMENTS: { list } as unknown as R2Bucket,
    });

    await expect(
      backupDocumentPage(env, "documents-folder-id", undefined, fetcher),
    ).resolves.toEqual({ cursor: null, scanned: 1, uploaded: 0 });
    expect(fetcher).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it("checks an unchanged Drive copy again after 30 days", async () => {
    const first = vi.fn().mockResolvedValue({
      r2_etag: "etag-1",
      google_drive_file_id: "drive-file-id",
      last_verified_at: "2026-01-01T00:00:00.000Z",
    });
    const run = vi.fn().mockResolvedValue({ meta: { changes: 1 } });
    const prepare = vi.fn().mockReturnValue({
      bind: vi.fn().mockReturnValue({ first, run }),
    });
    const list = vi.fn().mockResolvedValue({
      objects: [{ key: "documents/id/file.pdf", etag: "etag-1", size: 13 }],
      truncated: false,
    });
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "https://oauth2.googleapis.com/token") {
        return Response.json({ access_token: "temporary-access-token" });
      }
      if (url.includes("/files/drive-file-id?")) {
        return Response.json({
          id: "drive-file-id",
          trashed: false,
          parents: ["documents-folder-id"],
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    }) as unknown as typeof fetch;
    const env = configuredEnv({
      DB: { prepare } as unknown as D1Database,
      DOCUMENTS: { list } as unknown as R2Bucket,
    });

    await expect(
      backupDocumentPage(env, "documents-folder-id", undefined, fetcher),
    ).resolves.toEqual({ cursor: null, scanned: 1, uploaded: 0 });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenCalledOnce();
  });
});
