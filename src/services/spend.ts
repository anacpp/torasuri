import { randomBytes } from 'crypto';
import { logger } from '@logger';
import { getTreasuryConfig } from '@services/treasury';
import { getSigner } from '@services/signers';
import * as Stellar from 'stellar-sdk';
import { env } from '@utils/env';

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

const spends = new Map<string, PendingSpend>(); // id -> spend

const SPEND_EXPIRY_MINUTES = Number(process.env.SPEND_EXPIRY_MINUTES || 15);
const LIST_PAGE = Number(process.env.SPEND_LIST_PAGE_SIZE || 10);

function shortId() { return randomBytes(5).toString('hex'); }
export function listPending(guildId: string) { return [...spends.values()].filter(s => s.guildId === guildId && s.status === 'collecting'); }
export function listHistory(guildId: string, limit = 10) { return [...spends.values()].filter(s => s.guildId === guildId && s.status !== 'collecting').sort((a,b)=>b.createdAt-a.createdAt).slice(0, limit); }
export function getSpend(guildId: string, id: string) { const s = spends.get(id); return s && s.guildId === guildId ? s : undefined; }

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
  const tx = new TransactionBuilder(new Account(acct.accountId(), acct.sequenceNumber()), {
    fee: BASE_FEE,
    networkPassphrase: env.STELLAR_NETWORK === 'PUBLIC' ? Networks.PUBLIC : Networks.TESTNET,
    timebounds: { minTime: now, maxTime: now + SPEND_EXPIRY_MINUTES * 60 }
  })
    .addOperation(Operation.payment({ destination, asset: Asset.native(), amount: amountXlm.toFixed(7) }))
    .setTimeout(0)
    .build();

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
  logger.info({ guildId, id, proposer: proposerUserId, amount: spend.amountXlm, type }, 'spend_created');
  return spend;
}

export function hasQuorum(spend: PendingSpend) { return spend.approvals.length >= spend.requiredApprovals; }
export function isAlreadySigned(spend: PendingSpend, publicKey: string) { return spend.approvals.some(a => a.publicKey === publicKey); }

export async function addSignature(guildId: string, id: string, userId: string, publicKey: string, signedXdr: string) {
  const spend = getSpend(guildId, id); if (!spend) throw new Error('NOT_FOUND');
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
  logger.info({ guildId, id, userId }, 'spend_signature_added');
  return { updatedSpend: spend, added: true };
}

export async function finalizeSubmit(guildId: string, id: string) {
  const spend = getSpend(guildId, id); if (!spend) throw new Error('NOT_FOUND');
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
  return spend;
}

export function cancelSpend(guildId: string, id: string, byUserId: string) {
  const spend = getSpend(guildId, id); if (!spend) throw new Error('NOT_FOUND');
  if (spend.status !== 'collecting') return spend;
  if (spend.proposerUserId !== byUserId) throw new Error('NOT_PROP');
  spend.status = 'cancelled';
  logger.info({ guildId, id, by: byUserId }, 'spend_cancelled');
  return spend;
}

export function sweepExpiry() {
  const now = Date.now();
  for (const s of spends.values()) {
    if (s.status === 'collecting' && now > s.expiresAt) {
      s.status = 'expired';
      logger.info({ guildId: s.guildId, id: s.id }, 'spend_expired');
    }
  }
}

setInterval(sweepExpiry, 60_000);
