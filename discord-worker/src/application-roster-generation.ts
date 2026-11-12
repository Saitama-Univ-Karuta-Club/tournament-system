import {
  arrayBufferFromUint8Array,
  ExcelAutoFillError,
  fillExcelApplicationRoster,
  type ExcelAutoFillParticipant,
  type ExcelAutoFillProfile,
} from "./excel-auto-fill";
import type {
  OfficeConversionRequest,
  OfficeConversionResult,
} from "./office-conversion";

const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const XLS_CONTENT_TYPE = "application/vnd.ms-excel";
const SAFE_GROUP_KEY = /^(?:T|TG)-[0-9a-f-]{36}$/i;

export interface ExcelProfileEnv {
  EXCEL_CONTACT_NAME?: string;
  EXCEL_CONTACT_PHONE?: string;
  EXCEL_CONTACT_EMAIL?: string;
  EXCEL_REMITTER_NAME?: string;
  EXCEL_ASSOCIATION_MEMBERSHIP?: string;
}

export interface ApplicationRosterGenerationEnv extends ExcelProfileEnv {
  DB: D1Database;
  DOCUMENTS?: R2Bucket;
  DOCUMENT_PUBLIC_BASE_URL?: string;
  DISCORD_BOT_PUBLIC_URL?: string;
  DOCUMENT_CONVERTER?: {
    convertR2LegacyExcelToXlsx?(
      request: OfficeConversionRequest,
    ): Promise<OfficeConversionResult>;
  };
}

interface ApplicationRosterTournamentRow {
  tournament_id: string;
  group_key: string;
  title: string;
  created_at: string;
  application_method: "excel_email" | "excel_form";
  roster_document_url: string;
  roster_file_name: string;
  roster_content_type: string | null;
}

interface ApplicationRosterParticipantRow {
  member_id: string;
  grade: ExcelAutoFillParticipant["grade"];
  rank: number;
  last_name: string;
  first_name: string;
  last_name_kana: string;
  first_name_kana: string;
  appearance_count: number;
}

export interface ApplicationRosterGenerationResult {
  tournamentId: string;
  groupKey: string;
  url: string;
  fileName: string;
  size: number;
  layoutId: string;
  participantCount: number;
  warnings: string[];
  generated: boolean;
}

export interface DueApplicationRosterGenerationSummary {
  generated: number;
  skipped: number;
  failed: number;
}

export class ApplicationRosterGenerationError extends Error {
  constructor(message: string, public readonly statusCode = 400) {
    super(message);
    this.name = "ApplicationRosterGenerationError";
  }
}

function publicBaseUrl(env: ApplicationRosterGenerationEnv): string {
  const base = env.DOCUMENT_PUBLIC_BASE_URL || env.DISCORD_BOT_PUBLIC_URL;
  if (!base) {
    throw new ApplicationRosterGenerationError("Excel名簿の公開URLが設定されていません。", 500);
  }
  return base.replace(/\/+$/, "");
}

function documentKeyFromUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ApplicationRosterGenerationError("申込名簿の保存先URLが不正です。");
  }
  let path: string;
  try {
    path = url.pathname.slice(1).split("/").map(decodeURIComponent).join("/");
  } catch {
    throw new ApplicationRosterGenerationError("申込名簿の保存先URLが不正です。");
  }
  if (!/^documents\/[0-9a-f-]{36}\/.+\.(?:xls|xlsx)$/i.test(path)) {
    throw new ApplicationRosterGenerationError("申込名簿のR2ファイルを特定できません。");
  }
  return path;
}

