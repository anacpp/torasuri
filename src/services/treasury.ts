import { treasurySchema, type TreasuryConfig } from '@schemas/treasury';
import { logger } from '@logger';

const store = new Map<string, TreasuryConfig>();

export function setTreasuryConfig(input: TreasuryConfig): TreasuryConfig {
  const parsed = treasurySchema.parse(input);
  store.set(parsed.guildId, parsed);
  logger.info({ guildId: parsed.guildId }, 'Treasury configuration saved');
  return parsed;
}

export function getTreasuryConfig(guildId: string): TreasuryConfig | undefined {
  return store.get(guildId);
}

export function getAllTreasuries(): TreasuryConfig[] {
  return [...store.values()];
}
