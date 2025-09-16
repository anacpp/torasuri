import { SlashCommandBuilder, ChatInputCommandInteraction, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { env } from '@utils/env';
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

function spendActionRow(id: string, status: string, canApprove: boolean, guildId?: string, userId?: string) {
  const row = new ActionRowBuilder<ButtonBuilder>();
  if (status === 'collecting') {
    row.addComponents(new ButtonBuilder().setCustomId(`spend_refresh_${id}`).setLabel('Refresh').setStyle(ButtonStyle.Secondary));
    if (canApprove) {
      if (guildId && userId) {
        const baseUrl = (env.SERVER_URL || '').replace(/\/$/,'') || 'http://localhost:3000';
        const link = `${baseUrl}/spend/tx?guildId=${encodeURIComponent(guildId)}&spendId=${encodeURIComponent(id)}&userId=${encodeURIComponent(userId)}`;
        row.addComponents(new ButtonBuilder().setURL(link).setLabel('Assinar').setStyle(ButtonStyle.Link));
      }
      row.addComponents(new ButtonBuilder().setCustomId(`spend_sign_${id}`).setLabel('Assinar Manual').setStyle(ButtonStyle.Success));
    }
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

export { spendActionRow, formatSpend }; // export for potential reuse

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
      const spend = await createSpend({ guildId, proposerUserId: interaction.user.id, destination, memo, amountXlm: amount, channelId: interaction.channelId, messageId: interaction.id });
      return interaction.reply({ content: formatSpend(spend), components: spendActionRow(spend.id, spend.status, true, guildId, interaction.user.id) });
    }
    if (sub === 'purpose') {
      if (!(await canUserPropose(guildId, interaction.user.id))) return interaction.reply({ content: 'Not authorized.', ephemeral: true });
      return interaction.showModal(buildPurposeModal());
    }
    if (sub === 'list') {
      const pending = await listPending(guildId);
      if (!pending.length) return interaction.reply({ content: 'No pending spends.', ephemeral: true });
      const lines = pending.map((s: any) => `${s.id} ${s.amountXlm}XLM -> ${s.destination.substring(0,6)}... (${s.approvals.length}/${s.requiredApprovals})`);
      return interaction.reply({ content: lines.join('\n'), ephemeral: true });
    }
    if (sub === 'history') {
      const hist = await listHistory(guildId, 10);
      if (!hist.length) return interaction.reply({ content: 'No history.', ephemeral: true });
      const lines = hist.map((s: any) => `${s.id} ${s.amountXlm}XLM ${s.status}${s.submissionHash ? ' ' + s.submissionHash.slice(0,8)+'...' : ''}`);
      return interaction.reply({ content: lines.join('\n'), ephemeral: true });
    }
    if (sub === 'view') {
      const id = interaction.options.getString('id', true);
      const spend = await getSpend(guildId, id);
      if (!spend) return interaction.reply({ content: 'Not found.', ephemeral: true });
      const canApprove = !!(await getSigner(guildId, interaction.user.id)) || (await getTreasuryConfig(guildId))?.adminUserId === interaction.user.id;
      return interaction.reply({ content: formatSpend(spend), components: spendActionRow(spend.id, spend.status, canApprove, guildId, interaction.user.id), ephemeral: true });
    }
  } catch (e: any) {
    let msg = 'Error: ' + e.message;
    if (e.message === 'DEST_IS_TREASURY') msg = 'Destino é a própria tesouraria. Use uma conta diferente (o signer deve registrar uma chave que não seja a da tesouraria).';
    return interaction.reply({ content: msg, ephemeral: true });
  }
}

// Interaction handlers for buttons & modals
export const spendHandlers = { handleButton, handleModal };

function buildSignModal(id: string, needPublicKey: boolean) {
  const m = new ModalBuilder().setCustomId(`spend_modal_sign_${id}`).setTitle('Enviar Assinatura');
  if (needPublicKey) {
    m.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('public_key').setLabel('Signer Public Key').setStyle(TextInputStyle.Short).setRequired(true)));
  }
  m.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('signed_xdr').setLabel('Signed Transaction XDR').setStyle(TextInputStyle.Paragraph).setRequired(true)));
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

