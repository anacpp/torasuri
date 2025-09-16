import { treasurySchema, type TreasuryConfig } from '@schemas/treasury';
import { logger } from '@logger';
import { getCollection } from '@services/db';

const cache = new Map<string, TreasuryConfig>();

export async function setTreasuryConfig(input: TreasuryConfig): Promise<TreasuryConfig> {
  const parsed = treasurySchema.parse(input);
  cache.set(parsed.guildId, parsed);
  try {
    const col = await getCollection<TreasuryConfig>('treasuries');
    await col.updateOne({ guildId: parsed.guildId }, { $set: parsed }, { upsert: true });
    logger.info({ guildId: parsed.guildId }, 'Treasury configuration persisted');
  } catch (e: any) {
    logger.error({ e, guildId: parsed.guildId }, 'Treasury persist failed');
  }
  return parsed;
}

export async function getTreasuryConfig(guildId: string): Promise<TreasuryConfig | undefined> {
  const inMem = cache.get(guildId);
  if (inMem) return inMem;
  try {
    const col = await getCollection<TreasuryConfig>('treasuries');
    const doc = await col.findOne({ guildId });
    if (doc) {
      cache.set(guildId, doc);
      return doc;
    }
  } catch (e: any) {
    logger.error({ e, guildId }, 'Treasury fetch failed');
  }
  return undefined;
}

export async function getAllTreasuries(): Promise<TreasuryConfig[]> {
  // return cache if already populated for performance
  if (cache.size > 0) return [...cache.values()];
  try {
    const col = await getCollection<TreasuryConfig>('treasuries');
    const all = await col.find({}).toArray();
    for (const c of all) cache.set(c.guildId, c);
    return all;
  } catch (e: any) {
    logger.error({ e }, 'getAllTreasuries failed');
    return [...cache.values()];
  }
}
