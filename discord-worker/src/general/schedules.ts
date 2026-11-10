export type ScheduleAnswer = "yes" | "maybe" | "no";

export interface GeneralSchedule {
  id: string;
  channel_id: string;
  message_id: string | null;
  creator_user_id: string;
  title: string;
  description: string | null;
  status: "open" | "closed";
}

export interface GeneralScheduleCandidate {
  candidate_id: number;
  label: string;
  position: number;
  yes_count?: number;
  maybe_count?: number;
  no_count?: number;
  respondent_count?: number;
}

export interface GeneralScheduleResponse {
  candidate_id: number;
  discord_user_id: string;
  display_name: string;
  response: ScheduleAnswer;
}

export const SCHEDULE_PAGE_SIZE = 4;

export function parseScheduleCandidates(input: string): string[] {
  const candidates = input
    .split(/\r?\n/)
    .map((candidate) => candidate.trim())
    .filter(Boolean);
  if (candidates.length < 2) throw new Error("候補日時を2件以上入力してください。");
  if (candidates.length > 20) throw new Error("候補日時は20件までにしてください。");
  if (candidates.some((candidate) => candidate.length > 80)) {
    throw new Error("候補日時は1件80文字以内にしてください。");
  }
  if (new Set(candidates).size !== candidates.length) {
    throw new Error("同じ候補日時が重複しています。");
  }
  return candidates;
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function count(candidate: GeneralScheduleCandidate, key: "yes_count" | "maybe_count" | "no_count") {
  return Number(candidate[key] ?? 0);
}

export function scheduleMessageData(
  schedule: GeneralSchedule,
  candidates: GeneralScheduleCandidate[],
): Record<string, unknown> {
  const isClosed = schedule.status === "closed";
  const scores = candidates.map((candidate) => (
    count(candidate, "yes_count") * 2 + count(candidate, "maybe_count")
  ));
  const hasResponses = candidates.some((candidate) => (
    count(candidate, "yes_count") + count(candidate, "maybe_count") + count(candidate, "no_count") > 0
  ));
  const bestScore = hasResponses ? Math.max(...scores) : -1;
  const respondentCount = Number(candidates[0]?.respondent_count ?? 0);
  const description = [
    schedule.description,
    `回答者: ${respondentCount}人`,
  ].filter(Boolean).join("\n\n");

  return {
    embeds: [{
      title: schedule.title,
      description,
      color: isClosed ? 0x777777 : 0x668437,
      fields: candidates.map((candidate, index) => ({
        name: `${hasResponses && scores[index] === bestScore ? "★ " : ""}${candidate.label}`,
        value: `○ ${count(candidate, "yes_count")}　△ ${count(candidate, "maybe_count")}　× ${count(candidate, "no_count")}`,
        inline: false,
      })),
      footer: {
        text: isClosed
          ? "締め切り済み"
          : "★は現在の最適候補（○2点・△1点）",
      },
    }],
    components: [{
      type: 1,
      components: [
        {
          type: 2,
          style: 1,
          label: "回答する",
          custom_id: `general:schedule:answer:${schedule.id}`,
          disabled: isClosed,
        },
        {
          type: 2,
          style: 2,
          label: "回答一覧",
          custom_id: `general:schedule:summary:${schedule.id}:0`,
        },
        {
          type: 2,
          style: isClosed ? 2 : 4,
          label: isClosed ? "締め切り済み" : "締め切る",
          custom_id: `general:schedule:close:${schedule.id}`,
          disabled: isClosed,
        },
      ],
    }],
    allowed_mentions: { parse: [] },
  };
}

export function scheduleAnswerPanelData(
  schedule: GeneralSchedule,
  candidates: GeneralScheduleCandidate[],
  responses: GeneralScheduleResponse[],
  requestedPage: number,
  initial: boolean,
): Record<string, unknown> {
  const totalPages = Math.max(1, Math.ceil(candidates.length / SCHEDULE_PAGE_SIZE));
  const page = Math.max(0, Math.min(totalPages - 1, requestedPage));
  const pageCandidates = candidates.slice(
    page * SCHEDULE_PAGE_SIZE,
    (page + 1) * SCHEDULE_PAGE_SIZE,
  );
  const answers = new Map(responses.map((response) => [response.candidate_id, response.response]));
  const answerRows = pageCandidates.map((candidate) => ({
    type: 1,
    components: [{
      type: 3,
      custom_id: `general:schedule:choice:${schedule.id}:${page}:${candidate.candidate_id}`,
      placeholder: truncate(candidate.label, 150),
      min_values: 1,
      max_values: 1,
      options: [
        { label: "○ 参加できる", value: "yes", default: answers.get(candidate.candidate_id) === "yes" },
        { label: "△ 未定", value: "maybe", default: answers.get(candidate.candidate_id) === "maybe" },
        { label: "× 参加できない", value: "no", default: answers.get(candidate.candidate_id) === "no" },
      ],
    }],
  }));
  return {
    content: `**${schedule.title}**\n候補ごとに回答してください（${page + 1}/${totalPages}ページ）`,
    ...(initial ? { flags: 64 } : {}),
    components: [
      ...answerRows,
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 2,
            label: "前へ",
            custom_id: `general:schedule:page-prev:${schedule.id}:${Math.max(0, page - 1)}`,
            disabled: page === 0,
          },
          {
            type: 2,
            style: 2,
            label: "次へ",
            custom_id: `general:schedule:page-next:${schedule.id}:${Math.min(totalPages - 1, page + 1)}`,
            disabled: page + 1 >= totalPages,
          },
          {
            type: 2,
            style: 2,
            label: "全回答を消去",
            custom_id: `general:schedule:clear:${schedule.id}:${page}`,
          },
          {
            type: 2,
            style: 3,
            label: "回答を完了",
            custom_id: `general:schedule:finish:${schedule.id}:${page}`,
          },
        ],
      },
    ],
    allowed_mentions: { parse: [] },
  };
}

