import { describe, expect, it, vi } from "vitest";
import {
  buildBackupFailureMessage,
  processBackupFailureAlerts,
} from "../src/backup-alerts";

describe("backup failure alerts", () => {
  it("builds an administrator-facing message without mentions", () => {
    const payload = buildBackupFailureMessage({
      backup_run_id: "scheduled-2026-10-20",
      trigger_source: "scheduled",
      started_at: "2026-10-20T18:00:00.000Z",
      completed_at: "2026-10-20T18:01:00.000Z",
      error_message: "Google OAuth更新エラー",
      alert_attempt_count: 0,
    });

    expect(payload.content).toContain("バックアップに失敗");
    expect(payload.embeds?.[0]?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "エラー", value: "Google OAuth更新エラー" }),
      ]),
    );
    expect(payload.allowed_mentions).toEqual({ parse: [] });
  });

  it("does nothing when there are no failed backup runs", async () => {
    const all = vi.fn().mockResolvedValue({ results: [] });
    const prepare = vi.fn().mockReturnValue({
      bind: vi.fn().mockReturnValue({ all }),
    });

    await expect(
      processBackupFailureAlerts({
        DB: { prepare } as unknown as D1Database,
        DISCORD_BOT_TOKEN: "bot-token",
      }),
    ).resolves.toBe(0);
    expect(prepare).toHaveBeenCalledOnce();
  });
});
