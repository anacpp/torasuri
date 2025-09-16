import { type Express, type Request, type Response } from 'express';
import { URLSearchParams } from 'url';
import { logger } from '@logger';
import { getSpend, addSignature, finalizeSubmit } from '@services/spend';
import { getSigner } from '@services/signers';
import { env } from '@utils/env';

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

  app.get('/spend/sign', async (req: Request, res: Response) => {
    const guildId = String(req.query.guildId||'');
    const spendId = String(req.query.spendId||'');
    const userId = String(req.query.userId||'');
    const publicKey = String(req.query.publicKey||'');
    const signedXdr = String(req.query.xdr||'');

    if (!guildId || !spendId || !userId || !signedXdr) return res.status(400).send('missing params');
    try {
      const spend = await getSpend(guildId, spendId);
      if (!spend) return res.status(404).send('spend not found');
      if (spend.status !== 'collecting') return res.status(400).send('not collecting');
      const signer = await getSigner(guildId, userId);
      const pk = signer?.publicKey || publicKey;
      if (!pk || !/^G[A-Z0-9]{55}$/.test(pk)) return res.status(400).send('invalid public key');
      const { updatedSpend } = await addSignature(guildId, spendId, userId, pk, signedXdr);
      let submitted = false;
      if ((updatedSpend.type === 'MICRO' && updatedSpend.approvals.length >= 1) || (updatedSpend.type === 'MAJOR' && updatedSpend.approvals.length >= updatedSpend.requiredApprovals)) {
        await finalizeSubmit(guildId, spendId);
        submitted = true;
      }
      const html = `<!DOCTYPE html><html><head><meta charset='utf-8'/><title>Spend Signed</title><meta name='viewport' content='width=device-width,initial-scale=1'/><style>body{font-family:system-ui,Arial,sans-serif;background:#0d1117;color:#e6edf3;padding:32px;}code{background:#1f242d;padding:2px 4px;border-radius:4px;}a{color:#58a6ff;} .ok{color:#3fb950;font-weight:600;} .warn{color:#d29922;font-weight:600;} .err{color:#f85149;font-weight:600;} .box{background:#161b22;padding:16px 20px;border:1px solid #30363d;border-radius:8px;max-width:760px;} button{background:#238636;color:#fff;border:none;padding:10px 18px;border-radius:6px;cursor:pointer;font-size:15px;} h1{margin-top:0;} small{opacity:.7}</style></head><body><div class='box'><h1>Spend ${spendId} Assinada</h1><p class='ok'>Assinatura registrada com sucesso.</p><ul><li>ID: <code>${spendId}</code></li><li>Aprovações: ${updatedSpend.approvals.length}/${updatedSpend.requiredApprovals}</li><li>Status: ${updatedSpend.status}</li>${updatedSpend.submissionHash?`<li>Tx Hash: <code>${updatedSpend.submissionHash}</code></li>`:''}</ul><p>${submitted ? 'Transação enviada para a rede.' : 'Ainda aguardando quorum.'}</p><p><a href='${env.SERVER_URL}'>Voltar</a></p><small>Feche esta aba.</small></div></body></html>`;
      res.setHeader('Content-Type','text/html; charset=utf-8');
      res.send(html);
    } catch (e:any) {
      logger.error({ e, guildId, spendId }, 'spend_web_sign_error');
      res.status(500).send('internal error');
    }
  });

  app.get('/freighter-api.bundle.js', async (_req: Request, res: Response) => {
    res.setHeader('Content-Type','application/javascript; charset=utf-8');
    // Bundle mínimo: expõe freighterApi esperado no browser (a extensão sobrescreve/fornece implementação real se instalada).
    // Caso a extensão esteja presente, freighterApi já existirá; mantemos referência sem sobrescrever.
    res.send(`(function(){\n  if(!window.freighterApi){\n    // Fallback stub: métodos lançam erro claro se extensão ausente.\n    window.freighterApi = {\n      async isConnected(){ return false; },\n      async getPublicKey(){ throw new Error('Freighter não disponível (extensão ausente)'); },\n      async signTransaction(){ throw new Error('Freighter não disponível (extensão ausente)'); },\n      async requestAccess(){ throw new Error('Freighter não disponível (extensão ausente)'); }\n    };\n  }\n})();`);
  });

  app.get('/spend/tx.js', (_req: Request, res: Response) => {
    res.setHeader('Content-Type','application/javascript; charset=utf-8');
    res.send(`(function(){\n  const meta = document.getElementById('spend-config');\n  if(!meta) return;\n  const baseXdr = meta.getAttribute('data-xdr');\n  const callbackUrl = meta.getAttribute('data-callback');\n  const networkPassphrase = meta.getAttribute('data-network-passphrase');\n  const expectedPk = meta.getAttribute('data-expected-pk');\n  const connectBtn=document.getElementById('connectBtn');\n  const signBtn=document.getElementById('signBtn');\n  const statusEl=document.getElementById('status');\n  const pubkeyBox=document.getElementById('pubkeyBox');\n  const debugEl=document.getElementById('debug');\n  function api(){ return window.freighterApi; }\n  function logDebug(msg){ if(debugEl) debugEl.textContent += msg+'\\n'; }\n  function setStatus(msg, ok){ if(statusEl){ statusEl.textContent=msg; statusEl.style.color= ok?'#3fb950':'#e6edf3'; } }\n  // Poll aguardando requestAccess/signTransaction conforme docs.\n  let tries=0; const max=120; const poll=setInterval(async()=>{ tries++; if(api() && typeof api().requestAccess==='function'){ clearInterval(poll); let c=false; try { if(api().isConnected) c= await api().isConnected(); } catch {} logDebug('requestAccess disponível; isConnected='+c); setStatus('Clique em Conectar para autorizar.', true); } else if(tries===1){ setStatus('Aguardando Freighter...', false);} else if(tries>=max){ clearInterval(poll); setStatus('Freighter não detectada após espera.', false);} },250);\n\n  if(connectBtn) connectBtn.onclick=async()=>{\n    if(!api()){ setStatus('API Freighter indisponível.', false); return; }\n    if(typeof api().requestAccess !== 'function'){ setStatus('requestAccess indisponível.', false); return; }\n    setStatus('Solicitando acesso...');\n    try {\n      const access = await api().requestAccess();\n      logDebug('requestAccess resp: '+JSON.stringify(access||{}));\n      const pk = (access && (access.publicKey||access.address)) || (api().publicKey) || (api().address);\n      if(!pk){ throw new Error('Public key não retornada'); }\n      pubkeyBox.textContent='PubKey: '+pk+(expectedPk && expectedPk!==pk ? ' (⚠ diferente do esperado)' : '');\n      signBtn.disabled=false; signBtn.classList.remove('dim');\n      setStatus('Conectado.', true);\n    } catch(e){ console.error(e); logDebug('requestAccess err '+(e && e.message)); setStatus('Falha: '+(e && e.message || e), false);}\n  };\n\n  if(signBtn) signBtn.onclick=async()=>{\n    if(signBtn.disabled) return;\n    if(!api() || typeof api().signTransaction !== 'function'){ setStatus('signTransaction indisponível.', false); return; }\n    const currentPk = (pubkeyBox.textContent||'').replace('PubKey: ','').split(' ')[0];\n    if(!currentPk){ setStatus('Conecte primeiro.', false); return; }\n    setStatus('Assinando...');\n    try { const signedXdr = await api().signTransaction(baseXdr,{ networkPassphrase });\n      setStatus('Assinado. Enviando...', true);\n      const url = new URL(callbackUrl); url.searchParams.set('xdr', signedXdr); if(!url.searchParams.get('publicKey')) url.searchParams.set('publicKey', currentPk); window.location.href = url.toString(); }\n    catch(e){ console.error(e); logDebug('sign err '+(e && e.message)); setStatus('Erro ao assinar: '+(e && e.message||e), false);}\n  };\n})();`);
  });

  app.get('/spend/tx', async (req: Request, res: Response) => {
    const guildId = String(req.query.guildId||'');
    const spendId = String(req.query.spendId||'');
    const userId = String(req.query.userId||'');
    if (!guildId || !spendId) return res.status(400).send('missing params');
    try {
      const spend = await getSpend(guildId, spendId);
      if (!spend) return res.status(404).send('not found');
      if (spend.status !== 'collecting') return res.status(400).send('not collecting');
      let signerPk: string | undefined;
      if (userId) {
        const signer = await getSigner(guildId, userId).catch(()=>undefined);
        if (!signer && userId !== spend.proposerUserId) return res.status(403).send('forbidden');
        signerPk = signer?.publicKey;
      }
      const baseServerUrl = (env.SERVER_URL && env.SERVER_URL.length) ? env.SERVER_URL : ('http://localhost:'+ (process.env.PORT || '3000'));
      const callback = new URL(baseServerUrl.replace(/\/$/,'') + '/spend/sign');
      callback.searchParams.set('guildId', guildId);
      callback.searchParams.set('spendId', spendId);
      if (userId) callback.searchParams.set('userId', userId);
      const params = new URLSearchParams();
      params.set('xdr', spend.baseXdr);
      params.set('callback', callback.toString());
      params.set('replace', 'true');
      const desc = (spend.title || 'Spend') + ' ' + spend.amountXlm + ' XLM';
      params.set('description', desc.slice(0, 60));
      const networkPassphrase = env.STELLAR_NETWORK === 'PUBLIC'
        ? 'Public Global Stellar Network ; September 2015'
        : 'Test SDF Network ; September 2015';
      const originDomain = new URL(baseServerUrl).hostname;
      params.set('network_passphrase', networkPassphrase);
      params.set('origin_domain', originDomain);
      params.set('networkPassphrase', networkPassphrase);
      params.set('originDomain', originDomain);
      if (signerPk) params.set('pubkey', signerPk);
      const sep7 = 'web+stellar:tx?' + params.toString();
      const sep7Alt = 'stellar:tx?' + params.toString();
      const html = `<!DOCTYPE html><html><head><meta charset='utf-8'/><title>Assinar Spend ${spendId}</title><meta name='viewport' content='width=device-width,initial-scale=1'/><style>body{font-family:system-ui,Arial,sans-serif;background:#0d1117;color:#e6edf3;padding:32px;line-height:1.45}code,textarea{background:#161b22;color:#e6edf3;border:1px solid #30363d;border-radius:6px;}a.btn,button.btn{background:#238636;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:600;display:inline-block;margin-top:12px;border:none;cursor:pointer}button.btn.sec{background:#8957e5}button.btn.dim{background:#30363d}textarea{width:100%;height:160px;padding:8px;font-family:monospace;font-size:12px;margin-top:8px}small{opacity:.6;display:block;margin-top:18px}ul{padding-left:18px}#status{margin-top:12px;font-size:.9em}#pubkeyBox{margin-top:6px;font-size:.85em;opacity:.8}#debug{white-space:pre-wrap;font-size:11px;margin-top:12px;opacity:.7}</style><script src='https://cdnjs.cloudflare.com/ajax/libs/stellar-freighter-api/5.0.0/index.min.js' defer></script></head><body><meta id='spend-config' data-xdr='${spend.baseXdr}' data-callback='${callback.toString()}' data-network-passphrase='${networkPassphrase}' ${signerPk?`data-expected-pk='${signerPk}'`:''}/><h1>Assinar Spend</h1><p>ID: <code>${spendId}</code></p><p>Valor: <strong>${spend.amountXlm} XLM</strong></p>${spend.title?`<p>Título: <code>${spend.title}</code></p>`:''}<ul><li>Network Passphrase: <code>${networkPassphrase}</code></li><li>Origin: <code>${originDomain}</code></li>${signerPk?`<li>Signer PubKey (esperado): <code>${signerPk}</code></li>`:''}</ul><h2>Método 1: Protocolo (Wallet)</h2><p><a class='btn' href='${sep7}'>Abrir Wallet (web+stellar)</a> <a class='btn sec' href='${sep7Alt}'>Fallback (stellar:)</a></p><h2>Método 2: Freighter Direto</h2><p>Se a extensão estiver instalada, conecte e assine direto.</p><div><button class='btn' id='connectBtn'>Conectar Freighter</button> <button class='btn dim' id='signBtn' disabled>Assinar & Enviar</button><div id='pubkeyBox'></div><div id='status'></div><div id='debug'></div></div><h2>XDR Base</h2><textarea readonly>${spend.baseXdr}</textarea><small>Callback: ${callback.toString()}</small><script src='/spend/tx.js' defer></script></body></html>`;
      res.setHeader('Content-Type','text/html; charset=utf-8');
      res.send(html);
    } catch (e:any) {
      logger.error({ e, guildId, spendId }, 'spend_tx_route_err');
      res.status(500).send('internal error');
    }
  });
}
