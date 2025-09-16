import { Events, Interaction } from 'discord.js';
import { logger } from '@logger';
import { treasuryHandlers } from '@discord/commands/treasury';
import { spendHandlers } from '@discord/commands/spend';

export const name = Events.InteractionCreate;
export async function execute(interaction: Interaction) {
  try {
    if (interaction.isChatInputCommand()) {
      const command: any = (interaction.client as any).commands?.get(interaction.commandName);
      if (!command) {
        logger.warn({ command: interaction.commandName }, 'Unknown command');
        return;
      }
      await command.execute(interaction);
      return;
    }

    if (interaction.isButton()) {
      if (interaction.customId.startsWith('treasury_')) {
        return treasuryHandlers.handleButton(interaction);
      }
      if (interaction.customId.startsWith('spend_')) {
        return spendHandlers.handleButton(interaction);
      }
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith('treasury_modal_')) {
        return treasuryHandlers.handleModal(interaction);
      }
      if (interaction.customId.startsWith('spend_modal_')) {
        return spendHandlers.handleModal(interaction);
      }
    }
  } catch (error) {
    logger.error({ err: error }, 'Interaction handler error');
    if ('replied' in interaction && (interaction as any).replied) return;
    if ('reply' in interaction) {
      try { (interaction as any).reply({ content: 'Error handling interaction', ephemeral: true }); } catch {}
    }
  }
}
