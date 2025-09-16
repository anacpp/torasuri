import { type Express, type Request, type Response } from 'express';
import { URLSearchParams } from 'url';

export function registerRoutes(app: Express) {
  app.get('/', (_req: Request, res: Response) => {
    res.json({ name: 'torasuri', status: 'online' });
  });

  // Clickable redirect page for SEP-7 style payment links.
  // Example: /pay?destination=G...&memo=...&amount=10&network=public
  app.get('/pay', (req: Request, res: Response) => {
    const allowedKeys = ['destination','memo','memo_type','amount','network','asset_code','asset_issuer'];
    const params = new URLSearchParams();
    for (const k of allowedKeys) {
      const v = req.query[k];
      if (typeof v === 'string' && v.length) params.append(k, v);
    }
    const dest = params.get('destination');
    if (!dest) return res.status(400).send('missing destination');
    if (!/^G[A-Z0-9]{55}$/.test(dest)) return res.status(400).send('invalid destination');
    if (!params.get('memo_type') && params.get('memo')) params.set('memo_type','TEXT');
    const sep7 = 'web+stellar:pay?' + params.toString();
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><title>Open Wallet</title><meta name="viewport" content="width=device-width,initial-scale=1"/><style>body{font-family:system-ui,Arial,sans-serif;padding:24px;line-height:1.4;background:#0d1117;color:#e6edf3;}code{background:#1f242d;padding:2px 4px;border-radius:4px;font-size:0.9em;}a.btn{display:inline-block;margin-top:16px;background:#238636;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:600;}small{opacity:.7}</style></head><body><h1>Abrir pagamento</h1><p>Tentando abrir sua wallet com os dados da doação.</p><p>Se não abrir automaticamente clique no botão abaixo:</p><p><a class="btn" href="${sep7}">Abrir na Wallet</a></p><h2>Detalhes</h2><ul><li>Destination: <code>${dest}</code></li>${params.get('amount') ? `<li>Amount: <code>${params.get('amount')}</code></li>`:''}${params.get('memo') ? `<li>Memo: <code>${params.get('memo')}</code></li>`:''}<li>Network: <code>${params.get('network')||'public'}</code></li></ul><small>Caso não funcione: copie e cole este link no navegador: <code>${sep7}</code></small><script>setTimeout(()=>{window.location.href='${sep7}';},600);</script></body></html>`;
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.send(html);
  });
}
