import { describe, expect, it, vi } from "vitest";
import {
  applicationEmailDocumentKey,
  applicationEmailDraftFileName,
  buildApplicationEmailEml,
  loadApplicationEmailAttachment,
} from "../src/application-email";
import type { ApplicationEmailTemplate } from "../src/tournaments";

const template: ApplicationEmailTemplate = {
  to: "entry@example.com",
  subject: "テスト大会 C級 申し込み(埼玉大学かるた会)",
  body: "テスト大会 担当者 様\n\nよろしくお願いいたします。\n\n==============================\n埼玉大学かるた会\n石田 洋音",
  mailto: "mailto:entry@example.com",
  attachmentUrl:
    "https://files.example.com/documents/11111111-1111-4111-8111-111111111111/%E3%83%86%E3%82%B9%E3%83%88%E5%A4%A7%E4%BC%9A_C%E7%B4%9A_%E7%94%B3%E8%BE%BC%E5%90%8D%E7%B0%BF.xlsx",
  attachmentFileName: "テスト大会_C級_申込名簿.xlsx",
  attachmentContentType:
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

describe("application email draft", () => {
  it("resolves the private R2 key from the generated roster URL", () => {
    expect(applicationEmailDocumentKey(template.attachmentUrl!)).toBe(
      "documents/11111111-1111-4111-8111-111111111111/テスト大会_C級_申込名簿.xlsx",
    );
    expect(() => applicationEmailDocumentKey("https://files.example.com/other/file.xlsx"))
      .toThrow("R2ファイルを特定できません");
  });

  it("loads the generated Excel file from R2", async () => {
    const arrayBuffer = vi.fn().mockResolvedValue(
      new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer,
    );
    const get = vi.fn().mockResolvedValue({
      arrayBuffer,
      httpMetadata: {
        contentType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
    });

    const attachment = await loadApplicationEmailAttachment(
      { get } as unknown as R2Bucket,
      template,
    );

    expect(get).toHaveBeenCalledWith(
      "documents/11111111-1111-4111-8111-111111111111/テスト大会_C級_申込名簿.xlsx",
    );
    expect(attachment.fileName).toBe("テスト大会_C級_申込名簿.xlsx");
    expect([...attachment.bytes]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it("builds an unsent MIME email containing the Excel attachment", () => {
    const eml = buildApplicationEmailEml(
      template,
      {
        fileName: "テスト大会_C級_申込名簿.xlsx",
        contentType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
      },
      "test-boundary",
    );

    expect(eml).toContain("X-Unsent: 1\r\n");
    expect(eml).toContain("To: entry@example.com\r\n");
    expect(eml).toContain("Content-Type: multipart/mixed; boundary=\"test-boundary\"");
    expect(eml).toContain("Content-Disposition: inline; filename=\"application-roster.xlsx\";");
    expect(eml).toContain(
      "filename*=UTF-8''%E3%83%86%E3%82%B9%E3%83%88%E5%A4%A7%E4%BC%9A_C%E7%B4%9A_%E7%94%B3%E8%BE%BC%E5%90%8D%E7%B0%BF.xlsx",
    );
    expect(eml).toContain("UEsDBA==");
    const compact = eml.replaceAll("\r\n", "");
    const bodyBase64 = btoa(String.fromCharCode(
      ...new TextEncoder().encode("テスト大会 担当者 様\n\nよろしくお願いいたします。\n\n"),
    ));
    const signatureBase64 = btoa(String.fromCharCode(
      ...new TextEncoder().encode("\n\n==============================\n埼玉大学かるた会\n石田 洋音"),
    ));
    const bodyIndex = compact.indexOf(bodyBase64);
    const attachmentIndex = compact.indexOf(
      "Content-Disposition: inline; filename=\"application-roster.xlsx\";",
    );
    const signatureIndex = compact.indexOf(signatureBase64);
    expect(bodyIndex).toBeGreaterThan(-1);
    expect(attachmentIndex).toBeGreaterThan(bodyIndex);
    expect(signatureIndex).toBeGreaterThan(attachmentIndex);
  });

  it("uses a safe Japanese filename for the email draft", () => {
    expect(applicationEmailDraftFileName("テスト大会 C級 申し込み/確認"))
      .toBe("テスト大会 C級 申し込み_確認.eml");
  });
});
