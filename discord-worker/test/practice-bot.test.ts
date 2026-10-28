import { describe, expect, it, vi } from "vitest";
import { handlePracticeBotRequest, type PracticeBotEnv } from "../src/practice-bot";
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
    ]);
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
});
