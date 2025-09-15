import { Client, GatewayIntentBits, Collection } from 'discord.js';
import { logger } from '@logger';

export function createDiscordClient() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  // Attach a simple commands collection (later you can extend a Command interface)
  (client as any).commands = new Collection();

  client.once('ready', () => {
    logger.info({ tag: client.user?.tag }, 'Discord bot logged in');
  });

  return client;
}

export async function startDiscordBot(client: Client) {
  const token = process.env.DISCORD_TOKEN;
  if (!token) {
    throw new Error('DISCORD_TOKEN not set');
  }
  await client.login(token);
}
