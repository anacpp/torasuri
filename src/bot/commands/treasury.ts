import { ChatInputCommandInteraction, SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { getTreasuryConfig, setTreasuryConfig } from '@services/treasury';
import { logger } from '@logger';
import { treasurySchema } from '@schemas/treasury';
import { createOrVerifySigner, getSigner, listSigners, removeSigner } from '@services/signers';
import { buildChallenge, verifySignedChallenge } from '@services/sep10';
import { env } from '@utils/env';
import { createPendingIntent, generateDonationMemo, listRecent, getTreasuryBalance, startDonationWatcher } from '@services/donations';
import QRCode from 'qrcode';

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
  .addSubcommandGroup(g =>
    g.setName('signer').setDescription('Signer proof-of-control')
      .addSubcommand(s => s.setName('connect').setDescription('Generate a signing challenge'))
      .addSubcommand(s => s.setName('submit').setDescription('Submit signed challenge (XDR)'))
      .addSubcommand(s => s.setName('status').setDescription('Show signer status'))
      .addSubcommand(s => s.setName('remove').setDescription('Remove signer'))
      .addSubcommand(s => s.setName('list').setDescription('List signers (admin only)'))
  )
  .addSubcommand(s => s.setName('view').setDescription('View current treasury config'))
  .addSubcommand(s => s.setName('reset').setDescription('Reset existing treasury config'))
  .addSubcommand(s => s.setName('donate').setDescription('Doar para a tesouraria').addNumberOption(o => o.setName('amount').setDescription('Valor sugerido em XLM').setRequired(false)))
  .addSubcommand(s => s.setName('donations').setDescription('Listar últimas doações'))
  .addSubcommand(s => s.setName('balance').setDescription('Mostrar saldo atual'));

// ---------- Signer (non-custodial) helpers ----------
function signerConnectRow() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('treasury_signer_connect').setLabel('Enter Public Key').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setURL(env.SERVER_URL + '/wallet').setLabel('Web Flow').setStyle(ButtonStyle.Link)
  );
}
function signerSubmitRow() {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('treasury_signer_submit').setLabel('Submit Signed XDR').setStyle(ButtonStyle.Success)
  );
}

// ---------- Wizard helpers ----------
function startTimeout(guildId: string) {
  const st = wizardStates.get(guildId);
  if (!st) return;
  clearTimeout(st.timeout);
  st.timeout = setTimeout(() => { wizardStates.delete(guildId); }, 5 * 60 * 1000);
}

async function startWizard(interaction: ChatInputCommandInteraction) {
  const guildId = interaction.guildId!;
  const existing = await getTreasuryConfig(guildId);
  if (wizardStates.has(guildId)) return interaction.reply({ content: 'A wizard is already running. Cancel or wait for it to finish.', ephemeral: true });
  if (existing) return interaction.reply({ content: 'Treasury already configured. Use /treasury reset to reconfigure.', ephemeral: true });
  const timeout = setTimeout(() => { wizardStates.delete(guildId); }, 5 * 60 * 1000);
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
  const cleaned = input.toLowerCase().replace(/r\$|reais|real|\s/g, '').replace(/,/g, '.');
  if (!cleaned) return 0;
  const num = Number(cleaned);
  if (isNaN(num) || num < 0) return null;
  return Math.round(num * 100);
}

// ---------- Signer command logic ----------
async function handleSignerCommand(interaction: ChatInputCommandInteraction, sub: string) {
  if (!interaction.guildId) return interaction.reply({ content: 'Guild only.', ephemeral: true });
  const guildId = interaction.guildId; const userId = interaction.user.id; const cfg = await getTreasuryConfig(guildId);
  switch (sub) {
    case 'connect': {
      const existing = await getSigner(guildId, userId);
      if (existing) {
        try {
          const ch = buildChallenge(existing.publicKey, userId, 'torasuri');
          // Show full XDR (no truncation) so user can sign correctly
            return interaction.reply({
              content: `Challenge (reuse) gerado. Assine o XDR completo abaixo e envie em /treasury signer submit.\n\n\`\`\`\n${ch.xdr}\n\`\`\``,
              components: [signerSubmitRow()],
              ephemeral: true
            });
        } catch (e:any) {
          logger.error({ err: e }, 'Challenge build failed');
          return interaction.reply({ content: 'Failed to build challenge.', ephemeral: true });
        }
      }
      return interaction.reply({ content: 'Forneça sua Stellar public key (G...) para gerar o challenge.', components: [signerConnectRow()], ephemeral: true });
    }
    case 'submit': return interaction.reply({ content: 'Paste signed challenge XDR.', components: [signerSubmitRow()], ephemeral: true });
    case 'status': { const s = await getSigner(guildId, userId); if (!s) return interaction.reply({ content: 'Status: not verified', ephemeral: true }); return interaction.reply({ content: `Status: verified (pk: ${s.publicKey.substring(0,6)}...${s.publicKey.slice(-4)})`, ephemeral: true }); }
    case 'remove': { const s = await getSigner(guildId, userId); if (!s) return interaction.reply({ content: 'Not verified.', ephemeral: true }); await removeSigner(guildId, userId); return interaction.reply({ content: 'Signer removed.', ephemeral: true }); }
    case 'list': { if (!cfg || cfg.adminUserId !== userId) return interaction.reply({ content: 'Not authorized.', ephemeral: true }); const signers = await listSigners(guildId); const lines = signers.map(s => `${s.userId}: ${s.publicKey.substring(0,6)}...${s.publicKey.slice(-4)} (v${s.version})`); return interaction.reply({ content: lines.length ? lines.join('\n') : 'No signers.', ephemeral: true }); }
  }
}

