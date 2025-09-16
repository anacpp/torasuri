import { ChatInputCommandInteraction, SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, InteractionCollector } from 'discord.js';
import { getTreasuryConfig, setTreasuryConfig } from '@services/treasury';
import { logger } from '@logger';
import { treasurySchema } from '@schemas/treasury';

// In-memory wizard state
interface WizardState {
  stage: number;
  data: any;
  timeout: NodeJS.Timeout;
  adminUserId: string;
}

const wizardStates = new Map<string, WizardState>(); // key: guildId

export const data = new SlashCommandBuilder()
  .setName('treasury')
  .setDescription('Treasury management')
  .addSubcommandGroup(g =>
    g.setName('setup').setDescription('Configure treasury').addSubcommand(s => s.setName('start').setDescription('Start setup wizard'))
  )
  .addSubcommand(s => s.setName('view').setDescription('View current treasury config'))
  .addSubcommand(s => s.setName('reset').setDescription('Reset existing treasury config'));

function startTimeout(guildId: string) {
  const st = wizardStates.get(guildId);
  if (!st) return;
  clearTimeout(st.timeout);
  st.timeout = setTimeout(() => {
    wizardStates.delete(guildId);
  }, 5 * 60 * 1000);
}

async function startWizard(interaction: ChatInputCommandInteraction) {
  const guildId = interaction.guildId!;
  if (wizardStates.has(guildId)) {
    await interaction.reply({ content: 'A wizard is already running. Cancel or wait for it to finish.', ephemeral: true });
    return;
  }
  if (getTreasuryConfig(guildId)) {
    await interaction.reply({ content: 'Treasury already configured. Use /treasury reset to reconfigure.', ephemeral: true });
    return;
  }
  const timeout = setTimeout(() => {
    wizardStates.delete(guildId);
  }, 5 * 60 * 1000);
  wizardStates.set(guildId, { stage: 1, data: { guildId, adminUserId: interaction.user.id }, timeout, adminUserId: interaction.user.id });
  await interaction.reply({ content: 'Step 1: Enter Stellar public key', ephemeral: true, components: [buildEnterKeyRow()] });
}

function buildEnterKeyRow() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('treasury_enter_key').setLabel('Enter Key').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('treasury_cancel').setLabel('Cancel').setStyle(ButtonStyle.Danger)
  );
}

function buildThresholdRow() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('treasury_enter_threshold').setLabel('Set Threshold').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('treasury_cancel').setLabel('Cancel').setStyle(ButtonStyle.Danger)
  );
}

function buildSignersRow() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('treasury_skip_signers').setLabel('Skip').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('treasury_cancel').setLabel('Cancel').setStyle(ButtonStyle.Danger)
  );
}

function buildSummaryRow() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('treasury_confirm').setLabel('Confirm').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('treasury_cancel').setLabel('Cancel').setStyle(ButtonStyle.Danger)
  );
}

function stellarValid(key: string) { return /^G[A-Z0-9]{55}$/.test(key); }

function parseAmountToCents(input: string): number | null {
  if (!input) return 0;
  const cleaned = input
    .toLowerCase()
    .replace(/r\$|reais|real|\s/g, '')
    .replace(/,/g, '.');
  if (!cleaned) return 0;
  const num = Number(cleaned);
  if (isNaN(num) || num < 0) return null;
  return Math.round(num * 100);
}

async function handleButton(interaction: any) {
  const guildId = interaction.guildId!;
  const state = wizardStates.get(guildId);
  if (!state) {
    await interaction.reply({ content: 'No active wizard.', ephemeral: true });
    return;
  }
  startTimeout(guildId);
  switch (interaction.customId) {
    case 'treasury_enter_key': {
      const modal = new ModalBuilder().setCustomId('treasury_modal_key').setTitle('Stellar Public Key');
      const input = new TextInputBuilder().setCustomId('stellar_key').setLabel('Key').setStyle(TextInputStyle.Short).setRequired(true);
      modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
      await interaction.showModal(modal);
      break;
    }
    case 'treasury_enter_threshold': {
      const modal = new ModalBuilder().setCustomId('treasury_modal_threshold').setTitle('Micro-spend Threshold');
      const input = new TextInputBuilder().setCustomId('threshold').setLabel('Value (e.g. 100.50)').setStyle(TextInputStyle.Short).setRequired(false);
      modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
      await interaction.showModal(modal);
      break;
    }
    case 'treasury_skip_signers': {
      state.stage = 4; // summary
      await interaction.update({ content: summaryContent(state), components: [buildSummaryRow()], embeds: [] });
      break;
    }
    case 'treasury_confirm': {
      tryFinalize(interaction, state);
      break;
    }
    case 'treasury_cancel': {
      wizardStates.delete(guildId);
      await interaction.update({ content: 'Setup cancelled.', components: [] });
      break;
    }
  }
}

