export const DEFAULT_PRIMARY_COLOR = "#3658b2";
export const SITE_BANNER_KEY = "site-design/header-banner";
export const MAX_SITE_BANNER_BYTES = 5 * 1024 * 1024;

const SUPPORTED_BANNER_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

interface SiteDesignRow {
  primary_color: string;
  banner_key: string | null;
  banner_content_type: string | null;
  banner_version: string | null;
  updated_at: string;
}

export interface SiteDesignSetting {
  primaryColor: string;
  primaryDark: string;
  primaryLight: string;
  backgroundColor: string;
  lineColor: string;
  textColor: string;
  mutedTextColor: string;
  textOnPrimary: string;
  bannerUrl: string | null;
  bannerVersion: string | null;
  customized: boolean;
  updatedAt: string | null;
}

export class SiteDesignError extends Error {
  constructor(message: string, readonly statusCode = 400) {
    super(message);
  }
}

function parseHex(color: string): [number, number, number] {
  return [
    Number.parseInt(color.slice(1, 3), 16),
    Number.parseInt(color.slice(3, 5), 16),
    Number.parseInt(color.slice(5, 7), 16),
  ];
}

function toHex(channels: number[]): string {
  return `#${channels.map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("")}`;
}

function mix(color: string, target: string, targetWeight: number): string {
  const sourceChannels = parseHex(color);
  const targetChannels = parseHex(target);
  return toHex(sourceChannels.map((channel, index) => (
    channel * (1 - targetWeight) + targetChannels[index] * targetWeight
  )));
}

function relativeLuminance(color: string): number {
  const channels = parseHex(color).map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(first: string, second: string): number {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second));
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

function readableMutedColor(textColor: string, backgroundColor: string): string {
  for (const backgroundWeight of [0.4, 0.34, 0.28, 0.2]) {
    const candidate = mix(textColor, backgroundColor, backgroundWeight);
    if (contrastRatio(candidate, backgroundColor) >= 4.5) return candidate;
  }
  return textColor;
}

export function normalizePrimaryColor(value: unknown): string {
  if (typeof value !== "string" || !HEX_COLOR.test(value.trim())) {
    throw new SiteDesignError("メインカラーは#から始まる6桁のカラーコードで指定してください。");
  }
  return value.trim().toLowerCase();
}

export function buildSiteDesignSetting(row?: SiteDesignRow | null): SiteDesignSetting {
  const primaryColor = row?.primary_color && HEX_COLOR.test(row.primary_color)
    ? row.primary_color.toLowerCase()
    : DEFAULT_PRIMARY_COLOR;
  const primaryIsLight = relativeLuminance(primaryColor) > 0.48;
  const bannerVersion = row?.banner_key ? row.banner_version : null;
  const backgroundColor = mix(primaryColor, "#ffffff", 0.96);
  const textColor = mix(primaryColor, "#000000", primaryIsLight ? 0.78 : 0.72);
  return {
    primaryColor,
    primaryDark: mix(primaryColor, "#000000", primaryIsLight ? 0.48 : 0.24),
    primaryLight: mix(primaryColor, "#ffffff", 0.86),
    backgroundColor,
    lineColor: mix(primaryColor, "#ffffff", 0.80),
    textColor,
    mutedTextColor: readableMutedColor(textColor, backgroundColor),
    textOnPrimary: primaryIsLight ? "#172033" : "#ffffff",
    bannerUrl: row?.banner_key
      ? `/site-banner${bannerVersion ? `?v=${encodeURIComponent(bannerVersion)}` : ""}`
      : null,
    bannerVersion,
    customized: Boolean(row && (primaryColor !== DEFAULT_PRIMARY_COLOR || row.banner_key)),
    updatedAt: row?.updated_at ?? null,
  };
}

export async function getSiteDesignSetting(db: D1Database): Promise<SiteDesignSetting> {
  try {
    const row = await db.prepare(
      `SELECT primary_color, banner_key, banner_content_type, banner_version, updated_at
       FROM site_design_settings WHERE setting_id = 1`,
    ).first<SiteDesignRow>();
    return buildSiteDesignSetting(row);
  } catch (error) {
    console.error("デザイン設定の取得エラー", error);
    return buildSiteDesignSetting();
  }
}

