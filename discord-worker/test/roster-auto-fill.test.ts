import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import {
  checkApplicationRoster,
  extractLotteryRoster,
  type RosterExtractionCandidate,
} from "../src/roster-auto-fill";

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function cell(reference: string, value: string): string {
  return `<c r="${reference}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
}

function row(number: number, cells: string): string {
  return `<row r="${number}">${cells}</row>`;
}

function workbook(sheets: Array<{ name: string; rows: string[] }>): Uint8Array {
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(
      "<?xml version=\"1.0\"?><Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">" +
      "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>" +
      "<Default Extension=\"xml\" ContentType=\"application/xml\"/>" +
      "<Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/>" +
      sheets.map((_sheet, index) =>
        `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
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
        `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`
      ).join("") +
      "</sheets></workbook>",
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      "<?xml version=\"1.0\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
      sheets.map((_sheet, index) =>
        `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`
      ).join("") +
      "</Relationships>",
    ),
  };
  sheets.forEach((sheet, index) => {
    files[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(
      "<?xml version=\"1.0\"?><worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><sheetData>" +
      sheet.rows.join("") +
      "</sheetData></worksheet>",
    );
  });
  return zipSync(files);
}

const ishida: RosterExtractionCandidate = {
  tournamentId: "T-11111111-1111-4111-8111-111111111111",
  memberId: "M-11111111-1111-4111-8111-111111111111",
  displayName: "石田洋音",
  grade: "C",
};

describe("roster auto fill", () => {
  it("申込確認名簿の分割氏名と級を照合する", () => {
    const source = workbook([{
      name: "申込者一覧",
      rows: [
        row(1, cell("A1", "姓") + cell("B1", "名") + cell("C1", "所属会") + cell("D1", "参加級")),
        row(2, cell("A2", "石田") + cell("B2", "洋音") + cell("C2", "埼玉大学かるた会") + cell("D2", "C級")),
      ],
    }]);

    expect(checkApplicationRoster(source, [ishida]).predictions[0]).toMatchObject({
      status: "matched",
      sheetName: "申込者一覧",
      cellReference: "A2",
    });
  });

  it("氏名はあっても級が違えば要確認にする", () => {
    const source = workbook([{
      name: "D級",
      rows: [
        row(1, cell("A1", "氏名") + cell("B1", "所属")),
        row(2, cell("A2", "石田 洋音") + cell("B2", "埼玉大学かるた会")),
      ],
    }]);

    expect(checkApplicationRoster(source, [ishida]).predictions[0]).toMatchObject({
      status: "needs_review",
      sheetName: "D級",
    });
  });

  it("明示的な出場確定とキャンセル待ち番号を仮入力する", () => {
    const takada = { ...ishida, memberId: "M-22222222-2222-4222-8222-222222222222", displayName: "髙田脩矢" };
    const source = workbook([{
      name: "C級抽選結果",
      rows: [
        row(1, cell("A1", "氏名") + cell("B1", "所属") + cell("C1", "抽選結果") + cell("D1", "キャンセル待ち順位")),
        row(2, cell("A2", "石田洋音") + cell("B2", "埼玉大学かるた会") + cell("C2", "○")),
        row(3, cell("A3", "高田 脩矢") + cell("B3", "埼玉大学かるた会") + cell("C3", "×") + cell("D3", "24")),
      ],
    }]);

    const report = extractLotteryRoster(source, [ishida, takada]);
    expect(report.matchedCount).toBe(2);
    expect(report.predictions).toEqual([
      expect.objectContaining({ status: "matched", entryStatus: "selected", waitlistNumber: null }),
      expect.objectContaining({ status: "matched", entryStatus: "not_selected", waitlistNumber: 24 }),
    ]);
  });

  it("確定者名簿の記載者だけを出場確定にし、不記載者を落選にしない", () => {
    const missing = { ...ishida, memberId: "M-33333333-3333-4333-8333-333333333333", displayName: "佐藤花子" };
    const source = workbook([{
      name: "参加者リスト（確定）",
      rows: [
        row(1, cell("A1", "参加者名簿") + cell("B1", "氏名") + cell("C1", "所属会名") + cell("D1", "注記")),
        row(2, cell("B2", "石田洋音") + cell("C2", "埼玉大学かるた会") + cell("D2", "未申込・落選は保留")),
      ],
    }]);

    const report = extractLotteryRoster(source, [ishida, missing]);
    expect(report.predictions[0]).toMatchObject({ status: "matched", entryStatus: "selected" });
    expect(report.predictions[1]).toMatchObject({ status: "not_found", entryStatus: null });
  });

  it("通過者とキャンセル待ちの別区分を読む", () => {
    const takada = { ...ishida, memberId: "M-22222222-2222-4222-8222-222222222222", displayName: "髙田脩矢" };
    const source = workbook([{
      name: "C級",
      rows: [
        row(1, cell("A1", "抽選通過者名簿")),
        row(2, cell("A2", "氏名") + cell("B2", "所属")),
        row(3, cell("A3", "石田洋音") + cell("B3", "埼玉大学かるた会")),
        row(5, cell("A5", "キャンセル待ち名簿") + cell("C5", "待ち番号")),
        row(6, cell("A6", "高田脩矢") + cell("B6", "埼玉大学かるた会") + cell("C6", "3")),
      ],
    }]);

    const report = extractLotteryRoster(source, [ishida, takada]);
    expect(report.predictions[0]).toMatchObject({ status: "matched", entryStatus: "selected" });
    expect(report.predictions[1]).toMatchObject({ status: "matched", entryStatus: "not_selected", waitlistNumber: 3 });
  });
});
