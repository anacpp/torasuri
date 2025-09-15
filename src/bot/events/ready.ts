import { Events } from 'discord.js';
import { logger } from '@logger';

export const name = Events.ClientReady;
export const once = true;
export function execute(client: any) {
  logger.info({ user: client.user?.tag }, 'Bot is ready');
}
