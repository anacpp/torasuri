import { Events, Interaction } from 'discord.js';
import { logger } from '@logger';

export const name = Events.InteractionCreate;
export async function execute(interaction: Interaction) {
  if (!interaction.isChatInputCommand()) return;

  const command: any = (interaction.client as any).commands?.get(interaction.commandName);
  if (!command) {
    logger.warn({ command: interaction.commandName }, 'Unknown command');
    return;
  }

  try {
    await command.execute(interaction);
  } catch (error) {
    logger.error({ err: error }, 'Command execution error');
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: 'There was an error executing this command.', ephemeral: true });
    } else {
      await interaction.reply({ content: 'There was an error executing this command.', ephemeral: true });
    }
  }
}
