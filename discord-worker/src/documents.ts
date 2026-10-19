import { formatGrade } from "./members";
import type {
  OfficeConversionRequest,
  OfficeConversionResult,
} from "./office-conversion";

export const MAX_PDF_BYTES = 20 * 1024 * 1024;
export const MAX_GUIDANCE_BYTES = 20 * 1024 * 1024;

const SAFE_ID = /^[0-9a-f-]{36}$/i;
const VALID_GRADE = new Set(["A", "B", "C", "D", "E", "F", "beginner", "all"]);

export interface DocumentEnv {
  DOCUMENTS?: R2Bucket;
  DOCUMENT_PUBLIC_BASE_URL?: string;
  DOCUMENT_CONVERTER?: {
    convertR2DocumentToPdf(
      request: OfficeConversionRequest,
    ): Promise<OfficeConversionResult>;
  };
}

export type ManagedDocumentEnv = DocumentEnv & { DB?: D1Database };

export type ArchiveDocumentType = "roster" | "results";

export interface StoredGuidanceDocument {
  url: string;
  fileName: string;
  size: number;
  contentType: string;
  sourceUrl: string;
  sourceFileName: string;
  conversionStatus: "not_required" | "ready" | "failed";
  conversionError: string | null;
}

export interface DocumentStorageOptions {
  /** Set false for an Excel template that must remain editable after download. */
  generatePdfPreview?: boolean;
}

export class DocumentUploadError extends Error {}

function safeFilenamePart(value: string, fallback: string): string {
  const normalized = value
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/^[. ]+|[. ]+$/g, "")
    .slice(0, 100);
  return normalized || fallback;
}

function normalizeUploadGrades(raw: unknown): string[] {
  if (!Array.isArray(raw)) throw new DocumentUploadError("開催級が不正です。");
  const grades = [...new Set(raw.map(String))];
  if (grades.length === 0 || grades.some((grade) => !VALID_GRADE.has(grade))) {
    throw new DocumentUploadError("開催級が不正です。");
  }
  if (grades.includes("all") && grades.length > 1) {
    throw new DocumentUploadError("開催級が不正です。");
  }
  return grades;
}

function normalizeUploadDates(raw: unknown): string[] {
  if (!Array.isArray(raw)) throw new DocumentUploadError("開催日が不正です。");
  const dates = [...new Set(raw.map(String))];
  if (dates.length === 0 || dates.some((date) => !/^\d{4}-\d{2}-\d{2}$/.test(date))) {
    throw new DocumentUploadError("開催日が不正です。");
  }
  return dates;
}

export function buildPdfFilename(
  title: string,
  grades: string[],
  eventDates: string[],
): string {
  const safeTitle = safeFilenamePart(title, "大会");
  const months = [...new Set(eventDates.map((date) => date.slice(0, 7)))]
    .map((month) => `${month.slice(0, 4)}年${Number(month.slice(5, 7))}月`)
    .join("・");
  const gradeLabel = grades
    .map((grade) => grade === "all" ? "全級" : formatGrade(grade))
    .join("・");
  return safeFilenamePart(`${months}_${safeTitle}_${gradeLabel}`, "大会要項") + ".pdf";
}

export function buildTournamentDocumentFilename(
  title: string,
  grades: string[],
  eventDates: string[],
  extension: "pdf" | "doc" | "docx",
): string {
  return buildPdfFilename(title, grades, eventDates).replace(/\.pdf$/i, `.${extension}`);
}

export function buildArchivePdfFilename(
  title: string,
  grades: string[],
  eventDates: string[],
  documentType: ArchiveDocumentType,
): string {
  const base = buildPdfFilename(title, grades, eventDates).replace(/\.pdf$/i, "");
  const label = documentType === "roster" ? "選手名簿" : "大会結果";
  return safeFilenamePart(`${base}_${label}`, label) + ".pdf";
}

