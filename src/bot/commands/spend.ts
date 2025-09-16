import { SlashCommandBuilder, ChatInputCommandInteraction, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { getTreasuryConfig } from '@services/treasury';
import { canUserPropose, createSpend, listPending, listHistory, getSpend, addSignature, finalizeSubmit, cancelSpend, hasQuorum } from '@services/spend';
import { getSigner } from '@services/signers';
import { logger } from '@logger';

export const data = new SlashCommandBuilder()
  .setName('spend')
  .setDescription('Propose or approve spends')
  .addSubcommand(s => s.setName('propose').setDescription('Propose a payment')
    .addStringOption(o => o.setName('destination').setDescription('Destination account (G...)').setRequired(true))
    .addNumberOption(o => o.setName('amount').setDescription('Amount in XLM').setRequired(true))
    .addStringOption(o => o.setName('memo').setDescription('Optional memo').setRequired(false)))
  .addSubcommand(s => s.setName('purpose').setDescription('Propor gasto (modal) com título, descrição e destinatário'))
  .addSubcommand(s => s.setName('list').setDescription('List pending spends'))
  .addSubcommand(s => s.setName('history').setDescription('Recent submitted/cancelled/expired spends'))
  .addSubcommand(s => s.setName('view').setDescription('View single spend').addStringOption(o => o.setName('id').setDescription('Spend ID').setRequired(true)));

function spendActionRow(id: string, status: string, canApprove: boolean) {
  const row = new ActionRowBuilder<ButtonBuilder>();
  if (status === 'collecting') {
    row.addComponents(new ButtonBuilder().setCustomId(`spend_refresh_${id}`).setLabel('Refresh').setStyle(ButtonStyle.Secondary));
    if (canApprove) row.addComponents(new ButtonBuilder().setCustomId(`spend_sign_${id}`).setLabel('Approve / Sign').setStyle(ButtonStyle.Success));
    row.addComponents(new ButtonBuilder().setCustomId(`spend_cancel_${id}`).setLabel('Cancel').setStyle(ButtonStyle.Danger));
  } else {
    row.addComponents(new ButtonBuilder().setCustomId(`spend_view_${id}`).setLabel('View').setStyle(ButtonStyle.Secondary).setDisabled(true));
  }
  return [row];
}

function formatSpend(spend: any) {
  return [
    spend.title ? `Título: ${spend.title}` : undefined,
    spend.description ? `Descrição: ${spend.description}` : undefined,
    `ID: ${spend.id}`,
    `Tipo: ${spend.type}`,
    `Valor: ${spend.amountXlm} XLM`,
    spend.recipientUserId ? `Destinatário Discord: <@${spend.recipientUserId}>` : undefined,
    `Destination (Stellar): ${spend.destination}`,
    spend.memo ? `Memo: ${spend.memo}` : undefined,
    `Aprovações: ${spend.approvals.length}/${spend.requiredApprovals}`,
    `Status: ${spend.status}`,
    spend.submissionHash ? `Tx Hash: ${spend.submissionHash}` : undefined,
    spend.error ? `Erro: ${spend.error}` : undefined,
    `Expira em: ${Math.max(0, Math.round((spend.expiresAt - Date.now())/1000))}s`
  ].filter(Boolean).join('\n');
}

export async function execute(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) return interaction.reply({ content: 'Guild only', ephemeral: true });
  const guildId = interaction.guildId; const sub = interaction.options.getSubcommand();
  try {
    if (sub === 'propose') {
      const destination = interaction.options.getString('destination', true).trim();
      const amount = interaction.options.getNumber('amount', true);
      const memo = interaction.options.getString('memo', false) || undefined;
      if (!/^G[A-Z0-9]{55}$/.test(destination)) return interaction.reply({ content: 'Invalid destination.', ephemeral: true });
      if (amount <= 0) return interaction.reply({ content: 'Amount must be > 0', ephemeral: true });
      if (!(await canUserPropose(guildId, interaction.user.id))) return interaction.reply({ content: 'Not authorized.', ephemeral: true });
      const spend = await createSpend({ guildId, proposerUserId: interaction.user.id, destination, memo, amountXlm: amount });
      return interaction.reply({ content: formatSpend(spend), components: spendActionRow(spend.id, spend.status, true) });
    }
    if (sub === 'purpose') {
      if (!(await canUserPropose(guildId, interaction.user.id))) return interaction.reply({ content: 'Not authorized.', ephemeral: true });
      return interaction.showModal(buildPurposeModal());
    }
    if (sub === 'list') {
      const pending = listPending(guildId);
      if (!pending.length) return interaction.reply({ content: 'No pending spends.', ephemeral: true });
      const lines = pending.map(s => `${s.id} ${s.amountXlm}XLM -> ${s.destination.substring(0,6)}... (${s.approvals.length}/${s.requiredApprovals})`);
      return interaction.reply({ content: lines.join('\n'), ephemeral: true });
    }
    if (sub === 'history') {
      const hist = listHistory(guildId, 10);
      if (!hist.length) return interaction.reply({ content: 'No history.', ephemeral: true });
      const lines = hist.map(s => `${s.id} ${s.amountXlm}XLM ${s.status}${s.submissionHash ? ' ' + s.submissionHash.slice(0,8)+'...' : ''}`);
      return interaction.reply({ content: lines.join('\n'), ephemeral: true });
    }
    if (sub === 'view') {
      const id = interaction.options.getString('id', true);
      const spend = getSpend(guildId, id);
      if (!spend) return interaction.reply({ content: 'Not found.', ephemeral: true });
      const canApprove = !!(await getSigner(guildId, interaction.user.id)) || (await getTreasuryConfig(guildId))?.adminUserId === interaction.user.id;
      return interaction.reply({ content: formatSpend(spend), components: spendActionRow(spend.id, spend.status, canApprove), ephemeral: true });
    }
  } catch (e: any) {
    logger.error({ e }, 'spend_command_error');
    return interaction.reply({ content: 'Error: ' + e.message, ephemeral: true });
  }
}

