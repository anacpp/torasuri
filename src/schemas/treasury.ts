import { z } from 'zod';

export const stellarPublicKeyRegex = /^G[A-Z0-9]{55}$/;

export const treasurySchema = z.object({
  guildId: z.string().min(1),
  stellarPublicKey: z.string().regex(stellarPublicKeyRegex, 'Invalid Stellar public key'),
  adminUserId: z.string().min(1),
  microSpendThresholdInCents: z.number().int().nonnegative(),
  additionalSignerIds: z.array(z.string()).optional().default([]),
  multisig: z.object({
    requiredApprovals: z.number().int().min(1),
    totalSigners: z.number().int().min(1),
    quorumRatio: z.string()
  })
});

export type TreasuryConfig = z.infer<typeof treasurySchema>;