export async function saveSiteDesignSetting(
  db: D1Database,
  input: { primaryColor: unknown; banner?: File | null; removeBanner?: boolean },
  bucket: R2Bucket | undefined,
  updatedBy: string,
): Promise<SiteDesignSetting> {
  const primaryColor = normalizePrimaryColor(input.primaryColor);
  const current = await db.prepare(
    `SELECT primary_color, banner_key, banner_content_type, banner_version, updated_at
     FROM site_design_settings WHERE setting_id = 1`,
  ).first<SiteDesignRow>();
  let bannerKey = current?.banner_key ?? null;
  let bannerType = current?.banner_content_type ?? null;
  let bannerVersion = current?.banner_version ?? null;

  if (input.banner) {
    if (!bucket) throw new SiteDesignError("画像の保存先が設定されていません。", 503);
    if (!SUPPORTED_BANNER_TYPES.has(input.banner.type)) {
      throw new SiteDesignError("バナー画像はJPEG・PNG・WebP形式で選択してください。");
    }
    if (input.banner.size <= 0 || input.banner.size > MAX_SITE_BANNER_BYTES) {
      throw new SiteDesignError("バナー画像は5MB以内で選択してください。");
    }
    bannerVersion = crypto.randomUUID();
    await bucket.put(SITE_BANNER_KEY, await input.banner.arrayBuffer(), {
      httpMetadata: { contentType: input.banner.type },
      customMetadata: { uploadedBy: updatedBy, version: bannerVersion },
    });
    bannerKey = SITE_BANNER_KEY;
    bannerType = input.banner.type;
  } else if (input.removeBanner) {
    if (bucket && bannerKey) await bucket.delete(bannerKey);
    bannerKey = null;
    bannerType = null;
    bannerVersion = null;
  }

  await db.prepare(
    `INSERT INTO site_design_settings (
       setting_id, primary_color, banner_key, banner_content_type,
       banner_version, updated_by, updated_at
     ) VALUES (1, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
     ON CONFLICT(setting_id) DO UPDATE SET
       primary_color = excluded.primary_color,
       banner_key = excluded.banner_key,
       banner_content_type = excluded.banner_content_type,
       banner_version = excluded.banner_version,
       updated_by = excluded.updated_by,
       updated_at = excluded.updated_at`,
  ).bind(primaryColor, bannerKey, bannerType, bannerVersion, updatedBy).run();
  return getSiteDesignSetting(db);
}

export async function resetSiteDesignSetting(
  db: D1Database,
  bucket?: R2Bucket,
): Promise<SiteDesignSetting> {
  const current = await db.prepare(
    "SELECT banner_key FROM site_design_settings WHERE setting_id = 1",
  ).first<{ banner_key: string | null }>();
  if (bucket && current?.banner_key) await bucket.delete(current.banner_key);
  await db.prepare("DELETE FROM site_design_settings WHERE setting_id = 1").run();
  return buildSiteDesignSetting();
}

export async function serveSiteBanner(
  db: D1Database,
  bucket?: R2Bucket,
): Promise<Response> {
  if (!bucket) return new Response("Not Found", { status: 404 });
  const row = await db.prepare(
    "SELECT banner_key, banner_content_type, banner_version FROM site_design_settings WHERE setting_id = 1",
  ).first<Pick<SiteDesignRow, "banner_key" | "banner_content_type" | "banner_version">>();
  if (!row?.banner_key) return new Response("Not Found", { status: 404 });
  const object = await bucket.get(row.banner_key);
  if (!object) return new Response("Not Found", { status: 404 });
  return new Response(object.body, {
    headers: {
      "Content-Type": row.banner_content_type || object.httpMetadata?.contentType || "application/octet-stream",
      "Cache-Control": "private, max-age=86400",
      "ETag": row.banner_version || object.httpEtag,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
