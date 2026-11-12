import {
  WorkerEntrypoint,
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import {
  convertStoredLegacyExcelToXlsx,
  convertStoredOfficeDocumentToPdf,
  type OfficeConversionRequest,
  type OfficeConversionResult,
} from "./office-conversion";

const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_BASE = "https://www.googleapis.com/upload/drive/v3";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const D1_API_BASE = "https://api.cloudflare.com/client/v4";
const GOOGLE_DRIVE_FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
// Keep each Workflow step comfortably below the Workers Free subrequest limit.
// Bursts larger than this are handled by subsequent cursor pages in the same run.
const DOCUMENT_PAGE_SIZE = 5;
const DRIVE_VERIFICATION_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_RETENTION_DAYS = 365;

export interface BackupWorkflowParams {
  source: "scheduled" | "manual";
}

export interface DocumentBackupWorkflowParams {
  runId: string;
  databaseFolderId: string;
  documentsFolderId: string;
  databaseFileId: string;
  databaseFileName: string;
  startedAt: string;
  cursor?: string;
  pageNumber: number;
  documentsScanned: number;
  documentsUploaded: number;
}

export interface BackupEnv {
  DB: D1Database;
  DOCUMENTS: R2Bucket;
  BACKUP_WORKFLOW: Workflow<BackupWorkflowParams>;
  DOCUMENT_BACKUP_WORKFLOW: Workflow<DocumentBackupWorkflowParams>;
  ACCOUNT_ID: string;
  DATABASE_ID: string;
  DATABASE_BACKUP_RETENTION_DAYS?: string;
  CLOUDFLARE_D1_API_TOKEN?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REFRESH_TOKEN?: string;
  BACKUP_TRIGGER_SECRET?: string;
}

interface BackupRunRow {
  backup_run_id: string;
  trigger_source: string;
  status: string;
  database_file_name: string | null;
  documents_scanned: number;
  documents_uploaded: number;
  expired_database_backups_trashed: number;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
}

interface DriveFile {
  id: string;
  name?: string;
  createdTime?: string;
  trashed?: boolean;
  parents?: string[];
}

interface DriveFolders {
  rootId: string;
  databaseId: string;
  documentsId: string;
}

interface D1ExportJob {
  bookmark: string;
}

interface D1ExportReady {
  signedUrl: string;
  sourceFilename: string;
}

interface DocumentPageResult {
  cursor: string | null;
  scanned: number;
  uploaded: number;
}

interface DocumentCopyRow {
  r2_etag: string;
  google_drive_file_id: string;
  last_verified_at: string;
}

interface DriveListResponse {
  files?: DriveFile[];
  nextPageToken?: string;
}

interface D1ExportApiResponse {
  success?: boolean;
  errors?: Array<{ message?: string }>;
  result?: {
    at_bookmark?: string;
    signed_url?: string;
    filename?: string;
    error?: string;
    status?: "complete" | "error";
    success?: boolean;
    result?: {
      signed_url?: string;
      filename?: string;
    };
  };
}

export class BackupConfigurationError extends Error {}

export class DocumentConverter extends WorkerEntrypoint<BackupEnv> {
  convertR2DocumentToPdf(
    request: OfficeConversionRequest,
  ): Promise<OfficeConversionResult> {
    return convertStoredOfficeDocumentToPdf(this.env, request);
  }

  convertR2LegacyExcelToXlsx(
    request: OfficeConversionRequest,
  ): Promise<OfficeConversionResult> {
    return convertStoredLegacyExcelToXlsx(this.env, request);
  }
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 1000);
}

function requiredConfiguration(env: BackupEnv): string[] {
  const required: Array<[string, string | undefined]> = [
    ["ACCOUNT_ID", env.ACCOUNT_ID],
    ["DATABASE_ID", env.DATABASE_ID],
    ["CLOUDFLARE_D1_API_TOKEN", env.CLOUDFLARE_D1_API_TOKEN],
    ["GOOGLE_CLIENT_ID", env.GOOGLE_CLIENT_ID],
    ["GOOGLE_CLIENT_SECRET", env.GOOGLE_CLIENT_SECRET],
    ["GOOGLE_REFRESH_TOKEN", env.GOOGLE_REFRESH_TOKEN],
  ];
  return required.filter(([, value]) => !value?.trim()).map(([name]) => name);
}

