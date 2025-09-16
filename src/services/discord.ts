import type { Client } from 'discord.js';

let discordClient: Client | undefined;

export function setDiscordClient(client: Client) {
  discordClient = client;
}

export function getDiscordClient(): Client | undefined {
  return discordClient;
}
