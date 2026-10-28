import { describe, expect, it } from "vitest";
import { buildPracticePairingMessage } from "../src/practice/notifications";

describe("practice Discord messages", () => {
  it("contains the shared card selection and every pairing", () => {
    const message = buildPracticePairingMessage({
      session: {
        session_id: "P-test",
        practice_date: "2026-10-28",
        title: "通常練習",
        location: "大学会館",
        pairing_mode: "near_grade",
        card_scheme: "hiragana",
        card_selection_json: JSON.stringify(["あ", "う", "お", "き", "こ"]),
      },
      roundNumber: 2,
      matches: [
        { round_number: 2, player1_name: "石田", player2_name: "佐藤", status: "scheduled" },
        { round_number: 2, player1_name: "田中", player2_name: "鈴木", status: "scheduled" },
        { round_number: 2, player1_name: "山田", player2_name: null, status: "bye" },
      ],
      portalUrl: "https://portal.example.com",
    });

    expect(message.content).toContain("練習記録屋さん");
    expect(message.embeds?.[0]).toMatchObject({
      title: "2026-10-28 通常練習",
      description: "会場：大学会館",
    });
    expect(message.embeds?.[0]?.fields).toContainEqual(expect.objectContaining({
      name: "使用札",
      value: expect.stringContaining("あ・う・お・き・こ"),
    }));
    expect(message.embeds?.[0]?.fields).toContainEqual(expect.objectContaining({
      name: "第2試合",
      value: expect.stringContaining("1組　石田 — 佐藤"),
    }));
    expect(message.embeds?.[0]?.fields).toContainEqual(expect.objectContaining({
      value: expect.stringContaining("休み　山田"),
    }));
    expect(message.embeds?.[0]?.fields).toContainEqual(expect.objectContaining({
      value: "[メンバーポータルを開く](https://portal.example.com/#practice)",
    }));
  });
});
