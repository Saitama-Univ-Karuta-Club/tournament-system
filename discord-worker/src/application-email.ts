import type { ApplicationEmailTemplate } from "./tournaments";

const DOCUMENT_KEY_PATTERN = /^documents\/[0-9a-f-]{36}\/.+\.(?:xls|xlsx)$/i;
const XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const XLS_CONTENT_TYPE = "application/vnd.ms-excel";

export interface ApplicationEmailAttachment {
  fileName: string;
  contentType: string;
  bytes: Uint8Array;
}

export class ApplicationEmailError extends Error {
  constructor(message: string, public readonly statusCode = 400) {
    super(message);
    this.name = "ApplicationEmailError";
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function textToBase64(value: string): string {
  return bytesToBase64(new TextEncoder().encode(value));
}

function foldBase64(value: string): string {
  return value.match(/.{1,76}/g)?.join("\r\n") ?? "";
}

function mimeHeader(value: string): string {
  return `=?UTF-8?B?${textToBase64(value)}?=`;
}

function safeMailbox(value: string): string {
  const normalized = value.replace(/[\r\n]/g, "").trim();
  if (!normalized) throw new ApplicationEmailError("申込先メールアドレスが未登録です。");
  return normalized;
}

function splitBodyAndSignature(value: string): {
  body: string;
  signature: string | null;
} {
  const normalized = value.replace(/\r\n/g, "\n");
  const signatureMarker = "\n\n==============================\n";
  const markerIndex = normalized.lastIndexOf(signatureMarker);
  if (markerIndex === -1) return { body: normalized, signature: null };
  return {
    body: normalized.slice(0, markerIndex),
    signature: normalized.slice(markerIndex + 2),
  };
}

function fallbackContentType(fileName: string): string {
  return fileName.toLowerCase().endsWith(".xls")
    ? XLS_CONTENT_TYPE
    : XLSX_CONTENT_TYPE;
}

export function applicationEmailDocumentKey(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ApplicationEmailError("申込名簿の保存先URLが不正です。");
  }
  let key: string;
  try {
    key = url.pathname.slice(1).split("/").map(decodeURIComponent).join("/");
  } catch {
    throw new ApplicationEmailError("申込名簿の保存先URLが不正です。");
  }
  if (!DOCUMENT_KEY_PATTERN.test(key)) {
    throw new ApplicationEmailError("申込名簿のR2ファイルを特定できません。");
  }
  return key;
}

export async function loadApplicationEmailAttachment(
  bucket: R2Bucket | undefined,
  template: ApplicationEmailTemplate,
): Promise<ApplicationEmailAttachment> {
  if (!bucket) {
    throw new ApplicationEmailError("申込名簿の保存先が設定されていません。", 500);
  }
  if (!template.attachmentUrl || !template.attachmentFileName) {
    throw new ApplicationEmailError("申込名簿が登録されていません。", 404);
  }
  const key = applicationEmailDocumentKey(template.attachmentUrl);
  const object = await bucket.get(key);
  if (!object) {
    throw new ApplicationEmailError("申込名簿ファイルが見つかりません。", 404);
  }
  return {
    fileName: template.attachmentFileName,
    contentType: template.attachmentContentType ||
      object.httpMetadata?.contentType ||
      fallbackContentType(template.attachmentFileName),
    bytes: new Uint8Array(await object.arrayBuffer()),
  };
}

export function buildApplicationEmailEml(
  template: ApplicationEmailTemplate,
  attachment: ApplicationEmailAttachment,
  boundary = `sukc-${crypto.randomUUID()}`,
): string {
  const encodedFileName = encodeURIComponent(attachment.fileName);
  const { body, signature } = splitBodyAndSignature(template.body);
  const headers = [
    "X-Unsent: 1",
    `To: ${safeMailbox(template.to)}`,
    `Subject: ${mimeHeader(template.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ];
  const parts = [
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "Content-Disposition: inline",
    "",
    foldBase64(textToBase64(signature ? `${body}\n\n` : body)),
    `--${boundary}`,
    `Content-Type: ${attachment.contentType}; name="application-roster.xlsx"; name*=UTF-8''${encodedFileName}`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: inline; filename="application-roster.xlsx"; filename*=UTF-8''${encodedFileName}`,
    "",
    foldBase64(bytesToBase64(attachment.bytes)),
  ];
  if (signature) {
    parts.push(
      `--${boundary}`,
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "Content-Disposition: inline",
      "",
      foldBase64(textToBase64(`\n\n${signature}`)),
    );
  }
  parts.push(`--${boundary}--`, "");
  return [...headers, "", ...parts].join("\r\n");
}

export function applicationEmailDraftFileName(subject: string): string {
  const safe = subject
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/^[. ]+|[. ]+$/g, "")
    .slice(0, 120) || "申込メール";
  return `${safe}.eml`;
}
