import {
  normalizeSpreadsheetName,
  normalizeSpreadsheetText,
  readWorkbook,
  type WorkbookCell,
  type WorkbookSheet,
} from "./result-auto-fill";

export interface RosterExtractionCandidate {
  tournamentId: string;
  memberId: string;
  displayName: string;
  grade: string;
}

export interface ApplicationRosterPrediction extends RosterExtractionCandidate {
  status: "matched" | "needs_review" | "not_found";
  sheetName: string | null;
  cellReference: string | null;
  evidence: string;
}

export interface ApplicationRosterReport {
  predictions: ApplicationRosterPrediction[];
  matchedCount: number;
  reviewCount: number;
  notFoundCount: number;
}

export interface LotteryRosterPrediction extends RosterExtractionCandidate {
  status: "matched" | "needs_review" | "not_found";
  entryStatus: "selected" | "not_selected" | null;
  waitlistNumber: number | null;
  sheetName: string | null;
  cellReference: string | null;
  evidence: string;
}

export interface LotteryRosterReport {
  predictions: LotteryRosterPrediction[];
  matchedCount: number;
  reviewCount: number;
  notFoundCount: number;
}

interface NameOccurrence {
  sheet: WorkbookSheet;
  cells: WorkbookCell[];
  first: WorkbookCell;
  lastColumn: number;
  detectedGrade: string | null;
  gradeMismatch: boolean;
}

interface LotteryEvidence {
  entryStatus: "selected" | "not_selected" | "rejected" | null;
  waitlistNumber: number | null;
  priority: number;
  sheetName: string;
  cellReference: string;
  evidence: string;
}

const NAME_HEADERS = new Set([
  "選手名",
  "氏名",
  "名前",
  "選手氏名",
  "参加者氏名",
  "申込者氏名",
  "姓名",
]);
const GRADE_HEADERS = new Set(["級", "参加級", "出場級", "登録級"]);
const RESULT_HEADERS = new Set(["抽選結果", "当落", "結果", "抽選", "参加可否"]);
const WAITLIST_HEADERS = new Set([
  "キャンセル待ち",
  "キャンセル待ち順位",
  "キャンセル待ち順序",
  "キャンセル待ち番号",
  "キャン待ち順位",
  "キャン待ち番号",
  "待ち順位",
  "待ち番号",
  "補欠順位",
]);
const AFFILIATION_HEADERS = new Set(["所属", "所属会", "所属会名", "所属団体"]);

function gradeIn(value: string): string | null {
  const normalized = value.normalize("NFKC").toUpperCase();
  const match = normalized.match(/(?:^|[^A-Z])([A-F])(?:\d+)?級/);
  return match?.[1] ?? null;
}

function cellByColumn(cells: WorkbookCell[], column: number): WorkbookCell | undefined {
  return cells.find((cell) => cell.column === column);
}

function normalizedCell(cell: WorkbookCell): string {
  return normalizeSpreadsheetText(cell.value);
}

function headerColumns(sheet: WorkbookSheet, headers: Set<string>): Set<number> {
  const columns = new Set<number>();
  for (const cells of sheet.rows.values()) {
    for (const cell of cells) {
      if (headers.has(normalizedCell(cell))) columns.add(cell.column);
    }
  }
  return columns;
}

function tableHeaderColumns(sheet: WorkbookSheet, headers: Set<string>): Set<number> {
  const columns = new Set<number>();
  for (const cells of sheet.rows.values()) {
    const isTableHeader = cells.some((cell) => {
      const value = normalizedCell(cell);
      return NAME_HEADERS.has(value) || AFFILIATION_HEADERS.has(value);
    });
    if (!isTableHeader) continue;
    for (const cell of cells) {
      if (headers.has(normalizedCell(cell))) columns.add(cell.column);
    }
  }
  return columns.size > 0 ? columns : headerColumns(sheet, headers);
}

