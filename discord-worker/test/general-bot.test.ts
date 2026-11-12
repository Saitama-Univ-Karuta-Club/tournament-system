import { describe, expect, it, vi } from "vitest";
import {
  handleGeneralBotRequest,
  registerGeneralCommands,
  type GeneralBotEnv,
} from "../src/general-bot";
import { generalCommands } from "../src/general/commands";

const env: GeneralBotEnv = {
  DB: {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({ first: vi.fn().mockResolvedValue(null) })),
    })),
  } as unknown as D1Database,
  DISCORD_PUBLIC_KEY: "public-key",
};

const signedRequest = (body: unknown) => new Request("https://general.example.com/interactions", {
  method: "POST",
  headers: {
    "X-Signature-Ed25519": "signature",
    "X-Signature-Timestamp": "timestamp",
  },
  body: JSON.stringify(body),
});

const modalRow = (customId: string, value: string) => ({
  type: 1,
  components: [{ type: 4, custom_id: customId, value }],
});

const dbWithDraft = (
  participants: string[],
  members: Array<{ member_id: number; display_name: string; grade: string }> = [],
  selectedMemberIds: string[] = [],
) => ({
  prepare: vi.fn((query: string) => ({
    bind: vi.fn(() => ({
      first: vi.fn().mockResolvedValue(
        query.includes("SELECT participants_json")
          ? { participants_json: JSON.stringify(participants) }
          : query.includes("SELECT selected_member_ids_json")
            ? { selected_member_ids_json: JSON.stringify(selectedMemberIds) }
            : query.includes("COUNT(*)")
              ? { count: members.length }
          : null,
      ),
      all: vi.fn().mockResolvedValue({ results: members }),
      run: vi.fn().mockResolvedValue({ success: true }),
    })),
    run: vi.fn().mockResolvedValue({ success: true }),
  })),
}) as unknown as D1Database;

const pollDb = (settings: { anonymous?: number; multiple?: number } = {}) => {
  const poll = {
    id: "poll-1",
    title: "参加確認",
    description: null,
    anonymous: settings.anonymous ?? 0,
    multiple: settings.multiple ?? 0,
    status: "open" as "open" | "closed",
    creator_user_id: "creator-1",
  };
  const options = [
    { option_id: 1, label: "参加", position: 0 },
    { option_id: 2, label: "不参加", position: 1 },
  ];
  const votes: Array<{
    option_id: number;
    voter_key: string;
    voter_discord_user_id: string | null;
    voter_display_name: string | null;
  }> = [];
  const prepare = vi.fn((query: string) => ({
    bind: vi.fn((...args: unknown[]) => {
      const statement = {
        first: vi.fn(async () => {
          if (query.includes("FROM general_polls WHERE")) return poll;
          if (query.includes("SELECT 1 AS found")) {
            return votes.some((vote) => (
              vote.option_id === args[1] && vote.voter_key === args[2]
            )) ? { found: 1 } : null;
          }
          return null;
        }),
        all: vi.fn(async () => {
          if (query.includes("FROM general_poll_options")) return { results: options };
          if (query.includes("FROM general_poll_votes")) {
            return {
              results: votes.map((vote) => ({
                option_id: vote.option_id,
                voter_display_name: vote.voter_display_name,
              })),
            };
          }
          return { results: [] };
        }),
        run: vi.fn(async () => {
          if (query.includes("INSERT INTO general_poll_votes")) {
            votes.push({
              option_id: Number(args[1]),
              voter_key: String(args[2]),
              voter_discord_user_id: args[3] as string | null,
              voter_display_name: args[4] as string | null,
            });
          } else if (query.includes("DELETE FROM general_poll_votes")) {
            const optionId = args.length === 3 ? Number(args[1]) : null;
            const voterKey = String(args.at(-1));
            for (let index = votes.length - 1; index >= 0; index -= 1) {
              if (
                votes[index].voter_key === voterKey
                && (optionId === null || votes[index].option_id === optionId)
              ) votes.splice(index, 1);
            }
          } else if (query.includes("UPDATE general_polls")) {
            poll.status = "closed";
          }
          return { success: true };
        }),
      };
      return statement;
    }),
  }));
  const db = {
    prepare,
    batch: vi.fn(async (statements: Array<{ run: () => Promise<unknown> }>) => (
      Promise.all(statements.map((statement) => statement.run()))
    )),
  } as unknown as D1Database;
  return { db, poll, votes };
};

