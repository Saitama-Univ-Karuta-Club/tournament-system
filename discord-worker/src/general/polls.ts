export interface GeneralPoll {
  id: string;
  title: string;
  description: string | null;
  anonymous: number;
  multiple: number;
  status: "open" | "closed";
  creator_user_id: string;
}
export interface GeneralPollOption {
  option_id: number;
  label: string;
  position: number;
}

export interface GeneralPollVote {
  option_id: number;
  voter_display_name: string | null;
}

export function parsePollOptions(input: string): string[] {
  const options = input
    .split(/\r?\n/)
    .map((option) => option.trim())
    .filter(Boolean);
  if (options.length < 2) throw new Error("選択肢を2件以上入力してください。");
  if (options.length > 20) throw new Error("選択肢は20件までにしてください。");
  if (options.some((option) => option.length > 80)) {
    throw new Error("選択肢は1件80文字以内にしてください。");
  }
  if (new Set(options).size !== options.length) {
    throw new Error("同じ選択肢が重複しています。");
  }
  return options;
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

export function pollMessageData(
  poll: GeneralPoll,
  options: GeneralPollOption[],
  votes: GeneralPollVote[],
): Record<string, unknown> {
  const votesByOption = new Map<number, GeneralPollVote[]>();
  for (const vote of votes) {
    const optionVotes = votesByOption.get(vote.option_id) ?? [];
    optionVotes.push(vote);
    votesByOption.set(vote.option_id, optionVotes);
  }
  const isAnonymous = poll.anonymous === 1;
  const isClosed = poll.status === "closed";
  const fields = options.map((option) => {
    const optionVotes = votesByOption.get(option.option_id) ?? [];
    const names = optionVotes
      .map((vote) => vote.voter_display_name)
      .filter((name): name is string => Boolean(name));
    const voterLine = !isAnonymous && names.length > 0
      ? `\n${truncate(names.join("、"), 950)}`
      : "";
    return {
      name: option.label,
      value: `${optionVotes.length}票${voterLine}`,
      inline: false,
    };
  });
  const optionRows: Array<{ type: number; components: unknown[] }> = [];
  for (let index = 0; index < options.length; index += 5) {
    optionRows.push({
      type: 1,
      components: options.slice(index, index + 5).map((option) => ({
        type: 2,
        style: 2,
        label: truncate(option.label, 80),
        custom_id: `general:poll:vote:${poll.id}:${option.option_id}`,
        disabled: isClosed,
      })),
    });
  }
  return {
    embeds: [{
      title: poll.title,
      description: poll.description || undefined,
      color: isClosed ? 0x777777 : 0x668437,
      fields,
      footer: {
        text: [
          isAnonymous ? "匿名投票" : "記名投票",
          poll.multiple === 1 ? "複数選択可" : "1つ選択",
          isClosed ? "締め切り済み" : "ボタンを押して投票・取り消し",
        ].join("・"),
      },
    }],
    components: [
      ...optionRows,
      {
        type: 1,
        components: [{
          type: 2,
          style: isClosed ? 2 : 4,
          label: isClosed ? "締め切り済み" : "投票を締め切る",
          custom_id: `general:poll:close:${poll.id}`,
          disabled: isClosed,
        }],
      },
    ],
    allowed_mentions: { parse: [] },
  };
}