export function assertBackupConfiguration(env: BackupEnv): void {
  const missing = requiredConfiguration(env);
  if (missing.length > 0) {
    throw new BackupConfigurationError(
      `バックアップ設定が不足しています: ${missing.join(", ")}`,
    );
  }
}

function retentionDays(value?: string): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 30 || parsed > 3650) {
    return DEFAULT_RETENTION_DAYS;
  }
  return parsed;
}

function jstTimestamp(date: Date): string {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "00";
  return `${value("year")}-${value("month")}-${value("day")}_${value("hour")}-${value("minute")}-${value("second")}`;
}

export function databaseBackupFilename(date: Date): string {
  return `sukc-tournament-discord-db_${jstTimestamp(date)}.sql`;
}

function scheduledInstanceId(scheduledTime: number): string {
  return `scheduled-${jstTimestamp(new Date(scheduledTime)).slice(0, 10)}`;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function secureEqual(left: string, right: string): Promise<boolean> {
  const [leftDigest, rightDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(left)),
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(right)),
  ]);
  const leftBytes = new Uint8Array(leftDigest);
  const rightBytes = new Uint8Array(rightDigest);
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0;
}

function quoteDriveQuery(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function safeDriveFilename(key: string): string {
  const candidate = key.split("/").at(-1)?.trim() || "document.pdf";
  return candidate
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, "_")
    .replace(/^[. ]+|[. ]+$/g, "")
    .slice(0, 200) || "document.pdf";
}

async function responseError(response: Response, label: string): Promise<Error> {
  const detail = (await response.text()).slice(0, 500);
  return new Error(`${label} (${response.status}): ${detail || response.statusText}`);
}

export async function getGoogleAccessToken(
  env: BackupEnv,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  assertBackupConfiguration(env);
  const response = await fetcher(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      refresh_token: env.GOOGLE_REFRESH_TOKEN!,
      grant_type: "refresh_token",
    }),
  });
  if (!response.ok) throw await responseError(response, "Google OAuth更新エラー");
  const payload = await response.json<{ access_token?: string }>();
  if (!payload.access_token) throw new Error("Google OAuth応答にアクセストークンがありません。");
  return payload.access_token;
}