// Interaction handlers for buttons & modals
export const spendHandlers = { handleButton, handleModal };

function buildSignModal(id: string) {
  const m = new ModalBuilder().setCustomId(`spend_modal_sign_${id}`).setTitle('Provide Signed XDR');
  m.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('public_key').setLabel('Signer Public Key').setStyle(TextInputStyle.Short).setRequired(true)),
    new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('signed_xdr').setLabel('Signed Transaction XDR').setStyle(TextInputStyle.Paragraph).setRequired(true))
  );
  return m;
}

function buildPurposeModal() {
  const modal = new ModalBuilder().setCustomId('spend_modal_purpose').setTitle('Propor Gasto');
  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('title').setLabel('Título').setStyle(TextInputStyle.Short).setMaxLength(80).setRequired(true)),
    new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('description').setLabel('Descrição / Motivo').setStyle(TextInputStyle.Paragraph).setMaxLength(500).setRequired(true)),
    new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('recipient').setLabel('Destinatário (@menção)').setStyle(TextInputStyle.Short).setRequired(true)),
    new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('amount').setLabel('Valor em XLM').setStyle(TextInputStyle.Short).setRequired(true))
  );
  return modal;
}

async function handleButton(interaction: any) {
  if (!interaction.guildId) return interaction.reply({ content: 'Guild only', ephemeral: true });
  const [prefix, action, id] = interaction.customId.split('_');
  if (prefix !== 'spend') return;
  const spend = getSpend(interaction.guildId, id);
  if (!spend) return interaction.reply({ content: 'Spend not found.', ephemeral: true });
  const cfg = await getTreasuryConfig(interaction.guildId);
  const isAdmin = cfg?.adminUserId === interaction.user.id;
  const signer = await getSigner(interaction.guildId, interaction.user.id);
  const canApprove = !!signer || isAdmin;

  try {
    switch (action) {
      case 'refresh': {
        return interaction.reply({ content: formatSpend(spend), ephemeral: true });
      }
      case 'sign': {
        if (spend.status !== 'collecting') return interaction.reply({ content: 'Not collecting.', ephemeral: true });
        if (!canApprove) return interaction.reply({ content: 'Not authorized.', ephemeral: true });
        return interaction.showModal(buildSignModal(spend.id));
      }
      case 'cancel': {
        if (spend.proposerUserId !== interaction.user.id && !isAdmin) return interaction.reply({ content: 'Not proposer.', ephemeral: true });
        cancelSpend(interaction.guildId, spend.id, interaction.user.id);
        return interaction.reply({ content: 'Cancelled.', ephemeral: true });
      }
      default: return interaction.reply({ content: 'Unknown action', ephemeral: true });
    }
  } catch (e: any) {
    logger.error({ e }, 'spend_button_err');
    return interaction.reply({ content: 'Error: ' + e.message, ephemeral: true });
  }
}