const scheduleDb = () => {
  const schedule = {
    id: "schedule-1",
    channel_id: "channel-1",
    message_id: "message-1",
    creator_user_id: "creator-1",
    title: "懇親会の日程調整",
    description: null,
    status: "open" as "open" | "closed",
  };
  const candidates = [
    { candidate_id: 1, label: "11月7日", position: 0 },
    { candidate_id: 2, label: "11月8日", position: 1 },
  ];
  const responses: Array<{
    candidate_id: number;
    discord_user_id: string;
    display_name: string;
    response: "yes" | "maybe" | "no";
  }> = [];
  const prepare = vi.fn((query: string) => ({
    bind: vi.fn((...args: unknown[]) => ({
      first: vi.fn(async () => (
        query.includes("FROM general_schedules WHERE") ? schedule : null
      )),
      all: vi.fn(async () => {
        if (query.includes("FROM general_schedule_candidates c")) {
          const respondentCount = new Set(responses.map((response) => response.discord_user_id)).size;
          return {
            results: candidates.map((candidate) => ({
              ...candidate,
              yes_count: responses.filter((response) => (
                response.candidate_id === candidate.candidate_id && response.response === "yes"
              )).length,
              maybe_count: responses.filter((response) => (
                response.candidate_id === candidate.candidate_id && response.response === "maybe"
              )).length,
              no_count: responses.filter((response) => (
                response.candidate_id === candidate.candidate_id && response.response === "no"
              )).length,
              respondent_count: respondentCount,
            })),
          };
        }
        if (query.includes("FROM general_schedule_responses")) {
          return { results: responses.map((response) => ({ ...response })) };
        }
        return { results: [] };
      }),
      run: vi.fn(async () => {
        if (query.includes("INSERT INTO general_schedule_responses")) {
          const candidateId = Number(args[1]);
          const userId = String(args[2]);
          const existing = responses.find((response) => (
            response.candidate_id === candidateId && response.discord_user_id === userId
          ));
          const next = {
            candidate_id: candidateId,
            discord_user_id: userId,
            display_name: String(args[3]),
            response: args[4] as "yes" | "maybe" | "no",
          };
          if (existing) Object.assign(existing, next);
          else responses.push(next);
        } else if (query.includes("DELETE FROM general_schedule_responses")) {
          const userId = String(args[1]);
          for (let index = responses.length - 1; index >= 0; index -= 1) {
            if (responses[index].discord_user_id === userId) responses.splice(index, 1);
          }
        } else if (query.includes("UPDATE general_schedules") && query.includes("status = 'closed'")) {
          schedule.status = "closed";
        }
        return { success: true };
      }),
    })),
  }));
  return {
    schedule,
    candidates,
    responses,
    db: { prepare } as unknown as D1Database,
  };
};

