export {};

import { commands } from "../src/commands";

const applicationId = process.env.DISCORD_APPLICATION_ID;
const guildId = process.env.DISCORD_GUILD_ID;
const token = process.env.DISCORD_BOT_TOKEN;

if (!applicationId || !guildId || !token) {
  throw new Error(
    "DISCORD_APPLICATION_ID, DISCORD_GUILD_ID, DISCORD_BOT_TOKEN を設定してください。",
  );
}

const response = await fetch(
  `https://discord.com/api/v10/applications/${applicationId}/guilds/${guildId}/commands`,
  {
    method: "PUT",
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commands),
  },
);

if (!response.ok) {
  throw new Error(
    `Discordへのコマンド登録に失敗しました (${response.status}): ${await response.text()}`,
  );
}

console.log("開発用サーバーに /ping を登録しました。");
