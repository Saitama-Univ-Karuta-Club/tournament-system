export const commands = [
  {
    name: "ping",
    description: "大会管理Botとの接続を確認します",
    type: 1,
  },
  {
    name: "member-register",
    description: "自分を大会管理Botのテスト部員として登録・更新します",
    type: 1,
    options: [
      {
        type: 3,
        name: "name",
        description: "部員一覧と大会申込で使う氏名",
        required: true,
        min_length: 1,
        max_length: 50,
      },
      {
        type: 3,
        name: "grade",
        description: "現在の出場級",
        required: true,
        choices: [
          { name: "A級", value: "A" },
          { name: "B級", value: "B" },
          { name: "C級", value: "C" },
          { name: "D級", value: "D" },
          { name: "E級", value: "E" },
          { name: "F級", value: "F" },
          { name: "初心者", value: "beginner" },
        ],
      },
    ],
  },
  {
    name: "setup-channel",
    description: "このチャンネルを大会Botのテスト告知先に設定します",
    type: 1,
    default_member_permissions: "32",
  },
  {
    name: "test-tournament",
    description: "ボタン付きDMを確認するテスト大会を作成します",
    type: 1,
    default_member_permissions: "32",
    options: [
      {
        type: 3,
        name: "grade",
        description: "DM送信対象の出場級",
        required: true,
        choices: [
          { name: "A級", value: "A" },
          { name: "B級", value: "B" },
          { name: "C級", value: "C" },
          { name: "D級", value: "D" },
          { name: "E級", value: "E" },
          { name: "F級", value: "F" },
          { name: "初心者", value: "beginner" },
        ],
      },
      {
        type: 3,
        name: "title",
        description: "テスト大会名（省略可）",
        required: false,
        min_length: 1,
        max_length: 50,
      },
    ],
  },
] as const;
