import { randomBytes } from 'crypto';
import { logger } from '@logger';
import { getTreasuryConfig } from '@services/treasury';
import { getSigner } from '@services/signers';
import * as Stellar from 'stellar-sdk';
import { env } from '@utils/env';
import { getCollection } from '@services/db';

const { Keypair, Networks, TransactionBuilder, Operation, BASE_FEE, Account, Asset, Horizon } = Stellar as any;

export interface PendingSpend {
  id: string;
  guildId: string;
  proposerUserId: string;
  destination: string;
  memo?: string;
  amountInCents: number;
  amountXlm: string;
  type: 'MICRO' | 'MAJOR';
  requiredApprovals: number;
  signerPublicKeys: string[];
  approvals: { userId: string; publicKey: string }[];
  baseXdr: string;
  aggregatedXdr: string;
  status: 'collecting' | 'submitted' | 'failed' | 'cancelled' | 'expired';
  submissionHash?: string;
  error?: string;
  createdAt: number;
  expiresAt: number;
  channelId?: string;
  messageId?: string;
  title?: string;
  description?: string;
  recipientUserId?: string;
}

const spends = new Map<string, PendingSpend>(); // id -> spend (cache)

// Mongo helpers
async function spendCollection() { return getCollection<PendingSpend>('spends'); }
async function saveSpend(spend: PendingSpend) {
  try { const col = await spendCollection(); await col.updateOne({ guildId: spend.guildId, id: spend.id }, { $set: spend }, { upsert: true }); } catch (e:any) { logger.error({ e, id: spend.id }, 'spend_save_failed'); }
}
async function loadSpend(guildId: string, id: string): Promise<PendingSpend | undefined> {
  const cached = spends.get(id); if (cached && cached.guildId === guildId) return cached;
  try { const col = await spendCollection(); const doc = await col.findOne({ guildId, id }); if (doc) { spends.set(id, doc); return doc; } } catch (e:any) { logger.error({ e, id, guildId }, 'spend_load_failed'); }
  return undefined;
}

const SPEND_EXPIRY_MINUTES = Number(process.env.SPEND_EXPIRY_MINUTES || 15);
const LIST_PAGE = Number(process.env.SPEND_LIST_PAGE_SIZE || 10);

function shortId() { return randomBytes(5).toString('hex'); }
export async function listPending(guildId: string) {
  try { const col = await spendCollection(); return await col.find({ guildId, status: 'collecting' }).sort({ createdAt: -1 }).toArray(); } catch { return [...spends.values()].filter(s=>s.guildId===guildId && s.status==='collecting'); }
}
export async function listHistory(guildId: string, limit = 10) {
  try { const col = await spendCollection(); return await col.find({ guildId, status: { $ne: 'collecting' } }).sort({ createdAt: -1 }).limit(limit).toArray(); } catch { return [...spends.values()].filter(s=>s.guildId===guildId && s.status!=='collecting').sort((a,b)=>b.createdAt-a.createdAt).slice(0, limit); }
}
export async function getSpend(guildId: string, id: string) { return loadSpend(guildId, id); }

export async function canUserPropose(guildId: string, userId: string) {
  const cfg = await getTreasuryConfig(guildId); if (!cfg) return false;
  if (cfg.adminUserId === userId) return true;
  const signer = await getSigner(guildId, userId); return !!signer;
}
export const canUserApprove = canUserPropose;

export async function createSpend(params: { guildId: string; proposerUserId: string; destination: string; memo?: string; amountXlm: number; title?: string; description?: string; recipientUserId?: string; }) {
  const { guildId, proposerUserId, destination, memo, amountXlm, title, description, recipientUserId } = params;
  const cfg = await getTreasuryConfig(guildId); if (!cfg) throw new Error('NO_TREASURY');
  if (destination === cfg.stellarPublicKey) throw new Error('DEST_IS_TREASURY');
  if (!(await canUserPropose(guildId, proposerUserId))) throw new Error('NOT_AUTH');

  const amountInCents = Math.round(amountXlm * 100); // simplistic
  const type: 'MICRO' | 'MAJOR' = amountInCents <= cfg.microSpendThresholdInCents ? 'MICRO' : 'MAJOR';
  const requiredApprovals = type === 'MICRO' ? 1 : cfg.multisig.requiredApprovals;

  // collect eligible signers (admin + additional) that are verified
  const signerSet = new Set<string>();
  signerSet.add(cfg.adminUserId);
  for (const id of cfg.additionalSignerIds) signerSet.add(id);
  const verified: string[] = [];
  for (const uid of signerSet) { const s = await getSigner(guildId, uid); if (s) verified.push(s.publicKey); }

  // build payment transaction
  const server = new Horizon.Server(env.STELLAR_NETWORK === 'PUBLIC' ? 'https://horizon.stellar.org' : 'https://horizon-testnet.stellar.org');
  const acct = await server.loadAccount(cfg.stellarPublicKey);
  const now = Math.floor(Date.now()/1000);
  const builder = new TransactionBuilder(new Account(acct.accountId(), acct.sequenceNumber()), {
    fee: BASE_FEE,
    networkPassphrase: env.STELLAR_NETWORK === 'PUBLIC' ? Networks.PUBLIC : Networks.TESTNET,
    timebounds: { minTime: now, maxTime: now + SPEND_EXPIRY_MINUTES * 60 }
  })
    .addOperation(Operation.payment({ destination, asset: Asset.native(), amount: amountXlm.toFixed(7) }));
  if (memo) {
    try { builder.addMemo(Stellar.Memo.text(memo.slice(0,28))); } catch {}
  }
  const tx = builder.build();

  const baseXdr = tx.toXDR();
  const id = shortId();
  const spend: PendingSpend = {
    id,
    guildId,
    proposerUserId,
    destination,
    memo,
    amountInCents,
    amountXlm: amountXlm.toFixed(7),
    type,
    requiredApprovals,
    signerPublicKeys: verified,
    approvals: [],
    baseXdr,
    aggregatedXdr: baseXdr,
    status: 'collecting',
    createdAt: Date.now(),
    expiresAt: (Date.now() + SPEND_EXPIRY_MINUTES * 60 * 1000),
    title: title?.slice(0,80),
    description: description?.slice(0,500),
    recipientUserId
  };
  spends.set(id, spend);
  await saveSpend(spend);
  logger.info({ guildId, id, proposer: proposerUserId, amount: spend.amountXlm, type }, 'spend_created');
  return spend;
}