export function scheduleSummaryData(
  schedule: GeneralSchedule,
  candidates: GeneralScheduleCandidate[],
  responses: GeneralScheduleResponse[],
  requestedPage: number,
  initial: boolean,
): Record<string, unknown> {
  const totalPages = Math.max(1, Math.ceil(candidates.length / SCHEDULE_PAGE_SIZE));
  const page = Math.max(0, Math.min(totalPages - 1, requestedPage));
  const pageCandidates = candidates.slice(
    page * SCHEDULE_PAGE_SIZE,
    (page + 1) * SCHEDULE_PAGE_SIZE,
  );
  const sections = pageCandidates.map((candidate) => {
    const names = (answer: ScheduleAnswer) => responses
      .filter((response) => response.candidate_id === candidate.candidate_id && response.response === answer)
      .map((response) => response.display_name)
      .join("、") || "なし";
    return `**${candidate.label}**\n○ ${names("yes")}\n△ ${names("maybe")}\n× ${names("no")}`;
  });
  const components = totalPages > 1 ? [{
    type: 1,
    components: [
      {
        type: 2,
        style: 2,
        label: "前へ",
        custom_id: `general:schedule:summary-prev:${schedule.id}:${Math.max(0, page - 1)}`,
        disabled: page === 0,
      },
      {
        type: 2,
        style: 2,
        label: "次へ",
        custom_id: `general:schedule:summary-next:${schedule.id}:${Math.min(totalPages - 1, page + 1)}`,
        disabled: page + 1 >= totalPages,
      },
    ],
  }] : [];
  return {
    content: truncate(`**${schedule.title}：回答一覧**（${page + 1}/${totalPages}ページ）\n\n${sections.join("\n\n")}`, 2000),
    ...(initial ? { flags: 64 } : {}),
    components,
    allowed_mentions: { parse: [] },
  };
}
