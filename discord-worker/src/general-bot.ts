import { InteractionResponseType, InteractionType, verifyKey } from "discord-interactions";
import {
  createAmidaDraw,
  formatAmidaAssignments,
  generateAmidaPng,
  parseAmidaEntries,
  type AmidaDraw,
} from "./general/amida";
import { generalCommands } from "./general/commands";
import {
  parsePollOptions,
  pollMessageData,
  type GeneralPoll,
  type GeneralPollOption,
  type GeneralPollVote,
} from "./general/polls";
import {
  parseScheduleCandidates,
  scheduleAnswerPanelData,
  scheduleMessageData,
  scheduleSummaryData,
  type GeneralSchedule,
  type GeneralScheduleCandidate,
  type GeneralScheduleResponse,
  type ScheduleAnswer,
} from "./general/schedules";
import {
  parseScheduleCalendarForm,
  renderScheduleCreatedPage,
  renderScheduleCreatePage,
  renderScheduleErrorPage,
} from "./general/schedule-page";

export interface GeneralBotEnv {
  DB: D1Database;
  ENVIRONMENT?: string;
  DISCORD_PUBLIC_KEY: string;
  DISCORD_APPLICATION_ID?: string;
  DISCORD_GUILD_ID?: string;
  DISCORD_BOT_TOKEN?: string;
}

interface InteractionComponent {
  custom_id?: string;
  value?: string;
  components?: InteractionComponent[];
}

interface GeneralInteraction {
  type: number;
  guild_id?: string;
  channel_id?: string;
  member?: {
    nick?: string | null;
    roles?: string[];
    user?: {
      id?: string;
      username?: string;
      global_name?: string | null;
    };
  };
  data?: {
    name?: string;
    custom_id?: string;
    component_type?: number;
    values?: string[];
    options?: Array<{ name: string; value?: string | number | boolean }>;
    resolved?: {
      users?: Record<string, {
        id?: string;
        username?: string;
        global_name?: string | null;
        bot?: boolean;
      }>;
      members?: Record<string, { nick?: string | null }>;
    };
    components?: InteractionComponent[];
  };
}

type SignatureVerifier = (
  body: string,
  signature: string,
  timestamp: string,
  publicKey: string,
) => Promise<boolean>;

type AmidaImageGenerator = (draw: AmidaDraw) => Promise<Uint8Array>;

const json = (body: unknown, status = 200): Response => Response.json(body, { status });
const GENERAL_COMMANDS_VERSION = "2026-11-11-iroiro-bot-v1";
const ephemeral = (content: string): Response => json({
  type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
  data: { content, flags: 64 },
});
const html = (body: string, status = 200): Response => new Response(body, {
  status,
  headers: {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  },
});

export async function registerGeneralCommands(
  env: GeneralBotEnv,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  if (!env.DISCORD_APPLICATION_ID || !env.DISCORD_GUILD_ID || !env.DISCORD_BOT_TOKEN) {
    throw new Error("いろいろBOTのコマンド登録設定が足りません。");
  }
  const response = await fetcher(
    `https://discord.com/api/v10/applications/${env.DISCORD_APPLICATION_ID}/guilds/${env.DISCORD_GUILD_ID}/commands`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(generalCommands),
    },
  );
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`Discordへのコマンド登録に失敗しました (${response.status}): ${detail}`);
  }
}

export async function ensureGeneralCommandsRegistered(
  env: GeneralBotEnv,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  if (!env.DISCORD_APPLICATION_ID || !env.DISCORD_GUILD_ID || !env.DISCORD_BOT_TOKEN) {
    return false;
  }
  const setting = await env.DB.prepare(
    `SELECT commands_version FROM general_discord_settings WHERE guild_id = ?`,
  ).bind(env.DISCORD_GUILD_ID).first<{ commands_version: string | null }>();
  if (setting?.commands_version === GENERAL_COMMANDS_VERSION) return false;

  try {
    await registerGeneralCommands(env, fetcher);
  } catch (error) {
    const message = error instanceof Error ? error.message : "コマンド登録に失敗しました。";
    await env.DB.prepare(
      `INSERT INTO general_discord_settings (
         guild_id, commands_version, last_registration_error, updated_at
       ) VALUES (?, NULL, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
       ON CONFLICT(guild_id) DO UPDATE SET
         commands_version = NULL,
         last_registration_error = excluded.last_registration_error,
         updated_at = excluded.updated_at`,
    ).bind(env.DISCORD_GUILD_ID, message).run();
    throw error;
  }

  await env.DB.prepare(
    `INSERT INTO general_discord_settings (
       guild_id, commands_version, last_registration_error, updated_at
     ) VALUES (?, ?, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
     ON CONFLICT(guild_id) DO UPDATE SET
       commands_version = excluded.commands_version,
       last_registration_error = NULL,
       updated_at = excluded.updated_at`,
  ).bind(env.DISCORD_GUILD_ID, GENERAL_COMMANDS_VERSION).run();
  return true;
}

interface AmidaMemberOption {
  member_id: number;
  display_name: string;
  grade: string | null;
  total_count?: number;
}

interface AmidaSelectionDraft {
  selected_member_ids_json: string;
}

interface GeneralScheduleDraft {
  token: string;
  guild_id: string;
  channel_id: string;
  creator_user_id: string;
  used_at: string | null;
}

const AMIDA_MEMBER_PAGE_SIZE = 25;

