import { describe, expect, it } from "vitest";
import {
  parsePollOptions,
  pollMessageData,
  type GeneralPoll,
} from "../src/general/polls";

const poll: GeneralPoll = {
  id: "poll-1",
  title: "懇親会への参加確認",
  description: "金曜日までに回答してください",
  anonymous: 0,
  multiple: 0,
  status: "open",
  creator_user_id: "creator-1",
};

describe("general polls", () => {
  it("parses unique non-empty options", () => {
    expect(parsePollOptions("参加\n\n不参加\n 未定 ")).toEqual(["参加", "不参加", "未定"]);
    expect(() => parsePollOptions("参加")).toThrow("2件以上");
    expect(() => parsePollOptions("参加\n参加")).toThrow("重複");
    expect(() => parsePollOptions(
      Array.from({ length: 21 }, (_, index) => `選択肢${index + 1}`).join("\n"),
    )).toThrow("20件まで");
  });

  it("shows voter names in a named poll", () => {
    const data = pollMessageData(
      poll,
      [
        { option_id: 1, label: "参加", position: 0 },
        { option_id: 2, label: "不参加", position: 1 },
      ],
      [
        { option_id: 1, voter_display_name: "石田" },
        { option_id: 1, voter_display_name: "田中" },
      ],
    ) as { embeds: Array<{ fields: Array<{ value: string }>; footer: { text: string } }> };
    expect(data.embeds[0].fields[0].value).toBe("2票\n石田、田中");
    expect(data.embeds[0].footer.text).toContain("記名投票");
  });

  it("shows option labels without automatic numbering", () => {
    const data = pollMessageData(
      poll,
      [
        { option_id: 1, label: "1", position: 0 },
        { option_id: 2, label: "A案", position: 1 },
      ],
      [],
    ) as {
      embeds: Array<{ fields: Array<{ name: string }> }>;
      components: Array<{ components: Array<{ label: string }> }>;
    };
    expect(data.embeds[0].fields.map((field) => field.name)).toEqual(["1", "A案"]);
    expect(data.components[0].components.map((button) => button.label)).toEqual(["1", "A案"]);
  });

  it("hides voter names in an anonymous poll", () => {
    const data = pollMessageData(
      { ...poll, anonymous: 1 },
      [{ option_id: 1, label: "A案", position: 0 }],
      [{ option_id: 1, voter_display_name: "表示されない名前" }],
    ) as { embeds: Array<{ fields: Array<{ value: string }>; footer: { text: string } }> };
    expect(data.embeds[0].fields[0].value).toBe("1票");
    expect(data.embeds[0].footer.text).toContain("匿名投票");
  });

  it("fits twenty choices and closing controls into five component rows", () => {
    const options = Array.from({ length: 20 }, (_, index) => ({
      option_id: index + 1,
      label: `選択肢${index + 1}`,
      position: index,
    }));
    const data = pollMessageData(poll, options, []) as {
      components: Array<{ components: Array<{ custom_id: string; disabled: boolean }> }>;
    };
    expect(data.components).toHaveLength(5);
    const customIds = data.components.flatMap((row) => row.components.map((item) => item.custom_id));
    expect(new Set(customIds).size).toBe(customIds.length);
  });

  it("disables all controls after the poll closes", () => {
    const data = pollMessageData(
      { ...poll, status: "closed" },
      [{ option_id: 1, label: "参加", position: 0 }],
      [],
    ) as { components: Array<{ components: Array<{ disabled: boolean }> }> };
    expect(data.components.flatMap((row) => row.components).every((item) => item.disabled)).toBe(true);
  });

});
