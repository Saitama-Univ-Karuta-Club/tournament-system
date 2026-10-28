const DISCORD_API_BASE = "https://discord.com/api/v10";

export interface DiscordMessage {
  id: string;
  channel_id: string;
}

export interface DiscordFileAttachment {
  data: ArrayBuffer;
  filename: string;
  contentType: string;
  description?: string;
}

export interface DiscordMessagePayload {
  content?: string;
  embeds?: Array<{
    title?: string;
    description?: string;
    color?: number;
    image?: {
      url: string;
    };
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
    roles?: string[];
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

export function editChannelMessage(
  token: string,
  channelId: string,
  messageId: string,
  payload: DiscordMessagePayload,
  fetcher: typeof fetch = fetch,
): Promise<DiscordMessage> {
  return discordRequest<DiscordMessage>(
    token,
    `/channels/${channelId}/messages/${messageId}`,
    { method: "PATCH", body: JSON.stringify(payload) },
    fetcher,
  );
}

export async function sendChannelMessageWithFiles(
  token: string,
  channelId: string,
  payload: DiscordMessagePayload,
  files: DiscordFileAttachment[],
  fetcher: typeof fetch = fetch,
): Promise<DiscordMessage> {
  const form = new FormData();
  form.append("payload_json", JSON.stringify({
    ...payload,
    attachments: files.map((file, index) => ({
      id: index,
      filename: file.filename,
      description: file.description,
    })),
  }));
  files.forEach((file, index) => {
    form.append(
      `files[${index}]`,
      new Blob([file.data], { type: file.contentType }),
      file.filename,
    );
  });

  const response = await fetcher(
    `${DISCORD_API_BASE}/channels/${channelId}/messages`,
    {
      method: "POST",
      headers: { Authorization: `Bot ${token}` },
      body: form,
    },
  );
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`Discord API error (${response.status}): ${detail}`);
  }
  return await response.json<DiscordMessage>();
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
