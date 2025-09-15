import { Client, GatewayIntentBits, Collection, Events } from 'discord.js';
import { logger } from '@logger';
import fs from 'fs';
import path from 'path';

export function createDiscordClient() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  (client as any).commands = new Collection();

  loadEvents(client);

  client.once(Events.ClientReady, () => {
    logger.info({ tag: client.user?.tag, id: client.user?.id }, 'Discord bot logged in');
  });

  return client;
}

function loadEvents(client: Client) {
  const eventsDir = path.join(__dirname, 'events');
  let loaded = 0;
  if (!fs.existsSync(eventsDir)) {
    logger.warn({ eventsDir }, 'Events directory not found');
    return;
  }
  for (const file of fs.readdirSync(eventsDir)) {
    if (!file.match(/\.(ts|js)$/)) continue;
    const full = path.join(eventsDir, file);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(full);
    const name = mod.name;
    const execute = mod.execute;
    if (!name || !execute) continue;
    if (mod.once) {
      client.once(name, (...args) => execute(...args));
    } else {
      client.on(name, (...args) => execute(...args));
    }
    loaded++;
  }
  logger.info({ loaded }, 'Discord events loaded');
}

export async function startDiscordBot(client: Client) {
  const token = process.env.DISCORD_TOKEN;
  if (!token) {
    throw new Error('DISCORD_TOKEN not set');
  }
  await client.login(token);
}
