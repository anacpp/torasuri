import { Events, Message } from 'discord.js';
import { geminiInfer } from '@services/gemini';
import { logger } from '@logger';

export const name = Events.MessageCreate;
export const once = false;

export async function execute(message: Message) {
  try {
    if (message.author.bot) return;

    logger.info({ tag: message.client.user }, message.content);
    const clientUser = message.client.user;
    if (!clientUser) return;

    const mentioned = message.mentions.has(clientUser) || message.content.includes(`<@${clientUser.id}>`);
    if (!mentioned) return;

    const cleaned = message.content.replace(new RegExp(`<@!?${clientUser.id}>`, 'g'), '').trim();
    if (!cleaned) return;

    // No direct sendTyping; we could ignore or send ephemeral ack
    const structured = await geminiInfer(cleaned);
    if (!structured) {
      await message.reply('Could not interpret your request.');
      return;
    }

    await message.reply('```json\n' + JSON.stringify(structured, null, 2) + '\n```');
  } catch (err) {
    logger.error({ err }, 'messageCreate handler error');
  }
}
