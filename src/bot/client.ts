import { Client, GatewayIntentBits, Collection, REST, Routes, Events } from 'discord.js';
import { logger } from '@logger';
import path from 'path';
import fs from 'fs';
import { env } from '@utils/env';

export function createDiscordClient() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  (client as any).commands = new Collection();

  client.once( Events.ClientReady, async () => {
    logger.info({ tag: client.user?.tag }, 'Discord bot logged in');
    client.user?.setPresence({ activities: [{ name: '/treasury setup', type: 3 }], status: 'online' });
    try {
      await registerSlashCommands(client);
    } catch (e) {
      logger.error({ err: e }, 'Failed to register slash commands');
    }
  });

  loadEvents(client);

  return client;
}

export async function startDiscordBot(client: Client) {
  const token = process.env.DISCORD_TOKEN;
  if (!token) throw new Error('DISCORD_TOKEN not set');
  await client.login(token);
}

function loadEvents(client: Client) {
  const eventsDir = path.join(__dirname, 'events');
  if (!fs.existsSync(eventsDir)) return;
  for (const file of fs.readdirSync(eventsDir)) {
    if (!file.endsWith('.js') && !file.endsWith('.ts')) continue;
    const modPath = path.join(eventsDir, file);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(modPath);
    if (!mod.name || typeof mod.execute !== 'function') continue;
    if (mod.once) {
      client.once(mod.name, (...args) => mod.execute(...args));
    } else {
      client.on(mod.name, (...args) => mod.execute(...args));
    }
  }
}

export async function registerSlashCommands(client: Client) {
  const commandsDir = path.join(__dirname, 'commands');
  const commandData: any[] = [];
  if (fs.existsSync(commandsDir)) {
    for (const file of fs.readdirSync(commandsDir)) {
      if (!file.endsWith('.js') && !file.endsWith('.ts')) continue;
      const modPath = path.join(commandsDir, file);
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const command = require(modPath);
      if (command.data && command.execute) {
        (client as any).commands.set(command.data.name, command);
        commandData.push(command.data.toJSON());
      }
    }
  }

  if (!env.DISCORD_CLIENT_ID) throw new Error('DISCORD_CLIENT_ID missing');
  const rest = new REST({ version: '10' }).setToken(env.DISCORD_TOKEN);

  try {
    // Global registration so every guild (current & future) gets commands.
    await rest.put(Routes.applicationCommands(env.DISCORD_CLIENT_ID), { body: commandData });
    logger.info({ count: commandData.length }, 'Registered GLOBAL slash commands');

    // Optional fast sync: per-guild overwrite for immediate availability (avoids global propagation delay)
    const guildIds = client.guilds.cache.map(g => g.id);
    if (guildIds.length) {
      logger.info({ guilds: guildIds.length }, 'Fast-syncing commands to joined guilds');
      for (const gid of guildIds) {
        try {
          await rest.put(Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, gid), { body: commandData });
          logger.info({ guildId: gid }, 'Synced guild commands');
        } catch (e) {
          logger.warn({ guildId: gid, err: e }, 'Guild command sync failed');
        }
      }
    }
  } catch (err) {
    logger.error({ err }, 'Error registering slash commands');
  }
}