async function driveRequest(
  path: string,
  accessToken: string,
  init: RequestInit = {},
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  const response = await fetcher(`${DRIVE_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...init.headers,
    },
  });
  if (!response.ok) throw await responseError(response, "Google Drive APIエラー");
  return response;
}

async function listDriveFiles(
  accessToken: string,
  query: string,
  pageToken?: string,
  fetcher: typeof fetch = fetch,
): Promise<DriveListResponse> {
  const params = new URLSearchParams({
    q: query,
    spaces: "drive",
    fields: "nextPageToken,files(id,name,createdTime,trashed)",
    pageSize: "1000",
  });
  if (pageToken) params.set("pageToken", pageToken);
  const response = await driveRequest(
    `/files?${params.toString()}`,
    accessToken,
    {},
    fetcher,
  );
  return response.json<DriveListResponse>();
}

async function createDriveFolder(
  accessToken: string,
  name: string,
  role: string,
  parentId: string | undefined,
  fetcher: typeof fetch = fetch,
): Promise<DriveFile> {
  const response = await driveRequest(
    "/files?fields=id,name",
    accessToken,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        mimeType: GOOGLE_DRIVE_FOLDER_MIME_TYPE,
        parents: parentId ? [parentId] : undefined,
        appProperties: { sukcBackupRole: role },
      }),
    },
    fetcher,
  );
  const file = await response.json<DriveFile>();
  if (!file.id) throw new Error(`Google Driveフォルダ「${name}」を作成できませんでした。`);
  return file;
}

async function ensureDriveFolder(
  accessToken: string,
  name: string,
  role: string,
  parentId: string | undefined,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const clauses = [
    "trashed = false",
    `mimeType = '${GOOGLE_DRIVE_FOLDER_MIME_TYPE}'`,
    `appProperties has { key='sukcBackupRole' and value='${quoteDriveQuery(role)}' }`,
  ];
  if (parentId) clauses.push(`'${quoteDriveQuery(parentId)}' in parents`);
  const existing = await listDriveFiles(
    accessToken,
    clauses.join(" and "),
    undefined,
    fetcher,
  );
  if (existing.files?.[0]?.id) return existing.files[0].id;
  return (await createDriveFolder(accessToken, name, role, parentId, fetcher)).id;
}

export async function ensureBackupFolders(
  env: BackupEnv,
  fetcher: typeof fetch = fetch,
): Promise<DriveFolders> {
  const accessToken = await getGoogleAccessToken(env, fetcher);
  const rootId = await ensureDriveFolder(
    accessToken,
    "大会システムバックアップ",
    "root",
    undefined,
    fetcher,
  );
  const databaseId = await ensureDriveFolder(
    accessToken,
    "database",
    "database",
    rootId,
    fetcher,
  );
  const documentsId = await ensureDriveFolder(
    accessToken,
    "documents",
    "documents",
    rootId,
    fetcher,
  );
  return { rootId, databaseId, documentsId };
}

async function findDriveFileByProperty(
  accessToken: string,
  propertyName: string,
  propertyValue: string,
  parentId: string,
  fetcher: typeof fetch = fetch,
): Promise<DriveFile | null> {
  const query = [
    "trashed = false",
    `'${quoteDriveQuery(parentId)}' in parents`,
    `appProperties has { key='${quoteDriveQuery(propertyName)}' and value='${quoteDriveQuery(propertyValue)}' }`,
  ].join(" and ");
  const files = await listDriveFiles(accessToken, query, undefined, fetcher);
  return files.files?.[0] ?? null;
}

async function startResumableDriveUpload(
  accessToken: string,
  metadata: Record<string, unknown>,
  contentType: string,
  contentLength: number | undefined,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json; charset=UTF-8",
    "X-Upload-Content-Type": contentType,
  };
  if (contentLength !== undefined) {
    headers["X-Upload-Content-Length"] = String(contentLength);
  }
  const response = await fetcher(
    `${DRIVE_UPLOAD_BASE}/files?uploadType=resumable&fields=id,name`,
    { method: "POST", headers, body: JSON.stringify(metadata) },
  );
  if (!response.ok) throw await responseError(response, "Google Driveアップロード開始エラー");
  const location = response.headers.get("Location");
  if (!location) throw new Error("Google Driveの再開可能アップロードURLがありません。");
  return location;
}

async function uploadDriveStream(
  accessToken: string,
  parentId: string,
  name: string,
  contentType: string,
  body: BodyInit,
  contentLength: number | undefined,
  appProperties: Record<string, string>,
  fetcher: typeof fetch = fetch,
): Promise<DriveFile> {
  const sessionUrl = await startResumableDriveUpload(
    accessToken,
    { name, parents: [parentId], appProperties },
    contentType,
    contentLength,
    fetcher,
  );
  const headers: Record<string, string> = { "Content-Type": contentType };
  if (contentLength !== undefined) headers["Content-Length"] = String(contentLength);
  const response = await fetcher(sessionUrl, {
    method: "PUT",
    headers,
    body,
  });
  if (!response.ok) throw await responseError(response, "Google Driveアップロードエラー");
  const file = await response.json<DriveFile>();
  if (!file.id) throw new Error("Google Driveアップロード結果にファイルIDがありません。");
  return file;
}

export async function startD1Export(
  env: BackupEnv,
  fetcher: typeof fetch = fetch,
): Promise<D1ExportJob> {
  assertBackupConfiguration(env);
  const response = await fetcher(
    `${D1_API_BASE}/accounts/${env.ACCOUNT_ID}/d1/database/${env.DATABASE_ID}/export`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.CLOUDFLARE_D1_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ output_format: "polling" }),
    },
  );
  if (!response.ok) throw await responseError(response, "D1エクスポート開始エラー");
  const payload = await response.json<D1ExportApiResponse>();
  if (!payload.success || !payload.result?.at_bookmark) {
    const detail = payload.result?.error || payload.errors?.[0]?.message || "bookmarkなし";
    throw new Error(`D1エクスポートを開始できませんでした: ${detail}`);
  }
  return { bookmark: payload.result.at_bookmark };
}

export async function pollD1Export(
  env: BackupEnv,
  bookmark: string,
  fetcher: typeof fetch = fetch,
): Promise<D1ExportReady> {
  assertBackupConfiguration(env);
  const response = await fetcher(
    `${D1_API_BASE}/accounts/${env.ACCOUNT_ID}/d1/database/${env.DATABASE_ID}/export`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.CLOUDFLARE_D1_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        output_format: "polling",
        current_bookmark: bookmark,
      }),
    },
  );
  if (!response.ok) throw await responseError(response, "D1エクスポート確認エラー");
  const payload = await response.json<D1ExportApiResponse>();
  if (!payload.success) {
    const detail = payload.result?.error || payload.errors?.[0]?.message || "不明なエラー";
    throw new Error(`D1エクスポートに失敗しました: ${detail}`);
  }
  if (
    payload.result?.status === "error" ||
    payload.result?.success === false ||
    payload.result?.error
  ) {
    throw new Error(
      `D1エクスポートに失敗しました: ${payload.result.error || "不明なエラー"}`,
    );
  }
  const completed = payload.result?.result ?? payload.result;
  if (!completed?.signed_url) {
    throw new Error("D1エクスポートはまだ準備中です。");
  }
  return {
    signedUrl: completed.signed_url,
    sourceFilename: completed.filename || "database.sql",
  };
}

export async function uploadD1Backup(
  env: BackupEnv,
  ready: D1ExportReady,
  databaseFolderId: string,
  backupRunId: string,
  startedAt: Date,
  fetcher: typeof fetch = fetch,
): Promise<{ fileId: string; fileName: string }> {
  const accessToken = await getGoogleAccessToken(env, fetcher);
  const existing = await findDriveFileByProperty(
    accessToken,
    "sukcBackupRunId",
    backupRunId,
    databaseFolderId,
    fetcher,
  );
  const fileName = databaseBackupFilename(startedAt);
  if (existing) return { fileId: existing.id, fileName: existing.name || fileName };

  const dump = await fetcher(ready.signedUrl);
  if (!dump.ok || !dump.body) throw await responseError(dump, "D1バックアップ取得エラー");
  const rawLength = dump.headers.get("Content-Length");
  const contentLength = rawLength && /^\d+$/.test(rawLength) ? Number(rawLength) : undefined;
  const file = await uploadDriveStream(
    accessToken,
    databaseFolderId,
    fileName,
    "application/sql",
    dump.body,
    contentLength,
    {
      sukcBackupType: "d1",
      sukcBackupRunId: backupRunId,
      sukcExportSourceHash: (await sha256Hex(ready.sourceFilename)).slice(0, 32),
    },
    fetcher,
  );
  return { fileId: file.id, fileName };
}

async function driveFileExists(
  accessToken: string,
  fileId: string,
  expectedParentId: string,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  const response = await fetcher(
    `${DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?fields=id,trashed,parents`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (response.status === 404) return false;
  if (!response.ok) throw await responseError(response, "Google Driveファイル確認エラー");
  const file = await response.json<DriveFile>();
  return Boolean(
    file.id &&
    !file.trashed &&
    file.parents?.includes(expectedParentId),
  );
}

async function upsertDocumentCopy(
  env: BackupEnv,
  object: R2Object,
  fileId: string,
  fileName: string,
  now: string,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO backup_document_copies (
      r2_key, r2_etag, r2_size, google_drive_file_id,
      google_drive_file_name, backed_up_at, last_verified_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(r2_key) DO UPDATE SET
      r2_etag = excluded.r2_etag,
      r2_size = excluded.r2_size,
      google_drive_file_id = excluded.google_drive_file_id,
      google_drive_file_name = excluded.google_drive_file_name,
      backed_up_at = excluded.backed_up_at,
      last_verified_at = excluded.last_verified_at`,
  ).bind(
    object.key,
    object.etag,
    object.size,
    fileId,
    fileName,
    now,
    now,
  ).run();
}

export async function backupDocumentPage(
  env: BackupEnv,
  documentsFolderId: string,
  cursor: string | undefined,
  fetcher: typeof fetch = fetch,
): Promise<DocumentPageResult> {
  const page = await env.DOCUMENTS.list({
    prefix: "documents/",
    limit: DOCUMENT_PAGE_SIZE,
    cursor,
  });
  let uploaded = 0;
  const nowDate = new Date();
  const now = nowDate.toISOString();
  let accessTokenPromise: Promise<string> | undefined;
  const accessToken = (): Promise<string> => {
    accessTokenPromise ??= getGoogleAccessToken(env, fetcher);
    return accessTokenPromise;
  };

  for (const object of page.objects) {
    const recorded = await env.DB.prepare(
      `SELECT r2_etag, google_drive_file_id, last_verified_at
       FROM backup_document_copies
       WHERE r2_key = ?`,
    ).bind(object.key).first<DocumentCopyRow>();
    if (recorded?.r2_etag === object.etag) {
      const verifiedAt = Date.parse(recorded.last_verified_at);
      const verificationDue = !Number.isFinite(verifiedAt) ||
        nowDate.getTime() - verifiedAt >= DRIVE_VERIFICATION_INTERVAL_MS;
      if (!verificationDue) continue;

      if (await driveFileExists(
        await accessToken(),
        recorded.google_drive_file_id,
        documentsFolderId,
        fetcher,
      )) {
        await env.DB.prepare(
          `UPDATE backup_document_copies
           SET last_verified_at = ?
           WHERE r2_key = ?`,
        ).bind(now, object.key).run();
        continue;
      }
    }

    const identity = await sha256Hex(`${object.key}\n${object.etag}`);
    const existing = await findDriveFileByProperty(
      await accessToken(),
      "sukcR2ObjectId",
      identity,
      documentsFolderId,
      fetcher,
    );
    const fileName = safeDriveFilename(object.key);
    let fileId = existing?.id;
    if (!fileId) {
      const source = await env.DOCUMENTS.get(object.key);
      if (!source) continue;
      const file = await uploadDriveStream(
        await accessToken(),
        documentsFolderId,
        fileName,
        source.httpMetadata?.contentType || "application/pdf",
        source.body,
        source.size,
        {
          sukcBackupType: "r2-document",
          sukcR2ObjectId: identity,
          sukcR2KeyHash: (await sha256Hex(object.key)).slice(0, 32),
        },
        fetcher,
      );
      fileId = file.id;
      uploaded += 1;
    }
    await upsertDocumentCopy(env, object, fileId, fileName, now);
  }

  return {
    cursor: page.truncated ? page.cursor || null : null,
    scanned: page.objects.length,
    uploaded,
  };
}

export async function trashExpiredDatabaseBackups(
  env: BackupEnv,
  databaseFolderId: string,
  now: Date,
  fetcher: typeof fetch = fetch,
): Promise<number> {
  const accessToken = await getGoogleAccessToken(env, fetcher);
  const cutoff = new Date(
    now.getTime() - retentionDays(env.DATABASE_BACKUP_RETENTION_DAYS) * 24 * 60 * 60 * 1000,
  );
  let pageToken: string | undefined;
  let trashed = 0;
  do {
    const query = [
      "trashed = false",
      `'${quoteDriveQuery(databaseFolderId)}' in parents`,
      "appProperties has { key='sukcBackupType' and value='d1' }",
    ].join(" and ");
    const page = await listDriveFiles(accessToken, query, pageToken, fetcher);
    for (const file of page.files ?? []) {
      if (!file.createdTime || new Date(file.createdTime) >= cutoff) continue;
      await driveRequest(
        `/files/${encodeURIComponent(file.id)}`,
        accessToken,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ trashed: true }),
        },
        fetcher,
      );
      trashed += 1;
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
  return trashed;
}