async function handleModal(interaction: any) {
  if (!interaction.guildId) return interaction.reply({ content: 'Guild only', ephemeral: true });
  if (interaction.customId === 'spend_modal_purpose') {
    try {
      const guildId = interaction.guildId; const proposerId = interaction.user.id;
      if (!(await canUserPropose(guildId, proposerId))) return interaction.reply({ content: 'Not authorized.', ephemeral: true });
      const title = interaction.fields.getTextInputValue('title').trim();
      const description = interaction.fields.getTextInputValue('description').trim();
      const recipientRaw = interaction.fields.getTextInputValue('recipient').trim();
      const amountRaw = interaction.fields.getTextInputValue('amount').trim().replace(',', '.');
      const mentionMatch = recipientRaw.match(/<@!?(\d+)>/);
      if (!mentionMatch) return interaction.reply({ content: 'Destinatário deve ser uma menção válida.', ephemeral: true });
      const recipientUserId = mentionMatch[1];
      const recipientSigner = await getSigner(guildId, recipientUserId);
      if (!recipientSigner) return interaction.reply({ content: 'Destinatário não possui signer verificado.', ephemeral: true });
      const amount = Number(amountRaw);
      if (isNaN(amount) || amount <= 0) return interaction.reply({ content: 'Valor inválido.', ephemeral: true });
      const cfg = await getTreasuryConfig(guildId);
      if (!cfg) return interaction.reply({ content: 'Treasury not configured.', ephemeral: true });
      const memoCandidate = title.slice(0, 28);
      const spend = await createSpend({ guildId, proposerUserId: proposerId, destination: recipientSigner.publicKey, memo: memoCandidate, amountXlm: amount, title, description, recipientUserId });
      return interaction.reply({ content: formatSpend(spend), components: spendActionRow(spend.id, spend.status, true) });
    } catch (e: any) {
      logger.error({ e }, 'purpose_modal_error');
      return interaction.reply({ content: 'Erro ao criar gasto: ' + e.message, ephemeral: true });
    }
  }
  if (interaction.customId === 'spend_modal_sign') {
    const parts = interaction.customId.split('_');
    if (parts[0] !== 'spend' || parts[1] !== 'modal' || parts[2] !== 'sign') return;
    const id = parts.slice(3).join('_');
    const spend = getSpend(interaction.guildId, id);
    if (!spend) return interaction.reply({ content: 'Spend not found.', ephemeral: true });
    const pk = interaction.fields.getTextInputValue('public_key').trim();
    const xdr = interaction.fields.getTextInputValue('signed_xdr').trim();
    if (!/^G[A-Z0-9]{55}$/.test(pk)) return interaction.reply({ content: 'Invalid public key', ephemeral: true });
    try {
      const res = await addSignature(interaction.guildId, spend.id, interaction.user.id, pk, xdr);
      const updated = res.updatedSpend;
      let autoSubmit = false;
      if (updated.type === 'MICRO' && updated.approvals.length >= 1) autoSubmit = true;
      if (updated.type === 'MAJOR' && hasQuorum(updated)) autoSubmit = true;
      if (autoSubmit) {
        await finalizeSubmit(interaction.guildId, updated.id);
      }
      return interaction.reply({ content: formatSpend(updated), ephemeral: true });
    } catch (e: any) {
      let msg = 'Error: ' + e.message;
      if (e.message === 'BAD_XDR') msg = 'XDR inválido ou não corresponde à base.';
      if (e.message === 'MISSING_SIGNATURE') msg = 'Assinatura não encontrada no XDR fornecido.';
      if (e.message === 'HASH_MISMATCH') msg = 'Transação diferente da original.';
      return interaction.reply({ content: msg, ephemeral: true });
    }
  }
}
