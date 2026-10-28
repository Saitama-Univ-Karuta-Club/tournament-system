export const practiceCommands = [
  {
    name: "practice-setup",
    description: "このチャンネルを練習記録屋さんの投稿先に設定します",
    type: 1,
    default_member_permissions: "32",
  },
  {
    name: "practice-today",
    description: "今日の使用札と最新の組み合わせを確認します",
    type: 1,
  },
] as const;
