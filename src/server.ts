import 'dotenv/config';
import './utils/env';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';

import { logger } from '@logger';
import { registerRoutes } from '@router';
import { createDiscordClient, startDiscordBot } from '@discord/client';

const PORT = process.env.PORT || 3000;

async function bootstrap() {
  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json());

  registerRoutes(app);

  const client = createDiscordClient();
  await startDiscordBot(client);

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  app.listen(PORT, () => {
    logger.info({ port: PORT }, 'HTTP server started');
  });
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal bootstrap error', err);
  process.exit(1);
});
