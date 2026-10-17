const DISCORD_API_BASE = "https://discord.com/api/v10";

export interface DiscordMessage {
  id: string;
  channel_id: string;
}

export interface DiscordMessagePayload {
  content?: string;
  embeds?: Array<{
    title?: string;
    description?: string;
    color?: number;
    fields?: Array<{
      name: string;
      value: string;
      inline?: boolean;
    }>;
  }>;
  components?: Array<{
    type: number;
    components: Array<{
      type: number;
      style: number;
      label: string;
      custom_id: string;
    }>;
  }>;
  allowed_mentions?: {
    parse: string[];
  };
}

async function discordRequest<T>(
  token: string,
  path: string,
  init: RequestInit,
  fetcher: typeof fetch = fetch,
): Promise<T> {
  const response = await fetcher(`${DISCORD_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`Discord API error (${response.status}): ${detail}`);
  }

  return (await response.json()) as T;
}

export function sendChannelMessage(
  token: string,
  channelId: string,
  payload: DiscordMessagePayload,
  fetcher: typeof fetch = fetch,
): Promise<DiscordMessage> {
  return discordRequest<DiscordMessage>(
    token,
    `/channels/${channelId}/messages`,
    { method: "POST", body: JSON.stringify(payload) },
    fetcher,
  );
}

export async function sendDirectMessage(
  token: string,
  discordUserId: string,
  payload: DiscordMessagePayload,
  fetcher: typeof fetch = fetch,
): Promise<DiscordMessage> {
  const dmChannel = await discordRequest<{ id: string }>(
    token,
    "/users/@me/channels",
    {
      method: "POST",
      body: JSON.stringify({ recipient_id: discordUserId }),
    },
    fetcher,
  );

  return sendChannelMessage(token, dmChannel.id, payload, fetcher);
}