function amidaMemberPicker(
  members: AmidaMemberOption[],
  draftId: string,
  page: number,
  totalPages: number,
  selectedMemberIds: string[],
  initial: boolean,
): Response {
  const selected = new Set(selectedMemberIds);
  return json({
    type: initial
      ? InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE
      : InteractionResponseType.UPDATE_MESSAGE,
    data: {
      content: `参加メンバーを選択してください（選択済み: ${selected.size}人／${page + 1}ページ目）`,
      ...(initial ? { flags: 64 } : {}),
      components: [
        {
          type: 1,
          components: [{
            type: 3,
            custom_id: `general:amida:members:${draftId}:${page}`,
            placeholder: "このページの参加メンバーを選択",
            options: members.map((member) => ({
              label: member.display_name.slice(0, 100),
              value: String(member.member_id),
              description: member.grade ? `${member.grade}級` : undefined,
              default: selected.has(String(member.member_id)),
            })),
            min_values: 1,
            max_values: members.length,
          }],
        },
        {
          type: 1,
          components: [
            {
              type: 2,
              style: 2,
              label: "前へ",
              custom_id: `general:amida:page-prev:${draftId}:${Math.max(0, page - 1)}`,
              disabled: page === 0,
            },
            {
              type: 2,
              style: 2,
              label: "次へ",
              custom_id: `general:amida:page-next:${draftId}:${Math.min(totalPages - 1, page + 1)}`,
              disabled: page + 1 >= totalPages,
            },
            {
              type: 2,
              style: 2,
              label: "このページを解除",
              custom_id: `general:amida:clear:${draftId}:${page}`,
            },
            {
              type: 2,
              style: 3,
              label: "このメンバーで決定",
              custom_id: `general:amida:finish:${draftId}`,
            },
          ],
        },
      ],
    },
  });
}

function amidaModal(draftId: string, participantCount: number): Response {
  return json({
    type: InteractionResponseType.MODAL,
    data: {
      custom_id: `general:amida:create:${draftId}`,
      title: "あみだくじを作成",
      components: [
        {
          type: 1,
          components: [{
            type: 4,
            custom_id: "title",
            label: "タイトル（任意）",
            style: 1,
            required: false,
            max_length: 80,
            placeholder: "懇親会の席決め",
          }],
        },
        {
          type: 1,
          components: [{
            type: 4,
            custom_id: "destinations",
            label: "行き先（1行に1件）",
            style: 2,
            required: true,
            max_length: 4000,
            value: Array.from({ length: participantCount }, (_, index) => String(index + 1)).join("\n"),
          }],
        },
      ],
    },
  });
}

function modalValue(components: InteractionComponent[] | undefined, customId: string): string {
  for (const row of components ?? []) {
    for (const component of row.components ?? []) {
      if (component.custom_id === customId) return component.value ?? "";
    }
  }
  return "";
}

function pollModal(anonymous: boolean, multiple: boolean): Response {
  return json({
    type: InteractionResponseType.MODAL,
    data: {
      custom_id: `general:poll:create:${anonymous ? 1 : 0}:${multiple ? 1 : 0}`,
      title: "投票を作成",
      components: [
        {
          type: 1,
          components: [{
            type: 4,
            custom_id: "title",
            label: "タイトル",
            style: 1,
            required: true,
            max_length: 100,
            placeholder: "懇親会への参加確認",
          }],
        },
        {
          type: 1,
          components: [{
            type: 4,
            custom_id: "description",
            label: "説明（任意）",
            style: 2,
            required: false,
            max_length: 1000,
            placeholder: "回答期限や補足事項",
          }],
        },
        {
          type: 1,
          components: [{
            type: 4,
            custom_id: "options",
            label: "選択肢（1行に1件・最大20件）",
            style: 2,
            required: true,
            max_length: 3000,
            placeholder: "参加\n不参加\n未定",
          }],
        },
      ],
    },
  });
}

async function anonymousVoterKey(pollId: string, userId: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${pollId}:${userId}`),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function interactionDisplayName(interaction: GeneralInteraction): string {
  return interaction.member?.nick
    || interaction.member?.user?.global_name
    || interaction.member?.user?.username
    || "名前不明";
}

async function loadPollState(
  db: D1Database,
  pollId: string,
  guildId: string,
): Promise<{
  poll: GeneralPoll;
  options: GeneralPollOption[];
  votes: GeneralPollVote[];
} | null> {
  const poll = await db.prepare(
    `SELECT id, title, description, anonymous, multiple, status, creator_user_id
     FROM general_polls WHERE id = ? AND guild_id = ?`,
  ).bind(pollId, guildId).first<GeneralPoll>();
  if (!poll) return null;
  const [options, votes] = await Promise.all([
    db.prepare(
      `SELECT option_id, label, position
       FROM general_poll_options WHERE poll_id = ? ORDER BY position`,
    ).bind(pollId).all<GeneralPollOption>(),
    db.prepare(
      `SELECT option_id, voter_display_name
       FROM general_poll_votes WHERE poll_id = ? ORDER BY created_at, voter_key`,
    ).bind(pollId).all<GeneralPollVote>(),
  ]);
  return { poll, options: options.results, votes: votes.results };
}

async function loadScheduleState(
  db: D1Database,
  scheduleId: string,
  guildId: string,
): Promise<{
  schedule: GeneralSchedule;
  candidates: GeneralScheduleCandidate[];
  responses: GeneralScheduleResponse[];
} | null> {
  const schedule = await db.prepare(
    `SELECT id, channel_id, message_id, creator_user_id, title, description, status
     FROM general_schedules WHERE id = ? AND guild_id = ?`,
  ).bind(scheduleId, guildId).first<GeneralSchedule>();
  if (!schedule) return null;
  const [candidates, responses] = await Promise.all([
    db.prepare(
      `SELECT
         c.candidate_id,
         c.label,
         c.position,
         SUM(CASE WHEN r.response = 'yes' THEN 1 ELSE 0 END) AS yes_count,
         SUM(CASE WHEN r.response = 'maybe' THEN 1 ELSE 0 END) AS maybe_count,
         SUM(CASE WHEN r.response = 'no' THEN 1 ELSE 0 END) AS no_count,
         (SELECT COUNT(DISTINCT discord_user_id)
          FROM general_schedule_responses WHERE schedule_id = c.schedule_id) AS respondent_count
       FROM general_schedule_candidates c
       LEFT JOIN general_schedule_responses r
         ON r.schedule_id = c.schedule_id AND r.candidate_id = c.candidate_id
       WHERE c.schedule_id = ?
       GROUP BY c.schedule_id, c.candidate_id, c.label, c.position
       ORDER BY c.position`,
    ).bind(scheduleId).all<GeneralScheduleCandidate>(),
    db.prepare(
      `SELECT candidate_id, discord_user_id, display_name, response
       FROM general_schedule_responses
       WHERE schedule_id = ?
       ORDER BY display_name, discord_user_id, candidate_id`,
    ).bind(scheduleId).all<GeneralScheduleResponse>(),
  ]);
  return {
    schedule,
    candidates: candidates.results,
    responses: responses.results,
  };
}

async function createGeneralBotMessage(
  env: GeneralBotEnv,
  channelId: string,
  data: Record<string, unknown>,
  fetcher: typeof fetch,
): Promise<string> {
  if (!env.DISCORD_BOT_TOKEN) throw new Error("Bot Tokenが設定されていません。");
  const response = await fetcher(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`Discordへの日程調整の投稿に失敗しました (${response.status}): ${detail}`);
  }
  const message = await response.json() as { id?: string };
  if (!message.id) throw new Error("投稿した日程調整のメッセージIDを取得できませんでした。");
  return message.id;
}

async function updateScheduleMessage(
  env: GeneralBotEnv,
  state: {
    schedule: GeneralSchedule;
    candidates: GeneralScheduleCandidate[];
  },
  fetcher: typeof fetch,
): Promise<void> {
  if (!env.DISCORD_BOT_TOKEN || !state.schedule.message_id) return;
  const response = await fetcher(
    `https://discord.com/api/v10/channels/${state.schedule.channel_id}/messages/${state.schedule.message_id}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(scheduleMessageData(state.schedule, state.candidates)),
    },
  );
  if (!response.ok) {
    console.error("日程調整メッセージの更新に失敗しました", response.status);
  }
}

