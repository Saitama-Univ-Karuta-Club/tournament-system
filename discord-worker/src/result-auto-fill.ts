import { strFromU8, unzipSync } from "fflate";

export const AUTO_FILL_RESULT_OPTIONS = [
  "1回戦敗退",
  "2回戦敗退",
  "3回戦敗退",
  "4回戦敗退",
  "4位入賞",
  "3位入賞",
  "準優勝",
  "優勝",
] as const;

export type AutoFillResultText = typeof AUTO_FILL_RESULT_OPTIONS[number];

export interface ResultExtractionCandidate {
  tournamentId: string;
  memberId: string;
  displayName: string;
  grade: string;
}

export interface ResultExtractionPrediction extends ResultExtractionCandidate {
  status: "matched" | "needs_review" | "not_found";
  resultText: AutoFillResultText | null;
  sheetName: string | null;
  cellReference: string | null;
  evidence: string | null;
  matches: ResultMatchPrediction[];
}

export interface ResultMatchPrediction {
  roundNumber: number;
  outcome: "win" | "loss";
  scoreDifference: number | null;
  resultNote: string | null;
  opponentName: string | null;
  opponentAffiliation: string | null;
  sheetName: string;
  cellReference: string;
  status: "matched" | "needs_review";
  evidence: string;
}

export interface ResultExtractionReport {
  predictions: ResultExtractionPrediction[];
  matchedCount: number;
  reviewCount: number;
  notFoundCount: number;
}

export interface WorkbookCell {
  reference: string;
  row: number;
  column: number;
  value: string;
}

export interface WorkbookSheet {
  name: string;
  rows: Map<number, WorkbookCell[]>;
}

interface ResultEvidence {
  resultText: AutoFillResultText | null;
  priority: number;
  sheetName: string;
  cellReference: string;
  evidence: string;
}

interface MatchColumnGroup {
  roundNumber: number;
  opponentColumn: number;
  outcomeColumn: number;
  scoreColumn: number;
}

interface MatchSheetLayout {
  nameColumn: number;
  affiliationColumn: number;
  matches: MatchColumnGroup[];
}

export class ResultAutoFillError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResultAutoFillError";
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

function columnNumber(column: string): number {
  return [...column].reduce(
    (total, character) => total * 26 + character.charCodeAt(0) - 64,
    0,
  );
}

export function readWorkbook(template: Uint8Array): WorkbookSheet[] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(template);
  } catch {
    throw new ResultAutoFillError("Excelファイルを開けません。.xlsx形式を確認してください。");
  }
  const uncompressedSize = Object.values(files)
    .reduce((total, value) => total + value.byteLength, 0);
  if (uncompressedSize > 80 * 1024 * 1024) {
    throw new ResultAutoFillError("Excelファイルの展開サイズが大きすぎます。");
  }

  const rootRelationships = files["_rels/.rels"];
  if (!rootRelationships) throw new ResultAutoFillError("Excelファイルの構造が不正です。");
  const officeRelationship = [...strFromU8(rootRelationships)
    .matchAll(/<Relationship\b([^>]*)\/?\s*>/g)]
    .map((match) => parseAttributes(match[1]))
    .find((attributes) => attributes.Type?.endsWith("/officeDocument"));
  const workbookPath = officeRelationship?.Target
    ? normalizePartPath("", officeRelationship.Target)
    : "xl/workbook.xml";
  const workbookBytes = files[workbookPath];
  const workbookRelationshipBytes = files[relationshipPath(workbookPath)];
  if (!workbookBytes || !workbookRelationshipBytes) {
    throw new ResultAutoFillError("Excelファイルのシート情報がありません。");
  }

  const sharedStrings = files["xl/sharedStrings.xml"]
    ? [...strFromU8(files["xl/sharedStrings.xml"])
      .matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)]
      .map((match) => extractTextNodes(match[1]))
    : [];
  const workbookXml = strFromU8(workbookBytes);
  const targets = relationshipTargets(strFromU8(workbookRelationshipBytes));
  const sheets: WorkbookSheet[] = [];
  for (const match of workbookXml.matchAll(/<sheet\b([^>]*)\/?\s*>/g)) {
    const attributes = parseAttributes(match[1]);
    const target = targets.get(attributes["r:id"] ?? "");
    if (!attributes.name || !target) continue;
    const sheetPath = normalizePartPath(workbookPath, target);
    const sheetBytes = files[sheetPath];
    if (!sheetBytes) continue;
    const rows = new Map<number, WorkbookCell[]>();
    const sheetXml = strFromU8(sheetBytes);
    for (const cellMatch of sheetXml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attributes = parseAttributes(cellMatch[1]);
      const coordinate = attributes.r?.match(/^([A-Z]+)(\d+)$/);
      if (!coordinate) continue;
      const body = cellMatch[2] ?? "";
      let value = "";
      if (attributes.t === "inlineStr") {
        value = extractTextNodes(body);
      } else {
        const raw = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1] ?? "";
        if (attributes.t === "s") value = sharedStrings[Number(raw)] ?? "";
        else value = xmlDecode(raw);
      }
      if (!value) continue;
      const row = Number(coordinate[2]);
      const cells = rows.get(row) ?? [];
      cells.push({
        reference: attributes.r,
        row,
        column: columnNumber(coordinate[1]),
        value,
      });
      rows.set(row, cells);
    }
    for (const cells of rows.values()) cells.sort((left, right) => left.column - right.column);
    sheets.push({ name: attributes.name, rows });
  }
  if (sheets.length === 0) {
    throw new ResultAutoFillError("Excelファイルに読み取れるシートがありません。");
  }
  return sheets;
}

