import type { DiscordMessagePayload } from "./discord-api";

export const BOT_MESSAGE_DEFINITIONS = [
  {
    key: "announcement_new",
    category: "大会案内・参加回答",
    label: "新規大会追加のお知らせ",
    recipient: "大会お知らせチャンネル",
    defaultContent: "【新規大会追加のお知らせ】\n対象者のDMへ参加確認を送信しました。",
  },
  {
    key: "announcement_update",
    category: "大会案内・参加回答",
    label: "大会情報更新のお知らせ",
    recipient: "大会お知らせチャンネル",
    defaultContent: "【大会情報更新】\n変更後の内容を対象者のDMへ再送します。",
  },
  {
    key: "attendance_request",
    category: "大会案内・参加回答",
    label: "大会参加確認",
    recipient: "対象メンバーのDM",
    defaultContent: "大会への参加意思を選択してください。",
  },
  {
    key: "attendance_update",
    category: "大会案内・参加回答",
    label: "大会情報更新後の参加確認",
    recipient: "対象メンバーのDM",
    defaultContent: "【大会情報更新】内容が変更されました。参加意思をもう一度確認してください。",
  },
  {
    key: "response_reminder_channel",
    category: "大会案内・参加回答",
    label: "未回答リマインダー",
    recipient: "大会お知らせチャンネル",
    defaultContent: "サークル内締切の2日前です。未回答の方はお早めに回答お願いします。",
  },
  {
    key: "response_reminder_dm",
    category: "大会案内・参加回答",
    label: "未回答者へのリマインダー",
    recipient: "未回答メンバーのDM",
    defaultContent: "【回答締切リマインダー】まだ回答が登録されていません。サークル内締切までに参加意思を選択してください。",
  },
  {
    key: "internal_deadline",
    category: "申込・抽選",
    label: "サークル内締切後の申込通知",
    recipient: "大会担当チャンネル",
    defaultContent: "サークル内締切を過ぎました。参加希望者を確認し、申し込みを行なってください。",
  },
  {
    key: "organizer_deadline",
    category: "申込・抽選",
    label: "主催者締切日の緊急通知",
    recipient: "大会担当チャンネル",
    defaultContent: "**本日が主催者締切日です。参加希望者リストを確認し、すぐに申し込みを行なってください。**\nすでに申込済みの場合は、大会ステータスを「申込完了」に変更してください。",
  },
  {
    key: "application_completed",
    category: "申込・抽選",
    label: "大会申込完了",
    recipient: "大会お知らせチャンネル",
    defaultContent: "【申込完了】主催者への大会申込が完了しました。",
  },
  {
    key: "confirmation_roster",
    category: "申込・抽選",
    label: "抽選前の確認名簿",
    recipient: "申込者のDM",
    defaultContent: "主催者から抽選前の確認名簿が届きました。氏名・出場級を確認してください。\n万が一誤りがある場合は、お早めに大会担当者までお知らせください。",
  },
  {
    key: "lottery_result",
    category: "申込・抽選",
    label: "抽選結果・確定名簿",
    recipient: "大会お知らせチャンネル",
    defaultContent: "【出場者・キャンセル待ち確定】抽選結果をお知らせします。",
  },
  {
    key: "participant_guidance",
    category: "参加費・当日案内",
    label: "出場確定者への案内",
    recipient: "出場確定者のDM",
    defaultContent: "【参加者向け案内】出場確定者へのお知らせです。",
  },
  {
    key: "payment_reminder_dm",
    category: "参加費・当日案内",
    label: "参加費未納リマインダー",
    recipient: "未納メンバーのDM",
    defaultContent: "【参加費リマインダー】サークル内支払期限を過ぎています。お早めにお支払いください。\n出場をキャンセルする場合は、大会担当者までお知らせください。",
  },
  {
    key: "payment_reminder_channel",
    category: "参加費・当日案内",
    label: "参加費未納者の担当者通知",
    recipient: "大会担当チャンネル",
    defaultContent: "【参加費リマインダー】サークル内支払期限を過ぎました。",
  },
  {
    key: "organizer_payment_info",
    category: "参加費・当日案内",
    label: "主催者への振込情報",
    recipient: "大会担当チャンネル",
    defaultContent: "【担当者向け・参加費振込情報】抽選結果と出場確定者が登録されました。主催者への振込内容を確認してください。",
  },
  {
    key: "organizer_payment_overdue",
    category: "参加費・当日案内",
    label: "主催者への振込未完了通知",
    recipient: "大会担当チャンネル",
    defaultContent: "**【至急・主催者への振込未完了】本日が主催締切日です。主催者への参加費振込が未完了です。すぐに振込を行い、管理画面で「振込済み」に変更してください。**",
  },
  {
    key: "member_registration_approved",
    category: "メンバーシステム",
    label: "メンバー登録承認",
    recipient: "申請者のDM",
    defaultContent: "【メンバー登録承認】\n新規メンバー登録が承認されました。大会お知らせくんを利用できます。",
  },
  {
    key: "member_update_approved",
    category: "メンバーシステム",
    label: "登録内容更新承認",
    recipient: "申請者のDM",
    defaultContent: "【登録内容更新承認】\nメンバー登録内容の変更が承認されました。",
  },
  {
    key: "backup_failure",
    category: "メンバーシステム",
    label: "バックアップ失敗",
    recipient: "大会担当チャンネル",
    defaultContent: "⚠️ Google Driveバックアップに失敗しました。",
  },
] as const;