export function buildGuidanceFilename(
  title: string,
  grades: string[],
  eventDates: string[],
  extension: "pdf" | "doc" | "docx",
): string {
  const base = buildPdfFilename(title, grades, eventDates).replace(/\.pdf$/i, "");
  return safeFilenamePart(`${base}_参加者向け案内`, "参加者向け案内") + `.${extension}`;
}

export function buildConfirmationRosterFilename(
  title: string,
  grades: string[],
  eventDates: string[],
  extension: "pdf" | "doc" | "docx" | "xls" | "xlsx",
): string {
  const base = buildPdfFilename(title, grades, eventDates).replace(/\.pdf$/i, "");
  return safeFilenamePart(`${base}_申込確認名簿`, "申込確認名簿") + `.${extension}`;
}

export function buildApplicationRosterFilename(
  title: string,
  grades: string[],
  extension: "xls" | "xlsx",
  customFileName = "",
): string {
  const custom = customFileName.trim();
  if (custom) {
    const customExtension = custom.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
    if (customExtension && customExtension !== extension) {
      throw new DocumentUploadError(
        `指定ファイル名の拡張子はアップロードする.${extension}ファイルに合わせてください。`,
      );
    }
    const base = customExtension ? custom.slice(0, -(customExtension.length + 1)) : custom;
    return safeFilenamePart(base, "申込名簿") + `.${extension}`;
  }
  const safeTitle = safeFilenamePart(title, "大会");
  const gradeLabel = grades
    .map((grade) => grade === "all" ? "全級" : formatGrade(grade))
    .join("・");
  return safeFilenamePart(
    `${safeTitle}_${gradeLabel}_申込名簿_埼玉大学かるた会`,
    "申込名簿_埼玉大学かるた会",
  ) + `.${extension}`;
}

export function buildOrganizerPaymentFilename(
  title: string,
  grades: string[],
  eventDates: string[],
  extension: "pdf" | "doc" | "docx",
): string {
  const base = buildPdfFilename(title, grades, eventDates).replace(/\.pdf$/i, "");
  return safeFilenamePart(`${base}_主催者振込情報`, "主催者振込情報") + `.${extension}`;
}

function contentDisposition(filename: string): string {
  return `inline; filename="tournament.pdf"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function attachmentContentDisposition(filename: string): string {
  return `attachment; filename="tournament-document"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function uploadTournamentDocument(
  request: Request,
  env: ManagedDocumentEnv,
  uploadedBy: string,
): Promise<StoredGuidanceDocument> {
  if (!env.DOCUMENTS || !env.DOCUMENT_PUBLIC_BASE_URL) {
    throw new DocumentUploadError("大会要項の保存先が設定されていません。");
  }
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new DocumentUploadError("大会要項を選択してください。");
  if (file.size === 0) throw new DocumentUploadError("大会要項が空です。");
  if (file.size > MAX_PDF_BYTES) throw new DocumentUploadError("大会要項は20MB以下にしてください。");
  const extension = file.name.toLowerCase().match(/\.(pdf|doc|docx)$/)?.[1] as
    | "pdf"
    | "doc"
    | "docx"
    | undefined;
  if (!extension) {
    throw new DocumentUploadError("大会要項はPDF・Word（.doc/.docx）形式にしてください。");
  }

  let grades: string[];
  let eventDates: string[];
  try {
    grades = normalizeUploadGrades(JSON.parse(String(form.get("grades") ?? "")));
    eventDates = normalizeUploadDates(JSON.parse(String(form.get("eventDates") ?? "")));
  } catch (error) {
    if (error instanceof SyntaxError) throw new DocumentUploadError("大会要項の付随情報が不正です。");
    throw error;
  }
  const title = String(form.get("title") ?? "").trim();
  if (!title || title.length > 100) throw new DocumentUploadError("大会名を確認してください。");

  const fileName = buildTournamentDocumentFilename(title, grades, eventDates, extension);
  return storeParticipantGuidanceDocument(file, env, uploadedBy, fileName);
}

export async function uploadApplicationRoster(
  request: Request,
  env: ManagedDocumentEnv,
  uploadedBy: string,
): Promise<StoredGuidanceDocument> {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    throw new DocumentUploadError("申込名簿のExcelファイルを選択してください。");
  }
  const extension = file.name.toLowerCase().match(/\.(xls|xlsx)$/)?.[1] as
    | "xls"
    | "xlsx"
    | undefined;
  if (!extension) {
    throw new DocumentUploadError("申込名簿はExcel（.xls・.xlsx）形式にしてください。");
  }
  let grades: string[];
  try {
    grades = normalizeUploadGrades(JSON.parse(String(form.get("grades") ?? "")));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new DocumentUploadError("申込名簿の付随情報が不正です。");
    }
    throw error;
  }
  const title = String(form.get("title") ?? "").trim();
  if (!title || title.length > 100) {
    throw new DocumentUploadError("大会名を確認してください。");
  }
  const customFileName = String(form.get("customFileName") ?? "").trim();
  if (customFileName.length > 240) {
    throw new DocumentUploadError("指定ファイル名は240文字以内にしてください。");
  }
  const fileName = buildApplicationRosterFilename(
    title,
    grades,
    extension,
    customFileName,
  );
  return storeParticipantGuidanceDocument(
    file,
    env,
    uploadedBy,
    fileName,
    { generatePdfPreview: false },
  );
}

