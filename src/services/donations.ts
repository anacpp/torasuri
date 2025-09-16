import { logger } from '@logger';
import { randomBytes } from 'crypto';
import { env } from '@utils/env';
import fetch from 'node-fetch';

export interface DonationRecord {
  id: string;
  guildId: string;
  userId?: string;
  memo?: string;
  amount: string; // XLM string
  assetCode: 'XLM';
  txHash: string;
  createdAt: number;
}

interface PendingIntent {
  guildId: string;
  userId?: string;
  memo: string;
  createdAt: number;
}

const DONATION_POLL_INTERVAL_MS = Number(process.env.DONATION_POLL_INTERVAL_MS || 15000);
const DONATION_MAX_CACHE = Number(process.env.DONATION_MAX_CACHE || 100);

const donationStore = new Map<string, DonationRecord[]>(); // guildId -> records
const pendingIntents = new Map<string, PendingIntent>(); // memo -> pending
const lastCursorMap = new Map<string, string>(); // guildId -> paging token
const balanceCache = new Map<string, { balance: string; fetchedAt: number }>();

function pushDonation(rec: DonationRecord) {
  const arr = donationStore.get(rec.guildId) || [];
  arr.unshift(rec);
  while (arr.length > DONATION_MAX_CACHE) arr.pop();
  donationStore.set(rec.guildId, arr);
}

export function createPendingIntent(guildId: string, userId: string | undefined, memo: string) {
  const intent: PendingIntent = { guildId, userId, memo, createdAt: Date.now() };
  pendingIntents.set(memo, intent);
  logger.info({ guildId, userId, memo }, 'donation_intent');
  return intent;
}

export function listRecent(guildId: string, limit = 10): DonationRecord[] {
  return (donationStore.get(guildId) || []).slice(0, limit);
}

export function findByMemo(guildId: string, memo: string) {
  return (donationStore.get(guildId) || []).find(d => d.memo === memo);
}

// NEW: Short random memo (prefix 'd' + 12 hex chars) independent of guild/user to fit 28 char limit.
export function generateDonationMemo(_guildId: string, _userId: string) {
  for (let i = 0; i < 5; i++) {
    const memo = 'd' + randomBytes(6).toString('hex'); // 12 hex = 13 chars with 'd'
    if (!pendingIntents.has(memo)) return memo;
  }
  return 'd' + randomBytes(8).toString('hex').slice(0, 12);
}

export async function getTreasuryBalance(horizon: string, account: string, guildId: string) {
  const cached = balanceCache.get(guildId);
  if (cached && Date.now() - cached.fetchedAt < 30_000) return cached.balance;
  const res = await fetch(`${horizon}/accounts/${account}`);
  if (!res.ok) throw new Error('Horizon balance fetch failed');
  const json: any = await res.json();
  const native = json.balances.find((b: any) => b.asset_type === 'native');
  const bal = native ? native.balance : '0.0000000';
  balanceCache.set(guildId, { balance: bal, fetchedAt: Date.now() });
  return bal;
}

async function pollGuild(horizon: string, guildId: string, account: string) {
  try {
    const params = new URLSearchParams({ limit: '20', order: 'asc' });
    const cursor = lastCursorMap.get(guildId);
    if (cursor) params.append('cursor', cursor);
    const url = `${horizon}/accounts/${account}/payments?${params.toString()}`;
    const res = await fetch(url);
    if (!res.ok) return;
    const json: any = await res.json();
    const records: any[] = json._embedded?.records || [];
    for (const rec of records) {
      lastCursorMap.set(guildId, rec.paging_token);
      if (rec.type !== 'payment') continue;
      if (!rec.to || rec.to !== account) continue;

      // Fetch transaction to obtain MEMO (payments endpoint lacks memo)
      let memo: string | undefined;
      try {
        const txRes = await fetch(`${horizon}/transactions/${rec.transaction_hash}`);
        if (txRes.ok) {
          const txJson: any = await txRes.json();
          memo = txJson.memo || undefined;
        }
      } catch (e) {
        logger.warn({ e, tx: rec.transaction_hash }, 'donation_tx_fetch_error');
      }
      if (!memo) continue;

      const intent = pendingIntents.get(memo);
      if (!intent) continue; // not a memo we generated / tracking
      if (intent.guildId !== guildId) continue;

      if (findByMemo(guildId, memo)) { // already recorded donation
        pendingIntents.delete(memo);
        continue;
      }

      const donation: DonationRecord = {
        id: rec.id,
        guildId,
        userId: intent.userId,
        memo,
        amount: rec.amount,
        assetCode: 'XLM',
        txHash: rec.transaction_hash,
        createdAt: Date.now()
      };
      pushDonation(donation);
      pendingIntents.delete(memo);
      logger.info({ guildId, memo, amount: rec.amount, tx: rec.transaction_hash.slice(0, 10) }, 'donation_recorded');
    }
  } catch (e) {
    logger.warn({ e, guildId }, 'donation_poll_error');
  }
}

const watchers = new Map<string, NodeJS.Timeout>();

export function startDonationWatcher(guildId: string, account: string) {
  if (watchers.has(guildId)) return; // already
  const horizon = process.env.HORIZON_URL || (env.STELLAR_NETWORK === 'PUBLIC' ? 'https://horizon.stellar.org' : 'https://horizon-testnet.stellar.org');
  const tick = () => pollGuild(horizon, guildId, account);
  tick(); // initial
  const handle = setInterval(tick, DONATION_POLL_INTERVAL_MS);
  watchers.set(guildId, handle);
  logger.info({ guildId }, 'donation_watcher_started');
}

export function stopDonationWatcher(guildId: string) {
  const h = watchers.get(guildId);
  if (h) clearInterval(h);
  watchers.delete(guildId);
}
