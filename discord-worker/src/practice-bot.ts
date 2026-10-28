import { InteractionResponseType, InteractionType, verifyKey } from "discord-interactions";
import { practiceCommands } from "./practice/commands";
import {
  loadTodayPracticeMessage,
  processPracticeNotificationQueue,
  upsertPracticeChannel,
  type PracticeNotificationEnv,
} from "./practice/notifications";

export interface PracticeBotEnv extends PracticeNotificationEnv {
  DISCORD_PUBLIC_KEY: string;
  DISCORD_APPLICATION_ID?: string;
  DISCORD_GUILD_ID?: string;
}

interface PracticeInteraction {
  type: number;
  guild_id?: string;
  channel_id?: string;
  data?: { name?: string };
}

type SignatureVerifier = (
  body: string,
  signature: string,
  timestamp: string,
  publicKey: string,
) => Promise<boolean>;

const json = (body: unknown, status = 200): Response => Response.json(body, { status });
const ephemeral = (content: string, embeds?: unknown[]): Response => json({
  type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
  data: { content, embeds, flags: 64 },
});

export async function registerPracticeCommands(env: PracticeBotEnv): Promise<void> {
  if (!env.DISCORD_APPLICATION_ID || !env.DISCORD_GUILD_ID || !env.DISCORD_BOT_TOKEN) {
    throw new Error("練習記録屋さんのコマンド登録設定が足りません。");
  }
  const response = await fetch(
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
      ctx.waitUntil(registerPracticeCommands(env));
    }
    return json({ type: InteractionResponseType.PONG });
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
  return ephemeral("コマンドを確認できませんでした。");
}

export default {
  fetch(request: Request, env: PracticeBotEnv, ctx: ExecutionContext) {
    return handlePracticeBotRequest(request, env, verifyKey, ctx);
  },
  scheduled(_controller: ScheduledController, env: PracticeBotEnv, ctx: ExecutionContext) {
    ctx.waitUntil(processPracticeNotificationQueue(env));
  },
} satisfies ExportedHandler<PracticeBotEnv>;
