import { describe, expect, it, vi } from "vitest";
import { handleRequest, type Env } from "../src/index";

const env: Env = {
  DB: {
    prepare: vi.fn().mockReturnValue({
      first: vi.fn().mockResolvedValue({ ok: 1 }),
    }),
  } as unknown as D1Database,
  DISCORD_PUBLIC_KEY: "test-public-key",
};

describe("Discord Worker", () => {
  it("returns health information", async () => {
    const response = await handleRequest(
      new Request("https://example.com/health"),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      service: "sukc-tournament-discord-bot",
      database: "ok",
    });
  });

  it("serves a PDF stored in the private document bucket", async () => {
    const get = vi.fn().mockResolvedValue({
      body: new Blob(["%PDF-1.7\nbody"]),
      httpEtag: '"etag"',
      httpMetadata: { contentType: "application/pdf" },
    });
    const response = await handleRequest(
      new Request(
        "https://example.com/documents/11111111-1111-4111-8111-111111111111/test.pdf",
      ),
      { ...env, DOCUMENTS: { get } as unknown as R2Bucket },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(get).toHaveBeenCalledWith(
      "documents/11111111-1111-4111-8111-111111111111/test.pdf",
    );
  });

  it("rejects unsigned interaction requests", async () => {
    const response = await handleRequest(
      new Request("https://example.com/interactions", {
        method: "POST",
        body: JSON.stringify({ type: 1 }),
      }),
      env,
    );

    expect(response.status).toBe(401);
  });

  it("responds to Discord endpoint verification", async () => {
    const verifier = vi.fn().mockResolvedValue(true);
    const response = await handleRequest(
      new Request("https://example.com/interactions", {
        method: "POST",
        headers: {
          "X-Signature-Ed25519": "signature",
          "X-Signature-Timestamp": "timestamp",
        },
        body: JSON.stringify({ type: 1 }),
      }),
      env,
      verifier,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ type: 1 });
  });

  it("schedules command registration on a signed Discord ping", async () => {
    const verifier = vi.fn().mockResolvedValue(true);
    const commandRegistrar = vi.fn().mockResolvedValue(undefined);
    const waitUntil = vi.fn();
    const configuredEnv = {
      ...env,
      DISCORD_APPLICATION_ID: "application-id",
      DISCORD_GUILD_ID: "guild-id",
      DISCORD_BOT_TOKEN: "bot-token",
    };

    const response = await handleRequest(
      new Request("https://example.com/interactions", {
        method: "POST",
        headers: {
          "X-Signature-Ed25519": "signature",
          "X-Signature-Timestamp": "timestamp",
        },
        body: JSON.stringify({ type: 1 }),
      }),
      configuredEnv,
      verifier,
      { waitUntil },
      commandRegistrar,
    );

    expect(response.status).toBe(200);
    expect(commandRegistrar).toHaveBeenCalledWith(configuredEnv);
    expect(waitUntil).toHaveBeenCalledOnce();
  });

  it("responds privately to the ping command", async () => {
    const verifier = vi.fn().mockResolvedValue(true);
    const response = await handleRequest(
      new Request("https://example.com/interactions", {
        method: "POST",
        headers: {
          "X-Signature-Ed25519": "signature",
          "X-Signature-Timestamp": "timestamp",
        },
        body: JSON.stringify({ type: 2, data: { name: "ping" } }),
      }),
      env,
      verifier,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      type: 4,
      data: { flags: 64 },
    });
  });

  it("submits an update request for an existing Discord member", async () => {
    const verifier = vi.fn().mockResolvedValue(true);
    const memberRegistrar = vi.fn().mockResolvedValue({
      requestId: "MR-test",
      requestType: "update",
      discordUserId: "discord-user-id",
      displayName: "埼玉 花子",
      displayNameKana: "さいたま はなこ",
      grade: "B",
      rank: 2,
      currentDisplayName: "埼玉 花子",
      currentGrade: "C",
    });
    const configuredEnv: Env = {
      ...env,
      DISCORD_GUILD_ID: "guild-id",
    };

    const response = await handleRequest(
      new Request("https://example.com/interactions", {
        method: "POST",
        headers: {
          "X-Signature-Ed25519": "signature",
          "X-Signature-Timestamp": "timestamp",
        },
        body: JSON.stringify({
          type: 2,
          guild_id: "guild-id",
          member: { user: { id: "discord-user-id" } },
          data: {
            name: "member-register",
            options: [
              { name: "name", value: "埼玉 花子" },
              { name: "name-kana", value: "さいたま はなこ" },
              { name: "grade", value: "B" },
              { name: "rank", value: 2 },
            ],
          },
        }),
      }),
      configuredEnv,
      verifier,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      memberRegistrar,
    );

    expect(response.status).toBe(200);
    expect(memberRegistrar).toHaveBeenCalledWith(
      env.DB,
      {
        discordUserId: "discord-user-id",
        displayName: "埼玉 花子",
        displayNameKana: "さいたま はなこ",
        grade: "B",
        rank: 2,
      },
    );
    await expect(response.json()).resolves.toMatchObject({
      type: 4,
      data: {
        flags: 64,
        content: expect.stringContaining("登録内容変更の申請"),
      },
    });
  });

  it("sets the current channel as the announcement channel", async () => {
    const verifier = vi.fn().mockResolvedValue(true);
    const channelSetter = vi.fn().mockResolvedValue(undefined);
    const configuredEnv: Env = { ...env, DISCORD_GUILD_ID: "guild-id" };

    const response = await handleRequest(
      new Request("https://example.com/interactions", {
        method: "POST",
        headers: {
          "X-Signature-Ed25519": "signature",
          "X-Signature-Timestamp": "timestamp",
        },
        body: JSON.stringify({
          type: 2,
          guild_id: "guild-id",
          channel_id: "channel-id",
          member: { permissions: "32", user: { id: "admin-id" } },
          data: { name: "setup-channel" },
        }),
      }),
      configuredEnv,
      verifier,
      undefined,
      vi.fn(),
      channelSetter,
    );

    expect(response.status).toBe(200);
    expect(channelSetter).toHaveBeenCalledWith(
      configuredEnv,
      "guild-id",
      "channel-id",
    );
  });

  it("sets the current channel as the administrator reminder channel", async () => {
    const verifier = vi.fn().mockResolvedValue(true);
    const reminderChannelSetter = vi.fn().mockResolvedValue(undefined);
    const configuredEnv: Env = { ...env, DISCORD_GUILD_ID: "guild-id" };

    const response = await handleRequest(
      new Request("https://example.com/interactions", {
        method: "POST",
        headers: {
          "X-Signature-Ed25519": "signature",
          "X-Signature-Timestamp": "timestamp",
        },
        body: JSON.stringify({
          type: 2,
          guild_id: "guild-id",
          channel_id: "admin-reminder-channel-id",
          member: { permissions: "32", user: { id: "admin-id" } },
          data: { name: "setup-reminder-channel" },
        }),
      }),
      configuredEnv,
      verifier,
      undefined,
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      reminderChannelSetter,
    );

    expect(response.status).toBe(200);
    expect(reminderChannelSetter).toHaveBeenCalledWith(
      configuredEnv,
      "guild-id",
      "admin-reminder-channel-id",
    );
    await expect(response.json()).resolves.toMatchObject({
      data: { content: expect.stringContaining("締切リマインダー送信先") },
    });
  });

  it("sends a test reminder to the configured administrator channel", async () => {
    const verifier = vi.fn().mockResolvedValue(true);
    const testReminderSender = vi.fn().mockResolvedValue({
      tournamentTitle: "B級通知テスト大会",
      reminderKind: "internal_deadline",
    });
    const configuredEnv: Env = { ...env, DISCORD_GUILD_ID: "guild-id" };

    const response = await handleRequest(
      new Request("https://example.com/interactions", {
        method: "POST",
        headers: {
          "X-Signature-Ed25519": "signature",
          "X-Signature-Timestamp": "timestamp",
        },
        body: JSON.stringify({
          type: 2,
          guild_id: "guild-id",
          member: { permissions: "32", user: { id: "admin-id" } },
          data: { name: "test-reminder" },
        }),
      }),
      configuredEnv,
      verifier,
      undefined,
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      testReminderSender,
    );

    expect(testReminderSender).toHaveBeenCalledWith(configuredEnv);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        flags: 64,
        content: expect.stringContaining("B級通知テスト大会"),
      },
    });
  });

  it("schedules test tournament creation", async () => {
    const verifier = vi.fn().mockResolvedValue(true);
    const tournamentCreator = vi.fn().mockResolvedValue(undefined);
    const waitUntil = vi.fn();
    const configuredEnv: Env = { ...env, DISCORD_GUILD_ID: "guild-id" };

    const response = await handleRequest(
      new Request("https://example.com/interactions", {
        method: "POST",
        headers: {
          "X-Signature-Ed25519": "signature",
          "X-Signature-Timestamp": "timestamp",
        },
        body: JSON.stringify({
          type: 2,
          guild_id: "guild-id",
          member: { permissions: "32", user: { id: "creator-id" } },
          data: {
            name: "test-tournament",
            options: [
              { name: "grade", value: "C" },
              { name: "title", value: "DMテスト大会" },
            ],
          },
        }),
      }),
      configuredEnv,
      verifier,
      { waitUntil },
      vi.fn(),
      vi.fn(),
      tournamentCreator,
    );

    expect(response.status).toBe(200);
    expect(tournamentCreator).toHaveBeenCalledWith(configuredEnv, {
      grade: "C",
      title: "DMテスト大会",
      createdByDiscordUserId: "creator-id",
    });
    expect(waitUntil).toHaveBeenCalledOnce();
  });

  it("stores a button response and updates the DM", async () => {
    const verifier = vi.fn().mockResolvedValue(true);
    const attendanceRecorder = vi.fn().mockResolvedValue({
      content: "現在の回答: 参加希望",
      components: [],
    });

    const response = await handleRequest(
      new Request("https://example.com/interactions", {
        method: "POST",
        headers: {
          "X-Signature-Ed25519": "signature",
          "X-Signature-Timestamp": "timestamp",
        },
        body: JSON.stringify({
          type: 3,
          user: { id: "discord-user-id" },
          data: { custom_id: "attendance:tournament-id:yes" },
        }),
      }),
      env,
      verifier,
      undefined,
      vi.fn(),
      vi.fn(),
      vi.fn(),
      attendanceRecorder,
    );

    expect(attendanceRecorder).toHaveBeenCalledWith(env, {
      tournamentId: "tournament-id",
      discordUserId: "discord-user-id",
      response: "yes",
    });
    await expect(response.json()).resolves.toMatchObject({
      type: 7,
      data: { content: expect.stringContaining("参加希望") },
    });
  });
});