function rowGrade(cells: WorkbookCell[], gradeColumns: Set<number>): string | null {
  for (const cell of cells) {
    if (gradeColumns.size > 0 && !gradeColumns.has(cell.column)) continue;
    const bareGrade = normalizeSpreadsheetText(cell.value).toUpperCase();
    if (gradeColumns.size > 0 && /^[A-F]$/.test(bareGrade)) return bareGrade;
    const grade = gradeIn(cell.value);
    if (grade) return grade;
  }
  if (gradeColumns.size === 0) {
    for (const cell of cells) {
      const grade = gradeIn(cell.value);
      if (grade) return grade;
    }
  }
  return null;
}

function isClubAffiliation(value: string): boolean {
  const normalized = normalizeSpreadsheetText(value);
  return normalized.includes("埼玉大学かるた会") ||
    normalized.includes("埼玉大学歌留多会") ||
    normalized === "埼玉大学";
}

function candidateOccurrences(cells: WorkbookCell[], normalizedName: string): Array<{
  first: WorkbookCell;
  lastColumn: number;
}> {
  const result: Array<{ first: WorkbookCell; lastColumn: number }> = [];
  for (let index = 0; index < cells.length; index += 1) {
    const cell = cells[index];
    if (normalizeSpreadsheetName(cell.value) === normalizedName) {
      result.push({ first: cell, lastColumn: cell.column });
    }
    const next = cells[index + 1];
    if (
      next && next.column === cell.column + 1 &&
      normalizeSpreadsheetName(cell.value + next.value) === normalizedName
    ) {
      result.push({ first: cell, lastColumn: next.column });
    }
  }
  return result;
}

function sheetHasRosterStructure(sheet: WorkbookSheet): boolean {
  for (const cells of sheet.rows.values()) {
    for (const cell of cells) {
      const value = normalizedCell(cell);
      if (
        NAME_HEADERS.has(value) || AFFILIATION_HEADERS.has(value) ||
        value.includes("申込者名簿") || value.includes("参加者名簿") ||
        value.includes("参加者リスト") || value.includes("抽選結果")
      ) return true;
    }
  }
  return false;
}

function occurrencesForCandidate(
  sheets: WorkbookSheet[],
  candidate: RosterExtractionCandidate,
): NameOccurrence[] {
  const normalizedName = normalizeSpreadsheetName(candidate.displayName);
  const result: NameOccurrence[] = [];
  for (const sheet of sheets) {
    if (!sheetHasRosterStructure(sheet)) continue;
    const nameColumns = headerColumns(sheet, NAME_HEADERS);
    const gradeColumns = headerColumns(sheet, GRADE_HEADERS);
    const sheetDetectedGrade = gradeIn(sheet.name);
    for (const cells of sheet.rows.values()) {
      for (const occurrence of candidateOccurrences(cells, normalizedName)) {
        const hasClub = cells.some((cell) => isClubAffiliation(cell.value));
        const inNameColumn = nameColumns.has(occurrence.first.column) ||
          nameColumns.has(occurrence.lastColumn);
        if (!hasClub && nameColumns.size > 0 && !inNameColumn) continue;
        const detectedGrade = rowGrade(cells, gradeColumns) ?? sheetDetectedGrade;
        const gradeMismatch = Boolean(
          detectedGrade && candidate.grade !== "all" && detectedGrade !== candidate.grade,
        );
        result.push({
          sheet,
          cells,
          first: occurrence.first,
          lastColumn: occurrence.lastColumn,
          detectedGrade,
          gradeMismatch,
        });
      }
    }
  }
  return result;
}