function generatedUrl(baseUrl: string, key: string): string {
  return `${baseUrl}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

function generatedFilename(fileName: string): string {
  return fileName.replace(/\.xls$/i, ".xlsx");
}

function jstDateParts(now: Date): { currentDate: string; fiscalStart: string } {
  const currentDate = new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const year = Number(currentDate.slice(0, 4));
  const month = Number(currentDate.slice(5, 7));
  return {
    currentDate,
    fiscalStart: `${month >= 4 ? year : year - 1}-04-01`,
  };
}

function profileFromEnv(env: ExcelProfileEnv): ExcelAutoFillProfile {
  const contactName = env.EXCEL_CONTACT_NAME?.trim() || "石田洋音";
  return {
    clubPrefecture: "埼玉県",
    clubName: "埼玉大学かるた会",
    schoolName: "埼玉大学",
    contactName,
    contactPhone: env.EXCEL_CONTACT_PHONE?.trim() || "",
    contactEmail: env.EXCEL_CONTACT_EMAIL?.trim() || "saitama.iroha@gmail.com",
    remitterName: env.EXCEL_REMITTER_NAME?.trim() || contactName,
    associationMembership: env.EXCEL_ASSOCIATION_MEMBERSHIP?.trim() || "",
  };
}

async function loadTournament(
  db: D1Database,
  tournamentId: string,
): Promise<ApplicationRosterTournamentRow> {
  if (!/^T-[0-9a-f-]{36}$/i.test(tournamentId)) {
    throw new ApplicationRosterGenerationError("大会IDが不正です。");
  }
  const tournament = await db.prepare(
    `SELECT
      tournaments.tournament_id,
      COALESCE(tournaments.registration_group_id, tournaments.tournament_id) AS group_key,
      tournaments.title,
      tournaments.created_at,
      tournament_application_methods.application_method,
      tournament_application_methods.roster_document_url,
      tournament_application_methods.roster_file_name,
      tournament_application_methods.roster_content_type
     FROM tournaments
     INNER JOIN tournament_application_methods
       ON tournament_application_methods.group_key = COALESCE(
         tournaments.registration_group_id,
         tournaments.tournament_id
       )
     WHERE tournaments.tournament_id = ?
       AND tournaments.status <> 'deleted'
       AND tournament_application_methods.application_method IN ('excel_email', 'excel_form')
     LIMIT 1`,
  ).bind(tournamentId).first<ApplicationRosterTournamentRow>();
  if (!tournament?.roster_document_url || !tournament.roster_file_name) {
    throw new ApplicationRosterGenerationError("Excel申込名簿が登録されていません。", 404);
  }
  if (!SAFE_GROUP_KEY.test(tournament.group_key)) {
    throw new ApplicationRosterGenerationError("大会グループIDが不正です。");
  }
  return tournament;
}

async function loadParticipants(
  db: D1Database,
  tournament: ApplicationRosterTournamentRow,
  now: Date,
): Promise<ExcelAutoFillParticipant[]> {
  const { currentDate, fiscalStart } = jstDateParts(now);
  const rows = await db.prepare(
    `SELECT DISTINCT
      members.member_id,
      CASE WHEN response_tournaments.all_grades = 1
        THEN members.grade
        ELSE response_tournaments.grade
      END AS grade,
      members.rank,
      members.last_name,
      members.first_name,
      members.last_name_kana,
      members.first_name_kana,
      (
        SELECT COUNT(DISTINCT COALESCE(
          history_tournaments.registration_group_id,
          history_tournaments.tournament_id
        ))
        FROM tournament_entries AS history_entries
        INNER JOIN tournaments AS history_tournaments
          ON history_tournaments.tournament_id = history_entries.tournament_id
        WHERE history_entries.member_id = members.member_id
          AND history_entries.status = 'selected'
          AND history_tournaments.status NOT IN ('canceled', 'deleted')
          AND history_tournaments.event_start_date BETWEEN ? AND ?
          AND COALESCE(
            history_tournaments.registration_group_id,
            history_tournaments.tournament_id
          ) <> ?
      ) AS appearance_count
     FROM responses
     INNER JOIN members ON members.member_id = responses.member_id
     INNER JOIN tournaments AS response_tournaments
       ON response_tournaments.tournament_id = responses.tournament_id
     WHERE COALESCE(
         response_tournaments.registration_group_id,
         response_tournaments.tournament_id
       ) = ?
       AND responses.response = 'yes'
       AND responses.is_valid = 1
       AND members.status = 'active'
     ORDER BY
       grade,
       members.last_name_kana,
       members.first_name_kana,
       members.last_name,
       members.first_name`,
  ).bind(
    fiscalStart,
    currentDate,
    tournament.group_key,
    tournament.group_key,
  ).all<ApplicationRosterParticipantRow>();
  return rows.results.map((participant) => ({
    memberId: participant.member_id,
    grade: participant.grade,
    rank: Number(participant.rank),
    lastName: participant.last_name,
    firstName: participant.first_name,
    lastNameKana: participant.last_name_kana,
    firstNameKana: participant.first_name_kana,
    appearanceCount: Number(participant.appearance_count),
  }));
}

function decodeMetadataWarnings(value?: string): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function encodeMetadataWarnings(warnings: string[]): string {
  const retained: string[] = [];
  for (const warning of warnings) {
    const candidate = [...retained, warning.slice(0, 300)];
    if (JSON.stringify(candidate).length > 1024) break;
    retained.push(warning.slice(0, 300));
  }
  return JSON.stringify(retained);
}

export async function generateApplicationRoster(
  env: ApplicationRosterGenerationEnv,
  tournamentId: string,
  generatedBy: string,
  options: { skipIfGenerated?: boolean; now?: Date } = {},
): Promise<ApplicationRosterGenerationResult> {
  if (!env.DOCUMENTS) {
    throw new ApplicationRosterGenerationError("Excel名簿の保存先が設定されていません。", 500);
  }
  const tournament = await loadTournament(env.DB, tournamentId);
  let sourceKey = documentKeyFromUrl(tournament.roster_document_url);
  let source = await env.DOCUMENTS.get(sourceKey);
  if (!source) {
    throw new ApplicationRosterGenerationError("Excel申込名簿の原本がR2にありません。", 404);
  }
  const sourceMetadata = source.customMetadata ?? {};
  const fileName = generatedFilename(tournament.roster_file_name);
  if (options.skipIfGenerated && sourceMetadata.autoFillGenerated === "true") {
    return {
      tournamentId: tournament.tournament_id,
      groupKey: tournament.group_key,
      url: tournament.roster_document_url,
      fileName,
      size: Number(source.size),
      layoutId: sourceMetadata.autoFillLayout || "unknown",
      participantCount: Number(sourceMetadata.autoFillParticipants || 0),
      warnings: decodeMetadataWarnings(sourceMetadata.autoFillWarnings),
      generated: false,
    };
  }
  if (sourceMetadata.autoFillGenerated === "true" && sourceMetadata.sourceTemplateKey) {
    sourceKey = sourceMetadata.sourceTemplateKey;
    const originalSource = await env.DOCUMENTS.get(sourceKey);
    if (!originalSource) {
      throw new ApplicationRosterGenerationError("再生成に必要なExcel申込名簿の原本がR2にありません。", 404);
    }
    source = originalSource;
  }

  const originalSourceName = sourceMetadata.sourceTemplateName ||
    sourceMetadata.originalName ||
    tournament.roster_file_name;
  const isLegacyXls = originalSourceName.toLowerCase().endsWith(".xls") ||
    tournament.roster_content_type === XLS_CONTENT_TYPE;
  let templateBytes: Uint8Array;
  let convertedKey: string | null = null;
  if (isLegacyXls) {
    const converter = env.DOCUMENT_CONVERTER?.convertR2LegacyExcelToXlsx;
    if (!converter) {
      throw new ApplicationRosterGenerationError("旧式.xlsを.xlsxへ変換するサービスが設定されていません。", 500);
    }
    convertedKey = `temporary/excel-auto-fill/${crypto.randomUUID()}/template.xlsx`;
    await converter({
      sourceKey,
      targetKey: convertedKey,
      sourceContentType: XLS_CONTENT_TYPE,
      sourceFileName: originalSourceName,
      targetFileName: fileName,
    });
    const converted = await env.DOCUMENTS.get(convertedKey);
    if (!converted) {
      throw new ApplicationRosterGenerationError(".xls変換後の.xlsxファイルを取得できません。", 500);
    }
    templateBytes = new Uint8Array(await converted.arrayBuffer());
  } else {
    templateBytes = new Uint8Array(await source.arrayBuffer());
  }

  try {
    const participants = await loadParticipants(env.DB, tournament, options.now ?? new Date());
    if (participants.length === 0) {
      throw new ApplicationRosterGenerationError("参加希望者がいないため、申込名簿は生成しません。");
    }
    let filled;
    try {
      filled = fillExcelApplicationRoster({
        template: templateBytes,
        sourceFileName: originalSourceName,
        sourceWorkbookType: isLegacyXls ? "xls" : "xlsx",
        profile: profileFromEnv(env),
        participants,
      });
    } catch (error: unknown) {
      if (error instanceof ExcelAutoFillError) {
        throw new ApplicationRosterGenerationError(error.message);
      }
      throw error;
    }
    const key = `documents/${crypto.randomUUID()}/${fileName}`;
    const warningsJson = encodeMetadataWarnings(filled.warnings);
    await env.DOCUMENTS.put(key, arrayBufferFromUint8Array(filled.bytes), {
      httpMetadata: {
        contentType: XLSX_CONTENT_TYPE,
        contentDisposition: `attachment; filename="application-roster.xlsx"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      },
      customMetadata: {
        uploadedBy: generatedBy.slice(0, 320),
        originalName: fileName.slice(0, 500),
        sourceTemplateName: originalSourceName.slice(0, 500),
        sourceTemplateKey: sourceKey.slice(0, 500),
        autoFillGenerated: "true",
        autoFillLayout: filled.layoutId,
        autoFillParticipants: String(filled.participantCount),
        autoFillWarnings: warningsJson,
      },
    });
    const url = generatedUrl(publicBaseUrl(env), key);
    await env.DB.prepare(
      `UPDATE tournament_application_methods
       SET roster_document_url = ?, roster_file_name = ?, roster_file_size = ?,
         roster_content_type = ?, updated_at = ?
       WHERE group_key = ?`,
    ).bind(
      url,
      fileName,
      filled.bytes.byteLength,
      XLSX_CONTENT_TYPE,
      (options.now ?? new Date()).toISOString(),
      tournament.group_key,
    ).run();
    return {
      tournamentId: tournament.tournament_id,
      groupKey: tournament.group_key,
      url,
      fileName,
      size: filled.bytes.byteLength,
      layoutId: filled.layoutId,
      participantCount: filled.participantCount,
      warnings: filled.warnings,
      generated: true,
    };
  } finally {
    if (convertedKey) await env.DOCUMENTS.delete(convertedKey);
  }
}