async function handleSignerButton(interaction: any) {
  if (interaction.customId === 'treasury_signer_connect') {
    const modal = new ModalBuilder().setCustomId('treasury_modal_signer_connect').setTitle('Connect Signer');
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('public_key').setLabel('Public Key (G...)').setStyle(TextInputStyle.Short).setRequired(true)));
    return interaction.showModal(modal);
  }
  if (interaction.customId === 'treasury_signer_submit') {
    const modal = new ModalBuilder().setCustomId('treasury_modal_signer_submit').setTitle('Submit Signed XDR');
    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('public_key').setLabel('Public Key (if first time)').setStyle(TextInputStyle.Short).setRequired(false)),
      new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('signed_xdr').setLabel('Signed Challenge XDR').setStyle(TextInputStyle.Paragraph).setRequired(true))
    );
    return interaction.showModal(modal);
  }
}

async function handleSignerModal(interaction: any) {
  const guildId = interaction.guildId; const userId = interaction.user.id; if (!guildId) return interaction.reply({ content: 'Guild only.', ephemeral: true });
  try {
    if (interaction.customId === 'treasury_modal_signer_connect') {
      const publicKey = interaction.fields.getTextInputValue('public_key').trim();
      if (!/^G[A-Z0-9]{55}$/.test(publicKey)) return interaction.reply({ content: 'Invalid public key.', ephemeral: true });
      const ch = buildChallenge(publicKey, userId, 'torasuri');
      return interaction.reply({ content: `Challenge criado. Assine o XDR completo e depois use /treasury signer submit.\n\n\`\`\`\n${ch.xdr}\n\`\`\``, components: [signerSubmitRow()], ephemeral: true });
    }
    if (interaction.customId === 'treasury_modal_signer_submit') {
      const maybePk = interaction.fields.getTextInputValue('public_key')?.trim();
      const signedXdr = interaction.fields.getTextInputValue('signed_xdr').trim();
      const existing = await getSigner(guildId, userId);
      const publicKey = existing?.publicKey || maybePk;
      if (!publicKey || !/^G[A-Z0-9]{55}$/.test(publicKey)) return interaction.reply({ content: 'Public key missing or invalid.', ephemeral: true });
      try { verifySignedChallenge(signedXdr, publicKey, userId, 'torasuri'); } catch (e:any) {
        if (e.message?.includes('XDR Read Error')) {
          return interaction.reply({ content: 'XDR inválido ou truncado. Gere um novo challenge (/treasury signer connect) e use o XDR completo sem cortes.', ephemeral: true });
        }
        switch (e.message) {
          case 'NO_CHALLENGE': return interaction.reply({ content: 'Challenge não encontrado. Refaça o connect.', ephemeral: true });
          case 'CHALLENGE_EXPIRED': return interaction.reply({ content: 'Challenge expirado. Gere outro.', ephemeral: true });
          case 'MISMATCH': return interaction.reply({ content: 'User/public key mismatch.', ephemeral: true });
          case 'BAD_OP':
          case 'BAD_DOMAIN':
          case 'NO_SERVER_SIG':
          case 'NO_USER_SIG': return interaction.reply({ content: 'Falha na verificação da assinatura.', ephemeral: true });
          default: logger.error({ err: e }, 'Verify error'); return interaction.reply({ content: 'Verification failed.', ephemeral: true });
        }
      }
      await createOrVerifySigner(guildId, userId, publicKey);
      return interaction.reply({ content: 'Signer verificado com sucesso.', ephemeral: true });
    }
  } catch (e:any) {
    logger.error({ err: e }, 'Signer modal error');
    return interaction.reply({ content: 'Operation failed.', ephemeral: true });
  }
}

