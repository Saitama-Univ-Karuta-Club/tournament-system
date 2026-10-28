import { describe, expect, it } from "vitest";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import {
  ExcelAutoFillError,
  detectExcelLayout,
  fillExcelApplicationRoster,
  readExcelCell,
} from "../src/excel-auto-fill";
import {
  excelParticipant as participant,
  excelProfile as profile,
  standardExcelTemplate as standardTemplate,
} from "./excel-auto-fill-fixtures";

describe("Excel application roster auto-fill", () => {
  it("detects a known template, writes participants, and preserves formulas", () => {
    const template = standardTemplate();
    expect(detectExcelLayout(template, "xlsx", "香川大会CDE級申込み.xlsx"))
      .toBe("all_japan_standard_20");

    const result = fillExcelApplicationRoster({
      template,
      sourceFileName: "香川大会CDE級申込み.xlsx",
      profile,
      participants: [participant],
    });

    expect(result.layoutId).toBe("all_japan_standard_20");
    expect(result.participantCount).toBe(1);
    expect(readExcelCell(result.bytes, "Sheet1", "B3")).toBe("");
    expect(readExcelCell(result.bytes, "Sheet1", "F3")).toBe("埼玉県");
    expect(readExcelCell(result.bytes, "Sheet1", "F4")).toBe("埼玉大学かるた会");
    expect(readExcelCell(result.bytes, "Sheet1", "F5")).toBe("石田洋音");
    expect(readExcelCell(result.bytes, "Sheet1", "F6")).toBe("090-0000-0000");
    expect(readExcelCell(result.bytes, "Sheet1", "F7")).toBe("saitama.iroha@gmail.com");
    expect(readExcelCell(result.bytes, "Sheet1", "F8")).toBe("");
    expect(readExcelCell(result.bytes, "Sheet1", "B12")).toBe("C級");
    expect(readExcelCell(result.bytes, "Sheet1", "E12")).toBe("2段");
    expect(readExcelCell(result.bytes, "Sheet1", "F12")).toBe("石田");
    expect(readExcelCell(result.bytes, "Sheet1", "G12")).toBe("洋音");
    expect(readExcelCell(result.bytes, "Sheet1", "H12")).toBe("いしだ　ひろね");
    expect(readExcelCell(result.bytes, "Sheet1", "I12")).toBe("3");
    expect(readExcelCell(result.bytes, "Sheet1", "F13")).toBe("");
    const sheetXml = strFromU8(unzipSync(result.bytes)["xl/worksheets/sheet1.xml"]);
    expect(sheetXml).toContain("<f>A12+1</f>");
    expect(strFromU8(unzipSync(result.bytes)["xl/workbook.xml"]))
      .toContain('fullCalcOnLoad="1"');
  });

  it("does not write to an unknown layout", () => {
    const template = standardTemplate();
    const files = unzipSync(template);
    files["xl/worksheets/sheet1.xml"] = strToU8(
      strFromU8(files["xl/worksheets/sheet1.xml"]).replace("所属会名", "未知の見出し"),
    );
    expect(() => fillExcelApplicationRoster({
      template: zipSync(files),
      sourceFileName: "unknown.xlsx",
      profile,
      participants: [participant],
    })).toThrowError(ExcelAutoFillError);
  });

  it("stops instead of truncating participants over the template capacity", () => {
    expect(() => fillExcelApplicationRoster({
      template: standardTemplate(),
      sourceFileName: "香川大会CDE級申込み.xlsx",
      profile,
      participants: Array.from({ length: 21 }, (_unused, index) => ({
        ...participant,
        memberId: `M-${index}`,
        firstName: `洋音${index}`,
      })),
    })).toThrowError(/20名を超え/);
  });
});
