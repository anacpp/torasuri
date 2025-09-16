import 'dotenv/config';
import './utils/env';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
// @ts-ignore: ngrok types not bundled
import * as ngrokLib from 'ngrok';
const ngrok:any = (ngrokLib as any).default || ngrokLib;

import { logger } from '@logger';
import { registerRoutes } from '@router';
import { createDiscordClient, startDiscordBot } from '@discord/client';

const PORT = process.env.PORT || 3000;

async function startNgrokWithRetry(port: number, attempts = 3, delayMs = 1500): Promise<string | undefined> {
  if (!process.env.NGROK_AUTH_TOKEN) return undefined;
  try { await ngrok.authtoken(process.env.NGROK_AUTH_TOKEN); } catch {}
  for (let i=1;i<=attempts;i++) {
    try {
      const url = await ngrok.connect({ addr: port, proto: 'http', region: process.env.NGROK_REGION || undefined, edge: process.env.NGROK_EDGE || undefined });
      return url;
    } catch (e:any) {
      logger.error({ attempt: i, e: e?.body || e?.message || e }, 'ngrok_attempt_failed');
      if (i < attempts) await new Promise(r=>setTimeout(r, delayMs));
    }
  }
  return undefined;
}

async function bootstrap() {
  const app = express();
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        // Permite scripts locais e o CDN do freighter api.
        'script-src': ["'self'", 'https://cdnjs.cloudflare.com'],
      }
    }
  }));
  app.use(cors());
  app.use(express.json());

  registerRoutes(app);

  const client = createDiscordClient();
  await startDiscordBot(client);

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  app.listen(PORT, async () => {
    logger.info({ port: PORT }, 'HTTP server started');
    const publicUrl = await startNgrokWithRetry(Number(PORT));
    if (publicUrl) {
      logger.info({ publicUrl }, 'ngrok tunnel active');
      if (!process.env.SERVER_URL) {
        logger.warn('Set SERVER_URL to this ngrok URL for wallet callbacks.');
      }
    } else if (process.env.NGROK_AUTH_TOKEN) {
      logger.error('Failed to establish ngrok tunnel after retries. Run \"npx ngrok http '+PORT+'\" manually as fallback.');
    }
  });
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal bootstrap error', err);
  process.exit(1);
});
