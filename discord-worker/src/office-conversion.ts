const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const DRIVE_UPLOAD_ENDPOINT = "https://www.googleapis.com/upload/drive/v3/files";
const DRIVE_FILES_ENDPOINT = "https://www.googleapis.com/drive/v3/files";
const MAX_EXPORTED_PDF_BYTES = 10 * 1024 * 1024;

export interface OfficeConversionEnv {
  DOCUMENTS: R2Bucket;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REFRESH_TOKEN?: string;
}

export interface OfficeConversionRequest {
  sourceKey: string;
  targetKey: string;
  sourceContentType: string;
  sourceFileName: string;
  targetFileName: string;
}

export interface OfficeConversionResult {
  targetKey: string;
  size: number;
}

export class OfficeConversionError extends Error {}

function googleWorkspaceMimeType(sourceContentType: string): string {
  if (
    sourceContentType === "application/msword" ||
    sourceContentType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) return "application/vnd.google-apps.document";
  if (
    sourceContentType === "application/vnd.ms-excel" ||
    sourceContentType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  ) return "application/vnd.google-apps.spreadsheet";
  throw new OfficeConversionError("PDF変換に対応していないファイル形式です。");
}

function inlinePdfDisposition(fileName: string): string {
  return `inline; filename="document.pdf"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

async function errorResponse(response: Response, label: string): Promise<OfficeConversionError> {
  const detail = (await response.text()).slice(0, 500);
  return new OfficeConversionError(
    `${label} (${response.status}): ${detail || response.statusText}`,
  );
}

async function googleAccessToken(
  env: OfficeConversionEnv,
  fetcher: typeof fetch,
): Promise<string> {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REFRESH_TOKEN) {
    throw new OfficeConversionError("Google PDF変換の認証情報が設定されていません。");
  }
  const response = await fetcher(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env.GOOGLE_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  if (!response.ok) throw await errorResponse(response, "Google OAuth更新エラー");
  const payload = await response.json<{ access_token?: string }>();
  if (!payload.access_token) {
    throw new OfficeConversionError("Google OAuth応答にアクセストークンがありません。");
  }
  return payload.access_token;
}

async function importOfficeFile(
  bytes: ArrayBuffer,
  request: OfficeConversionRequest,
  workspaceMimeType: string,
  accessToken: string,
  fetcher: typeof fetch,
): Promise<string> {
  const boundary = `sukc_${crypto.randomUUID().replaceAll("-", "")}`;
  const metadata = JSON.stringify({
    name: `一時変換_${request.sourceFileName}`,
    mimeType: workspaceMimeType,
  });
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
    `--${boundary}\r\nContent-Type: ${request.sourceContentType}\r\n\r\n`,
    bytes,
    `\r\n--${boundary}--`,
  ]);
  const response = await fetcher(
    `${DRIVE_UPLOAD_ENDPOINT}?uploadType=multipart&fields=id`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  );
  if (!response.ok) throw await errorResponse(response, "Officeファイル変換エラー");
  const payload = await response.json<{ id?: string }>();
  if (!payload.id) throw new OfficeConversionError("Google Driveから変換用ファイルIDを取得できませんでした。");
  return payload.id;
}

async function exportPdf(
  fileId: string,
  accessToken: string,
  fetcher: typeof fetch,
): Promise<ArrayBuffer> {
  const response = await fetcher(
    `${DRIVE_FILES_ENDPOINT}/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent("application/pdf")}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!response.ok) throw await errorResponse(response, "PDF書き出しエラー");
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength === 0) throw new OfficeConversionError("書き出されたPDFが空です。");
  if (bytes.byteLength > MAX_EXPORTED_PDF_BYTES) {
    throw new OfficeConversionError("書き出されたPDFがGoogle Driveの10MB上限を超えています。");
  }
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") {
    throw new OfficeConversionError("Google DriveからPDF以外のデータが返されました。");
  }
  return bytes;
}

async function deleteTemporaryFile(
  fileId: string,
  accessToken: string,
  fetcher: typeof fetch,
): Promise<void> {
  const response = await fetcher(
    `${DRIVE_FILES_ENDPOINT}/${encodeURIComponent(fileId)}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!response.ok && response.status !== 404) {
    console.error("Google Drive一時変換ファイルを削除できませんでした", response.status);
  }
}

export async function convertStoredOfficeDocumentToPdf(
  env: OfficeConversionEnv,
  request: OfficeConversionRequest,
  fetcher: typeof fetch = fetch,
): Promise<OfficeConversionResult> {
  const workspaceMimeType = googleWorkspaceMimeType(request.sourceContentType);
  const source = await env.DOCUMENTS.get(request.sourceKey);
  if (!source) throw new OfficeConversionError("変換元ファイルが見つかりません。");
  const accessToken = await googleAccessToken(env, fetcher);
  let temporaryFileId: string | null = null;
  try {
    temporaryFileId = await importOfficeFile(
      await source.arrayBuffer(),
      request,
      workspaceMimeType,
      accessToken,
      fetcher,
    );
    const pdf = await exportPdf(temporaryFileId, accessToken, fetcher);
    await env.DOCUMENTS.put(request.targetKey, pdf, {
      httpMetadata: {
        contentType: "application/pdf",
        contentDisposition: inlinePdfDisposition(request.targetFileName),
      },
      customMetadata: {
        convertedFrom: request.sourceKey,
        originalName: request.sourceFileName.slice(0, 500),
      },
    });
    return { targetKey: request.targetKey, size: pdf.byteLength };
  } finally {
    if (temporaryFileId) {
      await deleteTemporaryFile(temporaryFileId, accessToken, fetcher);
    }
  }
}