async function tryFinalize(interaction: any, state: WizardState) {
  const config = {
    guildId: state.data.guildId,
    stellarPublicKey: state.data.stellarPublicKey,
    adminUserId: state.data.adminUserId,
    microSpendThresholdInCents: state.data.microSpendThresholdInCents ?? 0,
    additionalSignerIds: state.data.additionalSignerIds || [],
    multisig: computeMultisig(state)
  };
  try {
    treasurySchema.parse(config);
    setTreasuryConfig(config as any);
    wizardStates.delete(state.data.guildId);
    await interaction.update({ content: '```json\n' + JSON.stringify({ type: 'treasurySetup', ...config }, null, 2) + '\n```', components: [] });
  } catch (err:any) {
    logger.error({ err }, 'Validation failed on finalize');
    await interaction.reply({ content: 'Validation failed.', ephemeral: true });
  }
}

function computeMultisig(state: WizardState) {
  const total = 1 + (state.data.additionalSignerIds?.length || 0);
  const required = Math.max(1, Math.ceil(total * 2/3));
  return { requiredApprovals: required, totalSigners: total, quorumRatio: `${required}/${total}` };
}

function summaryContent(state: WizardState) {
  return 'Summary:\n' + 'Stellar: ' + state.data.stellarPublicKey + '\nThreshold (cents): ' + (state.data.microSpendThresholdInCents ?? 0) + '\nAdditional signers: ' + (state.data.additionalSignerIds?.length || 0);
}

async function handleModal(interaction: any) {
  const guildId = interaction.guildId!;
  const state = wizardStates.get(guildId);
  if (!state) return;
  startTimeout(guildId);
  if (interaction.customId === 'treasury_modal_key') {
    const key = interaction.fields.getTextInputValue('stellar_key').trim();
    if (!stellarValid(key)) {
      await interaction.reply({ content: 'Invalid Stellar key. Try again.', ephemeral: true });
      return;
    }
    state.data.stellarPublicKey = key;
    state.stage = 2;
    await interaction.reply({ content: 'Step 2: Set micro-spend threshold (optional)', components: [buildThresholdRow()], ephemeral: true });
  } else if (interaction.customId === 'treasury_modal_threshold') {
    const raw = interaction.fields.getTextInputValue('threshold').trim();
    if (raw) {
      const cents = parseAmountToCents(raw);
      if (cents == null) {
        await interaction.reply({ content: 'Invalid amount. Try again.', ephemeral: true, components: [buildThresholdRow()] });
        return;
      }
      state.data.microSpendThresholdInCents = cents;
    } else {
      state.data.microSpendThresholdInCents = 0;
    }
    state.stage = 3;
    await interaction.reply({ content: 'Step 3: Mention additional signers in the next message or skip.', components: [buildSignersRow()], ephemeral: true });
    collectSigners(interaction, state);
  }
}

function collectSigners(interaction: any, state: WizardState) {
  const channel = interaction.channel;
  if (!channel) return;
  const guildId = interaction.guildId!;
  const filter = (m: any) => m.author.id === state.adminUserId;
  const collector = channel.createMessageCollector({ filter, time: 60_000, max: 1 });
  collector.on('collect', (m: any) => {
    const mentions = [...m.mentions.users.keys()].filter(id => id !== state.adminUserId);
    state.data.additionalSignerIds = Array.from(new Set(mentions));
  });
  collector.on('end', async () => {
    if (!wizardStates.has(guildId)) return;
    state.stage = 4;
    try {
      await interaction.followUp({ content: summaryContent(state), components: [buildSummaryRow()], ephemeral: true });
    } catch (e) {
      logger.error({ e }, 'Failed to send summary');
    }
  });
}

export async function execute(interaction: ChatInputCommandInteraction) {
  const subGroup = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand(false);
  if (subGroup === 'setup' && sub === 'start') {
    return startWizard(interaction);
  }
  if (sub === 'view') {
    const cfg = interaction.guildId ? getTreasuryConfig(interaction.guildId) : undefined;
    if (!cfg) return interaction.reply({ content: 'Not configured.', ephemeral: true });
    return interaction.reply({ content: '```json\n' + JSON.stringify(cfg, null, 2) + '\n```', ephemeral: true });
  }
  if (sub === 'reset') {
    // Placeholder: no reset implementation detail provided yet beyond admin check
    return interaction.reply({ content: 'Reset not yet implemented in this version.', ephemeral: true });
  }
  await interaction.reply({ content: 'Unknown subcommand.', ephemeral: true });
}

// Component / modal handlers exported for central dispatcher (to be hooked in interactionCreate if needed)
export const treasuryHandlers = { handleButton, handleModal };