export async function storeTournamentPdf(
  file: File,
  env: ManagedDocumentEnv,
  uploadedBy: string,
  fileName: string,
): Promise<{ url: string; fileName: string; size: number }> {
  if (!env.DOCUMENTS || !env.DOCUMENT_PUBLIC_BASE_URL) {
    throw new DocumentUploadError("PDF保存先が設定されていません。");
  }
  if (file.size === 0) throw new DocumentUploadError("PDFファイルが空です。");
  if (file.size > MAX_PDF_BYTES) throw new DocumentUploadError("PDFは20MB以下にしてください。");
  const bytes = await file.arrayBuffer();
  const signature = new TextDecoder().decode(bytes.slice(0, 5));
  if (signature !== "%PDF-") throw new DocumentUploadError("PDF形式のファイルを選択してください。");

  const id = crypto.randomUUID();
  const key = `documents/${id}/${fileName}`;
  await env.DOCUMENTS.put(key, bytes, {
    httpMetadata: {
      contentType: "application/pdf",
      contentDisposition: contentDisposition(fileName),
    },
    customMetadata: {
      uploadedBy: uploadedBy.slice(0, 320),
      originalName: file.name.slice(0, 500),
    },
  });

  const baseUrl = env.DOCUMENT_PUBLIC_BASE_URL.replace(/\/+$/, "");
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  return { url: `${baseUrl}/${encodedKey}`, fileName, size: file.size };
}

