import {
  InteractionResponseType,
  InteractionType,
  verifyKey,
} from "discord-interactions";
import { commands } from "./commands";
import { serveTournamentDocument } from "./documents";
import {
  formatGrade,
  formatRank,
  normalizeMemberRegistration,
  submitMemberRegistrationRequest,
  type MemberRegistrationRequestResult,
  type RegisterMemberInput,
} from "./members";
import {
  createTestTournamentAndNotify,
  notifyPendingTournaments,
  recordAttendanceResponse,
  sendTestDeadlineReminder,
  type AttendanceInput,
  type TestReminderResult,
  type TestTournamentInput,
  upsertAnnouncementChannel,
  upsertReminderChannel,
} from "./tournaments";

export interface Env {
  DB: D1Database;
  DOCUMENTS?: R2Bucket;
  DISCORD_PUBLIC_KEY: string;
  DISCORD_APPLICATION_ID?: string;
  DISCORD_GUILD_ID?: string;
  DISCORD_BOT_TOKEN?: string;
}

interface DiscordInteraction {
  type: number;
  guild_id?: string;
  channel_id?: string;
  member?: {
    permissions?: string;
    user?: {
      id?: string;
    };
  };
  user?: {
    id?: string;
  };
  data?: {
    name?: string;
    custom_id?: string;
    options?: Array<{
      name: string;
      value?: unknown;
    }>;
  };
}

type SignatureVerifier = (
  body: string,
  signature: string,
  timestamp: string,
  publicKey: string,
) => Promise<boolean>;

type CommandRegistrar = (env: Env) => Promise<void>;
type AnnouncementChannelSetter = (
  env: Env,
  guildId: string,
  channelId: string,
) => Promise<void>;
type ReminderChannelSetter = AnnouncementChannelSetter;
type TestReminderSender = (env: Env) => Promise<TestReminderResult>;
type TestTournamentCreator = (
  env: Env,
  input: TestTournamentInput,
) => Promise<void>;
type AttendanceRecorder = (
  env: Env,
  input: AttendanceInput,
) => Promise<import("./discord-api").DiscordMessagePayload>;
type MemberRegistrar = (
  db: D1Database,
  input: RegisterMemberInput,
) => Promise<MemberRegistrationRequestResult>;

