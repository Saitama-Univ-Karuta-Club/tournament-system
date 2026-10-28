import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import mappingDocument from "../../docs/excel-auto-fill-input-mappings.json";

export type ExcelParticipantGrade = "A" | "B" | "C" | "D" | "E" | "F" | "beginner";

export interface ExcelAutoFillParticipant {
  memberId?: string;
  grade: ExcelParticipantGrade;
  rank: number;
  lastName: string;
  firstName: string;
  lastNameKana: string;
  firstNameKana: string;
  appearanceCount: number;
  notes?: string;
}

export interface ExcelAutoFillProfile {
  clubPrefecture: string;
  clubName: string;
  schoolName: string;
  contactName: string;
  contactPhone?: string;
  contactEmail: string;
  remitterName?: string;
  associationMembership?: string;
}

export interface ExcelAutoFillInput {
  template: Uint8Array;
  sourceFileName: string;
  profile: ExcelAutoFillProfile;
  participants: ExcelAutoFillParticipant[];
  /** .xls を .xlsx へ変換したテンプレートの場合に指定する。 */
  sourceWorkbookType?: "xlsx" | "xls";
}

export interface ExcelAutoFillResult {
  bytes: Uint8Array;
  layoutId: string;
  participantCount: number;
  warnings: string[];
}

interface CellField {
  field: string;
  transform?: string;
}

interface ParticipantBlock {
  rows: string;
  capacity: number;
  columns: Record<string, CellField>;
  manual_columns?: Record<string, string>;
  preserve_columns?: string[];
}

interface SheetMapping {
  name?: string;
  names?: string[];
  grade_from_sheet_name?: boolean;
  protected?: boolean;
  static_cells: Record<string, string | CellField>;
  manual_cells?: Record<string, string>;
  participant_blocks: ParticipantBlock[];
}

interface LayoutMapping {
  id: string;
  status: string;
  sample_files: string[];
  match: {
    workbook_type?: "xls";
    sheet_name?: string;
    sheet_names?: string[];
    anchors: Record<string, string>;
  };
  sheets: SheetMapping[];
  sample_overrides?: Record<string, {
    do_not_write?: string[];
    manual_cells?: string[];
    reason?: string;
  }>;
}

interface InputMappingDocument {
  version: number;
  layouts: LayoutMapping[];
}

interface WorkbookParts {
  files: Record<string, Uint8Array>;
  workbookPath: string;
  workbookXml: string;
  workbookRelsPath: string;
  workbookRelsXml: string;
  sharedStrings: string[];
  sheets: Map<string, { path: string; xml: string }>;
}

const mappings = mappingDocument as unknown as InputMappingDocument;
const gradeOrder: Record<ExcelParticipantGrade, number> = {
  A: 0,
  B: 1,
  C: 2,
  D: 3,
  E: 4,
  F: 5,
  beginner: 6,
};
const decoder = new TextDecoder();
const encoder = new TextEncoder();

export class ExcelAutoFillError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "invalid_workbook"
      | "unsupported_layout"
      | "participant_overflow"
      | "unsafe_template"
      | "verification_failed",
  ) {
    super(message);
    this.name = "ExcelAutoFillError";
  }
}

function xmlDecode(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_match, decimal: string) => String.fromCodePoint(Number(decimal)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function parseAttributes(value: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of value.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    attributes[match[1]] = xmlDecode(match[2] ?? match[3] ?? "");
  }
  return attributes;
}

function normalizePartPath(basePath: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = basePath.split("/");
  parts.pop();
  for (const segment of target.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") parts.pop();
    else parts.push(segment);
  }
  return parts.join("/");
}

function relationshipPath(partPath: string): string {
  const slash = partPath.lastIndexOf("/");
  const directory = slash >= 0 ? partPath.slice(0, slash + 1) : "";
  const fileName = partPath.slice(slash + 1);
  return `${directory}_rels/${fileName}.rels`;
}

function relationshipTargets(xml: string): Map<string, string> {
  const targets = new Map<string, string>();
  for (const match of xml.matchAll(/<Relationship\b([^>]*)\/?\s*>/g)) {
    const attributes = parseAttributes(match[1]);
    if (attributes.Id && attributes.Target) targets.set(attributes.Id, attributes.Target);
  }
  return targets;
}

