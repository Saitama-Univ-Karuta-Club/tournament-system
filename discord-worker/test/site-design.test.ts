import { describe, expect, it, vi } from "vitest";
import {
  buildSiteDesignSetting,
  DEFAULT_PRIMARY_COLOR,
  normalizePrimaryColor,
  saveSiteDesignSetting,
  SiteDesignError,
} from "../src/site-design";

describe("site design settings", () => {
  it("builds an accessible palette from one primary color", () => {
    const design = buildSiteDesignSetting({
      primary_color: "#f4d35e",
      banner_key: null,
      banner_content_type: null,
      banner_version: null,
      updated_at: "2026-11-10T00:00:00.000Z",
    });
    expect(design.primaryColor).toBe("#f4d35e");
    expect(design.textOnPrimary).toBe("#172033");
    expect(design.backgroundColor).toMatch(/^#[0-9a-f]{6}$/);
    expect(design.bannerUrl).toBeNull();
  });

  it("rejects invalid color values", () => {
    expect(() => normalizePrimaryColor("blue")).toThrow(SiteDesignError);
  });

  it("saves a color while keeping the existing banner", async () => {
    const current = {
      primary_color: DEFAULT_PRIMARY_COLOR,
      banner_key: "site-design/header-banner",
      banner_content_type: "image/png",
      banner_version: "old-version",
      updated_at: "2026-11-10T00:00:00.000Z",
    };
    const saved = { ...current, primary_color: "#668437", updated_at: "2026-11-10T01:00:00.000Z" };
    const first = vi.fn().mockResolvedValueOnce(current).mockResolvedValueOnce(saved);
    const run = vi.fn().mockResolvedValue({ success: true });
    const prepare = vi.fn(() => ({ bind: vi.fn(() => ({ first, run })), first }));
    const design = await saveSiteDesignSetting(
      { prepare } as unknown as D1Database,
      { primaryColor: "#668437" },
      undefined,
      "discord:admin",
    );
    expect(run).toHaveBeenCalledOnce();
    expect(design.primaryColor).toBe("#668437");
    expect(design.bannerUrl).toContain("old-version");
  });
});
