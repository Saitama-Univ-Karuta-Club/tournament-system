import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import {
  extractTournamentResults,
  ResultAutoFillError,
  type ResultExtractionCandidate,
} from "../src/result-auto-fill";

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function cell(reference: string, value: string): string {
  return "<c r=\"" + reference + "\" t=\"inlineStr\"><is><t>" +
    escapeXml(value) + "</t></is></c>";
}

function row(number: number, cells: string): string {
  return "<row r=\"" + number + "\">" + cells + "</row>";
}

function resultWorkbook(sheets: Array<{ name: string; rows: string[] }>): Uint8Array {
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(
      "<?xml version=\"1.0\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">" +
      "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>" +
      "<Default Extension=\"xml\" ContentType=\"application/xml\"/>" +
      "<Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/>" +
      sheets.map((_sheet, index) =>
        "<Override PartName=\"/xl/worksheets/sheet" + (index + 1) +
        ".xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>"
      ).join("") +
      "</Types>",
    ),
    "_rels/.rels": strToU8(
      "<?xml version=\"1.0\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
      "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/>" +
      "</Relationships>",
    ),
    "xl/workbook.xml": strToU8(
      "<?xml version=\"1.0\"?><workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" " +
      "xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><sheets>" +
      sheets.map((sheet, index) =>
        "<sheet name=\"" + escapeXml(sheet.name) + "\" sheetId=\"" + (index + 1) +
        "\" r:id=\"rId" + (index + 1) + "\"/>"
      ).join("") +
      "</sheets></workbook>",
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      "<?xml version=\"1.0\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
      sheets.map((_sheet, index) =>
        "<Relationship Id=\"rId" + (index + 1) +
        "\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" " +
        "Target=\"worksheets/sheet" + (index + 1) + ".xml\"/>"
      ).join("") +
      "</Relationships>",
    ),
  };
  sheets.forEach((sheet, index) => {
    files["xl/worksheets/sheet" + (index + 1) + ".xml"] = strToU8(
      "<?xml version=\"1.0\"?><worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">" +
      "<sheetData>" + sheet.rows.join("") + "</sheetData></worksheet>",
    );
  });
  return zipSync(files);
}

const ishida: ResultExtractionCandidate = {
  tournamentId: "T-11111111-1111-4111-8111-111111111111",
  memberId: "M-11111111-1111-4111-8111-111111111111",
  displayName: "石田洋音",
  grade: "C",
};

