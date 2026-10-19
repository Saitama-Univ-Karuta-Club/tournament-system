import { formatGrade } from "./members";

export const MAX_PDF_BYTES = 20 * 1024 * 1024;

const SAFE_ID = /^[0-9a-f-]{36}$/i;
const VALID_GRADE = new Set(["A", "B", "C", "D", "E", "F", "beginner", "all"]);

export interface DocumentEnv {
  DOCUMENTS?: R2Bucket;
  DOCUMENT_PUBLIC_BASE_URL?: string;
}

export type ArchiveDocumentType = "roster" | "results";

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

function contentDisposition(filename: string): string {
  return `inline; filename="tournament.pdf"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function uploadTournamentDocument(
  request: Request,
  env: DocumentEnv,
  uploadedBy: string,
): Promise<{ url: string; fileName: string; size: number }> {
  if (!env.DOCUMENTS || !env.DOCUMENT_PUBLIC_BASE_URL) {
    throw new DocumentUploadError("PDF保存先が設定されていません。");
  }
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new DocumentUploadError("PDFファイルを選択してください。");
  if (file.size === 0) throw new DocumentUploadError("PDFファイルが空です。");
  if (file.size > MAX_PDF_BYTES) throw new DocumentUploadError("PDFは20MB以下にしてください。");

  let grades: string[];
  let eventDates: string[];
  try {
    grades = normalizeUploadGrades(JSON.parse(String(form.get("grades") ?? "")));
    eventDates = normalizeUploadDates(JSON.parse(String(form.get("eventDates") ?? "")));
  } catch (error) {
    if (error instanceof SyntaxError) throw new DocumentUploadError("PDFの付随情報が不正です。");
    throw error;
  }
  const title = String(form.get("title") ?? "").trim();
  if (!title || title.length > 100) throw new DocumentUploadError("大会名を確認してください。");

  const fileName = buildPdfFilename(title, grades, eventDates);
  return storeTournamentPdf(file, env, uploadedBy, fileName);
}

export async function storeTournamentPdf(
  file: File,
  env: DocumentEnv,
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

export async function serveTournamentDocument(
  request: Request,
  bucket: R2Bucket | undefined,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (request.method !== "GET" || !url.pathname.startsWith("/documents/")) return null;
  if (!bucket) return new Response("Not Found", { status: 404 });

  let key: string;
  try {
    key = url.pathname.slice(1).split("/").map(decodeURIComponent).join("/");
  } catch {
    return new Response("Not Found", { status: 404 });
  }
  const parts = key.split("/");
  if (parts.length !== 3 || parts[0] !== "documents" || !SAFE_ID.test(parts[1]) || !parts[2].endsWith(".pdf")) {
    return new Response("Not Found", { status: 404 });
  }

  const object = await bucket.get(key);
  if (!object) return new Response("Not Found", { status: 404 });
  const headers = new Headers({
    "Cache-Control": "private, max-age=3600",
    "Content-Type": object.httpMetadata?.contentType || "application/pdf",
    "Content-Disposition": object.httpMetadata?.contentDisposition || contentDisposition(parts[2]),
    "X-Content-Type-Options": "nosniff",
  });
  headers.set("ETag", object.httpEtag);
  return new Response(object.body, { headers });
}
