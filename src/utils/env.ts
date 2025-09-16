import { z } from 'zod';

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1, 'Application (client) ID required'),
  DISCORD_GUILD_ID: z.string().optional(),
  PORT: z.string().optional(),
  LOG_LEVEL: z.string().optional(),
  NODE_ENV: z.enum(['development','test','production']).default('development'),
  GEMINI_API_KEY: z.string().min(1, 'Required for Gemini integration'),
  GEMINI_MODEL: z.string().default('gemini-1.5-flash'),
  MONGO_URI: z.string().min(1, 'MONGO_URI required'),
  STELLAR_NETWORK: z.enum(['PUBLIC','TESTNET']).default('PUBLIC'),
  SERVER_URL: z.string().url('SERVER_URL must be a valid URL').optional(),
  STELLAR_CHALLENGE_SECRET: z.string().optional(),
  HORIZON_URL: z.string().optional(),
  DONATION_POLL_INTERVAL_MS: z.string().optional(),
  DONATION_MAX_CACHE: z.string().optional(),
  SPEND_EXPIRY_MINUTES: z.string().optional(),
  SPEND_LIST_PAGE_SIZE: z.string().optional(),
  NGROK_AUTH_TOKEN: z.string().optional(),
  NGROK_REGION: z.string().optional(),
  NGROK_EDGE: z.string().optional()
});

type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: NodeJS.ProcessEnv): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error(parsed.error.flatten().fieldErrors);
    throw new Error('Invalid environment variables');
  }
  return parsed.data;
}

export const env = validateEnv(process.env);
