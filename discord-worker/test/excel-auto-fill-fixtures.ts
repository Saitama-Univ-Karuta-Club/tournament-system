import { strToU8, zipSync } from "fflate";
import type {
  ExcelAutoFillParticipant,
  ExcelAutoFillProfile,
} from "../src/excel-auto-fill";

export const excelProfile: ExcelAutoFillProfile = {
  clubPrefecture: "埼玉県",
  clubName: "埼玉大学かるた会",
  schoolName: "埼玉大学",
  contactName: "石田洋音",
  contactPhone: "090-0000-0000",
  contactEmail: "saitama.iroha@gmail.com",
  remitterName: "石田洋音",
  associationMembership: "あり",
};

export const excelParticipant: ExcelAutoFillParticipant = {
  memberId: "M-1",
  grade: "C",
  rank: 2,
  lastName: "石田",
  firstName: "洋音",
  lastNameKana: "いしだ",
  firstNameKana: "ひろね",
  appearanceCount: 3,
};

function inlineCell(reference: string, value: string, style = "1"): string {
  return `<c r="${reference}" s="${style}" t="inlineStr"><is><t>${value}</t></is></c>`;
}

function emptyCell(reference: string, style = "1"): string {
  return `<c r="${reference}" s="${style}"/>`;
}

export function standardExcelTemplate(): Uint8Array {
  const rows: string[] = [];
  rows.push(`<row r="3">${inlineCell("A3", "都道府県")}${emptyCell("B3")}${emptyCell("F3")}</row>`);
  rows.push(`<row r="4">${inlineCell("A4", "所属会名")}${emptyCell("B4")}${emptyCell("F4")}</row>`);
  for (let row = 5; row <= 8; row += 1) {
    rows.push(`<row r="${row}">${emptyCell(`B${row}`)}${emptyCell(`F${row}`)}</row>`);
  }
  rows.push(`<row r="11">${inlineCell("B11", "参加級")}${inlineCell("E11", "段位")}${inlineCell("F11", "氏")}${inlineCell("G11", "名")}</row>`);
  for (let row = 12; row <= 31; row += 1) {
    const formula = row === 13 ? `<c r="A13" s="1"><f>A12+1</f><v>2</v></c>` : emptyCell(`A${row}`);
    rows.push(
      `<row r="${row}">${formula}${["B", "E", "F", "G", "H", "I", "J"]
        .map((column) => emptyCell(`${column}${row}`))
        .join("")}</row>`,
    );
  }
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.join("")}</sheetData></worksheet>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  return zipSync({
    "[Content_Types].xml": strToU8(`<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(workbook),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`),
    "xl/worksheets/sheet1.xml": strToU8(sheet),
  });
}