async function createScheduleAndPost(
  env: GeneralBotEnv,
  draft: GeneralScheduleDraft,
  title: string,
  description: string,
  candidateLabels: string[],
  fetcher: typeof fetch,
): Promise<string> {
  const labels = parseScheduleCandidates(candidateLabels.join("\n"));
  const scheduleId = crypto.randomUUID().replaceAll("-", "").slice(0, 20);
  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO general_schedules (
           id, guild_id, channel_id, creator_user_id, title, description, status
         ) VALUES (?, ?, ?, ?, ?, ?, 'open')`,
      ).bind(
        scheduleId,
        draft.guild_id,
        draft.channel_id,
        draft.creator_user_id,
        title,
        description || null,
      ),
      ...labels.map((label, index) => env.DB.prepare(
        `INSERT INTO general_schedule_candidates (
           schedule_id, candidate_id, label, position
         ) VALUES (?, ?, ?, ?)`,
      ).bind(scheduleId, index + 1, label, index)),
    ]);
    const schedule: GeneralSchedule = {
      id: scheduleId,
      channel_id: draft.channel_id,
      message_id: null,
      creator_user_id: draft.creator_user_id,
      title,
      description: description || null,
      status: "open",
    };
    const candidates: GeneralScheduleCandidate[] = labels.map((label, index) => ({
      candidate_id: index + 1,
      label,
      position: index,
      yes_count: 0,
      maybe_count: 0,
      no_count: 0,
      respondent_count: 0,
    }));
    const messageId = await createGeneralBotMessage(
      env,
      draft.channel_id,
      scheduleMessageData(schedule, candidates),
      fetcher,
    );
    await env.DB.prepare(
      `UPDATE general_schedules SET message_id = ? WHERE id = ?`,
    ).bind(messageId, scheduleId).run();
    return `https://discord.com/channels/${draft.guild_id}/${draft.channel_id}/${messageId}`;
  } catch (error) {
    await env.DB.prepare(`DELETE FROM general_schedules WHERE id = ?`).bind(scheduleId).run();
    throw error;
  }
}

function amidaMultipartResponse(draw: AmidaDraw, png: Uint8Array): Response {
  const filename = "amida.png";
  const form = new FormData();
  form.append("payload_json", JSON.stringify({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      embeds: [{
        title: draw.title,
        description: formatAmidaAssignments(draw),
        color: 0x668437,
        image: { url: `attachment://${filename}` },
        footer: { text: "いろいろBOTのあみだくじ" },
      }],
      allowed_mentions: { parse: [] },
      attachments: [{ id: 0, filename, description: `${draw.title}のあみだくじ` }],
    },
  }));
  const bytes = new Uint8Array(png);
  form.append("files[0]", new Blob([bytes.buffer], { type: "image/png" }), filename);
  return new Response(form);
}