export type BotMessageKey = typeof BOT_MESSAGE_DEFINITIONS[number]["key"];

export interface BotMessageSettingView {
  key: BotMessageKey;
  category: string;
  label: string;
  recipient: string;
  content: string;
  defaultContent: string;
  customized: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
}

const DEFINITIONS_BY_KEY = new Map(
  BOT_MESSAGE_DEFINITIONS.map((definition) => [definition.key, definition]),
);

export class BotMessageSettingError extends Error {
  constructor(message: string, public statusCode = 400) {
    super(message);
    this.name = "BotMessageSettingError";
  }
}

export function isBotMessageKey(value: string): value is BotMessageKey {
  return DEFINITIONS_BY_KEY.has(value as BotMessageKey);
}

export function defaultBotMessageContent(key: BotMessageKey): string {
  return DEFINITIONS_BY_KEY.get(key)!.defaultContent;
}

export async function resolveBotMessageContent(
  db: D1Database,
  key: BotMessageKey,
): Promise<string> {
  const row = await db.prepare(
    `SELECT content FROM bot_message_settings WHERE message_key = ? LIMIT 1`,
  ).bind(key).first<{ content: string }>();
  return row?.content ?? defaultBotMessageContent(key);
}

export async function applyBotMessageContent(
  db: D1Database,
  key: BotMessageKey,
  payload: DiscordMessagePayload,
  suffix = "",
): Promise<DiscordMessagePayload> {
  return { ...payload, content: `${await resolveBotMessageContent(db, key)}${suffix}` };
}

export async function listBotMessageSettings(
  db: D1Database,
): Promise<BotMessageSettingView[]> {
  const rows = await db.prepare(
    `SELECT message_key, content, updated_at, updated_by
     FROM bot_message_settings`,
  ).all<{
    message_key: string;
    content: string;
    updated_at: string;
    updated_by: string;
  }>();
  const overrides = new Map(rows.results.map((row) => [row.message_key, row]));
  return BOT_MESSAGE_DEFINITIONS.map((definition) => {
    const override = overrides.get(definition.key);
    return {
      ...definition,
      content: override?.content ?? definition.defaultContent,
      customized: Boolean(override),
      updatedAt: override?.updated_at ?? null,
      updatedBy: override?.updated_by ?? null,
    };
  });
}

function normalizeContent(content: unknown): string {
  if (typeof content !== "string") {
    throw new BotMessageSettingError("本文を入力してください。");
  }
  const normalized = content.replace(/\r\n?/g, "\n").trim();
  if (!normalized) throw new BotMessageSettingError("本文を入力してください。");
  if (normalized.length > 2000) {
    throw new BotMessageSettingError("本文は2000文字以内にしてください。");
  }
  return normalized;
}

export async function saveBotMessageSetting(
  db: D1Database,
  key: string,
  content: unknown,
  updatedBy: string,
  now = new Date().toISOString(),
): Promise<BotMessageSettingView> {
  if (!isBotMessageKey(key)) {
    throw new BotMessageSettingError("メッセージの種類が不正です。", 404);
  }
  const normalized = normalizeContent(content);
  await db.prepare(
    `INSERT INTO bot_message_settings (message_key, content, updated_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(message_key) DO UPDATE SET
       content = excluded.content,
       updated_by = excluded.updated_by,
       updated_at = excluded.updated_at`,
  ).bind(key, normalized, updatedBy, now, now).run();
  const definition = DEFINITIONS_BY_KEY.get(key)!;
  return {
    ...definition,
    content: normalized,
    customized: true,
    updatedAt: now,
    updatedBy,
  };
}

export async function resetBotMessageSetting(
  db: D1Database,
  key: string,
): Promise<BotMessageSettingView> {
  if (!isBotMessageKey(key)) {
    throw new BotMessageSettingError("メッセージの種類が不正です。", 404);
  }
  await db.prepare(
    `DELETE FROM bot_message_settings WHERE message_key = ?`,
  ).bind(key).run();
  const definition = DEFINITIONS_BY_KEY.get(key)!;
  return {
    ...definition,
    content: definition.defaultContent,
    customized: false,
    updatedAt: null,
    updatedBy: null,
  };
}