// ---------- Wizard modal & button handlers ----------
async function handleButton(interaction: any) {
  if (interaction.customId.startsWith('treasury_signer_')) return handleSignerButton(interaction);
  const guildId = interaction.guildId!; const state = wizardStates.get(guildId);
  if (!state) return interaction.reply({ content: 'No active wizard.', ephemeral: true });
  startTimeout(guildId);
  switch (interaction.customId) {
    case 'treasury_enter_key': {
      const modal = new ModalBuilder().setCustomId('treasury_modal_key').setTitle('Stellar Public Key');
      modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('stellar_key').setLabel('Key').setStyle(TextInputStyle.Short).setRequired(true)));
      return interaction.showModal(modal);
    }
    case 'treasury_enter_threshold': {
      const modal = new ModalBuilder().setCustomId('treasury_modal_threshold').setTitle('Micro-spend Threshold');
      modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId('threshold').setLabel('Value (e.g. 100.50)').setStyle(TextInputStyle.Short).setRequired(false)));
      return interaction.showModal(modal);
    }
    case 'treasury_skip_signers': { state.stage = 4; return interaction.update({ content: summaryContent(state), components: [buildSummaryRow()], embeds: [] }); }
    case 'treasury_confirm': { return tryFinalize(interaction, state); }
    case 'treasury_cancel': { wizardStates.delete(guildId); return interaction.update({ content: 'Setup cancelled.', components: [] }); }
  }
}

async function handleModal(interaction: any) {
  if (interaction.customId.startsWith('treasury_modal_signer_')) return handleSignerModal(interaction);
  const guildId = interaction.guildId!; const state = wizardStates.get(guildId); if (!state) return; startTimeout(guildId);
  if (interaction.customId === 'treasury_modal_key') {
    const key = interaction.fields.getTextInputValue('stellar_key').trim();
    if (!stellarValid(key)) return interaction.reply({ content: 'Invalid Stellar key. Try again.', ephemeral: true });
    state.data.stellarPublicKey = key; state.stage = 2;
    return interaction.reply({ content: 'Step 2: Set micro-spend threshold (optional)', components: [buildThresholdRow()], ephemeral: true });
  }
  if (interaction.customId === 'treasury_modal_threshold') {
    const raw = interaction.fields.getTextInputValue('threshold').trim();
    if (raw) { const cents = parseAmountToCents(raw); if (cents == null) return interaction.reply({ content: 'Invalid amount. Try again.', ephemeral: true, components: [buildThresholdRow()] }); state.data.microSpendThresholdInCents = cents; } else { state.data.microSpendThresholdInCents = 0; }
    state.stage = 3;
    interaction.reply({ content: 'Step 3: Mention additional signers in the next message or skip.', components: [buildSignersRow()], ephemeral: true });
    collectSigners(interaction, state);
  }
}

function collectSigners(interaction: any, state: WizardState) {
  const channel = interaction.channel; if (!channel) return; const guildId = interaction.guildId!;
  const collector = channel.createMessageCollector({ filter: (m: any) => m.author.id === state.adminUserId, time: 60_000, max: 1 });
  collector.on('collect', (m: any) => { const mentions = [...m.mentions.users.keys()].filter(id => id !== state.adminUserId); state.data.additionalSignerIds = Array.from(new Set(mentions)); });
  collector.on('end', async () => { if (!wizardStates.has(guildId)) return; state.stage = 4; try { await interaction.followUp({ content: summaryContent(state), components: [buildSummaryRow()], ephemeral: true }); } catch (e) { logger.error({ e }, 'Failed to send summary'); } });
}

async function tryFinalize(interaction: any, state: WizardState) {
  const config = { guildId: state.data.guildId, stellarPublicKey: state.data.stellarPublicKey, adminUserId: state.data.adminUserId, microSpendThresholdInCents: state.data.microSpendThresholdInCents ?? 0, additionalSignerIds: state.data.additionalSignerIds || [], multisig: computeMultisig(state) };
  try { treasurySchema.parse(config); setTreasuryConfig(config as any); wizardStates.delete(state.data.guildId); return interaction.update({ content: '```json\n' + JSON.stringify({ type: 'treasurySetup', ...config }, null, 2) + '\n```', components: [] }); }
  catch (err:any) { logger.error({ err }, 'Validation failed on finalize'); if (interaction.reply) await interaction.reply({ content: 'Validation failed.', ephemeral: true }); }
}

function computeMultisig(state: WizardState) { const total = 1 + (state.data.additionalSignerIds?.length || 0); const required = Math.max(1, Math.ceil(total * 2/3)); return { requiredApprovals: required, totalSigners: total, quorumRatio: `${required}/${total}` }; }
function summaryContent(state: WizardState) { return 'Summary:\n' + 'Stellar: ' + state.data.stellarPublicKey + '\nThreshold (cents): ' + (state.data.microSpendThresholdInCents ?? 0) + '\nAdditional signers: ' + (state.data.additionalSignerIds?.length || 0); }