export async function registerGuildCommands(env: Env): Promise<void> {
  if (
    !env.DISCORD_APPLICATION_ID ||
    !env.DISCORD_GUILD_ID ||
    !env.DISCORD_BOT_TOKEN
  ) {
    throw new Error("Discordのコマンド登録設定が足りません。");
  }

  const response = await fetch(
    `https://discord.com/api/v10/applications/${env.DISCORD_APPLICATION_ID}/guilds/${env.DISCORD_GUILD_ID}/commands`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(commands),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Discordへのコマンド登録に失敗しました (${response.status}): ${await response.text()}`,
    );
  }
}

const json = (body: unknown, status = 200): Response =>
  Response.json(body, { status });

const ephemeralMessage = (content: string): Response =>
  json({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { content, flags: 64 },
  });

function getStringOption(
  interaction: DiscordInteraction,
  optionName: string,
): string {
  const option = interaction.data?.options?.find(
    (candidate) => candidate.name === optionName,
  );
  return typeof option?.value === "string" ? option.value : "";
}

function getIntegerOption(
  interaction: DiscordInteraction,
  optionName: string,
): number {
  const option = interaction.data?.options?.find(
    (candidate) => candidate.name === optionName,
  );
  return typeof option?.value === "number" ? option.value : Number.NaN;
}

function canManageGuild(interaction: DiscordInteraction): boolean {
  try {
    const permissions = BigInt(interaction.member?.permissions ?? "0");
    const administrator = 1n << 3n;
    const manageGuild = 1n << 5n;
    return Boolean(
      (permissions & administrator) === administrator ||
        (permissions & manageGuild) === manageGuild,
    );
  } catch {
    return false;
  }
}

function scheduleCommandRegistration(
  env: Env,
  executionContext: Pick<ExecutionContext, "waitUntil"> | undefined,
  commandRegistrar: CommandRegistrar,
): void {
  if (
    !executionContext ||
    !env.DISCORD_APPLICATION_ID ||
    !env.DISCORD_GUILD_ID ||
    !env.DISCORD_BOT_TOKEN
  ) {
    return;
  }

  executionContext.waitUntil(
    commandRegistrar(env).catch((error: unknown) => {
      console.error("Discordコマンド登録エラー", error);
    }),
  );
}

export async function handleRequest(
  request: Request,
  env: Env,
  verifier: SignatureVerifier = verifyKey,
  executionContext?: Pick<ExecutionContext, "waitUntil">,
  commandRegistrar: CommandRegistrar = registerGuildCommands,
  announcementChannelSetter: AnnouncementChannelSetter = upsertAnnouncementChannel,
  testTournamentCreator: TestTournamentCreator = createTestTournamentAndNotify,
  attendanceRecorder: AttendanceRecorder = recordAttendanceResponse,
  memberRegistrar: MemberRegistrar = submitMemberRegistrationRequest,
  reminderChannelSetter: ReminderChannelSetter = upsertReminderChannel,
  testReminderSender: TestReminderSender = sendTestDeadlineReminder,
): Promise<Response> {
  const url = new URL(request.url);

  const documentResponse = await serveTournamentDocument(request, env.DOCUMENTS);
  if (documentResponse) return documentResponse;

  if (request.method === "GET" && url.pathname === "/health") {
    try {
      const database = await env.DB.prepare("SELECT 1 AS ok").first<{
        ok: number;
      }>();
      if (database?.ok !== 1) {
        throw new Error("Unexpected D1 health-check result");
      }
      return json({
        ok: true,
        service: "sukc-tournament-discord-bot",
        database: "ok",
      });
    } catch (error: unknown) {
      console.error("D1ヘルスチェックエラー", error);
      return json(
        {
          ok: false,
          service: "sukc-tournament-discord-bot",
          database: "error",
        },
        503,
      );
    }
  }

  if (request.method !== "POST" || url.pathname !== "/interactions") {
    return new Response("Not Found", { status: 404 });
  }

  const signature = request.headers.get("X-Signature-Ed25519");
  const timestamp = request.headers.get("X-Signature-Timestamp");
  if (!signature || !timestamp || !env.DISCORD_PUBLIC_KEY) {
    return new Response("Invalid request signature", { status: 401 });
  }

  const rawBody = await request.text();
  const isValid = await verifier(
    rawBody,
    signature,
    timestamp,
    env.DISCORD_PUBLIC_KEY,
  );
  if (!isValid) {
    return new Response("Invalid request signature", { status: 401 });
  }

  let interaction: DiscordInteraction;
  try {
    interaction = JSON.parse(rawBody) as DiscordInteraction;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  if (interaction.type === InteractionType.PING) {
    scheduleCommandRegistration(env, executionContext, commandRegistrar);
    return json({ type: InteractionResponseType.PONG });
  }

  if (
    interaction.type === InteractionType.APPLICATION_COMMAND &&
    interaction.data?.name === "ping"
  ) {
    scheduleCommandRegistration(env, executionContext, commandRegistrar);
    return ephemeralMessage("大会管理Botは正常に動作しています。");
  }

  if (
    interaction.type === InteractionType.APPLICATION_COMMAND &&
    interaction.data?.name === "member-register"
  ) {
    if (!env.DISCORD_GUILD_ID || interaction.guild_id !== env.DISCORD_GUILD_ID) {
      return ephemeralMessage("このサーバーではメンバー登録できません。");
    }

    try {
      const registration = await memberRegistrar(env.DB, {
        discordUserId:
          interaction.member?.user?.id ?? interaction.user?.id ?? "",
        displayName: getStringOption(interaction, "name"),
        displayNameKana: getStringOption(interaction, "name-kana"),
        grade: getStringOption(interaction, "grade"),
        rank: getIntegerOption(interaction, "rank"),
      });

      if (registration.requestType === "update") {
        return ephemeralMessage(
          `登録内容変更の申請を受け付けました。\n現在: ${registration.currentDisplayName}（${registration.currentDisplayNameKana || "よみがな未登録"}）・${formatGrade(registration.currentGrade ?? "")}・${formatRank(registration.currentRank ?? 0)}\n申請内容: ${registration.displayName}（${registration.displayNameKana}）・${formatGrade(registration.grade)}・${formatRank(registration.rank)}\n管理者の承認後に反映されます。`,
        );
      }
      return ephemeralMessage(
        `メンバー登録の申請を受け付けました。\n氏名: ${registration.displayName}\nよみがな: ${registration.displayNameKana}\n出場級: ${formatGrade(registration.grade)}\n段位: ${formatRank(registration.rank)}\n管理者の承認後に有効になります。`,
      );
    } catch (error: unknown) {
      console.error("メンバー登録申請エラー", error);
      const message =
        error instanceof Error ? error.message : "不明なエラーが発生しました。";
      return ephemeralMessage(`メンバー登録申請に失敗しました。\n${message}`);
    }
  }

  if (
    interaction.type === InteractionType.APPLICATION_COMMAND &&
    interaction.data?.name === "setup-channel"
  ) {
    if (
      !env.DISCORD_GUILD_ID ||
      interaction.guild_id !== env.DISCORD_GUILD_ID ||
      !interaction.channel_id ||
      !canManageGuild(interaction)
    ) {
      return ephemeralMessage("このチャンネルは告知先に設定できません。");
    }

    try {
      await announcementChannelSetter(
        env,
        interaction.guild_id,
        interaction.channel_id,
      );
      return ephemeralMessage(
        "このチャンネルをテスト大会の告知先に設定しました。",
      );
    } catch (error: unknown) {
      console.error("告知チャンネル設定エラー", error);
      return ephemeralMessage("告知チャンネルの設定に失敗しました。");
    }
  }

  if (
    interaction.type === InteractionType.APPLICATION_COMMAND &&
    interaction.data?.name === "setup-reminder-channel"
  ) {
    if (
      !env.DISCORD_GUILD_ID ||
      interaction.guild_id !== env.DISCORD_GUILD_ID ||
      !interaction.channel_id ||
      !canManageGuild(interaction)
    ) {
      return ephemeralMessage(
        "このチャンネルは管理者用リマインダー送信先に設定できません。",
      );
    }

    try {
      await reminderChannelSetter(
        env,
        interaction.guild_id,
        interaction.channel_id,
      );
      return ephemeralMessage(
        "このチャンネルを管理者用の締切リマインダー送信先に設定しました。",
      );
    } catch (error: unknown) {
      console.error("管理者用リマインダーチャンネル設定エラー", error);
      return ephemeralMessage(
        "管理者用リマインダーチャンネルの設定に失敗しました。",
      );
    }
  }

  if (
    interaction.type === InteractionType.APPLICATION_COMMAND &&
    interaction.data?.name === "test-reminder"
  ) {
    if (
      !env.DISCORD_GUILD_ID ||
      interaction.guild_id !== env.DISCORD_GUILD_ID ||
      !canManageGuild(interaction)
    ) {
      return ephemeralMessage("このサーバーではテスト送信できません。");
    }

    try {
      const result = await testReminderSender(env);
      return ephemeralMessage(
        `管理者用チャンネルへ「${result.tournamentTitle}」のテストリマインダーを送信しました。`,
      );
    } catch (error: unknown) {
      console.error("締切リマインダーテスト送信エラー", error);
      const message =
        error instanceof Error ? error.message : "不明なエラーが発生しました。";
      return ephemeralMessage(`テスト送信に失敗しました。\n${message}`);
    }
  }

  if (
    interaction.type === InteractionType.APPLICATION_COMMAND &&
    interaction.data?.name === "test-tournament"
  ) {
    if (
      !env.DISCORD_GUILD_ID ||
      interaction.guild_id !== env.DISCORD_GUILD_ID ||
      !executionContext ||
      !canManageGuild(interaction)
    ) {
      return ephemeralMessage("このサーバーではテスト大会を作成できません。");
    }

    try {
      const creatorId =
        interaction.member?.user?.id ?? interaction.user?.id ?? "";
      const normalized = normalizeMemberRegistration({
        discordUserId: creatorId,
        displayName:
          getStringOption(interaction, "title") || "Discord Botテスト大会",
        displayNameKana:
          getStringOption(interaction, "title") || "Discord Botテスト大会",
        grade: getStringOption(interaction, "grade"),
        rank: 0,
      });

      executionContext.waitUntil(
        testTournamentCreator(env, {
          grade: normalized.grade,
          title: normalized.displayName,
          createdByDiscordUserId: normalized.discordUserId,
        }).catch((error: unknown) => {
          console.error("テスト大会作成・通知エラー", error);
        }),
      );

      return ephemeralMessage(
        `${formatGrade(normalized.grade)}対象のテスト大会作成とDM送信を開始しました。`,
      );
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "入力値が不正です。";
      return ephemeralMessage(`テスト大会を作成できません。\n${message}`);
    }
  }

  if (
    interaction.type === InteractionType.MESSAGE_COMPONENT &&
    interaction.data?.custom_id?.startsWith("attendance:")
  ) {
    const [, tournamentId, response] = interaction.data.custom_id.split(":");
    try {
      const payload = await attendanceRecorder(env, {
        tournamentId: tournamentId ?? "",
        discordUserId:
          interaction.member?.user?.id ?? interaction.user?.id ?? "",
        response: response ?? "",
      });
      return json({ type: InteractionResponseType.UPDATE_MESSAGE, data: payload });
    } catch (error: unknown) {
      console.error("大会参加回答エラー", error);
      const message =
        error instanceof Error ? error.message : "回答の保存に失敗しました。";
      return ephemeralMessage(`回答を保存できません。\n${message}`);
    }
  }

  return ephemeralMessage("この操作にはまだ対応していません。");
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handleRequest(request, env, verifyKey, ctx);
  },
  scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): void {
    ctx.waitUntil(notifyPendingTournaments(env));
  },
} satisfies ExportedHandler<Env>;
