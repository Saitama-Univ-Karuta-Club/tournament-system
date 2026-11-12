import { InteractionResponseType, InteractionType, verifyKey } from "discord-interactions";
import { practiceCommands } from "./practice/commands";
import {
  loadTodayPracticeMessage,
  processPracticeNotificationQueue,
  upsertPracticeChannel,
  type PracticeNotificationEnv,
} from "./practice/notifications";
import {
  loadPracticeScheduleReminder,
  processPracticeScheduleNotifications,
  savePracticeScheduleResponse,
  upsertPracticeScheduleChannel,
  type PracticeScheduleResponse,
} from "./practice/schedules";

export interface PracticeBotEnv extends PracticeNotificationEnv {
  DISCORD_PUBLIC_KEY: string;
  DISCORD_APPLICATION_ID?: string;
  DISCORD_GUILD_ID?: string;
}

interface PracticeInteraction {
  type: number;
  guild_id?: string;
  channel_id?: string;
  member?: { user?: { id?: string } };
  data?: {
    name?: string;
    custom_id?: string;
    options?: Array<{ name?: string; type?: number; value?: string }>;
  };
}

type SignatureVerifier = (
  body: string,
  signature: string,
  timestamp: string,
  publicKey: string,
) => Promise<boolean>;

const json = (body: unknown, status = 200): Response => Response.json(body, { status });
const PRACTICE_COMMANDS_VERSION = "2026-11-10-rename-v1";
const DISCORD_ID = /^\d{15,22}$/;
const ephemeral = (content: string, embeds?: unknown[]): Response => json({
  type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
  data: { content, embeds, flags: 64 },
});

export async function registerPracticeCommands(
  env: PracticeBotEnv,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  if (!env.DISCORD_APPLICATION_ID || !env.DISCORD_GUILD_ID || !env.DISCORD_BOT_TOKEN) {
    throw new Error("かるた練習帖のコマンド登録設定が足りません。");
  }
  const response = await fetcher(
    `https://discord.com/api/v10/applications/${env.DISCORD_APPLICATION_ID}/guilds/${env.DISCORD_GUILD_ID}/commands`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(practiceCommands),
    },
  );
  if (!response.ok) {
    throw new Error(`Discordへのコマンド登録に失敗しました (${response.status})`);
  }
}

export async function ensurePracticeCommandsRegistered(
  env: PracticeBotEnv,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  if (!env.DISCORD_APPLICATION_ID || !env.DISCORD_GUILD_ID || !env.DISCORD_BOT_TOKEN) {
    return false;
  }
  const setting = await env.DB.prepare(
    `SELECT practice_commands_version FROM practice_discord_settings
     WHERE guild_id = ?`,
  ).bind(env.DISCORD_GUILD_ID).first<{ practice_commands_version: string | null }>();
  if (setting?.practice_commands_version === PRACTICE_COMMANDS_VERSION) return false;
  await registerPracticeCommands(env, fetcher);
  await env.DB.prepare(
    `UPDATE practice_discord_settings
     SET practice_commands_version = ?,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE guild_id = ?`,
  ).bind(PRACTICE_COMMANDS_VERSION, env.DISCORD_GUILD_ID).run();
  return true;
}

function currentJstDate(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1_000).toISOString().slice(0, 10);
}