export async function handleGeneralBotRequest(
  request: Request,
  env: GeneralBotEnv,
  verifier: SignatureVerifier = verifyKey,
  imageGenerator: AmidaImageGenerator = generateAmidaPng,
  ctx?: Pick<ExecutionContext, "waitUntil">,
  discordFetcher: typeof fetch = fetch,
): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/schedule/create") {
    const token = url.searchParams.get("token") ?? "";
    const draft = token ? await env.DB.prepare(
      `SELECT token, guild_id, channel_id, creator_user_id, used_at
       FROM general_schedule_drafts
       WHERE token = ? AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    ).bind(token).first<GeneralScheduleDraft>() : null;
    if (!draft || draft.used_at) {
      return html(renderScheduleErrorPage("作成用リンクが無効か、有効期限が切れています。もう一度 /schedule を実行してください。"), 410);
    }
    return html(renderScheduleCreatePage(token));
  }
  if (request.method === "POST" && url.pathname === "/schedule/create") {
    let token = "";
    try {
      const input = parseScheduleCalendarForm(await request.formData());
      token = input.token;
      const draft = await env.DB.prepare(
        `SELECT token, guild_id, channel_id, creator_user_id, used_at
         FROM general_schedule_drafts
         WHERE token = ? AND used_at IS NULL
           AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
      ).bind(token).first<GeneralScheduleDraft>();
      if (!draft) {
        return html(renderScheduleErrorPage("作成用リンクが無効か、有効期限が切れています。もう一度 /schedule を実行してください。"), 410);
      }
      const claimed = await env.DB.prepare(
        `UPDATE general_schedule_drafts
         SET used_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE token = ? AND used_at IS NULL`,
      ).bind(token).run();
      if ((claimed.meta.changes ?? 0) !== 1) {
        return html(renderScheduleErrorPage("この作成用リンクはすでに使用されています。"), 409);
      }
      try {
        const messageUrl = await createScheduleAndPost(
          env,
          draft,
          input.title,
          input.description,
          input.candidates,
          discordFetcher,
        );
        return html(renderScheduleCreatedPage(messageUrl));
      } catch (error) {
        await env.DB.prepare(
          `UPDATE general_schedule_drafts SET used_at = NULL WHERE token = ?`,
        ).bind(token).run();
        throw error;
      }
    } catch (error) {
      return html(renderScheduleErrorPage(
        error instanceof Error ? error.message : "日程調整を作成できませんでした。",
      ), 400);
    }
  }
  if (request.method === "GET" && url.pathname === "/health") {
    if (
      env.DISCORD_APPLICATION_ID
      && env.DISCORD_GUILD_ID
      && env.DISCORD_BOT_TOKEN
    ) {
      try {
        await ensureGeneralCommandsRegistered(env);
      } catch (error) {
        console.error("いろいろBOTのコマンド登録エラー", error);
      }
    }
    const registration = env.DISCORD_GUILD_ID
      ? await env.DB.prepare(
        `SELECT commands_version, last_registration_error, updated_at
         FROM general_discord_settings WHERE guild_id = ?`,
      ).bind(env.DISCORD_GUILD_ID).first<{
        commands_version: string | null;
        last_registration_error: string | null;
        updated_at: string;
      }>()
      : null;
    return json({
      ok: true,
      service: "sukc-iroiro-bot",
      configured: {
        publicKey: Boolean(env.DISCORD_PUBLIC_KEY),
        applicationId: Boolean(env.DISCORD_APPLICATION_ID),
        guildId: Boolean(env.DISCORD_GUILD_ID),
        botToken: Boolean(env.DISCORD_BOT_TOKEN),
      },
      registration: registration ?? null,
    });
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

  const interaction = JSON.parse(body) as GeneralInteraction;
  if (interaction.type === InteractionType.PING) {
    if (ctx && env.DISCORD_APPLICATION_ID && env.DISCORD_GUILD_ID && env.DISCORD_BOT_TOKEN) {
      ctx.waitUntil(ensureGeneralCommandsRegistered(env).catch((error) => {
        console.error("いろいろBOTのコマンド登録エラー", error);
      }));
    }
    return json({ type: InteractionResponseType.PONG });
  }
  if (interaction.type === InteractionType.APPLICATION_COMMAND && interaction.data?.name === "help") {
    if (!interaction.guild_id || interaction.guild_id !== env.DISCORD_GUILD_ID) {
      return ephemeral("サーバー内で実行してください。");
    }
    let roleSettings: { admin_role_id: string | null; practice_role_id: string | null } | null = null;
    try {
      roleSettings = await env.DB.prepare(
        `SELECT admin_role_id, practice_role_id
         FROM discord_settings WHERE guild_id = ? LIMIT 1`,
      ).bind(interaction.guild_id).first<{
        admin_role_id: string | null;
        practice_role_id: string | null;
      }>();
    } catch (error) {
      console.error("ヘルプ用の担当者ロール確認エラー", error);
    }
    const memberRoles = Array.isArray(interaction.member?.roles) ? interaction.member.roles : [];
    const isTournamentManager = Boolean(
      roleSettings?.admin_role_id && memberRoles.includes(roleSettings.admin_role_id),
    );
    const isPracticeManager = Boolean(
      roleSettings?.practice_role_id && memberRoles.includes(roleSettings.practice_role_id),
    );
    const managerHelpEmbeds = [
      ...(isTournamentManager
        ? [{
          title: "大会担当者向けコマンド",
          description: "大会お知らせくんの初期設定と動作確認に使用します。",
          color: 0x5865f2,
          fields: [
            {
              name: "/setup-channel",
              value: "実行したチャンネルを大会の告知先に設定します。",
              inline: false,
            },
            {
              name: "/setup-reminder-channel",
              value: "実行したチャンネルを担当者用の締切リマインダー送信先に設定します。",
              inline: false,
            },
            {
              name: "/test-reminder",
              value: "担当者用チャンネルへ締切リマインダーをテスト送信します。",
              inline: false,
            },
            {
              name: "/test-tournament",
              value: "ボタン付きDMを確認するテスト大会を作成します。",
              inline: false,
            },
          ],
        }]
        : []),
      ...(isPracticeManager
        ? [{
          title: "練習担当者向けコマンド",
          description: "かるた練習帖の投稿先と担当者権限の設定に使用します。",
          color: 0x4262ad,
          fields: [
            {
              name: "/practice-setup",
              value: "実行したチャンネルを組み合わせ・札組の投稿先に設定します。",
              inline: false,
            },
            {
              name: "/practice-schedule-setup",
              value: "実行したチャンネルを練習日程・前日リマインドの投稿先に設定します。",
              inline: false,
            },
            {
              name: "/practice-role-setup",
              value: "練習担当ロールを運営管理ポータルの権限に設定します。",
              inline: false,
            },
          ],
        }]
        : []),
    ];
    return json({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        flags: 64,
        embeds: [
          {
            title: "BOTコマンドヘルプ",
            description: "3つのBotで一般メンバーが利用できるコマンドを案内します。\nこのヘルプは実行した本人にだけ表示されます。",
            color: 0x668437,
          },
          {
            title: "大会お知らせくん",
            color: 0x5865f2,
            fields: [
              {
                name: "/member-register",
                value: "メンバー登録・登録内容の変更を担当者へ申請します。氏名、よみがな、出場級、段位を入力します。",
                inline: false,
              },
              {
                name: "/ping",
                value: "大会お知らせくんとの接続を確認します。コマンドが動かない場合の確認に使います。",
                inline: false,
              },
            ],
          },
          {
            title: "かるた練習帖",
            color: 0x4262ad,
            fields: [{
              name: "/practice-today",
              value: "今日の使用札と、登録されている最新の対戦組み合わせを確認します。",
              inline: false,
            }],
          },
          {
            title: "いろいろBOT",
            color: 0x668437,
            fields: [
              {
                name: "/amida",
                value: "参加メンバーと行き先からあみだくじを作成します。結果と図はチャンネル全体に投稿されます。",
                inline: false,
              },
              {
                name: "/poll",
                value: "通常投票・匿名投票を作成します。`anonymous`で匿名、`multiple`で複数選択を指定できます。",
                inline: false,
              },
              {
                name: "/schedule",
                value: "カレンダーから候補日時を選び、○・△・×で回答する日程調整を作成します。",
                inline: false,
              },
            ],
          },
          ...managerHelpEmbeds,
          {
            title: "回答の変更・締め切り",
            description: "投票は同じ選択肢を再度押すと解除できます。\n日程調整は「回答する」から変更でき、投票・日程調整ともに作成者だけが締め切れます。",
            color: 0x668437,
            footer: { text: "いろいろBOT" },
          },
        ],
        allowed_mentions: { parse: [] },
      },
    });
  }
  if (interaction.type === InteractionType.APPLICATION_COMMAND && interaction.data?.name === "schedule") {
    if (
      !interaction.guild_id
      || !interaction.channel_id
      || interaction.guild_id !== env.DISCORD_GUILD_ID
    ) {
      return ephemeral("サーバー内のチャンネルで実行してください。");
    }
    const creatorUserId = interaction.member?.user?.id;
    if (!creatorUserId) return ephemeral("実行したメンバーを確認できませんでした。");
    const token = `${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
    await env.DB.batch([
      env.DB.prepare(
        `DELETE FROM general_schedule_drafts
         WHERE expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
      ),
      env.DB.prepare(
        `INSERT INTO general_schedule_drafts (
           token, guild_id, channel_id, creator_user_id, expires_at
         ) VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+30 minutes'))`,
      ).bind(token, interaction.guild_id, interaction.channel_id, creatorUserId),
    ]);
    const createUrl = `${url.origin}/schedule/create?token=${encodeURIComponent(token)}`;
    return json({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: "カレンダーから候補日時を選択してください。このリンクは30分間有効です。",
        flags: 64,
        components: [{
          type: 1,
          components: [{
            type: 2,
            style: 5,
            label: "日程調整を作成",
            url: createUrl,
          }],
        }],
      },
    });
  }
  if (
    interaction.type === InteractionType.MESSAGE_COMPONENT
    && interaction.data?.custom_id?.startsWith("general:schedule:")
  ) {
    if (!interaction.guild_id || interaction.guild_id !== env.DISCORD_GUILD_ID) {
      return ephemeral("このサーバーでは操作できません。");
    }
    const userId = interaction.member?.user?.id;
    if (!userId) return ephemeral("操作したメンバーを確認できませんでした。");
    const parts = interaction.data.custom_id.split(":");
    const action = parts[2];
    const scheduleId = parts[3] ?? "";
    let state = await loadScheduleState(env.DB, scheduleId, interaction.guild_id);
    if (!state) return ephemeral("日程調整が見つかりませんでした。");
    const userResponses = () => state!.responses.filter(
      (response) => response.discord_user_id === userId,
    );
    const refreshPublicMessage = async () => {
      const refresh = updateScheduleMessage(env, state!, discordFetcher);
      if (ctx) {
        ctx.waitUntil(refresh);
        return;
      }
      await refresh;
    };

    if (action === "answer") {
      if (state.schedule.status !== "open") return ephemeral("この日程調整は締め切られています。");
      return json({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: scheduleAnswerPanelData(
          state.schedule,
          state.candidates,
          userResponses(),
          0,
          true,
        ),
      });
    }

    if (action === "choice") {
      if (state.schedule.status !== "open") return ephemeral("この日程調整は締め切られています。");
      const page = Number.parseInt(parts[4] ?? "0", 10);
      const candidateId = Number.parseInt(parts[5] ?? "", 10);
      const answer = interaction.data.values?.[0] as ScheduleAnswer | undefined;
      if (
        !state.candidates.some((candidate) => candidate.candidate_id === candidateId)
        || !answer
        || !(["yes", "maybe", "no"] as const).includes(answer)
      ) {
        return ephemeral("回答内容を確認できませんでした。");
      }
      await env.DB.prepare(
        `INSERT INTO general_schedule_responses (
           schedule_id, candidate_id, discord_user_id, display_name, response, updated_at
         ) VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
         ON CONFLICT(schedule_id, candidate_id, discord_user_id) DO UPDATE SET
           display_name = excluded.display_name,
           response = excluded.response,
           updated_at = excluded.updated_at`,
      ).bind(
        scheduleId,
        candidateId,
        userId,
        interactionDisplayName(interaction),
        answer,
      ).run();
      state = await loadScheduleState(env.DB, scheduleId, interaction.guild_id);
      if (!state) return ephemeral("回答後の状態を読み込めませんでした。");
      await refreshPublicMessage();
      return json({
        type: InteractionResponseType.UPDATE_MESSAGE,
        data: scheduleAnswerPanelData(
          state.schedule,
          state.candidates,
          userResponses(),
          page,
          false,
        ),
      });
    }

    if (action === "page-prev" || action === "page-next") {
      const page = Number.parseInt(parts[4] ?? "0", 10);
      return json({
        type: InteractionResponseType.UPDATE_MESSAGE,
        data: scheduleAnswerPanelData(
          state.schedule,
          state.candidates,
          userResponses(),
          page,
          false,
        ),
      });
    }

    if (action === "clear") {
      if (state.schedule.status !== "open") return ephemeral("この日程調整は締め切られています。");
      const page = Number.parseInt(parts[4] ?? "0", 10);
      await env.DB.prepare(
        `DELETE FROM general_schedule_responses
         WHERE schedule_id = ? AND discord_user_id = ?`,
      ).bind(scheduleId, userId).run();
      state = await loadScheduleState(env.DB, scheduleId, interaction.guild_id);
      if (!state) return ephemeral("回答後の状態を読み込めませんでした。");
      await refreshPublicMessage();
      return json({
        type: InteractionResponseType.UPDATE_MESSAGE,
        data: scheduleAnswerPanelData(
          state.schedule,
          state.candidates,
          [],
          page,
          false,
        ),
      });
    }

    if (action === "finish") {
      const answeredCount = new Set(userResponses().map((response) => response.candidate_id)).size;
      if (answeredCount < state.candidates.length) {
        const page = Number.parseInt(parts[4] ?? "0", 10);
        const data = scheduleAnswerPanelData(
          state.schedule,
          state.candidates,
          userResponses(),
          page,
          false,
        ) as { content: string };
        data.content = `未回答の候補が${state.candidates.length - answeredCount}件あります。\n${data.content}`;
        return json({ type: InteractionResponseType.UPDATE_MESSAGE, data });
      }
      return json({
        type: InteractionResponseType.UPDATE_MESSAGE,
        data: {
          content: "回答を保存しました。",
          components: [],
          allowed_mentions: { parse: [] },
        },
      });
    }

    if (action === "summary" || action === "summary-prev" || action === "summary-next") {
      const page = Number.parseInt(parts[4] ?? "0", 10);
      return json({
        type: action === "summary"
          ? InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE
          : InteractionResponseType.UPDATE_MESSAGE,
        data: scheduleSummaryData(
          state.schedule,
          state.candidates,
          state.responses,
          page,
          action === "summary",
        ),
      });
    }

    if (action === "close") {
      if (state.schedule.creator_user_id !== userId) {
        return ephemeral("日程調整を締め切れるのは作成者だけです。");
      }
      if (state.schedule.status === "open") {
        await env.DB.prepare(
          `UPDATE general_schedules
           SET status = 'closed', closed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE id = ? AND status = 'open'`,
        ).bind(scheduleId).run();
        state.schedule.status = "closed";
      }
      return json({
        type: InteractionResponseType.UPDATE_MESSAGE,
        data: scheduleMessageData(state.schedule, state.candidates),
      });
    }

    return ephemeral("この操作には対応していません。");
  }
  if (interaction.type === InteractionType.APPLICATION_COMMAND && interaction.data?.name === "poll") {
    if (
      !interaction.guild_id
      || !interaction.channel_id
      || interaction.guild_id !== env.DISCORD_GUILD_ID
    ) {
      return ephemeral("サーバー内のチャンネルで実行してください。");
    }
    const anonymous = interaction.data.options?.find((option) => option.name === "anonymous")
      ?.value === true;
    const multiple = interaction.data.options?.find((option) => option.name === "multiple")
      ?.value === true;
    return pollModal(anonymous, multiple);
  }
  if (
    interaction.type === InteractionType.MODAL_SUBMIT
    && interaction.data?.custom_id?.startsWith("general:poll:create:")
  ) {
    if (
      !interaction.guild_id
      || !interaction.channel_id
      || interaction.guild_id !== env.DISCORD_GUILD_ID
    ) {
      return ephemeral("このサーバーでは投票を作成できません。");
    }
    const creatorUserId = interaction.member?.user?.id;
    if (!creatorUserId) return ephemeral("実行したメンバーを確認できませんでした。");
    try {
      const title = modalValue(interaction.data.components, "title").trim();
      if (!title) return ephemeral("タイトルを入力してください。");
      const description = modalValue(interaction.data.components, "description").trim();
      const options = parsePollOptions(modalValue(interaction.data.components, "options"));
      const mode = interaction.data.custom_id.split(":");
      const anonymous = mode[3] === "1";
      const multiple = mode[4] === "1";
      const pollId = crypto.randomUUID().replaceAll("-", "").slice(0, 20);
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO general_polls (
             id, guild_id, channel_id, creator_user_id, title, description,
             anonymous, multiple, status
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open')`,
        ).bind(
          pollId,
          interaction.guild_id,
          interaction.channel_id,
          creatorUserId,
          title,
          description || null,
          anonymous ? 1 : 0,
          multiple ? 1 : 0,
        ),
        ...options.map((option, index) => env.DB.prepare(
          `INSERT INTO general_poll_options (poll_id, option_id, label, position)
           VALUES (?, ?, ?, ?)`,
        ).bind(pollId, index + 1, option, index)),
      ]);
      const poll: GeneralPoll = {
        id: pollId,
        title,
        description: description || null,
        anonymous: anonymous ? 1 : 0,
        multiple: multiple ? 1 : 0,
        status: "open",
        creator_user_id: creatorUserId,
      };
      const pollOptions = options.map((label, index) => ({
        option_id: index + 1,
        label,
        position: index,
      }));
      return json({
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: pollMessageData(poll, pollOptions, []),
      });
    } catch (error) {
      return ephemeral(error instanceof Error ? error.message : "投票を作成できませんでした。");
    }
  }
  if (
    interaction.type === InteractionType.MESSAGE_COMPONENT
    && interaction.data?.custom_id?.startsWith("general:poll:")
  ) {
    if (!interaction.guild_id || interaction.guild_id !== env.DISCORD_GUILD_ID) {
      return ephemeral("このサーバーでは操作できません。");
    }
    const userId = interaction.member?.user?.id;
    if (!userId) return ephemeral("操作したメンバーを確認できませんでした。");
    const parts = interaction.data.custom_id.split(":");
    const action = parts[2];
    const pollId = parts[3] ?? "";
    const state = await loadPollState(env.DB, pollId, interaction.guild_id);
    if (!state) return ephemeral("投票が見つかりませんでした。");

    if (action === "close") {
      if (state.poll.creator_user_id !== userId) {
        return ephemeral("投票を締め切れるのは作成者だけです。");
      }
      if (state.poll.status === "open") {
        await env.DB.prepare(
          `UPDATE general_polls
           SET status = 'closed', closed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE id = ? AND status = 'open'`,
        ).bind(pollId).run();
        state.poll.status = "closed";
      }
      return json({
        type: InteractionResponseType.UPDATE_MESSAGE,
        data: pollMessageData(state.poll, state.options, state.votes),
      });
    }

    if (action !== "vote") return ephemeral("この操作には対応していません。");
    if (state.poll.status !== "open") return ephemeral("この投票は締め切られています。");
    const optionId = Number.parseInt(parts[4] ?? "", 10);
    if (!state.options.some((option) => option.option_id === optionId)) {
      return ephemeral("選択肢が見つかりませんでした。");
    }
    const isAnonymous = state.poll.anonymous === 1;
    const voterKey = isAnonymous ? await anonymousVoterKey(pollId, userId) : userId;
    const existing = await env.DB.prepare(
      `SELECT 1 AS found FROM general_poll_votes
       WHERE poll_id = ? AND option_id = ? AND voter_key = ?`,
    ).bind(pollId, optionId, voterKey).first<{ found: number }>();
    const insertVote = env.DB.prepare(
      `INSERT INTO general_poll_votes (
         poll_id, option_id, voter_key, voter_discord_user_id, voter_display_name
       ) VALUES (?, ?, ?, ?, ?)`,
    ).bind(
      pollId,
      optionId,
      voterKey,
      isAnonymous ? null : userId,
      isAnonymous ? null : interactionDisplayName(interaction),
    );
    if (state.poll.multiple === 1) {
      if (existing) {
        await env.DB.prepare(
          `DELETE FROM general_poll_votes
           WHERE poll_id = ? AND option_id = ? AND voter_key = ?`,
        ).bind(pollId, optionId, voterKey).run();
      } else {
        await insertVote.run();
      }
    } else {
      const statements = [env.DB.prepare(
        `DELETE FROM general_poll_votes WHERE poll_id = ? AND voter_key = ?`,
      ).bind(pollId, voterKey)];
      if (!existing) statements.push(insertVote);
      await env.DB.batch(statements);
    }
    const updatedVotes = await env.DB.prepare(
      `SELECT option_id, voter_display_name
       FROM general_poll_votes WHERE poll_id = ? ORDER BY created_at, voter_key`,
    ).bind(pollId).all<GeneralPollVote>();
    return json({
      type: InteractionResponseType.UPDATE_MESSAGE,
      data: pollMessageData(state.poll, state.options, updatedVotes.results),
    });
  }
  if (interaction.type === InteractionType.APPLICATION_COMMAND && interaction.data?.name === "amida") {
    if (
      !interaction.guild_id
      || !interaction.channel_id
      || interaction.guild_id !== env.DISCORD_GUILD_ID
    ) {
      return ephemeral("サーバー内のチャンネルで実行してください。");
    }
    const creatorUserId = interaction.member?.user?.id;
    if (!creatorUserId) return ephemeral("実行したメンバーを確認できませんでした。");
    const candidates = await env.DB.prepare(
      `SELECT member_id, display_name, grade, COUNT(*) OVER() AS total_count
       FROM members
       WHERE status = 'active'
         AND (? = 'development' OR discord_user_id IS NOT NULL)
       ORDER BY COALESCE(NULLIF(display_name_kana, ''), display_name), display_name
       LIMIT ? OFFSET 0`,
    ).bind(env.ENVIRONMENT ?? "production", AMIDA_MEMBER_PAGE_SIZE).all<AmidaMemberOption>();
    const candidateCount = Number(candidates.results[0]?.total_count ?? candidates.results.length);
    if (candidateCount < 2) {
      return ephemeral("選択できるメンバーが2人未満です。");
    }
    const draftId = crypto.randomUUID().replaceAll("-", "").slice(0, 20);
    const saveDraft = (async () => {
      await env.DB.prepare(
        `DELETE FROM general_amida_drafts
         WHERE expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
      ).run();
      await env.DB.prepare(
        `INSERT INTO general_amida_drafts (
           id, guild_id, creator_user_id, participants_json,
           selected_member_ids_json, expires_at
         ) VALUES (?, ?, ?, '[]', '[]', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+30 minutes'))`,
      ).bind(draftId, interaction.guild_id, creatorUserId).run();
    })();
    if (ctx) ctx.waitUntil(saveDraft);
    else await saveDraft;
    return amidaMemberPicker(
      candidates.results,
      draftId,
      0,
      Math.ceil(candidateCount / AMIDA_MEMBER_PAGE_SIZE),
      [],
      true,
    );
  }
  if (
    interaction.type === InteractionType.MESSAGE_COMPONENT
    && interaction.data?.custom_id?.startsWith("general:amida:")
  ) {
    if (!interaction.guild_id || interaction.guild_id !== env.DISCORD_GUILD_ID) {
      return ephemeral("このサーバーでは実行できません。");
    }
    const creatorUserId = interaction.member?.user?.id;
    if (!creatorUserId) return ephemeral("操作したメンバーを確認できませんでした。");
    const customId = interaction.data.custom_id;
    const parts = customId.split(":");
    const draftId = parts[3] ?? "";
    const draft = await env.DB.prepare(
      `SELECT selected_member_ids_json
       FROM general_amida_drafts
       WHERE id = ? AND guild_id = ? AND creator_user_id = ?
         AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    ).bind(draftId, interaction.guild_id, creatorUserId).first<AmidaSelectionDraft>();
    if (!draft) {
      return ephemeral("選択の有効期限が切れました。もう一度 /amida を実行してください。");
    }
    let selectedMemberIds = JSON.parse(draft.selected_member_ids_json) as string[];

    if (parts[2] === "finish") {
      if (selectedMemberIds.length < 2) {
        return ephemeral("参加メンバーを2人以上選択してください。");
      }
      const placeholders = selectedMemberIds.map(() => "?").join(", ");
      const selectedMembers = await env.DB.prepare(
        `SELECT member_id, display_name
         FROM members
         WHERE status = 'active' AND member_id IN (${placeholders})`,
      ).bind(...selectedMemberIds).all<{ member_id: number; display_name: string }>();
      const namesById = new Map(
        selectedMembers.results.map((member) => [String(member.member_id), member.display_name]),
      );
      const participants = selectedMemberIds
        .map((id) => namesById.get(id))
        .filter((name): name is string => Boolean(name));
      if (participants.length !== selectedMemberIds.length) {
        return ephemeral("選択したメンバーを名簿で確認できませんでした。");
      }
      const counts = new Map<string, number>();
      const uniqueParticipants = participants.map((name) => {
        const count = (counts.get(name) ?? 0) + 1;
        counts.set(name, count);
        return count === 1 ? name : `${name} (${count})`;
      });
      await env.DB.prepare(
        `UPDATE general_amida_drafts SET participants_json = ? WHERE id = ?`,
      ).bind(JSON.stringify(uniqueParticipants), draftId).run();
      return amidaModal(draftId, uniqueParticipants.length);
    }

    const requestedPage = Number.parseInt(parts[4] ?? "0", 10);
    const countRow = await env.DB.prepare(
      `SELECT COUNT(*) AS count
       FROM members
       WHERE status = 'active'
         AND (? = 'development' OR discord_user_id IS NOT NULL)`,
    ).bind(env.ENVIRONMENT ?? "production").first<{ count: number }>();
    const candidateCount = countRow?.count ?? 0;
    const totalPages = Math.max(1, Math.ceil(candidateCount / AMIDA_MEMBER_PAGE_SIZE));
    const page = Math.max(0, Math.min(totalPages - 1, requestedPage));
    const candidates = await env.DB.prepare(
      `SELECT member_id, display_name, grade
       FROM members
       WHERE status = 'active'
         AND (? = 'development' OR discord_user_id IS NOT NULL)
       ORDER BY COALESCE(NULLIF(display_name_kana, ''), display_name), display_name
       LIMIT ? OFFSET ?`,
    ).bind(
      env.ENVIRONMENT ?? "production",
      AMIDA_MEMBER_PAGE_SIZE,
      page * AMIDA_MEMBER_PAGE_SIZE,
    ).all<AmidaMemberOption>();

    if (parts[2] === "members" || parts[2] === "clear") {
      const pageIds = new Set(candidates.results.map((member) => String(member.member_id)));
      selectedMemberIds = selectedMemberIds.filter((id) => !pageIds.has(id));
      if (parts[2] === "members") {
        selectedMemberIds.push(...(interaction.data.values ?? []));
      }
      await env.DB.prepare(
        `UPDATE general_amida_drafts SET selected_member_ids_json = ? WHERE id = ?`,
      ).bind(JSON.stringify(selectedMemberIds), draftId).run();
    }
    return amidaMemberPicker(
      candidates.results,
      draftId,
      page,
      totalPages,
      selectedMemberIds,
      false,
    );
  }
  if (
    interaction.type === InteractionType.MODAL_SUBMIT
    && interaction.data?.custom_id?.startsWith("general:amida:create:")
  ) {
    if (!interaction.guild_id || interaction.guild_id !== env.DISCORD_GUILD_ID) {
      return ephemeral("このサーバーでは実行できません。");
    }
    try {
      const creatorUserId = interaction.member?.user?.id;
      const draftId = interaction.data.custom_id.slice("general:amida:create:".length);
      const draft = creatorUserId
        ? await env.DB.prepare(
          `SELECT participants_json
           FROM general_amida_drafts
           WHERE id = ? AND guild_id = ? AND creator_user_id = ?
             AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
        ).bind(draftId, interaction.guild_id, creatorUserId).first<{
          participants_json: string;
        }>()
        : null;
      if (!draft) {
        return ephemeral("入力の有効期限が切れました。もう一度 /amida を実行してください。");
      }
      const participants = JSON.parse(draft.participants_json) as string[];
      const destinations = parseAmidaEntries(modalValue(interaction.data.components, "destinations"));
      const title = modalValue(interaction.data.components, "title");
      const draw = createAmidaDraw(participants, destinations, title);
      const png = await imageGenerator(draw);
      await env.DB.prepare(`DELETE FROM general_amida_drafts WHERE id = ?`).bind(draftId).run();
      return amidaMultipartResponse(draw, png);
    } catch (error) {
      return ephemeral(error instanceof Error ? error.message : "あみだくじを作成できませんでした。");
    }
  }
  return ephemeral("この操作には対応していません。");
}

export default {
  fetch(request: Request, env: GeneralBotEnv, ctx: ExecutionContext) {
    return handleGeneralBotRequest(request, env, verifyKey, generateAmidaPng, ctx);
  },
  scheduled(_controller: ScheduledController, env: GeneralBotEnv, ctx: ExecutionContext) {
    ctx.waitUntil(ensureGeneralCommandsRegistered(env).catch((error) => {
      console.error("いろいろBOTのコマンド自動登録エラー", error);
      return false;
    }));
  },
} satisfies ExportedHandler<GeneralBotEnv>;
