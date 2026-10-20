import { describe, expect, it, vi } from "vitest";
import {
  applyBotMessageContent,
  BOT_MESSAGE_DEFINITIONS,
  defaultBotMessageContent,
  saveBotMessageSetting,
} from "../src/bot-message-settings";

describe("Discord Bot message settings", () => {
  it("defines editable fixed bodies without dynamic embed data", () => {
    expect(BOT_MESSAGE_DEFINITIONS).toHaveLength(19);
    expect([...new Set(BOT_MESSAGE_DEFINITIONS.map((definition) => definition.category))]).toEqual([
      "大会案内・参加回答",
      "申込・抽選",
      "参加費・当日案内",
      "メンバーシステム",
    ]);
    expect(defaultBotMessageContent("attendance_request")).toBe(
      "大会への参加意思を選択してください。",
    );
    expect(defaultBotMessageContent("organizer_deadline")).toContain(
      "本日が主催者締切日",
    );
  });

  it("applies a saved body while preserving embeds and protected suffixes", async () => {
    const first = vi.fn().mockResolvedValue({ content: "変更後の本文" });
    const bind = vi.fn().mockReturnValue({ first });
    const prepare = vi.fn().mockReturnValue({ bind });
    const payload = {
      content: "初期本文",
      embeds: [{ title: "大会名" }],
    };

    await expect(applyBotMessageContent(
      { prepare } as unknown as D1Database,
      "attendance_request",
      payload,
      "\n現在の回答: **参加希望**",
    )).resolves.toEqual({
      content: "変更後の本文\n現在の回答: **参加希望**",
      embeds: [{ title: "大会名" }],
    });
  });

  it("normalizes and saves an administrator-edited body", async () => {
    const run = vi.fn().mockResolvedValue({});
    const bind = vi.fn().mockReturnValue({ run });
    const prepare = vi.fn().mockReturnValue({ bind });

    const saved = await saveBotMessageSetting(
      { prepare } as unknown as D1Database,
      "announcement_new",
      "  1行目\r\n2行目  ",
      "admin@example.com",
      "2026-10-20T00:00:00.000Z",
    );

    expect(saved.content).toBe("1行目\n2行目");
    expect(saved.customized).toBe(true);
    expect(bind).toHaveBeenCalledWith(
      "announcement_new",
      "1行目\n2行目",
      "admin@example.com",
      "2026-10-20T00:00:00.000Z",
      "2026-10-20T00:00:00.000Z",
    );
  });
});