function duplicateCandidateKeys(candidates: RosterExtractionCandidate[]): Set<string> {
  const counts = new Map<string, number>();
  for (const candidate of candidates) {
    const key = `${candidate.grade}:${normalizeSpreadsheetName(candidate.displayName)}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return new Set([...counts].filter(([, count]) => count > 1).map(([key]) => key));
}

export function checkApplicationRoster(
  workbook: Uint8Array,
  candidates: RosterExtractionCandidate[],
): ApplicationRosterReport {
  const sheets = readWorkbook(workbook);
  const duplicates = duplicateCandidateKeys(candidates);
  const predictions = candidates.map<ApplicationRosterPrediction>((candidate) => {
    const duplicateKey = `${candidate.grade}:${normalizeSpreadsheetName(candidate.displayName)}`;
    if (duplicates.has(duplicateKey)) {
      return {
        ...candidate,
        status: "needs_review",
        sheetName: null,
        cellReference: null,
        evidence: "同じ級に同姓同名の申込者がいるため、自動確認できません。",
      };
    }
    const occurrences = occurrencesForCandidate(sheets, candidate);
    const compatible = occurrences.filter((item) => !item.gradeMismatch);
    if (compatible.length > 0) {
      const selected = compatible[0];
      const gradeEvidence = selected.detectedGrade
        ? `${selected.detectedGrade}級として`
        : "氏名を";
      return {
        ...candidate,
        status: "matched",
        sheetName: selected.sheet.name,
        cellReference: selected.first.reference,
        evidence: `${gradeEvidence}確認しました。`,
      };
    }
    if (occurrences.length > 0) {
      const selected = occurrences[0];
      return {
        ...candidate,
        status: "needs_review",
        sheetName: selected.sheet.name,
        cellReference: selected.first.reference,
        evidence: `氏名はありますが、名簿上の級は${selected.detectedGrade ?? "不明"}級です。`,
      };
    }
    return {
      ...candidate,
      status: "not_found",
      sheetName: null,
      cellReference: null,
      evidence: "名簿内で氏名を確認できませんでした。",
    };
  });
  return {
    predictions,
    matchedCount: predictions.filter((item) => item.status === "matched").length,
    reviewCount: predictions.filter((item) => item.status === "needs_review").length,
    notFoundCount: predictions.filter((item) => item.status === "not_found").length,
  };
}

function sectionByRow(sheet: WorkbookSheet): Map<number, "selected" | "waitlisted" | null> {
  const result = new Map<number, "selected" | "waitlisted" | null>();
  let section: "selected" | "waitlisted" | null = null;
  const rows = [...sheet.rows.entries()].sort(([left], [right]) => left - right);
  for (const [rowNumber, cells] of rows) {
    const rowText = cells.map(normalizedCell).join("");
    if (
      /(?:キャンセル待ち|キャン待ち|補欠)(?:者)?(?:名簿|一覧|順位)/.test(rowText)
    ) section = "waitlisted";
    else if (/(?:抽選通過者|出場確定者|参加確定者|当選者)(?:名簿|一覧)?/.test(rowText)) {
      section = "selected";
    }
    result.set(rowNumber, section);
  }
  return result;
}

function finalParticipantSheet(sheet: WorkbookSheet): boolean {
  const heading = [sheet.name, ...[...sheet.rows.entries()]
    .sort(([left], [right]) => left - right)
    .slice(0, 12)
    .flatMap(([, cells]) => cells.map((cell) => cell.value))]
    .map(normalizeSpreadsheetText)
    .join("");
  return /(?:参加者リスト確定|参加者確定|参加確定名簿|出場確定者|出場確定名簿|参加者名簿)/.test(heading);
}

function numericValue(value: string): number | null {
  const match = value.normalize("NFKC").trim().match(/^(\d{1,4})(?:\.0+)?(?:番|位)?$/);
  if (!match) return null;
  const number = Number(match[1]);
  return number >= 1 && number <= 9999 ? number : null;
}

function waitlistNumberFromRow(cells: WorkbookCell[], waitColumns: Set<number>): number | null {
  for (const cell of cells) {
    const normalized = normalizeSpreadsheetText(cell.value);
    const embedded = normalized.match(/(?:キャンセル待ち|キャン待ち|補欠)(\d{1,4})(?:番|位)?/);
    if (embedded) return Number(embedded[1]);
  }
  for (const column of waitColumns) {
    const cell = cellByColumn(cells, column);
    const number = cell ? numericValue(cell.value) : null;
    if (number !== null) return number;
  }
  return null;
}

function lotteryEvidenceForOccurrence(occurrence: NameOccurrence): LotteryEvidence {
  const { sheet, cells, first } = occurrence;
  const resultColumns = tableHeaderColumns(sheet, RESULT_HEADERS);
  const waitColumns = tableHeaderColumns(sheet, WAITLIST_HEADERS);
  const sections = sectionByRow(sheet);
  const section = sections.get(first.row) ?? null;
  const waitlistNumber = waitlistNumberFromRow(cells, waitColumns);

  for (const cell of cells) {
    const normalized = normalizedCell(cell);
    const waitlisted = normalized.match(/^(?:キャンセル待ち|キャン待ち|補欠)(\d{1,4})?(?:番|位)?$/);
    if (waitlisted) {
      const number = waitlisted[1] ? Number(waitlisted[1]) : waitlistNumber;
      return {
        entryStatus: "not_selected",
        waitlistNumber: number,
        priority: number ? 100 : 65,
        sheetName: sheet.name,
        cellReference: first.reference,
        evidence: number ? `キャンセル待ち${number}番` : "キャンセル待ち（順位は要確認）",
      };
    }
    if (/^(?:出場確定|参加確定|当選|抽選通過|通過)$/.test(normalized)) {
      return {
        entryStatus: "selected",
        waitlistNumber: null,
        priority: 100,
        sheetName: sheet.name,
        cellReference: first.reference,
        evidence: cell.value.trim(),
      };
    }
  }

  for (const column of resultColumns) {
    const resultCell = cellByColumn(cells, column);
    const normalized = normalizeSpreadsheetText(resultCell?.value ?? "");
    if (["○", "〇", "◎"].includes(normalized)) {
      return {
        entryStatus: "selected",
        waitlistNumber: null,
        priority: 90,
        sheetName: sheet.name,
        cellReference: first.reference,
        evidence: `抽選結果欄「${resultCell?.value}」`,
      };
    }
    if (["×", "✕"].includes(normalized) || /^(?:落選|不当選)$/.test(normalized)) {
      return {
        entryStatus: waitlistNumber ? "not_selected" : "rejected",
        waitlistNumber,
        priority: waitlistNumber ? 90 : 70,
        sheetName: sheet.name,
        cellReference: first.reference,
        evidence: waitlistNumber
          ? `抽選結果欄「${resultCell?.value}」・キャンセル待ち${waitlistNumber}番`
          : `抽選結果欄「${resultCell?.value}」（待ち順位は要確認）`,
      };
    }
  }

  if (waitColumns.size > 0) {
    const rowWaitValues = [...waitColumns]
      .map((column) => normalizeSpreadsheetText(cellByColumn(cells, column)?.value ?? ""));
    const sheetUsesWaitlistMarker = [...sheet.rows.values()].some((rowCells) =>
      [...waitColumns].some((column) =>
        /^(?:キャンセル待ち|キャン待ち|補欠)/.test(
          normalizeSpreadsheetText(cellByColumn(rowCells, column)?.value ?? ""),
        )
      )
    );
    if (sheetUsesWaitlistMarker && rowWaitValues.every((value) => value === "")) {
      return {
        entryStatus: "selected",
        waitlistNumber: null,
        priority: 80,
        sheetName: sheet.name,
        cellReference: first.reference,
        evidence: "キャンセル待ち欄が空欄の確定者",
      };
    }
  }

  if (section === "waitlisted") {
    return {
      entryStatus: "not_selected",
      waitlistNumber,
      priority: waitlistNumber ? 85 : 60,
      sheetName: sheet.name,
      cellReference: first.reference,
      evidence: waitlistNumber
        ? `キャンセル待ち名簿 ${waitlistNumber}番`
        : "キャンセル待ち名簿に記載（順位は要確認）",
    };
  }
  if (section === "selected") {
    return {
      entryStatus: "selected",
      waitlistNumber: null,
      priority: 80,
      sheetName: sheet.name,
      cellReference: first.reference,
      evidence: "抽選通過者・出場確定者の欄に記載",
    };
  }
  const blockColumns = headerColumns(sheet, new Set(["ブロック", "組", "会場"]));
  if ([...blockColumns].some((column) => Boolean(cellByColumn(cells, column)?.value.trim()))) {
    return {
      entryStatus: "selected",
      waitlistNumber: null,
      priority: 75,
      sheetName: sheet.name,
      cellReference: first.reference,
      evidence: "ブロック割当がある確定名簿に記載",
    };
  }
  if (finalParticipantSheet(sheet)) {
    return {
      entryStatus: "selected",
      waitlistNumber: null,
      priority: 70,
      sheetName: sheet.name,
      cellReference: first.reference,
      evidence: "参加者確定名簿に記載",
    };
  }
  return {
    entryStatus: null,
    waitlistNumber: null,
    priority: 20,
    sheetName: sheet.name,
    cellReference: first.reference,
    evidence: "氏名はありますが、当落欄を特定できませんでした。",
  };
}

export function extractLotteryRoster(
  workbook: Uint8Array,
  candidates: RosterExtractionCandidate[],
): LotteryRosterReport {
  const sheets = readWorkbook(workbook);
  const duplicates = duplicateCandidateKeys(candidates);
  const predictions = candidates.map<LotteryRosterPrediction>((candidate) => {
    const duplicateKey = `${candidate.grade}:${normalizeSpreadsheetName(candidate.displayName)}`;
    if (duplicates.has(duplicateKey)) {
      return {
        ...candidate,
        status: "needs_review",
        entryStatus: null,
        waitlistNumber: null,
        sheetName: null,
        cellReference: null,
        evidence: "同じ級に同姓同名の申込者がいるため自動判定できません。",
      };
    }
    const occurrences = occurrencesForCandidate(sheets, candidate);
    const compatible = occurrences.filter((item) => !item.gradeMismatch);
    if (compatible.length === 0) {
      const mismatch = occurrences[0];
      return {
        ...candidate,
        status: mismatch ? "needs_review" : "not_found",
        entryStatus: null,
        waitlistNumber: null,
        sheetName: mismatch?.sheet.name ?? null,
        cellReference: mismatch?.first.reference ?? null,
        evidence: mismatch
          ? `氏名はありますが、名簿上の級は${mismatch.detectedGrade ?? "不明"}級です。`
          : "名簿内で氏名を確認できませんでした。確定者だけの名簿の場合、不記載だけで落選とは判定しません。",
      };
    }
    const evidence = compatible.map(lotteryEvidenceForOccurrence);
    const highestPriority = Math.max(...evidence.map((item) => item.priority));
    const strongest = evidence.filter((item) => item.priority === highestPriority);
    const distinct = new Set(strongest.map((item) =>
      `${item.entryStatus ?? "none"}:${item.waitlistNumber ?? "none"}`
    ));
    const selected = strongest[0];
    const canAutoFill = distinct.size === 1 && (
      selected.entryStatus === "selected" ||
      (selected.entryStatus === "not_selected" && selected.waitlistNumber !== null)
    );
    return {
      ...candidate,
      status: canAutoFill ? "matched" : "needs_review",
      entryStatus: canAutoFill ? selected.entryStatus as "selected" | "not_selected" : null,
      waitlistNumber: canAutoFill ? selected.waitlistNumber : null,
      sheetName: selected.sheetName,
      cellReference: selected.cellReference,
      evidence: distinct.size > 1
        ? "複数の当落候補が見つかったため、手動確認が必要です。"
        : selected.evidence,
    };
  });
  return {
    predictions,
    matchedCount: predictions.filter((item) => item.status === "matched").length,
    reviewCount: predictions.filter((item) => item.status === "needs_review").length,
    notFoundCount: predictions.filter((item) => item.status === "not_found").length,
  };
}