export async function storeParticipantGuidanceDocument(
  file: File,
  env: ManagedDocumentEnv,
  uploadedBy: string,
  fileName: string,
  options: DocumentStorageOptions = {},
): Promise<StoredGuidanceDocument> {
  if (!env.DOCUMENTS || !env.DOCUMENT_PUBLIC_BASE_URL) {
    throw new DocumentUploadError("案内ファイルの保存先が設定されていません。");
  }
  if (file.size === 0) throw new DocumentUploadError("案内ファイルが空です。");
  if (file.size > MAX_GUIDANCE_BYTES) {
    throw new DocumentUploadError("案内ファイルは20MB以下にしてください。");
  }
  const extension = fileName.toLowerCase().split(".").pop();
  const bytes = await file.arrayBuffer();
  const prefix = new Uint8Array(bytes.slice(0, 8));
  let contentType: string;
  if (extension === "pdf") {
    const signature = new TextDecoder().decode(bytes.slice(0, 5));
    if (signature !== "%PDF-") throw new DocumentUploadError("PDF形式を確認できませんでした。");
    contentType = "application/pdf";
  } else if (extension === "docx") {
    if (prefix[0] !== 0x50 || prefix[1] !== 0x4b) {
      throw new DocumentUploadError("Word（.docx）形式を確認できませんでした。");
    }
    contentType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  } else if (extension === "doc") {
    const oleSignature = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
    if (!oleSignature.every((value, index) => prefix[index] === value)) {
      throw new DocumentUploadError("Word（.doc）形式を確認できませんでした。");
    }
    contentType = "application/msword";
  } else if (extension === "xlsx") {
    if (prefix[0] !== 0x50 || prefix[1] !== 0x4b) {
      throw new DocumentUploadError("Excel（.xlsx）形式を確認できませんでした。");
    }
    contentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  } else if (extension === "xls") {
    const oleSignature = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
    if (!oleSignature.every((value, index) => prefix[index] === value)) {
      throw new DocumentUploadError("Excel（.xls）形式を確認できませんでした。");
    }
    contentType = "application/vnd.ms-excel";
  } else {
    throw new DocumentUploadError("ファイルはPDF・Word・Excel形式のみ登録できます。");
  }

  const id = crypto.randomUUID();
  const baseUrl = env.DOCUMENT_PUBLIC_BASE_URL.replace(/\/+$/, "");
  const needsPdfPreview = options.generatePdfPreview !== false &&
    (extension === "doc" || extension === "docx" || extension === "xls" || extension === "xlsx");

  // PDFと、編集用として残す申込名簿Excelは従来URLのまま保存する。
  if (!env.DB || !needsPdfPreview) {
    const key = `documents/${id}/${fileName}`;
    await env.DOCUMENTS.put(key, bytes, {
      httpMetadata: {
        contentType,
        contentDisposition: extension === "pdf"
          ? contentDisposition(fileName)
          : attachmentContentDisposition(fileName),
      },
      customMetadata: {
        uploadedBy: uploadedBy.slice(0, 320),
        originalName: file.name.slice(0, 500),
      },
    });
    const encodedKey = key.split("/").map(encodeURIComponent).join("/");
    const url = `${baseUrl}/${encodedKey}`;
    return {
      url,
      fileName,
      size: file.size,
      contentType,
      sourceUrl: url,
      sourceFileName: fileName,
      conversionStatus: "not_required",
      conversionError: null,
    };
  }

  const sourceKey = `documents/${id}/source/${fileName}`;
  const stableUrl = `${baseUrl}/document-files/${id}`;
  const sourceUrl = `${stableUrl}/source`;
  await env.DOCUMENTS.put(sourceKey, bytes, {
    httpMetadata: {
      contentType,
      contentDisposition: attachmentContentDisposition(fileName),
    },
    customMetadata: {
      uploadedBy: uploadedBy.slice(0, 320),
      originalName: file.name.slice(0, 500),
    },
  });

  await env.DB.prepare(
    `INSERT INTO stored_documents (
      document_id, source_key, source_file_name, source_content_type,
      preferred_key, preferred_file_name, preferred_content_type,
      conversion_status, uploaded_by_email
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id,
    sourceKey,
    fileName,
    contentType,
    sourceKey,
    fileName,
    contentType,
    "converting",
    uploadedBy.slice(0, 320),
  ).run();

  if (needsPdfPreview) {
    const previewFileName = fileName.replace(/\.(?:doc|docx|xls|xlsx)$/i, ".pdf");
    const previewKey = `documents/${id}/preview/${previewFileName}`;
    try {
      if (!env.DOCUMENT_CONVERTER) {
        throw new Error("PDF変換サービスが設定されていません。");
      }
      const converted = await env.DOCUMENT_CONVERTER.convertR2DocumentToPdf({
        sourceKey,
        targetKey: previewKey,
        sourceContentType: contentType,
        sourceFileName: fileName,
        targetFileName: previewFileName,
      });
      await env.DB.prepare(
        `UPDATE stored_documents
         SET preferred_key = ?, preferred_file_name = ?,
             preferred_content_type = 'application/pdf', preview_key = ?,
             conversion_status = 'ready', conversion_error = NULL,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE document_id = ?`,
      ).bind(converted.targetKey, previewFileName, converted.targetKey, id).run();
      return {
        url: stableUrl,
        fileName: previewFileName,
        size: converted.size,
        contentType: "application/pdf",
        sourceUrl,
        sourceFileName: fileName,
        conversionStatus: "ready",
        conversionError: null,
      };
    } catch (error: unknown) {
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
      console.error("OfficeファイルのPDF変換に失敗しました", message);
      await env.DB.prepare(
        `UPDATE stored_documents
         SET conversion_status = 'failed', conversion_error = ?,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE document_id = ?`,
      ).bind(message, id).run();
      return {
        url: stableUrl,
        fileName,
        size: file.size,
        contentType,
        sourceUrl,
        sourceFileName: fileName,
        conversionStatus: "failed",
        conversionError: message,
      };
    }
  }

  return {
    url: stableUrl,
    fileName,
    size: file.size,
    contentType,
    sourceUrl,
    sourceFileName: fileName,
    conversionStatus: "not_required",
    conversionError: null,
  };
}

interface StoredDocumentRouteRow {
  source_key: string;
  source_file_name: string;
  source_content_type: string;
  preferred_key: string;
  preferred_file_name: string;
  preferred_content_type: string;
}

export async function serveTournamentDocument(
  request: Request,
  bucket: R2Bucket | undefined,
  db?: D1Database,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const stableMatch = url.pathname.match(/^\/document-files\/([0-9a-f-]{36})(\/source)?$/i);
  if (stableMatch) {
    if (!bucket || !db || !SAFE_ID.test(stableMatch[1])) {
      return new Response("Not Found", { status: 404 });
    }
    const row = await db.prepare(
      `SELECT source_key, source_file_name, source_content_type,
        preferred_key, preferred_file_name, preferred_content_type
       FROM stored_documents WHERE document_id = ?`,
    ).bind(stableMatch[1]).first<StoredDocumentRouteRow>();
    if (!row) return new Response("Not Found", { status: 404 });
    const sourceRequested = Boolean(stableMatch[2]);
    const key = sourceRequested ? row.source_key : row.preferred_key;
    const fileName = sourceRequested ? row.source_file_name : row.preferred_file_name;
    const contentType = sourceRequested ? row.source_content_type : row.preferred_content_type;
    const object = await bucket.get(key);
    if (!object) return new Response("Not Found", { status: 404 });
    const headers = new Headers({
      "Cache-Control": "private, max-age=3600",
      "Content-Type": object.httpMetadata?.contentType || contentType,
      "Content-Disposition": object.httpMetadata?.contentDisposition ||
        (contentType === "application/pdf"
          ? contentDisposition(fileName)
          : attachmentContentDisposition(fileName)),
      "X-Content-Type-Options": "nosniff",
      ETag: object.httpEtag,
    });
    return new Response(request.method === "HEAD" ? null : object.body, { headers });
  }

  if (!url.pathname.startsWith("/documents/")) return null;
  if (!bucket) return new Response("Not Found", { status: 404 });

  let key: string;
  try {
    key = url.pathname.slice(1).split("/").map(decodeURIComponent).join("/");
  } catch {
    return new Response("Not Found", { status: 404 });
  }
  const parts = key.split("/");
  if (
    parts.length !== 3 ||
    parts[0] !== "documents" ||
    !SAFE_ID.test(parts[1]) ||
    !/\.(?:pdf|doc|docx|xls|xlsx)$/i.test(parts[2])
  ) {
    return new Response("Not Found", { status: 404 });
  }

  const object = await bucket.get(key);
  if (!object) return new Response("Not Found", { status: 404 });
  const headers = new Headers({
    "Cache-Control": "private, max-age=3600",
    "Content-Type": object.httpMetadata?.contentType || "application/octet-stream",
    "Content-Disposition": object.httpMetadata?.contentDisposition || attachmentContentDisposition(parts[2]),
    "X-Content-Type-Options": "nosniff",
  });
  headers.set("ETag", object.httpEtag);
  return new Response(request.method === "HEAD" ? null : object.body, { headers });
}