export function hasQuorum(spend: PendingSpend) { return spend.approvals.length >= spend.requiredApprovals; }
export function isAlreadySigned(spend: PendingSpend, publicKey: string) { return spend.approvals.some(a => a.publicKey === publicKey); }

export async function addSignature(guildId: string, id: string, userId: string, publicKey: string, signedXdr: string) {
  const spend = await getSpend(guildId, id); if (!spend) throw new Error('NOT_FOUND');
  if (spend.status !== 'collecting') throw new Error('NOT_COLLECTING');
  if (isAlreadySigned(spend, publicKey)) return { updatedSpend: spend, added: false };

  // parse and validate XDR
  let tx: any; let base: any;
  try {
    const pass = env.STELLAR_NETWORK === 'PUBLIC' ? Networks.PUBLIC : Networks.TESTNET;
    const { TransactionBuilder: TB } = await import('stellar-sdk');
    tx = TB.fromXDR(signedXdr, pass);
    base = TB.fromXDR(spend.baseXdr, pass);
    if (tx.hash().toString('hex') !== base.hash().toString('hex')) throw new Error('HASH_MISMATCH');
  } catch (e:any) {
    throw new Error('BAD_XDR');
  }

  // check signature includes signer publicKey
  const kp = Keypair.fromPublicKey(publicKey);
  const sigs: any[] = (tx as any).signatures || [];
  const txHash = base.hash();
  const has = sigs.some(s => kp.verify(txHash, s.signature()));
  if (!has) throw new Error('MISSING_SIGNATURE');

  // aggregate signatures (merge unique)
  const baseTx = base; // already parsed
  const existingHints = new Set(baseTx.signatures.map((s: any) => s.hint().toString('hex')));
  for (const s of sigs) {
    const hintHex = s.hint().toString('hex');
    if (!existingHints.has(hintHex)) baseTx.signatures.push(s);
  }
  spend.aggregatedXdr = baseTx.toXDR();
  spend.approvals.push({ userId, publicKey });
  spends.set(spend.id, spend);
  await saveSpend(spend);
  logger.info({ guildId, id, userId }, 'spend_signature_added');
  return { updatedSpend: spend, added: true };
}

export async function finalizeSubmit(guildId: string, id: string) {
  const spend = await getSpend(guildId, id); if (!spend) throw new Error('NOT_FOUND');
  if (spend.status !== 'collecting') return spend;
  const pass = env.STELLAR_NETWORK === 'PUBLIC' ? Networks.PUBLIC : Networks.TESTNET;
  const server = new Horizon.Server(env.STELLAR_NETWORK === 'PUBLIC' ? 'https://horizon.stellar.org' : 'https://horizon-testnet.stellar.org');
  const { TransactionBuilder: TB } = await import('stellar-sdk');
  const tx = TB.fromXDR(spend.aggregatedXdr, pass);
  try {
    const res = await server.submitTransaction(tx as any);
    spend.status = 'submitted';
    spend.submissionHash = res.hash;
    logger.info({ guildId, id, hash: res.hash }, 'spend_submitted');
  } catch (e:any) {
    spend.status = 'failed';
    spend.error = e?.response?.data?.extras?.result_codes?.transaction || e.message;
    logger.warn({ guildId, id, err: spend.error }, 'spend_submit_failed');
  }
  spends.set(spend.id, spend);
  await saveSpend(spend);
  return spend;
}

export async function cancelSpend(guildId: string, id: string, byUserId: string) {
  const spend = await getSpend(guildId, id); if (!spend) throw new Error('NOT_FOUND');
  if (spend.status !== 'collecting') return spend;
  if (spend.proposerUserId !== byUserId) throw new Error('NOT_PROP');
  spend.status = 'cancelled';
  spends.set(spend.id, spend);
  await saveSpend(spend);
  logger.info({ guildId, id, by: byUserId }, 'spend_cancelled');
  return spend;
}

export async function sweepExpiry() {
  const now = Date.now();
  try {
    const col = await spendCollection();
    const expired = await col.find({ status: 'collecting', expiresAt: { $lt: now } }).toArray();
    if (expired.length) {
      await col.updateMany({ status: 'collecting', expiresAt: { $lt: now } }, { $set: { status: 'expired' } });
      for (const s of expired) { s.status = 'expired'; spends.set(s.id, s); logger.info({ guildId: s.guildId, id: s.id }, 'spend_expired'); }
    }
  } catch (e:any) {
    logger.error({ e }, 'sweepExpiry_failed');
    // fallback in-memory
    for (const s of spends.values()) { if (s.status === 'collecting' && now > s.expiresAt) { s.status='expired'; await saveSpend(s); } }
  }
}

setInterval(()=>{ sweepExpiry().catch(()=>{}); }, 60_000);