function extractTextNodes(xml: string): string {
  const withoutPhonetics = xml
    .replace(/<rPh\b[^>]*>[\s\S]*?<\/rPh>/g, "")
    .replace(/<phoneticPr\b[^>]*\/?\s*>/g, "");
  return [...withoutPhonetics.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
    .map((match) => xmlDecode(match[1]))
    .join("");
}

function parseSharedStrings(files: Record<string, Uint8Array>): string[] {
  const bytes = files["xl/sharedStrings.xml"];
  if (!bytes) return [];
  const xml = strFromU8(bytes);
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)]
    .map((match) => extractTextNodes(match[1]));
}

function parseWorkbook(template: Uint8Array): WorkbookParts {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(template);
  } catch {
    throw new ExcelAutoFillError(
      "Excelファイルを開けません。.xlsx形式を確認してください。",
      "invalid_workbook",
    );
  }
  const rootRelsBytes = files["_rels/.rels"];
  if (!rootRelsBytes) {
    throw new ExcelAutoFillError("Excelファイルの構造が不正です。", "invalid_workbook");
  }
  const officeRelationship = [...strFromU8(rootRelsBytes).matchAll(/<Relationship\b([^>]*)\/?\s*>/g)]
    .map((match) => parseAttributes(match[1]))
    .find((attributes) => attributes.Type?.endsWith("/officeDocument"));
  const workbookPath = officeRelationship?.Target
    ? normalizePartPath("", officeRelationship.Target)
    : "xl/workbook.xml";
  const workbookBytes = files[workbookPath];
  if (!workbookBytes) {
    throw new ExcelAutoFillError("Excelファイルのブック情報がありません。", "invalid_workbook");
  }
  const workbookXml = strFromU8(workbookBytes);
  const workbookRelsPath = relationshipPath(workbookPath);
  const workbookRelsBytes = files[workbookRelsPath];
  if (!workbookRelsBytes) {
    throw new ExcelAutoFillError("Excelファイルのシート情報がありません。", "invalid_workbook");
  }
  const workbookRelsXml = strFromU8(workbookRelsBytes);
  const targets = relationshipTargets(workbookRelsXml);
  const sheets = new Map<string, { path: string; xml: string }>();
  for (const match of workbookXml.matchAll(/<sheet\b([^>]*)\/?\s*>/g)) {
    const attributes = parseAttributes(match[1]);
    const relationshipId = attributes["r:id"];
    const target = relationshipId ? targets.get(relationshipId) : undefined;
    if (!attributes.name || !target) continue;
    const path = normalizePartPath(workbookPath, target);
    if (!files[path]) continue;
    sheets.set(attributes.name, { path, xml: strFromU8(files[path]) });
  }
  if (sheets.size === 0) {
    throw new ExcelAutoFillError("Excelファイルに読み取れるシートがありません。", "invalid_workbook");
  }
  return {
    files,
    workbookPath,
    workbookXml,
    workbookRelsPath,
    workbookRelsXml,
    sharedStrings: parseSharedStrings(files),
    sheets,
  };
}

function cellPattern(reference: string): RegExp {
  return new RegExp(
    `<c\\b(?=[^>]*\\br=(?:"${reference}"|'${reference}'))[^>]*?(?:\\/>|>[\\s\\S]*?<\\/c>)`,
  );
}

function cellXml(sheetXml: string, reference: string): string | null {
  return sheetXml.match(cellPattern(reference))?.[0] ?? null;
}

function readCell(sheetXml: string, reference: string, sharedStrings: string[]): string {
  const xml = cellXml(sheetXml, reference);
  if (!xml) return "";
  const opening = xml.match(/^<c\b([^>]*)/)?.[1] ?? "";
  const attributes = parseAttributes(opening);
  if (attributes.t === "inlineStr") return extractTextNodes(xml);
  const raw = xml.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1] ?? "";
  if (attributes.t === "s") return sharedStrings[Number(raw)] ?? "";
  if (attributes.t === "str") return xmlDecode(raw);
  return xmlDecode(raw);
}

function normalizedAnchor(value: string): string {
  return value.normalize("NFKC").replace(/[\s\u3000]+/g, "");
}

