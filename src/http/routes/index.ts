import { type Express, type Request, type Response } from 'express';

export function registerRoutes(app: Express) {
  app.get('/', (_req: Request, res: Response) => {
    res.json({ name: 'torasuri', status: 'online' });
  });
}
