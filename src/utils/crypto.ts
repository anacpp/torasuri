import crypto from 'crypto';
import { env } from '@utils/env';

interface EncryptedSecret {
  iv: string; // base64
  tag: string; // base64
  cipher: string; // base64
  salt: string; // base64
}

export function generateSalt(bytes = env.ENCRYPTION_SALT_BYTES): Buffer {
  return crypto.randomBytes(bytes);
}

export async function deriveKey(passphrase: string, userId: string, saltInput: Buffer | string, serverSecret: string): Promise<Buffer> {
  const salt = Buffer.isBuffer(saltInput) ? saltInput : Buffer.from(saltInput, 'base64');
  return await new Promise((resolve, reject) => {
    crypto.pbkdf2(
      passphrase + '::' + userId,
      salt.toString('base64') + '::' + serverSecret,
      env.ENCRYPTION_PBKDF_ITER,
      32,
      'sha256',
      (err, derivedKey) => {
        if (err) reject(err); else resolve(derivedKey);
      }
    );
  });
}

export async function encryptSecret(plain: string, passphrase: string, userId: string, serverSecret: string): Promise<EncryptedSecret> {
  const salt = generateSalt();
  const key = await deriveKey(passphrase, userId, salt, serverSecret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    cipher: encrypted.toString('base64'),
    salt: salt.toString('base64')
  };
}

export async function decryptSecret(enc: EncryptedSecret, passphrase: string, userId: string, serverSecret: string): Promise<string> {
  const key = await deriveKey(passphrase, userId, enc.salt, serverSecret);
  const iv = Buffer.from(enc.iv, 'base64');
  const tag = Buffer.from(enc.tag, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(Buffer.from(enc.cipher, 'base64')), decipher.final()]);
  return decrypted.toString('utf8');
}

export type { EncryptedSecret };