describe("general man Discord bot", () => {
  it("registers only the general-purpose commands", () => {
    expect(generalCommands.map((command) => command.name)).toEqual([
      "amida",
      "poll",
      "schedule",
      "help",
    ]);
  });

  it("registers guild commands with the general-man application", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("[]", { status: 200 }));
    await registerGeneralCommands({
      ...env,
      DISCORD_APPLICATION_ID: "application-1",
      DISCORD_GUILD_ID: "guild-1",
      DISCORD_BOT_TOKEN: "token-1",
    }, fetcher);

    expect(fetcher).toHaveBeenCalledWith(
      "https://discord.com/api/v10/applications/application-1/guilds/guild-1/commands",
      expect.objectContaining({ method: "PUT" }),
    );
  });

  it("returns health information and rejects unsigned interactions", async () => {
    const health = await handleGeneralBotRequest(
      new Request("https://general.example.com/health"),
      env,
    );
    await expect(health.json()).resolves.toEqual({
      ok: true,
      service: "sukc-iroiro-bot",
      configured: {
        publicKey: true,
        applicationId: false,
        guildId: false,
        botToken: false,
      },
      registration: null,
    });

    const rejected = await handleGeneralBotRequest(
      new Request("https://general.example.com/interactions", {
        method: "POST",
        body: JSON.stringify({ type: 1 }),
      }),
      env,
    );
    expect(rejected.status).toBe(401);
  });

  it("responds to endpoint verification", async () => {
    const response = await handleGeneralBotRequest(
      signedRequest({ type: 1 }),
      env,
      vi.fn().mockResolvedValue(true),
    );
    await expect(response.json()).resolves.toEqual({ type: 1 });
  });

  it("shows private help for every general command", async () => {
    const response = await handleGeneralBotRequest(
      signedRequest({
        type: 2,
        guild_id: "guild-1",
        channel_id: "channel-1",
        member: { user: { id: "user-1" } },
        data: { name: "help" },
      }),
      { ...env, DISCORD_GUILD_ID: "guild-1" },
      vi.fn().mockResolvedValue(true),
    );
    const payload = await response.json() as {
      type: number;
      data: {
        flags: number;
        embeds: Array<{
          title?: string;
          description?: string;
          fields?: Array<{ name: string; value: string }>;
        }>;
      };
    };
    expect(payload.type).toBe(4);
    expect(payload.data.flags).toBe(64);
    expect(payload.data.embeds[0].title).toBe("BOTコマンドヘルプ");
    const helpText = payload.data.embeds
      .flatMap((embed) => [
        embed.title ?? "",
        embed.description ?? "",
        ...(embed.fields ?? []).map((field) => `${field.name}\n${field.value}`),
      ])
      .join("\n");
    expect(helpText).toContain("大会お知らせくん");
    expect(helpText).toContain("かるた練習帖");
    expect(helpText).toContain("いろいろBOT");
    expect(helpText).toContain("/member-register");
    expect(helpText).toContain("/ping");
    expect(helpText).toContain("/practice-today");
    expect(helpText).toContain("/amida");
    expect(helpText).toContain("/poll");
    expect(helpText).toContain("/schedule");
    expect(helpText).not.toContain("/setup-channel");
    expect(helpText).not.toContain("/practice-setup");
    expect(helpText).not.toContain("/test-reminder");
  });

  it.each([
    {
      label: "大会担当だけ",
      roles: ["tournament-role"],
      included: ["/setup-channel", "/test-reminder"],
      excluded: ["/practice-setup", "/practice-role-setup"],
    },
    {
      label: "練習担当だけ",
      roles: ["practice-role"],
      included: ["/practice-setup", "/practice-role-setup"],
      excluded: ["/setup-channel", "/test-reminder"],
    },
    {
      label: "両方の担当",
      roles: ["tournament-role", "practice-role"],
      included: ["/setup-channel", "/test-reminder", "/practice-setup", "/practice-role-setup"],
      excluded: [],
    },
  ])("adds only the $label commands to help", async ({ roles, included, excluded }) => {
    const roleDb = {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({
          first: vi.fn().mockResolvedValue({
            admin_role_id: "tournament-role",
            practice_role_id: "practice-role",
          }),
        })),
      })),
    } as unknown as D1Database;
    const response = await handleGeneralBotRequest(
      signedRequest({
        type: 2,
        guild_id: "guild-1",
        channel_id: "channel-1",
        member: { roles, user: { id: "user-1" } },
        data: { name: "help" },
      }),
      { ...env, DB: roleDb, DISCORD_GUILD_ID: "guild-1" },
      vi.fn().mockResolvedValue(true),
    );
    const payload = await response.json() as {
      data: {
        embeds: Array<{
          title?: string;
          description?: string;
          fields?: Array<{ name: string; value: string }>;
        }>;
      };
    };
    const helpText = payload.data.embeds
      .flatMap((embed) => [
        embed.title ?? "",
        embed.description ?? "",
        ...(embed.fields ?? []).map((field) => `${field.name}\n${field.value}`),
      ])
      .join("\n");
    for (const command of included) expect(helpText).toContain(command);
    for (const command of excluded) expect(helpText).not.toContain(command);
  });

  it("opens a poll modal with the selected modes", async () => {
    const response = await handleGeneralBotRequest(
      signedRequest({
        type: 2,
        guild_id: "guild-1",
        channel_id: "channel-1",
        member: { user: { id: "creator-1" } },
        data: {
          name: "poll",
          options: [
            { name: "anonymous", value: true },
            { name: "multiple", value: true },
          ],
        },
      }),
      { ...env, DISCORD_GUILD_ID: "guild-1" },
      vi.fn().mockResolvedValue(true),
    );
    await expect(response.json()).resolves.toMatchObject({
      type: 9,
      data: {
        custom_id: "general:poll:create:1:1",
        title: "投票を作成",
      },
    });
  });

  it("returns a private calendar link for schedule creation", async () => {
    const batch = vi.fn().mockResolvedValue([]);
    const response = await handleGeneralBotRequest(
      signedRequest({
        type: 2,
        guild_id: "guild-1",
        channel_id: "channel-1",
        member: { user: { id: "creator-1" } },
        data: { name: "schedule" },
      }),
      {
        ...env,
        DB: {
          batch,
          prepare: vi.fn(() => ({ bind: vi.fn(() => ({})) })),
        } as unknown as D1Database,
        DISCORD_GUILD_ID: "guild-1",
      },
      vi.fn().mockResolvedValue(true),
    );
    const payload = await response.json() as {
      type: number;
      data: {
        flags: number;
        components: Array<{ components: Array<{ url: string }> }>;
      };
    };
    expect(payload.type).toBe(4);
    expect(payload.data.flags).toBe(64);
    expect(payload.data.components[0].components[0].url).toMatch(
      /^https:\/\/general\.example\.com\/schedule\/create\?token=/,
    );
    expect(batch).toHaveBeenCalledOnce();
  });

  it("creates a schedule message from calendar form values", async () => {
    const batch = vi.fn().mockResolvedValue([]);
    const draft = {
      token: "token-1",
      guild_id: "guild-1",
      channel_id: "channel-1",
      creator_user_id: "creator-1",
      used_at: null,
    };
    const db = {
      prepare: vi.fn((query: string) => ({
        bind: vi.fn(() => ({
          first: vi.fn().mockResolvedValue(
            query.includes("FROM general_schedule_drafts") ? draft : null,
          ),
          run: vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } }),
        })),
      })),
      batch,
    } as unknown as D1Database;
    const fetcher = vi.fn().mockResolvedValue(Response.json({ id: "message-1" }));
    const form = new FormData();
    form.set("token", "token-1");
    form.set("title", "懇親会の日程調整");
    form.set("description", "回答してください");
    form.append("candidate_date", "2026-11-07");
    form.append("candidate_time", "18:00");
    form.append("candidate_date", "2026-11-08");
    form.append("candidate_time", "");
    const response = await handleGeneralBotRequest(
      new Request("https://general.example.com/schedule/create", { method: "POST", body: form }),
      {
        ...env,
        DB: db,
        DISCORD_GUILD_ID: "guild-1",
        DISCORD_BOT_TOKEN: "bot-token",
      },
      vi.fn(),
      undefined,
      undefined,
      fetcher,
    );
    expect(response.headers.get("content-type")).toContain("text/html");
    await expect(response.text()).resolves.toContain("Discordのメッセージを開く");
    expect(batch).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith(
      "https://discord.com/api/v10/channels/channel-1/messages",
      expect.objectContaining({ method: "POST" }),
    );
    const messageBody = JSON.parse(String((fetcher.mock.calls[0][1] as RequestInit).body)) as {
      embeds: Array<{ fields: Array<{ name: string }> }>;
    };
    expect(messageBody.embeds[0].fields.map((field) => field.name)).toEqual([
      "2026年11月7日（土） 18:00",
      "2026年11月8日（日）",
    ]);
  });

  it("opens a private schedule answer panel", async () => {
    const state = scheduleDb();
    const response = await handleGeneralBotRequest(
      signedRequest({
        type: 3,
        guild_id: "guild-1",
        channel_id: "channel-1",
        member: { user: { id: "user-1", global_name: "石田" } },
        data: { custom_id: "general:schedule:answer:schedule-1", component_type: 2 },
      }),
      { ...env, DB: state.db, DISCORD_GUILD_ID: "guild-1" },
      vi.fn().mockResolvedValue(true),
    );
    const payload = await response.json() as {
      type: number;
      data: { flags: number; components: unknown[] };
    };
    expect(payload.type).toBe(4);
    expect(payload.data.flags).toBe(64);
    expect(payload.data.components).toHaveLength(3);
  });

  it("stores a schedule answer and refreshes the public message", async () => {
    const state = scheduleDb();
    const pending: Promise<unknown>[] = [];
    const fetcher = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    const response = await handleGeneralBotRequest(
      signedRequest({
        type: 3,
        guild_id: "guild-1",
        channel_id: "channel-1",
        member: { user: { id: "user-1", global_name: "石田" } },
        data: {
          custom_id: "general:schedule:choice:schedule-1:0:1",
          component_type: 3,
          values: ["yes"],
        },
      }),
      {
        ...env,
        DB: state.db,
        DISCORD_GUILD_ID: "guild-1",
        DISCORD_BOT_TOKEN: "bot-token",
      },
      vi.fn().mockResolvedValue(true),
      undefined,
      { waitUntil: (promise) => pending.push(promise) },
      fetcher,
    );
    await Promise.all(pending);
    await expect(response.json()).resolves.toMatchObject({ type: 7 });
    expect(state.responses).toEqual([{
      candidate_id: 1,
      discord_user_id: "user-1",
      display_name: "石田",
      response: "yes",
    }]);
    expect(fetcher).toHaveBeenCalledWith(
      "https://discord.com/api/v10/channels/channel-1/messages/message-1",
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it("keeps the answer panel open while candidates remain unanswered", async () => {
    const state = scheduleDb();
    state.responses.push({
      candidate_id: 1,
      discord_user_id: "user-1",
      display_name: "石田",
      response: "yes",
    });
    const response = await handleGeneralBotRequest(
      signedRequest({
        type: 3,
        guild_id: "guild-1",
        member: { user: { id: "user-1" } },
        data: { custom_id: "general:schedule:finish:schedule-1:0", component_type: 2 },
      }),
      { ...env, DB: state.db, DISCORD_GUILD_ID: "guild-1" },
      vi.fn().mockResolvedValue(true),
    );
    await expect(response.json()).resolves.toMatchObject({
      type: 7,
      data: {
        content: expect.stringContaining("未回答の候補が1件あります"),
        components: expect.any(Array),
      },
    });
  });

  it("lets only the schedule creator close the coordination", async () => {
    const state = scheduleDb();
    const denied = await handleGeneralBotRequest(
      signedRequest({
        type: 3,
        guild_id: "guild-1",
        member: { user: { id: "other-1" } },
        data: { custom_id: "general:schedule:close:schedule-1", component_type: 2 },
      }),
      { ...env, DB: state.db, DISCORD_GUILD_ID: "guild-1" },
      vi.fn().mockResolvedValue(true),
    );
    await expect(denied.json()).resolves.toMatchObject({ data: { flags: 64 } });
    expect(state.schedule.status).toBe("open");

    const closed = await handleGeneralBotRequest(
      signedRequest({
        type: 3,
        guild_id: "guild-1",
        member: { user: { id: "creator-1" } },
        data: { custom_id: "general:schedule:close:schedule-1", component_type: 2 },
      }),
      { ...env, DB: state.db, DISCORD_GUILD_ID: "guild-1" },
      vi.fn().mockResolvedValue(true),
    );
    await expect(closed.json()).resolves.toMatchObject({ type: 7 });
    expect(state.schedule.status).toBe("closed");
  });

  it("creates a public poll from the modal", async () => {
    const batch = vi.fn().mockResolvedValue([]);
    const db = {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({ run: vi.fn().mockResolvedValue({ success: true }) })),
      })),
      batch,
    } as unknown as D1Database;
    const response = await handleGeneralBotRequest(
      signedRequest({
        type: 5,
        guild_id: "guild-1",
        channel_id: "channel-1",
        member: { user: { id: "creator-1" } },
        data: {
          custom_id: "general:poll:create:0:0",
          components: [
            modalRow("title", "懇親会への参加確認"),
            modalRow("description", "金曜日まで"),
            modalRow("options", "参加\n不参加\n未定"),
          ],
        },
      }),
      { ...env, DB: db, DISCORD_GUILD_ID: "guild-1" },
      vi.fn().mockResolvedValue(true),
    );
    const payload = await response.json() as {
      type: number;
      data: { embeds: Array<{ title: string; fields: unknown[] }>; components: unknown[] };
    };
    expect(payload.type).toBe(4);
    expect(payload.data.embeds[0].title).toBe("懇親会への参加確認");
    expect(payload.data.embeds[0].fields).toHaveLength(3);
    expect(payload.data.components).toHaveLength(2);
    expect(batch).toHaveBeenCalledOnce();
  });

  it("changes a single-choice vote and shows the voter name", async () => {
    const state = pollDb();
    state.votes.push({
      option_id: 1,
      voter_key: "voter-1",
      voter_discord_user_id: "voter-1",
      voter_display_name: "投票者",
    });
    const response = await handleGeneralBotRequest(
      signedRequest({
        type: 3,
        guild_id: "guild-1",
        channel_id: "channel-1",
        member: { user: { id: "voter-1", global_name: "投票者" } },
        data: { custom_id: "general:poll:vote:poll-1:2", component_type: 2 },
      }),
      { ...env, DB: state.db, DISCORD_GUILD_ID: "guild-1" },
      vi.fn().mockResolvedValue(true),
    );
    const payload = await response.json() as {
      type: number;
      data: { embeds: Array<{ fields: Array<{ value: string }> }> };
    };
    expect(payload.type).toBe(7);
    expect(state.votes).toEqual([expect.objectContaining({ option_id: 2, voter_key: "voter-1" })]);
    expect(payload.data.embeds[0].fields[1].value).toContain("投票者");
  });

  it("does not store a Discord ID or name for an anonymous vote", async () => {
    const state = pollDb({ anonymous: 1 });
    await handleGeneralBotRequest(
      signedRequest({
        type: 3,
        guild_id: "guild-1",
        channel_id: "channel-1",
        member: { user: { id: "voter-1", global_name: "投票者" } },
        data: { custom_id: "general:poll:vote:poll-1:1", component_type: 2 },
      }),
      { ...env, DB: state.db, DISCORD_GUILD_ID: "guild-1" },
      vi.fn().mockResolvedValue(true),
    );
    expect(state.votes).toHaveLength(1);
    expect(state.votes[0]).toMatchObject({
      option_id: 1,
      voter_discord_user_id: null,
      voter_display_name: null,
    });
    expect(state.votes[0].voter_key).not.toBe("voter-1");
  });

  it("lets only the creator close a poll", async () => {
    const state = pollDb();
    const denied = await handleGeneralBotRequest(
      signedRequest({
        type: 3,
        guild_id: "guild-1",
        member: { user: { id: "other-1" } },
        data: { custom_id: "general:poll:close:poll-1", component_type: 2 },
      }),
      { ...env, DB: state.db, DISCORD_GUILD_ID: "guild-1" },
      vi.fn().mockResolvedValue(true),
    );
    await expect(denied.json()).resolves.toMatchObject({ data: { flags: 64 } });
    expect(state.poll.status).toBe("open");

    const closed = await handleGeneralBotRequest(
      signedRequest({
        type: 3,
        guild_id: "guild-1",
        member: { user: { id: "creator-1" } },
        data: { custom_id: "general:poll:close:poll-1", component_type: 2 },
      }),
      { ...env, DB: state.db, DISCORD_GUILD_ID: "guild-1" },
      vi.fn().mockResolvedValue(true),
    );
    await expect(closed.json()).resolves.toMatchObject({ type: 7 });
    expect(state.poll.status).toBe("closed");
  });

  it("opens the member picker from the slash command", async () => {
    const response = await handleGeneralBotRequest(
      signedRequest({
        type: 2,
        guild_id: "guild-1",
        channel_id: "channel-1",
        member: { user: { id: "creator-1" } },
        data: { name: "amida" },
      }),
      {
        ...env,
        DB: dbWithDraft([], [
          { member_id: 1, display_name: "石田", grade: "C" },
          { member_id: 2, display_name: "田中", grade: "C" },
        ]),
        ENVIRONMENT: "development",
        DISCORD_GUILD_ID: "guild-1",
      },
      vi.fn().mockResolvedValue(true),
    );
    const payload = await response.json() as {
      type: number;
      data: {
        flags: number;
        components: Array<{
          components: Array<{
            type: number;
            min_values: number;
            max_values: number;
            options: unknown[];
            custom_id: string;
          }>;
        }>;
      };
    };

    expect(payload.type).toBe(4);
    expect(payload.data.flags).toBe(64);
    expect(payload.data.components[0].components[0]).toMatchObject({
      type: 3,
      min_values: 1,
      max_values: 2,
    });
    expect(payload.data.components[0].components[0].options).toHaveLength(2);
    expect(payload.data.components[0].components[0].custom_id).toMatch(
      /^general:amida:members:/,
    );
    const customIds = payload.data.components
      .flatMap((row) => row.components)
      .map((component) => component.custom_id);
    expect(new Set(customIds).size).toBe(customIds.length);
  });

  it("opens a modal with numbered destinations after the selection is finalized", async () => {
    const response = await handleGeneralBotRequest(
      signedRequest({
        type: 3,
        guild_id: "guild-1",
        channel_id: "channel-1",
        member: { user: { id: "creator-1" } },
        data: {
          component_type: 2,
          custom_id: "general:amida:finish:draft-1",
        },
      }),
      {
        ...env,
        DB: dbWithDraft(
          [],
          [
            { member_id: 1, display_name: "石田", grade: "C" },
            { member_id: 2, display_name: "田中", grade: "C" },
            { member_id: 3, display_name: "佐藤", grade: "C" },
          ],
          ["1", "2", "3"],
        ),
        DISCORD_GUILD_ID: "guild-1",
      },
      vi.fn().mockResolvedValue(true),
    );
    const payload = await response.json() as {
      type: number;
      data: {
        custom_id: string;
        components: Array<{ components: Array<{ custom_id: string; value?: string }> }>;
      };
    };

    expect(payload.type).toBe(9);
    expect(payload.data.custom_id).toMatch(/^general:amida:create:/);
    const destinations = payload.data.components
      .flatMap((row) => row.components)
      .find((component) => component.custom_id === "destinations");
    expect(destinations?.value).toBe("1\n2\n3");
  });

  it("returns a private validation error for mismatched lists", async () => {
    const response = await handleGeneralBotRequest(
      signedRequest({
        type: 5,
        guild_id: "guild-1",
        channel_id: "channel-1",
        member: { user: { id: "creator-1" } },
        data: {
          custom_id: "general:amida:create:draft-1",
          components: [
            modalRow("title", "席決め"),
            modalRow("destinations", "1番席"),
          ],
        },
      }),
      {
        ...env,
        DB: dbWithDraft(["石田", "田中"]),
        DISCORD_GUILD_ID: "guild-1",
      },
      vi.fn().mockResolvedValue(true),
      vi.fn(),
    );
    await expect(response.json()).resolves.toMatchObject({
      data: {
        content: "参加者と行き先の数を同じにしてください。",
        flags: 64,
      },
    });
  });

  it("publishes the ladder image and public result from a modal", async () => {
    const imageGenerator = vi.fn().mockResolvedValue(new Uint8Array([137, 80, 78, 71]));
    const response = await handleGeneralBotRequest(
      signedRequest({
        type: 5,
        guild_id: "guild-1",
        channel_id: "channel-1",
        member: { user: { id: "creator-1" } },
        data: {
          custom_id: "general:amida:create:draft-1",
          components: [
            modalRow("title", "懇親会の席決め"),
            modalRow("destinations", "1番席\n2番席\n3番席"),
          ],
        },
      }),
      {
        ...env,
        DB: dbWithDraft(["石田", "田中", "佐藤"]),
        DISCORD_GUILD_ID: "guild-1",
      },
      vi.fn().mockResolvedValue(true),
      imageGenerator,
    );

    expect(response.headers.get("content-type")).toContain("multipart/form-data");
    const form = await response.formData();
    const payload = JSON.parse(String(form.get("payload_json"))) as {
      type: number;
      data: {
        embeds: Array<{ title: string; description: string; image: { url: string } }>;
        allowed_mentions: { parse: string[] };
      };
    };
    expect(payload.type).toBe(4);
    expect(payload.data.embeds[0].title).toBe("懇親会の席決め");
    expect(payload.data.embeds[0].description).toContain("石田");
    expect(payload.data.embeds[0].image.url).toBe("attachment://amida.png");
    expect(payload.data.allowed_mentions.parse).toEqual([]);
    expect(form.get("files[0]")).toBeInstanceOf(Blob);
    expect(imageGenerator).toHaveBeenCalledOnce();
  });
});