describe("result auto fill", () => {
  it("prefers an explicit placing over the loss round in a detailed sheet", () => {
    const workbook = resultWorkbook([
      {
        name: "まとめ",
        rows: [row(1, cell("A1", "第三位") + cell("B1", "石田 洋音") + cell("C1", "埼玉大学かるた会"))],
      },
      {
        name: "C1級",
        rows: [
          row(1,
            cell("B1", "選手名") + cell("C1", "所属") +
            cell("D1", "相手") + cell("E1", "枚数") + cell("F1", "勝敗") +
            cell("G1", "相手") + cell("H1", "枚数") + cell("I1", "勝敗") +
            cell("J1", "相手") + cell("K1", "枚数") + cell("L1", "勝敗") +
            cell("M1", "相手") + cell("N1", "枚数") + cell("O1", "勝敗"),
          ),
          row(2,
            cell("B2", "石田　洋音") + cell("C2", "埼玉大学かるた会") +
            cell("D2", "山田 太郎") + cell("E2", "8") + cell("F2", "○") +
            cell("G2", "佐藤 花子") + cell("H2", "1") + cell("I2", "○") +
            cell("J2", "鈴木 一郎") + cell("K2", "4") + cell("L2", "○") +
            cell("M2", "斉藤 次郎") + cell("N2", "5") + cell("O2", "×"),
          ),
          row(3, cell("B3", "山田 太郎") + cell("C3", "世界大学かるた会")),
          row(4, cell("B4", "佐藤 花子") + cell("C4", "ちはやふるかるた会")),
          row(5, cell("B5", "鈴木 一郎") + cell("C5", "東京都かるた会")),
          row(6, cell("B6", "斉藤 次郎") + cell("C6", "しのぶれどかるた会")),
        ],
      },
    ]);

    const report = extractTournamentResults(workbook, [ishida]);

    expect(report.matchedCount).toBe(1);
    expect(report.predictions[0]).toMatchObject({
      status: "matched",
      resultText: "3位入賞",
      sheetName: "まとめ",
      cellReference: "B1",
    });
    expect(report.predictions[0].matches).toEqual([
      expect.objectContaining({
        roundNumber: 1,
        outcome: "win",
        scoreDifference: 8,
        opponentName: "山田 太郎",
        opponentAffiliation: "世界大学かるた会",
      }),
      expect.objectContaining({
        roundNumber: 2,
        outcome: "win",
        scoreDifference: 1,
        opponentName: "佐藤 花子",
        opponentAffiliation: "ちはやふるかるた会",
      }),
      expect.objectContaining({ roundNumber: 3, outcome: "win", scoreDifference: 4 }),
      expect.objectContaining({
        roundNumber: 4,
        outcome: "loss",
        scoreDifference: 5,
        opponentName: "斉藤 次郎",
        opponentAffiliation: "しのぶれどかるた会",
      }),
    ]);
  });

  it("reads an opponent, outcome, and score layout and keeps special results", () => {
    const workbook = resultWorkbook([{
      name: "C級詳細",
      rows: [
        row(1,
          cell("C1", "氏名") + cell("D1", "所属会") +
          cell("F1", "対戦相手") + cell("G1", "勝敗") + cell("H1", "枚数") +
          cell("I1", "対戦相手") + cell("J1", "勝敗") + cell("K1", "枚数"),
        ),
        row(2,
          cell("C2", "石田 洋音") + cell("D2", "埼玉大学かるた会") +
          cell("F2", "山田 太郎") + cell("G2", "○") + cell("H2", "13") +
          cell("J2", "○") + cell("K2", "不戦勝"),
        ),
        row(3, cell("C3", "山田 太郎") + cell("D3", "世界大学かるた会")),
      ],
    }]);

    const matches = extractTournamentResults(workbook, [ishida]).predictions[0].matches;

    expect(matches).toEqual([
      expect.objectContaining({
        roundNumber: 1,
        outcome: "win",
        scoreDifference: 13,
        resultNote: null,
        opponentAffiliation: "世界大学かるた会",
      }),
      expect.objectContaining({
        roundNumber: 2,
        outcome: "win",
        scoreDifference: null,
        resultNote: "不戦勝",
        opponentName: null,
      }),
    ]);
  });

  it("counts wins before the first loss and filters sheets by grade", () => {
    const imoto: ResultExtractionCandidate = {
      tournamentId: "T-22222222-2222-4222-8222-222222222222",
      memberId: "M-22222222-2222-4222-8222-222222222222",
      displayName: "伊本理乃",
      grade: "E",
    };
    const workbook = resultWorkbook([
      {
        name: "C5級",
        rows: [
          row(1, cell("B1", "選手名") + cell("C1", "所属")),
          row(2, cell("B2", "伊本 理乃") + cell("C2", "埼玉大学かるた会") + cell("D2", "相手") + cell("E2", "×")),
        ],
      },
      {
        name: "対戦結果表_E8級",
        rows: [
          row(1, cell("B1", "選手名") + cell("C1", "所属")),
          row(2,
            cell("B2", "伊本　理乃") + cell("C2", "埼玉大学かるた会") +
            cell("D2", "相手1") + cell("E2", "○") +
            cell("F2", "相手2") + cell("G2", "×"),
          ),
        ],
      },
    ]);

    expect(extractTournamentResults(workbook, [imoto]).predictions[0]).toMatchObject({
      status: "matched",
      resultText: "2回戦敗退",
      sheetName: "対戦結果表_E8級",
    });
  });

  it("does not mistake an opponent-name occurrence for the participant row", () => {
    const workbook = resultWorkbook([{
      name: "C級",
      rows: [
        row(1, cell("B1", "選手名") + cell("C1", "所属") + cell("D1", "相手")),
        row(2,
          cell("B2", "別の選手") + cell("C2", "埼玉大学かるた会") +
          cell("D2", "石田 洋音") + cell("E2", "○"),
        ),
      ],
    }]);

    expect(extractTournamentResults(workbook, [ishida]).predictions[0]).toMatchObject({
      status: "not_found",
      resultText: null,
    });
  });

  it("requires manual review when same-grade candidates have the same name", () => {
    const workbook = resultWorkbook([{
      name: "C級",
      rows: [
        row(1, cell("B1", "選手名") + cell("C1", "所属")),
        row(2, cell("B2", "石田 洋音") + cell("C2", "埼玉大学かるた会") + cell("D2", "相手") + cell("E2", "×")),
      ],
    }]);
    const duplicate = { ...ishida, memberId: "M-99999999-9999-4999-8999-999999999999" };

    const report = extractTournamentResults(workbook, [ishida, duplicate]);

    expect(report.reviewCount).toBe(2);
    expect(report.predictions.every((item) => item.status === "needs_review")).toBe(true);
  });

  it("rejects a malformed workbook", () => {
    expect(() => extractTournamentResults(new Uint8Array([1, 2, 3]), [ishida]))
      .toThrow(ResultAutoFillError);
  });
});
