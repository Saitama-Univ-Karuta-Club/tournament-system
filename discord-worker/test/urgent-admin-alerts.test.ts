import { describe, expect, it, vi } from "vitest";
import {
  decorateUrgentAdminAlert,
  loadAdminRoleId,
  loadUrgentAdminAlertAttachment,
  serveUrgentAdminAlertAsset,
} from "../src/urgent-admin-alerts";

describe("urgent administrator alerts", () => {
  it("mentions only the configured administrator role and prepends the deadline banner", () => {
    const roleId = "123456789012345678";
    const message = decorateUrgentAdminAlert(
      {
        content: "本日が主催者締切日です。",
        embeds: [{ title: "埼玉大会", color: 0xed4245 }],
        allowed_mentions: { parse: [] },
      },
      "organizer_deadline",
      {
        adminRoleId: roleId,
        publicBaseUrl: "https://bot.example.com",
      },
    );

    expect(message.content).toContain(`<@&${roleId}>`);
    expect(message.content).toContain("🚨");
    expect(message.content).toContain("📅");
    expect(message.allowed_mentions).toEqual({ parse: [], roles: [roleId] });
    expect(message.embeds?.[0]?.image?.url).toBe(
      "https://bot.example.com/notification-banners/organizer-deadline.png",
    );
    expect(message.embeds?.[1]?.title).toBe("埼玉大会");
  });

  it("uses the payment banner and money emoji for an overdue transfer", () => {
    const message = decorateUrgentAdminAlert(
      { content: "主催者への振込が未完了です。" },
      "organizer_payment",
      { publicBaseUrl: "https://bot.example.com" },
    );

    expect(message.content).toContain("💴");
    expect(message.content).toContain("主催者振込未完了");
    expect(message.allowed_mentions).toEqual({ parse: [] });
    expect(message.embeds?.[0]?.image?.url).toContain("organizer-payment.png");
  });

  it("loads a valid administrator role for the configured guild", async () => {
    const first = vi.fn().mockResolvedValue({
      admin_role_id: "123456789012345678",
    });
    const bind = vi.fn(() => ({ first }));
    const prepare = vi.fn(() => ({ bind }));

    await expect(loadAdminRoleId(
      { prepare } as unknown as D1Database,
      "1534368058632572990",
    )).resolves.toBe("123456789012345678");
    expect(bind).toHaveBeenCalledWith("1534368058632572990");
  });

  it("serves a public, cacheable PNG from the fixed R2 key", async () => {
    const get = vi.fn().mockResolvedValue({
      body: "png-data",
      httpEtag: '"banner-etag"',
      httpMetadata: { contentType: "image/png" },
    });
    const response = await serveUrgentAdminAlertAsset(
      new Request("https://bot.example.com/notification-banners/organizer-payment.png"),
      { get } as unknown as R2Bucket,
    );

    expect(get).toHaveBeenCalledWith(
      "system/notification-banners/v1/organizer-payment.png",
    );
    expect(response?.status).toBe(200);
    expect(response?.headers.get("Content-Type")).toBe("image/png");
    expect(response?.headers.get("Cache-Control")).toContain("immutable");
  });

  it("loads the payment banner as a Discord attachment", async () => {
    const get = vi.fn().mockResolvedValue({
      arrayBuffer: vi.fn().mockResolvedValue(new TextEncoder().encode("png").buffer),
      httpMetadata: { contentType: "image/png" },
    });
    const attachment = await loadUrgentAdminAlertAttachment(
      { get } as unknown as R2Bucket,
      "organizer_payment",
    );

    expect(get).toHaveBeenCalledWith(
      "system/notification-banners/v1/organizer-payment.png",
    );
    expect(attachment?.filename).toBe("organizer-payment.png");
    expect(attachment?.contentType).toBe("image/png");
  });
});