export function normalizeSpreadsheetText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\s\u200b\u3000]/g, "")
    .replace(/[()\uff08\uff09・・·]/g, "");
}

export function normalizeSpreadsheetName(value: string): string {
  return normalizeSpreadsheetText(value)
    .replace(/髙/g, "高")
    .replace(/[﨑]/g, "崎")
    .replace(/[邊邉]/g, "辺")
    .replace(/[濵]/g, "浜")
    .replace(/[神]/g, "神")
    .replace(/𠮷/g, "吉");
}

const normalizeText = normalizeSpreadsheetText;
const normalizeName = normalizeSpreadsheetName;

function sheetGrade(sheetName: string): string | null {
  const match = sheetName.normalize("NFKC").toUpperCase().match(/(?:^|[^A-Z])([A-F])(?:\d+)?級/);
  return match?.[1] ?? null;
}

function playerNameColumns(sheet: WorkbookSheet): Set<number> {
  const columns = new Set<number>();
  for (const cells of sheet.rows.values()) {
    for (const cell of cells) {
      const value = normalizeText(cell.value);
      if (["選手名", "氏名", "名前", "選手氏名", "参加者氏名"].includes(value)) {
        columns.add(cell.column);
      }
    }
  }
  return columns;
}

function isClubAffiliation(value: string): boolean {
  const normalized = normalizeText(value);
  return normalized.includes("埼玉大学かるた会") ||
    normalized.includes("埼玉大学歌留多会") ||
    normalized === "埼玉大学";
}

function cellByColumn(cells: WorkbookCell[], column: number): WorkbookCell | undefined {
  return cells.find((cell) => cell.column === column);
}