async function handleDonation(interaction: ChatInputCommandInteraction) {
  const guildId = interaction.guildId!;
  const cfg = await getTreasuryConfig(guildId);
  if (!cfg) return interaction.reply({ content: 'Tesouraria não configurada.', ephemeral: true });
  const amount = interaction.options.getNumber('amount', false) || undefined;
  startDonationWatcher(guildId, cfg.stellarPublicKey);
  const memo = generateDonationMemo(guildId, interaction.user.id);
  createPendingIntent(guildId, interaction.user.id, memo);
  const network = env.STELLAR_NETWORK === 'PUBLIC' ? 'public' : 'testnet';
  const params = new URLSearchParams({ destination: cfg.stellarPublicKey, memo, memo_type: 'TEXT', network });
  if (amount) params.append('amount', amount.toString());
  const uriParams = params.toString();
  const rawSep7 = `web+stellar:pay?${uriParams}`; // for QR
  const clickUrl = `${env.SERVER_URL.replace(/\/$/,'')}/pay?${uriParams}`; // clickable HTTP wrapper
  let qrAttachment: any = undefined;
  try {
    const dataUrl = await QRCode.toDataURL(rawSep7, { margin: 1, scale: 5 });
    const base64 = dataUrl.split(',')[1];
    const buf = Buffer.from(base64, 'base64');
    qrAttachment = { attachment: buf, name: 'donation_qr.png' };
  } catch (e) {
    logger.warn({ e }, 'qr_generation_failed');
  }
  const lines = [
    'Obrigado por apoiar a tesouraria!',
    `Endereço: ${cfg.stellarPublicKey}`,
    `Memo (NÃO ALTERAR): ${memo}`,
    amount ? `Valor sugerido: ${amount} XLM` : 'Valor: livre (defina na sua wallet)',
    '1. Clique no link ou escaneie o QR',
    '2. Confirme endereço e memo antes de enviar',
    '3. Envie a transação',
    '4. O bot detectará em até ~30s',
    '',
    `Link: ${clickUrl}`
  ];
  return interaction.reply({ content: lines.join('\n'), files: qrAttachment ? [qrAttachment] : [], ephemeral: true });
}

async function handleDonationsList(interaction: ChatInputCommandInteraction) {
  const guildId = interaction.guildId!; const recs = listRecent(guildId, 10);
  if (!recs.length) return interaction.reply({ content: 'Nenhuma doação registrada.', ephemeral: true });
  const lines = ['Últimas doações:'];
  for (const r of recs) {
    const user = r.userId ? `<@${r.userId}>` : 'anon';
    lines.push(`${user} ${r.amount} XLM (tx: ${r.txHash.slice(0,8)}...)`);
  }
  return interaction.reply({ content: lines.join('\n'), ephemeral: true });
}

async function handleBalance(interaction: ChatInputCommandInteraction) {
  const guildId = interaction.guildId!; const cfg = await getTreasuryConfig(guildId);
  if (!cfg) return interaction.reply({ content: 'Tesouraria não configurada.', ephemeral: true });
  startDonationWatcher(guildId, cfg.stellarPublicKey);
  const horizon = process.env.HORIZON_URL || (env.STELLAR_NETWORK === 'PUBLIC' ? 'https://horizon.stellar.org' : 'https://horizon-testnet.stellar.org');
  try {
    const bal = await getTreasuryBalance(horizon, cfg.stellarPublicKey, guildId);
    return interaction.reply({ content: `Saldo: ${bal} XLM`, ephemeral: true });
  } catch (e:any) {
    logger.error({ e }, 'balance_fetch_error');
    return interaction.reply({ content: 'Falha ao buscar saldo.', ephemeral: true });
  }
}

// ---------- Main command handler ----------
export async function execute(interaction: ChatInputCommandInteraction) {
  const subGroup = interaction.options.getSubcommandGroup(false); const sub = interaction.options.getSubcommand(false);
  if (subGroup === 'setup' && sub === 'start') return startWizard(interaction);
  if (subGroup === 'signer') return handleSignerCommand(interaction, sub!);
  if (sub === 'donate') return handleDonation(interaction);
  if (sub === 'donations') return handleDonationsList(interaction);
  if (sub === 'balance') return handleBalance(interaction);
  if (sub === 'view') { const cfg = interaction.guildId ? await getTreasuryConfig(interaction.guildId) : undefined; if (!cfg) return interaction.reply({ content: 'Not configured.', ephemeral: true }); return interaction.reply({ content: '```json\n' + JSON.stringify(cfg, null, 2) + '\n```', ephemeral: true }); }
  if (sub === 'reset') return interaction.reply({ content: 'Reset not yet implemented in this version.', ephemeral: true });
  return interaction.reply({ content: 'Unknown subcommand.', ephemeral: true });
}

export const treasuryHandlers = { handleButton, handleModal };
