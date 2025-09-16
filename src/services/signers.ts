import { getCollection } from '@services/db';
import { logger } from '@logger';

export interface StoredSigner {
  guildId: string;
  userId: string;
  publicKey: string;
  verifiedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export async function createOrVerifySigner(guildId: string, userId: string, publicKey: string) {
  if (!/^G[A-Z0-9]{55}$/.test(publicKey)) throw new Error('INVALID_PUBLIC_KEY');
  const col = await getCollection<StoredSigner>('signers');
  const existing = await col.findOne({ guildId, userId });
  const now = new Date();
  if (!existing) {
    const doc: StoredSigner = { guildId, userId, publicKey, verifiedAt: now, createdAt: now, updatedAt: now, version: 1 };
    await col.insertOne(doc);
    logger.info({ guildId, userId, pk: publicKey.slice(0,6) }, 'Signer added');
    return doc;
  } else {
    await col.updateOne({ guildId, userId }, { $set: { publicKey, verifiedAt: now, updatedAt: now }, $inc: { version: 1 } });
    logger.info({ guildId, userId, pk: publicKey.slice(0,6) }, 'Signer re-verified');
    return { ...existing, publicKey, verifiedAt: now, updatedAt: now, version: existing.version + 1 };
  }
}

export async function getSigner(guildId: string, userId: string) {
  const col = await getCollection<StoredSigner>('signers');
  return col.findOne({ guildId, userId });
}

export async function listSigners(guildId: string) {
  const col = await getCollection<StoredSigner>('signers');
  return col.find({ guildId }).toArray();
}

export async function removeSigner(guildId: string, userId: string) {
  const col = await getCollection<StoredSigner>('signers');
  await col.deleteOne({ guildId, userId });
  logger.info({ guildId, userId }, 'Signer removed');
}