async function beginBackupRun(
  env: BackupEnv,
  runId: string,
  source: BackupWorkflowParams["source"],
  startedAt: string,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO backup_runs (
      backup_run_id, trigger_source, status, started_at
    ) VALUES (?, ?, 'running', ?)
    ON CONFLICT(backup_run_id) DO UPDATE SET
      status = 'running',
      error_message = NULL,
      completed_at = NULL`,
  ).bind(runId, source, startedAt).run();
}

async function completeBackupRun(
  env: BackupEnv,
  runId: string,
  databaseFileId: string,
  databaseFileName: string,
  documentsScanned: number,
  documentsUploaded: number,
  expiredTrashed: number,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE backup_runs
     SET status = 'succeeded', database_file_id = ?, database_file_name = ?,
       documents_scanned = ?, documents_uploaded = ?,
       expired_database_backups_trashed = ?, error_message = NULL,
       completed_at = ?
     WHERE backup_run_id = ?`,
  ).bind(
    databaseFileId,
    databaseFileName,
    documentsScanned,
    documentsUploaded,
    expiredTrashed,
    new Date().toISOString(),
    runId,
  ).run();
}

async function failBackupRun(
  env: BackupEnv,
  runId: string,
  error: unknown,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE backup_runs
     SET status = 'failed', error_message = ?, completed_at = ?,
       alert_next_attempt_at = ?
     WHERE backup_run_id = ?`,
  ).bind(
    errorText(error),
    new Date().toISOString(),
    new Date().toISOString(),
    runId,
  ).run();
}

export class TournamentBackupWorkflow extends WorkflowEntrypoint<
  BackupEnv,
  BackupWorkflowParams
> {
  async run(
    event: Readonly<WorkflowEvent<BackupWorkflowParams>>,
    step: WorkflowStep,
  ): Promise<unknown> {
    const runId = event.instanceId;
    const startedAt = event.timestamp;
    await step.do("バックアップ開始記録", async () => {
      await beginBackupRun(this.env, runId, event.payload.source, startedAt.toISOString());
      return { runId };
    });

    try {
      assertBackupConfiguration(this.env);
      const folders = await step.do(
        "Google Driveフォルダ準備",
        { retries: { limit: 3, delay: "10 seconds", backoff: "exponential" } },
        () => ensureBackupFolders(this.env),
      );
      const exportJob = await step.do(
        "D1エクスポート開始",
        { retries: { limit: 3, delay: "10 seconds", backoff: "exponential" } },
        () => startD1Export(this.env),
      );
      const ready = await step.do(
        "D1エクスポート完了待ち",
        {
          retries: { limit: 12, delay: "10 seconds", backoff: "linear" },
          sensitive: "output",
        },
        () => pollD1Export(this.env, exportJob.bookmark),
      );
      const databaseFile = await step.do(
        "D1をGoogle Driveへ保存",
        { retries: { limit: 3, delay: "15 seconds", backoff: "exponential" } },
        () => uploadD1Backup(
          this.env,
          ready,
          folders.databaseId,
          runId,
          startedAt,
        ),
      );
      const documentWorkflow = await step.do(
        "R2文書バックアップ開始",
        { retries: { limit: 3, delay: "10 seconds", backoff: "exponential" } },
        async () => (await this.env.DOCUMENT_BACKUP_WORKFLOW.create({
          params: {
            runId,
            databaseFolderId: folders.databaseId,
            documentsFolderId: folders.documentsId,
            databaseFileId: databaseFile.fileId,
            databaseFileName: databaseFile.fileName,
            startedAt: startedAt.toISOString(),
            pageNumber: 1,
            documentsScanned: 0,
            documentsUploaded: 0,
          },
        })).id,
      );
      return {
        runId,
        databaseFileName: databaseFile.fileName,
        documentWorkflowId: documentWorkflow,
      };
    } catch (error: unknown) {
      await step.do(
        "バックアップ失敗記録",
        { retries: { limit: 3, delay: "5 seconds", backoff: "exponential" } },
        async () => {
          await failBackupRun(this.env, runId, error);
          return { failed: true };
        },
      );
      throw error;
    }
  }
}

export class TournamentDocumentBackupWorkflow extends WorkflowEntrypoint<
  BackupEnv,
  DocumentBackupWorkflowParams
> {
  async run(
    event: Readonly<WorkflowEvent<DocumentBackupWorkflowParams>>,
    step: WorkflowStep,
  ): Promise<unknown> {
    const params = event.payload;
    try {
      assertBackupConfiguration(this.env);
      const result = await step.do(
        `R2文書バックアップ ${params.pageNumber}`,
        { retries: { limit: 3, delay: "15 seconds", backoff: "exponential" } },
        () => backupDocumentPage(
          this.env,
          params.documentsFolderId,
          params.cursor,
        ),
      );
      const documentsScanned = params.documentsScanned + result.scanned;
      const documentsUploaded = params.documentsUploaded + result.uploaded;

      if (result.cursor) {
        const nextWorkflow = await step.do(
          "次の文書ページを開始",
          { retries: { limit: 3, delay: "10 seconds", backoff: "exponential" } },
          async () => (await this.env.DOCUMENT_BACKUP_WORKFLOW.create({
            params: {
              ...params,
              cursor: result.cursor || undefined,
              pageNumber: params.pageNumber + 1,
              documentsScanned,
              documentsUploaded,
            },
          })).id,
        );
        return {
          runId: params.runId,
          continuedAs: nextWorkflow,
          documentsScanned,
          documentsUploaded,
        };
      }

      const startedAt = new Date(params.startedAt);
      const expiredTrashed = await step.do(
        "期限切れD1バックアップ整理",
        { retries: { limit: 3, delay: "10 seconds", backoff: "exponential" } },
        () => trashExpiredDatabaseBackups(
          this.env,
          params.databaseFolderId,
          startedAt,
        ),
      );
      await step.do("バックアップ完了記録", async () => {
        await completeBackupRun(
          this.env,
          params.runId,
          params.databaseFileId,
          params.databaseFileName,
          documentsScanned,
          documentsUploaded,
          expiredTrashed,
        );
        return { completed: true };
      });
      return {
        runId: params.runId,
        documentsScanned,
        documentsUploaded,
        expiredTrashed,
      };
    } catch (error: unknown) {
      await step.do(
        "バックアップ失敗記録",
        { retries: { limit: 3, delay: "5 seconds", backoff: "exponential" } },
        async () => {
          await failBackupRun(this.env, params.runId, error);
          return { failed: true };
        },
      );
      throw error;
    }
  }
}

export async function handleBackupRequest(
  request: Request,
  env: BackupEnv,
): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/health") {
    const latest = await env.DB.prepare(
      `SELECT backup_run_id, trigger_source, status, database_file_name,
        documents_scanned, documents_uploaded,
        expired_database_backups_trashed, error_message, started_at, completed_at
       FROM backup_runs
       ORDER BY started_at DESC
       LIMIT 1`,
    ).first<BackupRunRow>();
    return json({
      ok: true,
      service: "sukc-tournament-backup",
      configured: requiredConfiguration(env).length === 0,
      latestBackup: latest ?? null,
    });
  }

  if (request.method === "POST" && url.pathname === "/run") {
    const expected = env.BACKUP_TRIGGER_SECRET ?? "";
    const authorization = request.headers.get("Authorization") ?? "";
    const supplied = authorization.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : "";
    if (!expected || !supplied || !await secureEqual(expected, supplied)) {
      return json({ ok: false, error: "unauthorized" }, 401);
    }
    const missing = requiredConfiguration(env);
    if (missing.length > 0) {
      return json({ ok: false, error: "backup_not_configured", missing }, 503);
    }
    const instance = await env.BACKUP_WORKFLOW.create({
      id: `manual-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
      params: { source: "manual" },
      retention: { successRetention: "3 days", errorRetention: "7 days" },
      locationHint: "apac-ne",
    });
    return json({ ok: true, instanceId: instance.id }, 202);
  }

  return new Response("Not Found", { status: 404 });
}

export default {
  fetch(request: Request, env: BackupEnv): Promise<Response> {
    return handleBackupRequest(request, env);
  },
  async scheduled(
    controller: ScheduledController,
    env: BackupEnv,
  ): Promise<void> {
    await env.BACKUP_WORKFLOW.create({
      id: scheduledInstanceId(controller.scheduledTime),
      params: { source: "scheduled" },
      retention: { successRetention: "3 days", errorRetention: "7 days" },
      locationHint: "apac-ne",
    });
  },
} satisfies ExportedHandler<BackupEnv>;