export async function generateDueApplicationRosters(
  env: ApplicationRosterGenerationEnv,
  now = new Date(),
): Promise<DueApplicationRosterGenerationSummary> {
  if (!env.DOCUMENTS || !(env.DOCUMENT_PUBLIC_BASE_URL || env.DISCORD_BOT_PUBLIC_URL)) {
    return { generated: 0, skipped: 0, failed: 0 };
  }
  const due = await env.DB.prepare(
    `SELECT tournaments.tournament_id
     FROM tournaments
     INNER JOIN tournament_application_methods
       ON tournament_application_methods.group_key = COALESCE(
         tournaments.registration_group_id,
         tournaments.tournament_id
       )
     WHERE tournaments.status = 'active'
       AND tournaments.workflow_stage IN ('registration_open', 'application_pending')
       AND tournaments.internal_deadline <= ?
       AND tournament_application_methods.application_method IN ('excel_email', 'excel_form')
       AND tournaments.tournament_id = (
         SELECT MIN(group_tournaments.tournament_id)
         FROM tournaments AS group_tournaments
         WHERE COALESCE(
             group_tournaments.registration_group_id,
             group_tournaments.tournament_id
           ) = COALESCE(
             tournaments.registration_group_id,
             tournaments.tournament_id
           )
           AND group_tournaments.status <> 'deleted'
       )
       AND EXISTS (
         SELECT 1
         FROM responses
         INNER JOIN tournaments AS response_tournaments
           ON response_tournaments.tournament_id = responses.tournament_id
         WHERE COALESCE(
             response_tournaments.registration_group_id,
             response_tournaments.tournament_id
           ) = COALESCE(
             tournaments.registration_group_id,
             tournaments.tournament_id
           )
           AND responses.response = 'yes'
           AND responses.is_valid = 1
       )
     ORDER BY tournaments.internal_deadline
     LIMIT 10`,
  ).bind(now.toISOString()).all<{ tournament_id: string }>();
  const summary: DueApplicationRosterGenerationSummary = { generated: 0, skipped: 0, failed: 0 };
  for (const row of due.results) {
    try {
      const result = await generateApplicationRoster(
        env,
        row.tournament_id,
        "system:internal-deadline",
        { skipIfGenerated: true, now },
      );
      if (result.generated) {
        summary.generated += 1;
        if (result.warnings.length > 0) {
          console.warn(
            `申込名簿を生成しましたが手動確認が必要です: ${row.tournament_id}`,
            result.warnings,
          );
        }
      } else summary.skipped += 1;
    } catch (error: unknown) {
      summary.failed += 1;
      console.error(`申込名簿の自動生成に失敗しました: ${row.tournament_id}`, error);
    }
  }
  return summary;
}
