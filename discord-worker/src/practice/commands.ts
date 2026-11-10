export const practiceCommands = [
  {
    name: "practice-setup",
    description: "このチャンネルをかるた練習帖の投稿先に設定します",
    type: 1,
    default_member_permissions: "32",
  },
  {
    name: "practice-today",
    description: "今日の使用札と最新の組み合わせを確認します",
    type: 1,
  },
  {
    name: "practice-schedule-setup",
    description: "このチャンネルを練習日程とリマインドの投稿先に設定します",
    type: 1,
    default_member_permissions: "32",
  },
  {
    name: "practice-role-setup",
    description: "練習担当ロールを運営管理ポータルの権限に設定します",
    type: 1,
    default_member_permissions: "32",
    options: [
      {
        type: 8,
        name: "role",
        description: "練習担当として使用するロール",
        required: true,
      },
    ],
  },
] as const;