async function resolveRecipientUserId(interaction: any, input: string): Promise<string | undefined> {
  // Accept direct mention <@id> or <@!id>
  const mention = input.match(/<@!?(\d+)>/);
  if (mention) return mention[1];
  // Accept raw numeric ID
  if (/^\d{10,20}$/.test(input)) return input;
  // Accept @username or username
  const cleaned = input.startsWith('@') ? input.slice(1) : input;
  if (!cleaned) return undefined;
  try {
    const guild = interaction.guild;
    if (!guild) return undefined;
    // Try cached first
    let member = guild.members.cache.find((m: any) => m.user.username.toLowerCase() === cleaned.toLowerCase() || m.displayName?.toLowerCase() === cleaned.toLowerCase());
    if (member) return member.user.id;
    // Fallback fetch (may require GUILD_MEMBERS intent)
    const fetched = await guild.members.fetch({ query: cleaned, limit: 5 }).catch(()=>undefined);
    if (fetched) {
      member = fetched.find((m: any) => m.user.username.toLowerCase() === cleaned.toLowerCase() || m.displayName?.toLowerCase() === cleaned.toLowerCase());
      if (member) return member.user.id;
    }
  } catch {}
  return undefined;
}

async function handleButton(interaction: any) {
  if (!interaction.guildId) return interaction.reply({ content: 'Guild only', ephemeral: true });
  const [prefix, action, id] = interaction.customId.split('_');
  if (prefix !== 'spend') return;
  const spend = await getSpend(interaction.guildId, id);
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
        const needPk = !signer; // if user not a registered signer (edge) ask pk
        try { await interaction.reply({ content: `Assine o XDR abaixo com sua carteira (ou use o botão de wallet) e depois envie na modal se necessário.\n\n\u0060\u0060\u0060\n${spend.baseXdr}\n\u0060\u0060\u0060`, ephemeral: true }); } catch {}
        return interaction.followUp({ content: 'Abrindo modal manual...', ephemeral: true }).catch(()=>{}).finally(()=> interaction.showModal(buildSignModal(spend.id, needPk)));
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

      const recipientUserId = await resolveRecipientUserId(interaction, recipientRaw);
      if (!recipientUserId) return interaction.reply({ content: 'Destinatário inválido. Use menção (@usuario), ID ou username exato.', ephemeral: true });

      const recipientSigner = await getSigner(guildId, recipientUserId);
      if (!recipientSigner) return interaction.reply({ content: 'Destinatário não possui signer verificado.', ephemeral: true });

      const cfg = await getTreasuryConfig(guildId);
      if (!cfg) return interaction.reply({ content: 'Treasury not configured.', ephemeral: true });
      if (recipientSigner.publicKey === cfg.stellarPublicKey) {
        return interaction.reply({ content: 'A chave do destinatário é a mesma da tesouraria. O destinatário precisa registrar uma chave separada para receber fundos.', ephemeral: true });
      }

      const amount = Number(amountRaw);
      if (isNaN(amount) || amount <= 0) return interaction.reply({ content: 'Valor inválido.', ephemeral: true });

      const memoCandidate = title.slice(0, 28);
      let spend;
      try {
        spend = await createSpend({ guildId, proposerUserId: proposerId, destination: recipientSigner.publicKey, memo: memoCandidate, amountXlm: amount, title, description, recipientUserId, channelId: interaction.channelId, messageId: interaction.id });
      } catch (e: any) {
        if (e.message === 'DEST_IS_TREASURY') return interaction.reply({ content: 'Destino não pode ser a tesouraria. Use uma conta diferente.', ephemeral: true });
        throw e;
      }
      return interaction.reply({ content: formatSpend(spend), components: spendActionRow(spend.id, spend.status, true, guildId, proposerId) });
    } catch (e: any) {
      let msg = 'Erro ao criar gasto: ' + e.message;
      if (e.message === 'DEST_IS_TREASURY') msg = 'Destino é a própria tesouraria. Registre outra chave para o destinatário.';
      logger.error({ e }, 'purpose_modal_error');
      return interaction.reply({ content: msg, ephemeral: true });
    }
  }
  if (interaction.customId.startsWith('spend_modal_sign_')) {
    const id = interaction.customId.replace('spend_modal_sign_', '');
    const spend = await getSpend(interaction.guildId, id);
    if (!spend) return interaction.reply({ content: 'Spend not found.', ephemeral: true });
    const signerRecord = await getSigner(interaction.guildId, interaction.user.id);
    const pkField = interaction.fields.getTextInputValue('public_key')?.trim();
    const publicKey = signerRecord?.publicKey || pkField;
    if (!publicKey || !/^G[A-Z0-9]{55}$/.test(publicKey)) return interaction.reply({ content: 'Invalid or missing public key', ephemeral: true });
    const xdr = interaction.fields.getTextInputValue('signed_xdr').trim();
    try {
      const res = await addSignature(interaction.guildId, spend.id, interaction.user.id, publicKey, xdr);
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
