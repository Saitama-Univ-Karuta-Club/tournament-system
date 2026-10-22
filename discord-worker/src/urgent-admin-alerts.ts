import type {
  DiscordFileAttachment,
  DiscordMessagePayload,
} from "./discord-api";

export type UrgentAdminAlertKind =
  | "organizer_deadline"
  | "organizer_payment";

const DISCORD_ID = /^\d{15,22}$/;
const MAX_MESSAGE_CONTENT_LENGTH = 2000;

const ALERTS: Record<
  UrgentAdminAlertKind,
  {
    headline: string;
    pathname: string;
    r2Key: string;
    filename: string;
    description: string;
  }
> = {
  organizer_deadline: {
    headline: "🚨 **【最重要・本日締切】** 📅",
    pathname: "/notification-banners/organizer-deadline.png",
    r2Key: "system/notification-banners/v1/organizer-deadline.png",
    filename: "organizer-deadline.png",
    description: "主催者締切が本日であることを知らせる緊急警告バナー",
  },
  organizer_payment: {
    headline: "🚨 **【最重要・主催者振込未完了】** 💴",
    pathname: "/notification-banners/organizer-payment.png",
    r2Key: "system/notification-banners/v1/organizer-payment.png",
    filename: "organizer-payment.png",
    description: "主催者への振込期限が本日であることを知らせる緊急警告バナー",
  },
};

function validRoleId(value: string | null | undefined): string | null {
  const roleId = value?.trim() ?? "";
  return DISCORD_ID.test(roleId) ? roleId : null;
}

function bannerUrl(
  kind: UrgentAdminAlertKind,
  publicBaseUrl?: string,
): string | null {
  if (!publicBaseUrl) return null;
  try {
    const url = new URL(ALERTS[kind].pathname, publicBaseUrl);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export async function loadAdminRoleId(
  db: D1Database,
  guildId?: string,
): Promise<string | null> {
  const row = guildId
    ? await db.prepare(
      `SELECT admin_role_id FROM discord_settings
       WHERE guild_id = ? LIMIT 1`,
    ).bind(guildId).first<{ admin_role_id: string | null }>()
    : await db.prepare(
      `SELECT admin_role_id FROM discord_settings
       WHERE admin_role_id IS NOT NULL
       ORDER BY updated_at DESC LIMIT 1`,
    ).first<{ admin_role_id: string | null }>();
  return validRoleId(row?.admin_role_id);
}

export function decorateUrgentAdminAlert(
  payload: DiscordMessagePayload,
  kind: UrgentAdminAlertKind,
  options: {
    adminRoleId?: string | null;
    publicBaseUrl?: string;
    imageUrl?: string;
  } = {},
): DiscordMessagePayload {
  const roleId = validRoleId(options.adminRoleId);
  const prefix = [
    roleId ? `<@&${roleId}>` : "",
    ALERTS[kind].headline,
  ].filter(Boolean).join("\n");
  const contentLimit = Math.max(
    0,
    MAX_MESSAGE_CONTENT_LENGTH - prefix.length - 1,
  );
  const body = (payload.content ?? "").slice(0, contentLimit);
  const imageUrl = options.imageUrl ?? bannerUrl(kind, options.publicBaseUrl);

  return {
    ...payload,
    content: body ? `${prefix}\n${body}` : prefix,
    embeds: imageUrl
      ? [
        {
          color: 0xed4245,
          image: { url: imageUrl },
        },
        ...(payload.embeds ?? []),
      ]
      : payload.embeds,
    allowed_mentions: roleId
      ? { parse: [], roles: [roleId] }
      : { parse: [] },
  };
}

export async function loadUrgentAdminAlertAttachment(
  bucket: R2Bucket | undefined,
  kind: UrgentAdminAlertKind,
): Promise<DiscordFileAttachment | null> {
  if (!bucket) return null;
  const alert = ALERTS[kind];
  const object = await bucket.get(alert.r2Key);
  if (!object) return null;
  return {
    data: await object.arrayBuffer(),
    filename: alert.filename,
    contentType: object.httpMetadata?.contentType ?? "image/png",
    description: alert.description,
  };
}

export async function serveUrgentAdminAlertAsset(
  request: Request,
  bucket?: R2Bucket,
): Promise<Response | null> {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const pathname = new URL(request.url).pathname;
  const alert = Object.values(ALERTS).find(
    (candidate) => candidate.pathname === pathname,
  );
  if (!alert) return null;
  if (!bucket) return new Response("Not Found", { status: 404 });

  const object = await bucket.get(alert.r2Key);
  if (!object) return new Response("Not Found", { status: 404 });
  return new Response(request.method === "HEAD" ? null : object.body, {
    headers: {
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Type": object.httpMetadata?.contentType ?? "image/png",
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
      ETag: object.httpEtag,
    },
  });
}
