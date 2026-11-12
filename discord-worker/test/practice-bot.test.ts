import { describe, expect, it, vi } from "vitest";
import {
  ensurePracticeCommandsRegistered,
  handlePracticeBotRequest,
  type PracticeBotEnv,
} from "../src/practice-bot";
import { practiceCommands } from "../src/practice/commands";

const env: PracticeBotEnv = {
  DB: {
    prepare: vi.fn().mockReturnValue({ first: vi.fn().mockResolvedValue({ ok: 1 }) }),
  } as unknown as D1Database,
  DISCORD_PUBLIC_KEY: "public-key",
};

describe("practice recorder Discord bot", () => {
  it("registers only the practice commands", () => {
    expect(practiceCommands.map((command) => command.name)).toEqual([
      "practice-setup",
      "practice-today",
      "practice-schedule-setup",
      "practice-role-setup",
    ]);
  });

  it("automatically registers a new command version only once", async () => {
    const first = vi.fn().mockResolvedValue({ practice_commands_version: null });
    const run = vi.fn().mockResolvedValue({ success: true });
    const bind = vi.fn()
      .mockReturnValueOnce({ first })
      .mockReturnValueOnce({ run });
    const prepare = vi.fn(() => ({ bind }));
    const fetcher = vi.fn().mockResolvedValue(new Response("[]", { status: 200 }));
    const registrationEnv = {
      ...env,
      DB: { prepare } as unknown as D1Database,
      DISCORD_APPLICATION_ID: "application-1",
      DISCORD_GUILD_ID: "guild-1",
      DISCORD_BOT_TOKEN: "bot-token",
    };

    await expect(ensurePracticeCommandsRegistered(registrationEnv, fetcher)).resolves.toBe(true);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith(
      "https://discord.com/api/v10/applications/application-1/guilds/guild-1/commands",
      expect.objectContaining({ method: "PUT" }),
    );
    expect(run).toHaveBeenCalledOnce();
  });

  it("skips registration when the stored command version is current", async () => {
    const first = vi.fn().mockResolvedValue({
      practice_commands_version: "2026-11-10-rename-v1",
    });
    const bind = vi.fn(() => ({ first }));
    const prepare = vi.fn(() => ({ bind }));
    const fetcher = vi.fn();

    await expect(ensurePracticeCommandsRegistered({
      ...env,
      DB: { prepare } as unknown as D1Database,
      DISCORD_APPLICATION_ID: "application-1",
      DISCORD_GUILD_ID: "guild-1",
      DISCORD_BOT_TOKEN: "bot-token",
    }, fetcher)).resolves.toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("returns health information", async () => {
    const response = await handlePracticeBotRequest(
      new Request("https://practice.example.com/health"),
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      service: "sukc-practice-recorder-bot",
      database: "ok",
    });
  });

  it("rejects unsigned interactions", async () => {
    const response = await handlePracticeBotRequest(
      new Request("https://practice.example.com/interactions", {
        method: "POST",
        body: JSON.stringify({ type: 1 }),
      }),
      env,
    );

    expect(response.status).toBe(401);
  });

  it("responds to Discord endpoint verification", async () => {
    const response = await handlePracticeBotRequest(
      new Request("https://practice.example.com/interactions", {
        method: "POST",
        headers: {
          "X-Signature-Ed25519": "signature",
          "X-Signature-Timestamp": "timestamp",
        },
        body: JSON.stringify({ type: 1 }),
      }),
      env,
      vi.fn().mockResolvedValue(true),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ type: 1 });
  });

  it("stores the selected posting channel", async () => {
    const run = vi.fn().mockResolvedValue({ success: true });
    const bind = vi.fn(() => ({ run }));
    const prepare = vi.fn(() => ({ bind }));
    const response = await handlePracticeBotRequest(
      new Request("https://practice.example.com/interactions", {
        method: "POST",
        headers: {
          "X-Signature-Ed25519": "signature",
          "X-Signature-Timestamp": "timestamp",
        },
        body: JSON.stringify({
          type: 2,
          guild_id: "guild-1",
          channel_id: "channel-1",
          data: { name: "practice-setup" },
        }),
      }),
      { ...env, DB: { prepare } as unknown as D1Database },
      vi.fn().mockResolvedValue(true),
    );

    expect(response.status).toBe(200);
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("practice_discord_settings"));
    expect(bind).toHaveBeenCalledWith("guild-1", "channel-1");
    expect(run).toHaveBeenCalledOnce();
    await expect(response.json()).resolves.toMatchObject({ data: { flags: 64 } });
  });

  it("stores the selected practice schedule channel", async () => {
    const run = vi.fn().mockResolvedValue({ success: true });
    const bind = vi.fn(() => ({ run }));
    const prepare = vi.fn(() => ({ bind }));
    const response = await handlePracticeBotRequest(
      new Request("https://practice.example.com/interactions", {
        method: "POST",
        headers: {
          "X-Signature-Ed25519": "signature",
          "X-Signature-Timestamp": "timestamp",
        },
        body: JSON.stringify({
          type: 2,
          guild_id: "guild-1",
          channel_id: "schedule-channel-1",
          data: { name: "practice-schedule-setup" },
        }),
      }),
      { ...env, DB: { prepare } as unknown as D1Database },
      vi.fn().mockResolvedValue(true),
    );

    expect(response.status).toBe(200);
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("schedule_channel_id"));
    expect(bind).toHaveBeenCalledWith("guild-1", "schedule-channel-1", "schedule-channel-1");
    expect(run).toHaveBeenCalledOnce();
    await expect(response.json()).resolves.toMatchObject({ data: { flags: 64 } });
  });

  it("stores the selected practice administrator role", async () => {
    const run = vi.fn().mockResolvedValue({ success: true, meta: { changes: 1 } });
    const bind = vi.fn(() => ({ run }));
    const prepare = vi.fn(() => ({ bind }));
    const response = await handlePracticeBotRequest(
      new Request("https://practice.example.com/interactions", {
        method: "POST",
        headers: {
          "X-Signature-Ed25519": "signature",
          "X-Signature-Timestamp": "timestamp",
        },
        body: JSON.stringify({
          type: 2,
          guild_id: "1561041857952223352",
          data: {
            name: "practice-role-setup",
            options: [{ name: "role", type: 8, value: "1562000000000000003" }],
          },
        }),
      }),
      { ...env, DB: { prepare } as unknown as D1Database },
      vi.fn().mockResolvedValue(true),
    );

    expect(response.status).toBe(200);
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining("practice_role_id"));
    expect(bind).toHaveBeenCalledWith("1562000000000000003", "1561041857952223352");
    expect(run).toHaveBeenCalledOnce();
    await expect(response.json()).resolves.toMatchObject({
      data: { content: expect.stringContaining("練習担当ロール"), flags: 64 },
    });
  });

  it("records an attendance response from a Discord button", async () => {
    const run = vi.fn().mockResolvedValue({ success: true });
    const first = vi.fn()
      .mockResolvedValueOnce({ member_id: "M-11111111-1111-4111-8111-111111111111" })
      .mockResolvedValueOnce({ schedule_id: "PS-11111111-1111-4111-8111-111111111111" })
      .mockResolvedValueOnce({
        schedule_id: "PS-11111111-1111-4111-8111-111111111111",
        practice_date: "2026-11-03",
        start_time: "18:00",
        end_time: "21:30",
        title: "通常練習",
        location: "大久保東公民館",
        note: null,
        status: "scheduled",
        created_by_member_id: null,
        created_by_admin_identity: "admin@example.com",
        registration_batch_id: null,
        announcement_message_id: null,
      });
    const all = vi.fn().mockResolvedValue({
      results: [{
        member_id: "M-11111111-1111-4111-8111-111111111111",
        display_name: "参加者",
        response: "yes",
      }],
    });
    const bind = vi.fn(() => ({ first, run, all }));
    const prepare = vi.fn(() => ({ bind }));
    const response = await handlePracticeBotRequest(
      new Request("https://practice.example.com/interactions", {
        method: "POST",
        headers: {
          "X-Signature-Ed25519": "signature",
          "X-Signature-Timestamp": "timestamp",
        },
        body: JSON.stringify({
          type: 3,
          member: { user: { id: "discord-user-1" } },
          data: {
            custom_id: "practice-schedule:PS-11111111-1111-4111-8111-111111111111:yes",
          },
        }),
      }),
      { ...env, DB: { prepare } as unknown as D1Database },
      vi.fn().mockResolvedValue(true),
    );

    expect(response.status).toBe(200);
    expect(prepare).toHaveBeenCalledTimes(5);
    expect(bind).toHaveBeenNthCalledWith(1, "discord-user-1");
    expect(bind).toHaveBeenNthCalledWith(2, "PS-11111111-1111-4111-8111-111111111111");
    expect(bind).toHaveBeenNthCalledWith(
      3,
      "PS-11111111-1111-4111-8111-111111111111",
      "M-11111111-1111-4111-8111-111111111111",
      "yes",
      "discord",
    );
    expect(run).toHaveBeenCalledOnce();
    await expect(response.json()).resolves.toMatchObject({
      type: 7,
      data: {
        embeds: [{ fields: expect.arrayContaining([{ name: "参加", value: "参加者" }]) }],
      },
    });
  });
});