export async function handlePracticeBotRequest(
  request: Request,
  env: PracticeBotEnv,
  verifier: SignatureVerifier = verifyKey,
  ctx?: Pick<ExecutionContext, "waitUntil">,
): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/health") {
    try {
      await env.DB.prepare("SELECT 1 AS ok").first();
      return json({ ok: true, service: "sukc-practice-recorder-bot", database: "ok" });
    } catch {
      return json({ ok: false, service: "sukc-practice-recorder-bot", database: "error" }, 503);
    }
  }
  if (request.method !== "POST" || url.pathname !== "/interactions") {
    return new Response("Not Found", { status: 404 });
  }
  const signature = request.headers.get("X-Signature-Ed25519") ?? "";
  const timestamp = request.headers.get("X-Signature-Timestamp") ?? "";
  const body = await request.text();
  if (!signature || !timestamp || !await verifier(body, signature, timestamp, env.DISCORD_PUBLIC_KEY)) {
    return new Response("invalid request signature", { status: 401 });
  }
  const interaction = JSON.parse(body) as PracticeInteraction;
  if (interaction.type === InteractionType.PING) {
    if (ctx && env.DISCORD_APPLICATION_ID && env.DISCORD_GUILD_ID && env.DISCORD_BOT_TOKEN) {
      ctx.waitUntil(ensurePracticeCommandsRegistered(env));
    }
    return json({ type: InteractionResponseType.PONG });
  }
  if (
    interaction.type === InteractionType.MESSAGE_COMPONENT &&
    interaction.data?.custom_id?.startsWith("practice-schedule:")
  ) {
    const match = interaction.data.custom_id.match(
      /^practice-schedule:(PS-[0-9a-f-]{36}):(yes|maybe|no)$/,
    );
    const discordUserId = interaction.member?.user?.id;
    if (!match || !discordUserId) return ephemeral("回答内容を確認できませんでした。");
    try {
      await savePracticeScheduleResponse(
        env,
        discordUserId,
        match[1],
        match[2] as PracticeScheduleResponse,
      );
      return json({
        type: InteractionResponseType.UPDATE_MESSAGE,
        data: await loadPracticeScheduleReminder(env, match[1]),
      });
    } catch (error) {
      return ephemeral(error instanceof Error ? error.message : "回答を保存できませんでした。");
    }
  }
  if (interaction.type !== InteractionType.APPLICATION_COMMAND) {
    return ephemeral("この操作には対応していません。");
  }
  if (interaction.data?.name === "practice-setup") {
    if (!interaction.guild_id || !interaction.channel_id) {
      return ephemeral("サーバー内のチャンネルで実行してください。");
    }
    await upsertPracticeChannel(env.DB, interaction.guild_id, interaction.channel_id);
    return ephemeral("このチャンネルを練習の組み合わせ・札組の投稿先に設定しました。");
  }
  if (interaction.data?.name === "practice-today") {
    const payload = await loadTodayPracticeMessage(env, currentJstDate());
    if (!payload) return ephemeral("今日の組み合わせはまだ作成されていません。");
    return json({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { ...payload, flags: 64 },
    });
  }
  if (interaction.data?.name === "practice-schedule-setup") {
    if (!interaction.guild_id || !interaction.channel_id) {
      return ephemeral("サーバー内のチャンネルで実行してください。");
    }
    await upsertPracticeScheduleChannel(env.DB, interaction.guild_id, interaction.channel_id);
    return ephemeral("このチャンネルを練習日程・前日リマインドの投稿先に設定しました。");
  }
  if (interaction.data?.name === "practice-role-setup") {
    if (!interaction.guild_id) {
      return ephemeral("サーバー内で実行してください。");
    }
    const roleId = interaction.data.options?.find((option) => option.name === "role")?.value;
    if (!roleId || !DISCORD_ID.test(roleId)) {
      return ephemeral("練習担当ロールを確認できませんでした。");
    }
    const result = await env.DB.prepare(
      `UPDATE discord_settings
       SET practice_role_id = ?,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE guild_id = ?`,
    ).bind(roleId, interaction.guild_id).run();
    if ((result.meta?.changes ?? 0) !== 1) {
      return ephemeral("Discordサーバー設定が見つかりません。先に大会Botの初期設定を行ってください。");
    }
    return ephemeral("練習担当ロールを運営管理ポータルに設定しました。反映には再ログインが必要です。");
  }
  return ephemeral("コマンドを確認できませんでした。");
}

export default {
  fetch(request: Request, env: PracticeBotEnv, ctx: ExecutionContext) {
    return handlePracticeBotRequest(request, env, verifyKey, ctx);
  },
  scheduled(_controller: ScheduledController, env: PracticeBotEnv, ctx: ExecutionContext) {
    ctx.waitUntil(Promise.all([
      processPracticeNotificationQueue(env),
      processPracticeScheduleNotifications(env),
      ensurePracticeCommandsRegistered(env).catch((error) => {
        console.error("かるた練習帖のコマンド自動登録エラー", error);
        return false;
      }),
    ]));
  },
} satisfies ExportedHandler<PracticeBotEnv>;
