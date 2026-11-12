import { describe, expect, it } from "vitest";
import {
  parseScheduleCandidates,
  scheduleAnswerPanelData,
  scheduleMessageData,
  scheduleSummaryData,
  type GeneralSchedule,
  type GeneralScheduleCandidate,
} from "../src/general/schedules";

const schedule: GeneralSchedule = {
  id: "schedule-1",
  channel_id: "channel-1",
  message_id: "message-1",
  creator_user_id: "creator-1",
  title: "懇親会の日程調整",
  description: "土日の候補です",
  status: "open",
};

const candidates: GeneralScheduleCandidate[] = [
  {
    candidate_id: 1,
    label: "11月7日（土）18:00〜",
    position: 0,
    yes_count: 2,
    maybe_count: 0,
    no_count: 1,
    respondent_count: 3,
  },
  {
    candidate_id: 2,
    label: "11月8日（日）12:00〜",
    position: 1,
    yes_count: 1,
    maybe_count: 1,
    no_count: 1,
    respondent_count: 3,
  },
];

describe("general schedule coordination", () => {
  it("parses unique candidate labels", () => {
    expect(parseScheduleCandidates("11月7日\n\n11月8日 ")).toEqual(["11月7日", "11月8日"]);
    expect(() => parseScheduleCandidates("11月7日")).toThrow("2件以上");
    expect(() => parseScheduleCandidates("11月7日\n11月7日")).toThrow("重複");
    expect(() => parseScheduleCandidates(
      Array.from({ length: 21 }, (_, index) => `${index + 1}日`).join("\n"),
    )).toThrow("20件まで");
  });

  it("marks the highest scoring candidate and shows counts", () => {
    const data = scheduleMessageData(schedule, candidates) as {
      embeds: Array<{
        description: string;
        fields: Array<{ name: string; value: string }>;
      }>;
      components: Array<{ components: Array<{ custom_id: string }> }>;
    };
    expect(data.embeds[0].description).toContain("回答者: 3人");
    expect(data.embeds[0].fields[0]).toMatchObject({
      name: "★ 11月7日（土）18:00〜",
      value: "○ 2　△ 0　× 1",
    });
    expect(data.embeds[0].fields[1].name).not.toContain("★");
    const customIds = data.components.flatMap((row) => (
      row.components.map((component) => component.custom_id)
    ));
    expect(new Set(customIds).size).toBe(customIds.length);
  });

  it("shows four candidates per private answer page and restores defaults", () => {
    const manyCandidates = Array.from({ length: 6 }, (_, index) => ({
      candidate_id: index + 1,
      label: `${index + 1}日`,
      position: index,
    }));
    const data = scheduleAnswerPanelData(
      schedule,
      manyCandidates,
      [{ candidate_id: 1, discord_user_id: "user-1", display_name: "石田", response: "yes" }],
      0,
      true,
    ) as {
      flags: number;
      components: Array<{
        components: Array<{
          custom_id: string;
          options?: Array<{ value: string; default: boolean }>;
        }>;
      }>;
    };
    expect(data.flags).toBe(64);
    expect(data.components).toHaveLength(5);
    expect(data.components[0].components[0].options?.find((option) => option.value === "yes")?.default)
      .toBe(true);
    const customIds = data.components.flatMap((row) => (
      row.components.map((component) => component.custom_id)
    ));
    expect(new Set(customIds).size).toBe(customIds.length);

    const secondPage = scheduleAnswerPanelData(schedule, manyCandidates, [], 1, false) as {
      flags?: number;
      components: unknown[];
    };
    expect(secondPage.flags).toBeUndefined();
    expect(secondPage.components).toHaveLength(3);
  });

  it("lists names by answer without mentioning users", () => {
    const data = scheduleSummaryData(
      schedule,
      candidates,
      [
        { candidate_id: 1, discord_user_id: "1", display_name: "石田", response: "yes" },
        { candidate_id: 1, discord_user_id: "2", display_name: "田中", response: "maybe" },
      ],
      0,
      true,
    ) as { content: string; flags: number; allowed_mentions: { parse: string[] } };
    expect(data.content).toContain("○ 石田");
    expect(data.content).toContain("△ 田中");
    expect(data.flags).toBe(64);
    expect(data.allowed_mentions.parse).toEqual([]);
  });

  it("disables answering and closing after the schedule closes", () => {
    const data = scheduleMessageData(
      { ...schedule, status: "closed" },
      candidates,
    ) as { components: Array<{ components: Array<{ label: string; disabled?: boolean }> }> };
    const controls = data.components[0].components;
    expect(controls.find((control) => control.label === "回答する")?.disabled).toBe(true);
    expect(controls.find((control) => control.label === "締め切り済み")?.disabled).toBe(true);
  });
});