function layoutMatches(
  workbook: WorkbookParts,
  layout: LayoutMapping,
  sourceWorkbookType: "xlsx" | "xls",
): boolean {
  if ((layout.match.workbook_type ?? "xlsx") !== sourceWorkbookType) return false;
  const sheetNames = layout.match.sheet_names ?? (layout.match.sheet_name ? [layout.match.sheet_name] : []);
  if (sheetNames.length === 0 || sheetNames.some((name) => !workbook.sheets.has(name))) return false;
  return sheetNames.every((sheetName) => {
    const sheet = workbook.sheets.get(sheetName)!;
    return Object.entries(layout.match.anchors).every(([reference, expected]) =>
      normalizedAnchor(readCell(sheet.xml, reference, workbook.sharedStrings))
        .includes(normalizedAnchor(expected))
    );
  });
}

function selectLayout(
  matches: LayoutMapping[],
  sourceFileName?: string,
): LayoutMapping | null {
  if (sourceFileName) {
    const filenameMatches = matches.filter((layout) => layout.sample_files.includes(sourceFileName));
    if (filenameMatches.length === 1) return filenameMatches[0];
  }
  return matches.length === 1 ? matches[0] : null;
}

export function detectExcelLayout(
  template: Uint8Array,
  sourceWorkbookType: "xlsx" | "xls" = "xlsx",
  sourceFileName?: string,
): string {
  const workbook = parseWorkbook(template);
  const matches = mappings.layouts.filter((layout) =>
    layout.status.startsWith("mapped") && layoutMatches(workbook, layout, sourceWorkbookType)
  );
  const selected = selectLayout(matches, sourceFileName);
  if (!selected) {
    throw new ExcelAutoFillError(
      matches.length === 0
        ? "未対応の申込名簿形式です。自動入力せず、開発者にマッピング追加を依頼してください。"
        : "申込名簿の形式を1つに特定できませんでした。",
      "unsupported_layout",
    );
  }
  return selected.id;
}

function rangeContainsReference(range: string, reference: string): boolean {
  const rangeMatch = range.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
  const referenceMatch = reference.match(/^([A-Z]+)(\d+)$/);
  if (!rangeMatch || !referenceMatch) return false;
  const columnNumber = (column: string) => [...column].reduce(
    (total, character) => total * 26 + character.charCodeAt(0) - 64,
    0,
  );
  const column = columnNumber(referenceMatch[1]);
  const row = Number(referenceMatch[2]);
  return column >= columnNumber(rangeMatch[1]) &&
    column <= columnNumber(rangeMatch[3]) &&
    row >= Number(rangeMatch[2]) &&
    row <= Number(rangeMatch[4]);
}