function matchSheetLayout(sheet: WorkbookSheet): MatchSheetLayout | null {
  let nameColumn: number | null = null;
  let affiliationColumn: number | null = null;
  for (const cells of sheet.rows.values()) {
    const nameCell = cells.find((cell) =>
      ["選手名", "氏名", "名前", "選手氏名", "参加者氏名"].includes(normalizeText(cell.value))
    );
    const affiliationCell = cells.find((cell) =>
      ["所属", "所属会", "所属会名", "所属団体"].includes(normalizeText(cell.value))
    );
    if (nameCell && affiliationCell) {
      nameColumn = nameCell.column;
      affiliationColumn = affiliationCell.column;
      break;
    }
  }
  if (nameColumn === null || affiliationColumn === null) return null;
  for (const cells of sheet.rows.values()) {
    const opponentCells = cells.filter((cell) =>
      ["相手", "対戦相手"].includes(normalizeText(cell.value))
    );
    if (opponentCells.length === 0) continue;
    const matches: MatchColumnGroup[] = [];
    for (const [index, opponentCell] of opponentCells.entries()) {
      const nextOpponentColumn = opponentCells[index + 1]?.column ?? Number.POSITIVE_INFINITY;
      const related = cells.filter((cell) =>
        cell.column > opponentCell.column && cell.column < nextOpponentColumn
      );
      const outcome = related.find((cell) => normalizeText(cell.value) === "勝敗");
      const score = related.find((cell) => normalizeText(cell.value) === "枚数");
      if (!outcome || !score) continue;
      matches.push({
        roundNumber: matches.length + 1,
        opponentColumn: opponentCell.column,
        outcomeColumn: outcome.column,
        scoreColumn: score.column,
      });
    }
    if (matches.length > 0) {
      return {
        nameColumn,
        affiliationColumn,
        matches,
      };
    }
  }
  return null;
}

function normalizedOutcome(value: string): "win" | "loss" | null {
  const normalized = normalizeText(value);
  if (["○", "〇", "勝"].includes(normalized)) return "win";
  if (["×", "敗", "不戦敗"].includes(normalized)) return "loss";
  return null;
}

function normalizedScore(value: string): { scoreDifference: number | null; resultNote: string | null } {
  const normalized = value.normalize("NFKC").trim();
  if (!normalized) return { scoreDifference: null, resultNote: null };
  const numeric = normalized.match(/^(\d+)(?:\.0+)?(?:枚)?$/);
  if (numeric) {
    const scoreDifference = Number(numeric[1]);
    return Number.isInteger(scoreDifference) && scoreDifference >= 0 && scoreDifference <= 50
      ? { scoreDifference, resultNote: null }
      : { scoreDifference: null, resultNote: normalized.slice(0, 50) };
  }
  return { scoreDifference: null, resultNote: normalized.slice(0, 50) };
}

function displayCellText(value: string): string {
  return value.normalize("NFKC").trim().replace(/[\s\u3000]+/g, " ");
}

function matchDetailsForCandidate(
  sheets: WorkbookSheet[],
  candidate: ResultExtractionCandidate,
): ResultMatchPrediction[] {
  const candidateName = normalizeName(candidate.displayName);
  const found: ResultMatchPrediction[][] = [];
  for (const sheet of sheets) {
    const detectedGrade = sheetGrade(sheet.name);
    if (detectedGrade && candidate.grade !== "all" && detectedGrade !== candidate.grade) continue;
    const layout = matchSheetLayout(sheet);
    if (!layout) continue;
    const directory = new Map<string, Set<string>>();
    for (const cells of sheet.rows.values()) {
      const name = cellByColumn(cells, layout.nameColumn)?.value;
      const affiliation = cellByColumn(cells, layout.affiliationColumn)?.value;
      if (!name || !affiliation) continue;
      const key = normalizeName(name);
      const affiliations = directory.get(key) ?? new Set<string>();
      affiliations.add(displayCellText(affiliation));
      directory.set(key, affiliations);
    }
    for (const cells of sheet.rows.values()) {
      const nameCell = cellByColumn(cells, layout.nameColumn);
      const affiliationCell = cellByColumn(cells, layout.affiliationColumn);
      if (!nameCell || normalizeName(nameCell.value) !== candidateName) continue;
      if (!affiliationCell || !isClubAffiliation(affiliationCell.value)) continue;
      const matches: ResultMatchPrediction[] = [];
      for (const group of layout.matches) {
        const outcomeCell = cellByColumn(cells, group.outcomeColumn);
        const outcome = normalizedOutcome(outcomeCell?.value ?? "");
        if (!outcome || !outcomeCell) continue;
        const opponentValue = displayCellText(
          cellByColumn(cells, group.opponentColumn)?.value ?? "",
        );
        const opponentName = opponentValue && !["不戦勝", "不戦敗"].includes(opponentValue)
          ? opponentValue
          : null;
        const score = normalizedScore(cellByColumn(cells, group.scoreColumn)?.value ?? "");
        const opponentAffiliations = opponentName
          ? [...(directory.get(normalizeName(opponentName)) ?? [])]
          : [];
        const opponentAffiliation = opponentAffiliations.length === 1
          ? opponentAffiliations[0]
          : null;
        const status = opponentName && opponentAffiliation === null
          ? "needs_review"
          : "matched";
        const mark = outcome === "win" ? "○" : "×";
        const scoreLabel = score.scoreDifference !== null
          ? String(score.scoreDifference)
          : score.resultNote ?? "";
        matches.push({
          roundNumber: group.roundNumber,
          outcome,
          scoreDifference: score.scoreDifference,
          resultNote: score.resultNote,
          opponentName,
          opponentAffiliation,
          sheetName: sheet.name,
          cellReference: outcomeCell.reference,
          status,
          evidence: `${group.roundNumber}回戦 ${mark}${scoreLabel}`,
        });
      }
      if (matches.length > 0) found.push(matches);
    }
  }
  if (found.length !== 1) return [];
  return found[0];
}

