import { Keypair, Networks, TransactionBuilder, Operation, Transaction, Account } from 'stellar-sdk';
import { env } from '@utils/env';
import { logger } from '@logger';

interface Challenge {
  xdr: string;
  transactionHash: string;
  publicKey: string;
  expiresAt: number;
  userId: string;
}

const challenges = new Map<string, Challenge>();

// Fallback ephemeral server key if no secret provided (NOT for production)
let serverKeypair: Keypair = env.STELLAR_CHALLENGE_SECRET ? Keypair.fromSecret(env.STELLAR_CHALLENGE_SECRET) : Keypair.random();
if (!env.STELLAR_CHALLENGE_SECRET) {
  logger.warn({ pub: serverKeypair.publicKey().slice(0,6) }, 'Using ephemeral server challenge key (STELLAR_CHALLENGE_SECRET not set)');
}

function networkPassphrase() {
  return env.STELLAR_NETWORK === 'PUBLIC' ? Networks.PUBLIC : Networks.TESTNET;
}

export function buildChallenge(publicKey: string, userId: string, domain: string) {
  if (!/^G[A-Z0-9]{55}$/.test(publicKey)) throw new Error('INVALID_PUBLIC_KEY');
  const source = serverKeypair.publicKey();
  const account = new Account(source, '0');
  const tx = new TransactionBuilder(account, { fee: '100', networkPassphrase: networkPassphrase() })
    .addOperation(Operation.manageData({ name: `${domain}|${userId}|challenge`, value: publicKey }))
    .setTimeout(300)
    .build();

  tx.sign(serverKeypair);
  const hash = tx.hash().toString('hex');
  const xdrStr = tx.toXDR();
  challenges.set(hash, { xdr: xdrStr, transactionHash: hash, publicKey, expiresAt: Date.now() + 300_000, userId });
  logger.info({ hash: hash.slice(0,10), pk: publicKey.slice(0,6), userId }, 'Challenge created');
  return { xdr: xdrStr, transactionHash: hash, expiresAt: Date.now() + 300_000 };
}

export function verifySignedChallenge(signedXdr: string, expectedPublicKey: string, userId: string, domain: string) {
  const tx = new Transaction(signedXdr, networkPassphrase());
  const hash = tx.hash().toString('hex');
  const stored = challenges.get(hash);
  if (!stored) throw new Error('NO_CHALLENGE');
  if (Date.now() > stored.expiresAt) {
    challenges.delete(hash);
    throw new Error('CHALLENGE_EXPIRED');
  }
  if (stored.publicKey !== expectedPublicKey || stored.userId !== userId) throw new Error('MISMATCH');
  const op = tx.operations[0];
  if (!op || op.type !== 'manageData') throw new Error('BAD_OP');
  const name = (op as any).name as string;
  if (!name.startsWith(domain + '|')) throw new Error('BAD_DOMAIN');
  // Verify signatures: must contain server signature + user signature
  const serverSigPresent = tx.signatures.some(sig => {
    try { serverKeypair.verify(tx.hash(), sig.signature()); return true; } catch { return false; }
  });
  if (!serverSigPresent) throw new Error('NO_SERVER_SIG');
  const userSigPresent = tx.signatures.some(sig => {
    try { Keypair.fromPublicKey(expectedPublicKey).verify(tx.hash(), sig.signature()); return true; } catch { return false; }
  });
  if (!userSigPresent) throw new Error('NO_USER_SIG');
  challenges.delete(hash);
  logger.info({ hash: hash.slice(0,10), pk: expectedPublicKey.slice(0,6), userId }, 'Challenge verified');
  return true;
}