function withoutTypeAttribute(opening: string): string {
  return opening.replace(/\s+t\s*=\s*(?:"[^"]*"|'[^']*')/g, "");
}

function cellCoordinates(reference: string): { column: number; row: number } | null {
  const match = reference.match(/^([A-Z]+)(\d+)$/);
  if (!match) return null;
  return {
    column: [...match[1]].reduce(
      (total, character) => total * 26 + character.charCodeAt(0) - 64,
      0,
    ),
    row: Number(match[2]),
  };
}

function mergedRangeContaining(sheetXml: string, reference: string): string | null {
  const target = cellCoordinates(reference);
  if (!target) return null;
  for (const match of sheetXml.matchAll(/<mergeCell\b[^>]*\bref=(?:"([A-Z]+\d+:[A-Z]+\d+)"|'([A-Z]+\d+:[A-Z]+\d+)')[^>]*\/?\s*>/g)) {
    const range = match[1] ?? match[2];
    if (rangeContainsReference(range, reference)) return range;
  }
  return null;
}

function ensureCellExists(sheetXml: string, reference: string): string {
  if (cellXml(sheetXml, reference)) return sheetXml;
  const mergedRange = mergedRangeContaining(sheetXml, reference);
  if (mergedRange && !mergedRange.startsWith(`${reference}:`)) {
    throw new ExcelAutoFillError(
      `結合セルの左上以外への書き込みを中止しました: ${reference}`,
      "unsafe_template",
    );
  }
  const target = cellCoordinates(reference);
  if (!target) {
    throw new ExcelAutoFillError(`セル参照が不正です: ${reference}`, "unsafe_template");
  }
  const rowPattern = new RegExp(`<row\\b(?=[^>]*\\br=(?:"${target.row}"|'${target.row}'))[^>]*>[\\s\\S]*?<\\/row>`);
  const rowXml = sheetXml.match(rowPattern)?.[0];
  if (!rowXml) {
    throw new ExcelAutoFillError(
      `安全に書き込めない行です: ${reference}`,
      "unsafe_template",
    );
  }
  const cells = [...rowXml.matchAll(/<c\b[^>]*\br=(?:"([A-Z]+\d+)"|'([A-Z]+\d+)')[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g)]
    .map((match) => {
      const cellReference = match[1] ?? match[2];
      const coordinates = cellCoordinates(cellReference)!;
      const style = parseAttributes(match[0].match(/^<c\b([^>]*)/)?.[1] ?? "").s;
      return { xml: match[0], reference: cellReference, column: coordinates.column, style };
    });
  const nearest = [...cells].sort((left, right) =>
    Math.abs(left.column - target.column) - Math.abs(right.column - target.column)
  )[0];
  const newCell = `<c r="${reference}"${nearest?.style ? ` s="${xmlEscape(nearest.style)}"` : ""}/>`;
  const nextCell = cells.find((cell) => cell.column > target.column);
  const nextRowXml = nextCell
    ? rowXml.replace(nextCell.xml, `${newCell}${nextCell.xml}`)
    : rowXml.replace(/<\/row>$/, `${newCell}</row>`);
  return sheetXml.replace(rowPattern, nextRowXml);
}

function writeCell(
  sheetXml: string,
  reference: string,
  value: string | number | null,
): string {
  sheetXml = ensureCellExists(sheetXml, reference);
  const pattern = cellPattern(reference);
  const existing = sheetXml.match(pattern)?.[0];
  if (!existing) {
    throw new ExcelAutoFillError(
      `安全に書き込めないセルがあります: ${reference}`,
      "unsafe_template",
    );
  }
  if (/<f\b/.test(existing)) {
    throw new ExcelAutoFillError(
      `数式セルへの書き込みを中止しました: ${reference}`,
      "unsafe_template",
    );
  }
  const opening = existing.match(/^<c\b[^>]*>/)?.[0] ?? existing.match(/^<c\b[^>]*\/>/)?.[0];
  if (!opening) {
    throw new ExcelAutoFillError(`セルを更新できません: ${reference}`, "unsafe_template");
  }
  let next: string;
  if (value === null || value === "") {
    next = withoutTypeAttribute(opening.replace(/\/>$/, ">")).replace(/>$/, "/>");
  } else if (typeof value === "number") {
    next = `${withoutTypeAttribute(opening.replace(/\/>$/, ">"))}<v>${value}</v></c>`;
  } else {
    const typedOpening = `${withoutTypeAttribute(opening.replace(/\/>$/, ">"))
      .replace(/>$/, ' t="inlineStr">')}`;
    next = `${typedOpening}<is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
  }
  return sheetXml.replace(pattern, next);
}

function staticValue(profile: ExcelAutoFillProfile, field: string): string {
  const values: Record<string, string | undefined> = {
    club_prefecture: profile.clubPrefecture,
    club_name: profile.clubName,
    school_name: profile.schoolName,
    club_or_school_name: profile.schoolName || profile.clubName,
    contact_name: profile.contactName,
    contact_phone: profile.contactPhone,
    contact_email: profile.contactEmail,
    remitter_name: profile.remitterName,
    remitter_name_if_present: profile.remitterName,
    association_membership: profile.associationMembership,
  };
  return values[field]?.trim() ?? "";
}

function rankKanji(rank: number): string {
  return ["無", "初", "弐", "参", "四", "五", "六", "七", "八", "九", "十"][rank] ?? "";
}

function rankJapanese(rank: number): string {
  return ["無段", "初段", "二段", "三段", "四段", "五段", "六段", "七段", "八段", "九段", "十段"][rank] ?? "";
}

function participantValue(
  participant: ExcelAutoFillParticipant,
  profile: ExcelAutoFillProfile,
  field: string,
): string | number {
  const values: Record<string, string | number | undefined> = {
    participant_grade: participant.grade,
    participant_rank: participant.rank,
    participant_last_name: participant.lastName,
    participant_first_name: participant.firstName,
    participant_last_name_kana: participant.lastNameKana,
    participant_first_name_kana: participant.firstNameKana,
    participant_full_name: `${participant.lastName}\u0000${participant.firstName}`,
    participant_full_name_kana: `${participant.lastNameKana}\u0000${participant.firstNameKana}`,
    participant_appearance_count: participant.appearanceCount,
    participant_notes: participant.notes ?? "",
    club_name: profile.clubName,
    school_name: profile.schoolName,
    club_or_school_name: profile.schoolName || profile.clubName,
    club_prefecture: profile.clubPrefecture,
  };
  return values[field] ?? "";
}

function applyTransform(
  value: string | number,
  transform: string | undefined,
  layoutId: string,
): string | number {
  if (!transform) return value;
  if (transform === "grade_with_suffix") {
    return value === "beginner" ? "初心者" : `${value}級`;
  }
  if (transform === "grade_without_suffix") {
    return value === "beginner" ? "初心者" : String(value);
  }
  if (transform === "grade_template_specific") {
    return value === "beginner" ? "初心者" : `${value}級`;
  }
  const rank = typeof value === "number" ? value : Number(value);
  if (transform === "rank_to_arabic_dan") return rank === 0 ? "" : rank === 1 ? "初段" : `${rank}段`;
  if (transform === "rank_to_arabic_dan_allow_unranked") {
    return rank === 0 ? "無段" : rank === 1 ? "初段" : `${rank}段`;
  }
  if (transform === "rank_to_kanji_short") return rankKanji(rank);
  if (transform === "rank_to_kanji_dan_allow_unranked") {
    return rank === 0 ? "無段" : `${rankKanji(rank)}段`;
  }
  if (transform === "rank_without_suffix") return rankKanji(rank);
  if (transform === "rank_template_specific") {
    if (layoutId === "hogyoku_grade_sheets_30") return rankJapanese(rank);
    if (layoutId === "hiroshima_de_60") return rank === 0 ? "無段" : rankJapanese(rank);
    return rankJapanese(rank);
  }
  if (transform === "join_full_width_space") return String(value).replace("\u0000", "　");
  if (transform === "join_half_width_space") return String(value).replace("\u0000", " ");
  if (transform === "join_no_space") return String(value).replace("\u0000", "");
  if (transform === "membership_to_template_choice") {
    const normalized = String(value).normalize("NFKC").toLowerCase();
    if (!normalized) return "";
    return /^(?:1|yes|true|加入|加盟|会員|あり)$/.test(normalized) ? "あり" : "なし";
  }
  return value;
}

function rowsIn(block: ParticipantBlock): number[] {
  const match = block.rows.match(/^(\d+):(\d+)$/);
  if (!match) {
    throw new ExcelAutoFillError(`入力行定義が不正です: ${block.rows}`, "unsafe_template");
  }
  const first = Number(match[1]);
  const last = Number(match[2]);
  return Array.from({ length: last - first + 1 }, (_unused, index) => first + index);
}

function gradeFromSheetName(sheetName: string): ExcelParticipantGrade | null {
  const match = sheetName.match(/^([A-F])級/);
  return match ? match[1] as ExcelParticipantGrade : null;
}

function sortedParticipants(participants: ExcelAutoFillParticipant[]): ExcelAutoFillParticipant[] {
  return [...participants].sort((left, right) =>
    gradeOrder[left.grade] - gradeOrder[right.grade] ||
    `${left.lastNameKana}${left.firstNameKana}`.localeCompare(
      `${right.lastNameKana}${right.firstNameKana}`,
      "ja",
    ) ||
    `${left.lastName}${left.firstName}`.localeCompare(`${right.lastName}${right.firstName}`, "ja")
  );
}

function formulaSnapshot(xml: string): string[] {
  return [...xml.matchAll(/<f\b[^>]*\/>|<f\b[^>]*>[\s\S]*?<\/f>/g)].map((match) => match[0]);
}

function markWorkbookForRecalculation(workbookXml: string): string {
  const calcPr = workbookXml.match(/<calcPr\b[^>]*\/?\s*>/);
  if (calcPr) {
    let replacement = calcPr[0]
      .replace(/\s+(?:calcMode|fullCalcOnLoad|forceFullCalc)\s*=\s*(?:"[^"]*"|'[^']*')/g, "")
      .replace(/\/>$/, ">");
    replacement = replacement.replace(/>$/, ' calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/>');
    return workbookXml.replace(calcPr[0], replacement);
  }
  return workbookXml.replace(
    /<\/workbook>/,
    '<calcPr calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/></workbook>',
  );
}

export function fillExcelApplicationRoster(input: ExcelAutoFillInput): ExcelAutoFillResult {
  const sourceWorkbookType = input.sourceWorkbookType ??
    (input.sourceFileName.toLowerCase().endsWith(".xls") ? "xls" : "xlsx");
  const workbook = parseWorkbook(input.template);
  const matchingLayouts = mappings.layouts.filter((layout) =>
    layout.status.startsWith("mapped") && layoutMatches(workbook, layout, sourceWorkbookType)
  );
  const layout = selectLayout(matchingLayouts, input.sourceFileName);
  if (!layout) {
    throw new ExcelAutoFillError(
      matchingLayouts.length === 0
        ? "未対応の申込名簿形式です。ファイルは変更していません。"
        : "申込名簿の形式を1つに特定できませんでした。",
      "unsupported_layout",
    );
  }
  const participants = sortedParticipants(input.participants);
  const warnings = new Set<string>();
  const expectedCells: Array<{
    sheetName: string;
    reference: string;
    value: string;
  }> = [];
  const expectedFormulas = new Map<string, string[]>();
  const override = layout.sample_overrides?.[input.sourceFileName];
  if (override?.reason) warnings.add(override.reason);
  const doNotWrite = override?.do_not_write ?? [];
  for (const cell of override?.manual_cells ?? []) warnings.add(`手動確認が必要です: ${cell}`);

  for (const sheetMapping of layout.sheets) {
    const sheetNames = sheetMapping.names ?? (sheetMapping.name ? [sheetMapping.name] : []);
    for (const sheetName of sheetNames) {
      const sheet = workbook.sheets.get(sheetName);
      if (!sheet) {
        throw new ExcelAutoFillError(`必要なシートがありません: ${sheetName}`, "unsafe_template");
      }
      const originalFormulas = formulaSnapshot(sheet.xml);
      expectedFormulas.set(sheetName, originalFormulas);
      let nextXml = sheet.xml;
      for (const [reference, definition] of Object.entries(sheetMapping.static_cells)) {
        if (doNotWrite.some((range) => rangeContainsReference(range, reference))) continue;
        const field = typeof definition === "string" ? definition : definition.field;
        const transform = typeof definition === "string" ? undefined : definition.transform;
        const rawValue = staticValue(input.profile, field);
        if (!rawValue) {
          if (!field.endsWith("_if_present")) warnings.add(`自動入力値が未設定です: ${field}`);
          continue;
        }
        const value = applyTransform(rawValue, transform, layout.id);
        nextXml = writeCell(nextXml, reference, value);
        expectedCells.push({ sheetName, reference, value: String(value) });
      }
      for (const [reference, label] of Object.entries(sheetMapping.manual_cells ?? {})) {
        warnings.add(`手動入力が必要です: ${label}（${sheetName}!${reference}）`);
      }

      const eligibleParticipants = sheetMapping.grade_from_sheet_name
        ? participants.filter((participant) => participant.grade === gradeFromSheetName(sheetName))
        : participants;
      const totalCapacity = sheetMapping.participant_blocks.reduce(
        (total, block) => total + block.capacity,
        0,
      );
      if (eligibleParticipants.length > totalCapacity) {
        throw new ExcelAutoFillError(
          `${sheetName}の入力上限${totalCapacity}名を超えています（${eligibleParticipants.length}名）。`,
          "participant_overflow",
        );
      }
      let participantIndex = 0;
      for (const block of sheetMapping.participant_blocks) {
        for (const [column, label] of Object.entries(block.manual_columns ?? {})) {
          warnings.add(`手動入力が必要です: ${label}（${sheetName}!${column}列）`);
        }
        for (const row of rowsIn(block)) {
          const participant = eligibleParticipants[participantIndex] ?? null;
          for (const [column, definition] of Object.entries(block.columns)) {
            const reference = `${column}${row}`;
            if (doNotWrite.some((range) => rangeContainsReference(range, reference))) continue;
            const value = participant
              ? applyTransform(
                participantValue(participant, input.profile, definition.field),
                definition.transform,
                layout.id,
              )
              : null;
            nextXml = writeCell(nextXml, reference, value);
            expectedCells.push({
              sheetName,
              reference,
              value: value === null ? "" : String(value),
            });
          }
          if (participant) participantIndex += 1;
        }
      }
      if (participantIndex !== eligibleParticipants.length) {
        throw new ExcelAutoFillError("参加者全員を名簿に入力できませんでした。", "verification_failed");
      }
      const nextFormulas = formulaSnapshot(nextXml);
      if (JSON.stringify(nextFormulas) !== JSON.stringify(originalFormulas)) {
        const changedIndex = originalFormulas.findIndex((formula, index) => formula !== nextFormulas[index]);
        throw new ExcelAutoFillError(
          `名簿の数式保持に失敗したため、生成を中止しました（${originalFormulas.length}→${nextFormulas.length}、確認位置${changedIndex}）。`,
          "verification_failed",
        );
      }
      sheet.xml = nextXml;
      workbook.files[sheet.path] = strToU8(nextXml);
    }
  }

  workbook.workbookXml = markWorkbookForRecalculation(workbook.workbookXml);
  workbook.files[workbook.workbookPath] = strToU8(workbook.workbookXml);
  const bytes = zipSync(workbook.files, { level: 6 });
  const verificationWorkbook = parseWorkbook(bytes);
  if (!layoutMatches(verificationWorkbook, layout, sourceWorkbookType)) {
    throw new ExcelAutoFillError("生成後のExcelファイル検証に失敗しました。", "verification_failed");
  }
  for (const expected of expectedCells) {
    const sheet = verificationWorkbook.sheets.get(expected.sheetName);
    const actual = sheet
      ? readCell(sheet.xml, expected.reference, verificationWorkbook.sharedStrings)
      : "";
    if (actual !== expected.value) {
      throw new ExcelAutoFillError(
        `生成後のセル値を確認できませんでした: ${expected.sheetName}!${expected.reference}`,
        "verification_failed",
      );
    }
  }
  for (const [sheetName, formulas] of expectedFormulas) {
    const sheet = verificationWorkbook.sheets.get(sheetName);
    if (!sheet || JSON.stringify(formulaSnapshot(sheet.xml)) !== JSON.stringify(formulas)) {
      throw new ExcelAutoFillError(
        `生成後の数式保持を確認できませんでした: ${sheetName}`,
        "verification_failed",
      );
    }
  }
  return {
    bytes,
    layoutId: layout.id,
    participantCount: participants.length,
    warnings: [...warnings],
  };
}

/** テストと開発時の生成後検証用。 */
export function readExcelCell(
  workbookBytes: Uint8Array,
  sheetName: string,
  reference: string,
): string {
  const workbook = parseWorkbook(workbookBytes);
  const sheet = workbook.sheets.get(sheetName);
  if (!sheet) throw new ExcelAutoFillError(`シートがありません: ${sheetName}`, "invalid_workbook");
  return readCell(sheet.xml, reference, workbook.sharedStrings);
}

export function inspectExcelCellXml(
  workbookBytes: Uint8Array,
  sheetName: string,
  reference: string,
): string | null {
  const workbook = parseWorkbook(workbookBytes);
  const sheet = workbook.sheets.get(sheetName);
  return sheet ? cellXml(sheet.xml, reference) : null;
}

export function uint8ArrayFromArrayBuffer(buffer: ArrayBuffer): Uint8Array {
  return new Uint8Array(buffer);
}

export function arrayBufferFromUint8Array(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export function isXlsxBytes(bytes: Uint8Array): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b && decoder.decode(bytes.slice(0, 2)) === "PK";
}

export function encodeUtf8(value: string): Uint8Array {
  return encoder.encode(value);
}