function rankResult(cells: WorkbookCell[]): ResultEvidence["resultText"] | null {
  for (const cell of cells) {
    const value = normalizeText(cell.value);
    if (value.includes("準優勝") || /^(?:第?2位|2位)/.test(value)) return "準優勝";
    if (/^(?:第三位|第?3位|3位)/.test(value)) return "3位入賞";
    if (/^(?:第四位|第?4位|4位)/.test(value)) return "4位入賞";
    if (/^(?:優勝|第一位|第?1位|1位)/.test(value)) return "優勝";
  }
  return null;
}

function matchSequenceResult(cells: WorkbookCell[]): {
  resultText: AutoFillResultText | null;
  evidence: string | null;
} {
  const outcomes = cells
    .map((cell) => normalizeText(cell.value))
    .filter((value) => ["○", "〇", "×", "勝", "敗", "不戦敗"].includes(value));
  const lossIndex = outcomes.findIndex((value) => value === "×" || value === "敗" || value === "不戦敗");
  if (lossIndex < 0) {
    return {
      resultText: null,
      evidence: outcomes.length > 0 ? `勝敗 ${outcomes.join("→")}` : null,
    };
  }
  const wins = outcomes.slice(0, lossIndex)
    .filter((value) => value === "○" || value === "〇" || value === "勝").length;
  const round = wins + 1;
  if (round < 1 || round > 4) {
    return { resultText: null, evidence: `勝敗 ${outcomes.join("→")}` };
  }
  return {
    resultText: `${round}回戦敗退` as AutoFillResultText,
    evidence: `勝敗 ${outcomes.join("→")}`,
  };
}

function candidateOccurrences(cells: WorkbookCell[], normalizedName: string): Array<{
  first: WorkbookCell;
  lastColumn: number;
}> {
  const matches: Array<{ first: WorkbookCell; lastColumn: number }> = [];
  for (let index = 0; index < cells.length; index += 1) {
    const cell = cells[index];
    if (normalizeName(cell.value) === normalizedName) {
      matches.push({ first: cell, lastColumn: cell.column });
    }
    const next = cells[index + 1];
    if (
      next && next.column === cell.column + 1 &&
      normalizeName(cell.value + next.value) === normalizedName
    ) {
      matches.push({ first: cell, lastColumn: next.column });
    }
  }
  return matches;
}

