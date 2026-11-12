export const generalCommands = [
  {
    name: "amida",
    description: "参加者と行き先からあみだくじを作成します",
    type: 1,
    dm_permission: false,
  },
  {
    name: "poll",
    description: "投票を作成します",
    type: 1,
    dm_permission: false,
    options: [
      {
        type: 5,
        name: "anonymous",
        description: "匿名投票にします（既定: いいえ）",
        required: false,
      },
      {
        type: 5,
        name: "multiple",
        description: "複数の選択肢へ投票できます（既定: いいえ）",
        required: false,
      },
    ],
  },
  {
    name: "schedule",
    description: "複数の候補日時から日程調整を作成します",
    type: 1,
    dm_permission: false,
  },
  {
    name: "help",
    description: "いろいろBOTの使い方を表示します",
    type: 1,
    dm_permission: false,
  },
] as const;