function evidenceForCandidate(
  sheets: WorkbookSheet[],
  candidate: ResultExtractionCandidate,
): ResultEvidence[] {
  const normalizedName = normalizeName(candidate.displayName);
  const result: ResultEvidence[] = [];
  for (const sheet of sheets) {
    const detectedGrade = sheetGrade(sheet.name);
    if (detectedGrade && candidate.grade !== "all" && detectedGrade !== candidate.grade) continue;
    const nameColumns = playerNameColumns(sheet);
    for (const cells of sheet.rows.values()) {
      for (const occurrence of candidateOccurrences(cells, normalizedName)) {
        const affiliationAfterName = cells.some((cell) =>
          cell.column > occurrence.lastColumn &&
          cell.column <= occurrence.lastColumn + 3 &&
          isClubAffiliation(cell.value)
        );
        if (!affiliationAfterName && !nameColumns.has(occurrence.first.column)) continue;
        const ranked = rankResult(cells);
        if (ranked) {
          result.push({
            resultText: ranked,
            priority: 100,
            sheetName: sheet.name,
            cellReference: occurrence.first.reference,
            evidence: `順位欄から「${ranked}」`,
          });
          continue;
        }
        const sequence = matchSequenceResult(cells);
        if (sequence.resultText) {
          result.push({
            resultText: sequence.resultText,
            priority: 60,
            sheetName: sheet.name,
            cellReference: occurrence.first.reference,
            evidence: sequence.evidence ?? "勝敗欄から判定",
          });
        } else {
          result.push({
            resultText: null,
            priority: sequence.evidence ? 40 : 20,
            sheetName: sheet.name,
            cellReference: occurrence.first.reference,
            evidence: sequence.evidence ?? "氏名は見つかりましたが、成績欄を特定できませんでした。",
          });
        }
      }
    }
  }
  return result;
}

export function extractTournamentResults(
  template: Uint8Array,
  candidates: ResultExtractionCandidate[],
): ResultExtractionReport {
  if (candidates.length === 0) {
    return { predictions: [], matchedCount: 0, reviewCount: 0, notFoundCount: 0 };
  }
  const sheets = readWorkbook(template);
  const duplicateNames = new Set<string>();
  const candidateNameCounts = new Map<string, number>();
  for (const candidate of candidates) {
    const key = `${candidate.grade}:${normalizeName(candidate.displayName)}`;
    candidateNameCounts.set(key, (candidateNameCounts.get(key) ?? 0) + 1);
  }
  for (const [key, count] of candidateNameCounts) {
    if (count > 1) duplicateNames.add(key);
  }

  const predictions = candidates.map<ResultExtractionPrediction>((candidate) => {
    const duplicateKey = `${candidate.grade}:${normalizeName(candidate.displayName)}`;
    if (duplicateNames.has(duplicateKey)) {
      return {
        ...candidate,
        status: "needs_review",
        resultText: null,
        sheetName: null,
        cellReference: null,
        evidence: "同じ級に同姓同名の出場者がいるため自動判定できません。",
        matches: [],
      };
    }
    const evidence = evidenceForCandidate(sheets, candidate);
    const matches = matchDetailsForCandidate(sheets, candidate);
    if (evidence.length === 0) {
      return {
        ...candidate,
        status: "not_found",
        resultText: null,
        sheetName: null,
        cellReference: null,
        evidence: "結果ファイル内で成績を特定できませんでした。",
        matches,
      };
    }
    const highestPriority = Math.max(...evidence.map((item) => item.priority));
    const strongest = evidence.filter((item) => item.priority === highestPriority);
    const distinctResults = [...new Set(strongest.map((item) => item.resultText))];
    if (distinctResults.length !== 1 || distinctResults[0] === null) {
      return {
        ...candidate,
        status: "needs_review",
        resultText: null,
        sheetName: strongest[0]?.sheetName ?? null,
        cellReference: strongest[0]?.cellReference ?? null,
        evidence: distinctResults.length !== 1
          ? "複数の成績候補が見つかりました。"
          : strongest[0]?.evidence ?? "成績を自動判定できませんでした。",
        matches,
      };
    }
    const selected = strongest[0];
    return {
      ...candidate,
      status: "matched",
      resultText: selected.resultText as AutoFillResultText,
      sheetName: selected.sheetName,
      cellReference: selected.cellReference,
      evidence: selected.evidence,
      matches,
    };
  });
  return {
    predictions,
    matchedCount: predictions.filter((item) => item.status === "matched").length,
    reviewCount: predictions.filter((item) => item.status === "needs_review").length,
    notFoundCount: predictions.filter((item) => item.status === "not_found").length,
  };
}
