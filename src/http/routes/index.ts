import { type Express, type Request, type Response } from 'express';
import { URLSearchParams } from 'url';
import { logger } from '@logger';
import { getSpend, addSignature, finalizeSubmit, hasQuorum } from '@services/spend';
import { getSigner } from '@services/signers';
import { env } from '@utils/env';
import { getTreasuryConfig } from '@services/treasury';
import StellarSdk, { Transaction, Networks, Memo } from 'stellar-sdk';
const { Server } = StellarSdk;

export function registerRoutes(app: Express) {
  app.get('/', (_req: Request, res: Response) => {
    res.json({ name: 'torasuri', status: 'online' });
  });

  // Legacy pay route retained
  app.get('/pay', (req: Request, res: Response) => {
    const allowedKeys = ['destination','memo','memo_type','amount','network','asset_code','asset_issuer'];
    const params = new URLSearchParams();
    for (const k of allowedKeys) { const v = req.query[k]; if (typeof v === 'string' && v.length) params.append(k, v); }
    const dest = params.get('destination');
    if (!dest) return res.status(400).send('missing destination');
    if (!/^G[A-Z0-9]{55}$/.test(dest)) return res.status(400).send('invalid destination');
    if (!params.get('memo_type') && params.get('memo')) params.set('memo_type','TEXT');
    const sep7 = 'web+stellar:pay?' + params.toString();
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><title>Open Wallet</title><meta name="viewport" content="width=device-width,initial-scale=1"/><style>body{font-family:system-ui,Arial,sans-serif;padding:24px;line-height:1.4;background:#0d1117;color:#e6edf3;}code{background:#1f242d;padding:2px 4px;border-radius:4px;font-size:0.9em;}a.btn{display:inline-block;margin-top:16px;background:#238636;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:600;}small{opacity:.7}</style></head><body><h1>Abrir pagamento</h1><p>Tentando abrir sua wallet com os dados da doação.</p><p>Se não abrir automaticamente clique no botão abaixo:</p><p><a class="btn" href="${sep7}">Abrir na Wallet</a></p><h2>Detalhes</h2><ul><li>Destination: <code>${dest}</code></li>${params.get('amount') ? `<li>Amount: <code>${params.get('amount')}</code></li>`:''}${params.get('memo') ? `<li>Memo: <code>${params.get('memo')}</code></li>`:''}<li>Network: <code>${params.get('network')||'public'}</code></li></ul><small>Caso não funcione: copie e cole este link no navegador: <code>${sep7}</code></small><script>setTimeout(()=>{window.location.href='${sep7}';},600);</script></body></html>`;
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.send(html);
  });

  // -------- Freighter Donation Flow (refactored: external JS) --------
  app.get('/donate', async (req: Request, res: Response) => {
    const guildId = String(req.query.guildId||'');
    const memo = String(req.query.memo||'');
    const amount = String(req.query.amount||''); // optional
    if(!guildId) return res.status(400).send('missing guildId');
    try {
      const cfg = await getTreasuryConfig(guildId);
      if(!cfg) return res.status(404).send('treasury not configured');
      const networkPassphrase = env.STELLAR_NETWORK === 'PUBLIC' ? 'Public Global Stellar Network ; September 2015' : 'Test SDF Network ; September 2015';
      const horizonUrl = process.env.HORIZON_URL || (env.STELLAR_NETWORK === 'PUBLIC' ? 'https://horizon.stellar.org' : 'https://horizon-testnet.stellar.org');
      const safeMemo = memo.replace(/[^A-Za-z0-9 _.-]/g,'').slice(0,28);
      const html = `<!DOCTYPE html><html><head><meta charset='utf-8'/><title>Freighter Donation</title><meta name='viewport' content='width=device-width,initial-scale=1'/><style>body{font-family:system-ui,Arial,sans-serif;background:#0d1117;color:#e6edf3;padding:28px;line-height:1.45}h1{margin-top:0}code,textarea,input{background:#161b22;color:#e6edf3;border:1px solid #30363d;border-radius:6px;padding:4px 6px;font-family:monospace;font-size:13px}button{background:#238636;color:#fff;border:none;padding:10px 18px;border-radius:6px;cursor:pointer;font-weight:600;margin-right:8px;margin-top:8px}button.dim{background:#30363d}#status{margin-top:10px;font-size:.9em}#debug{white-space:pre-wrap;font-size:11px;margin-top:14px;opacity:.7}label{display:block;margin-top:12px;font-size:.75em;opacity:.8;text-transform:uppercase;letter-spacing:.5px}small{opacity:.6;display:block;margin-top:20px}</style><script src='https://cdnjs.cloudflare.com/ajax/libs/stellar-freighter-api/5.0.0/index.min.js' defer></script><script src='https://cdnjs.cloudflare.com/ajax/libs/stellar-sdk/13.3.0/stellar-sdk.min.js' defer></script></head><body><div id='donate-config' data-guild='${guildId}' data-dest='${cfg.stellarPublicKey}' data-memo='${safeMemo}' data-amount='${amount}' data-np='${networkPassphrase}' data-horizon='${horizonUrl}'></div><h1>Donate to Treasury</h1><ul><li>Guild: <code>${guildId}</code></li><li>Destination: <code>${cfg.stellarPublicKey}</code></li>${safeMemo?`<li>Memo: <code>${safeMemo}</code></li>`:''}${amount?`<li>Suggested amount: <code>${amount} XLM</code></li>`:''}<li>Network Passphrase: <code>${networkPassphrase}</code></li></ul><div><button id='connectBtn' class='dim' disabled>Loading...</button><button id='signBtn' class='dim' disabled>Sign</button><button id='submitBtn' class='dim' disabled>Submit</button></div><div id='pkBox'></div><div id='status'></div><label>Amount XLM<input id='amtInput' type='text' value='${amount || ''}' placeholder='e.g. 5.5'/></label><label>Memo<input id='memoInput' type='text' value='${safeMemo}' ${safeMemo? 'readonly':''}/></label><h2>Signed XDR</h2><textarea id='signedBox' readonly style='width:100%;min-height:140px;display:none'></textarea><div id='debug'></div><small>Flow: Connect Freighter -> Sign -> Submit.</small><script src='/donate.js' defer></script></body></html>`;
      res.setHeader('Content-Type','text/html; charset=utf-8');
      return res.send(html);
    } catch(e:any){
      logger.error({ e, guildId }, 'donate_page_error');
      return res.status(500).send('internal error');
    }
  });

  app.get('/donate.js', (_req: Request, res: Response) => {
    res.setHeader('Content-Type','application/javascript; charset=utf-8');
    res.send(`(function(){\n'use strict';\nconst cfg=document.getElementById('donate-config');\nif(!cfg){return;}\nconst guildId=cfg.getAttribute('data-guild');\nconst dest=cfg.getAttribute('data-dest');\nconst fixedMemo=cfg.getAttribute('data-memo')||'';\nconst presetAmount=cfg.getAttribute('data-amount')||'';\nconst networkPassphrase=cfg.getAttribute('data-np');\nconst horizon=cfg.getAttribute('data-horizon');\nconst connectBtn=document.getElementById('connectBtn');\nconst signBtn=document.getElementById('signBtn');\nconst submitBtn=document.getElementById('submitBtn');\nconst pkBox=document.getElementById('pkBox');\nconst statusEl=document.getElementById('status');\nconst amtInput=document.getElementById('amtInput');\nconst memoInput=document.getElementById('memoInput');\nconst signedBox=document.getElementById('signedBox');\nconst debug=document.getElementById('debug');\nlet donorPk='';\nlet currentSigned='';\nfunction api(){return window.freighterApi;}\nfunction log(m){ if(debug) debug.textContent += m+'\\n'; }\nfunction setStatus(m,ok){ if(statusEl){ statusEl.textContent=m; statusEl.style.color= ok?'#3fb950':'#e6edf3'; } }\n// Poll for Freighter\nlet tries=0;const max=80;const poll=setInterval(()=>{tries++;if(api()&&typeof api().requestAccess==='function'){clearInterval(poll);connectBtn.disabled=false;connectBtn.classList.remove('dim');connectBtn.textContent='Connect Freighter';setStatus('Click Connect.',true);}else if(tries===1){setStatus('Waiting for Freighter...',false);}else if(tries>=max){clearInterval(poll);setStatus('Freighter not detected.',false);}},250);\n// Connect\nif(connectBtn) connectBtn.onclick=async()=>{ if(!api()){ return setStatus('API unavailable.',false);} try{ const access=await api().requestAccess(); donorPk=(access&&(access.publicKey||access.address))||access; if(!/^G[A-Z0-9]{55}$/.test(donorPk)) throw new Error('Invalid public key'); pkBox.textContent='Public Key: '+donorPk.slice(0,6)+'...'+donorPk.slice(-4); signBtn.disabled=false; signBtn.classList.remove('dim'); setStatus('Connected. Ready to sign.',true);} catch(e){ setStatus('Connect failed: '+(e&&e.message||e), false);} };\nfunction looksLikeXDR(s){ return typeof s==='string' && s.length>80 && /^[A-Za-z0-9+/=]+$/.test(s); }\n// Sign\nif(signBtn) signBtn.onclick=async()=>{ if(signBtn.disabled) return; if(!donorPk) return setStatus('Connect first.',false); const amtRaw=(amtInput.value||presetAmount||'').trim(); if(!amtRaw) return setStatus('Enter an amount.',false); const amountRegex=/^\\d+(\\.\\d+)?$/; if(!amountRegex.test(amtRaw)) return setStatus('Invalid amount.',false); const memoTxt=(fixedMemo||memoInput.value||'').trim(); setStatus('Building...',false); try { const accResp=await fetch(horizon+'/accounts/'+donorPk); if(!accResp.ok) throw new Error('Account not found'); const accJSON=await accResp.json(); const seq=accJSON.sequence; const fee=100; const S=window.StellarSdk; const acct=new S.Account(donorPk, seq); let b=new S.TransactionBuilder(acct,{fee,networkPassphrase}); b=b.addOperation(S.Operation.payment({ destination: dest, asset: S.Asset.native(), amount: amtRaw })); if(memoTxt) b=b.addMemo(S.Memo.text(memoTxt)); const tx=b.setTimeout(300).build(); const xdr=tx.toXDR(); setStatus('Signing...',false); const raw=await api().signTransaction(xdr,{ networkPassphrase }); let sx; if(typeof raw==='string'){ sx=raw; } else if(raw && typeof raw==='object'){ log('Freighter keys: '+Object.keys(raw).join(',')); sx = raw.signedXDR || raw.signedXdr || raw.signed_tx || raw.envelope_xdr || raw.envelopeXdr || raw.txXDR || raw.txXdr; if(!sx){ for(const v of Object.values(raw)){ if(looksLikeXDR(v)){ sx=v; break; } } } } if(!looksLikeXDR(sx||'')) { throw new Error('Unknown Freighter return format'); } if(sx.length<120) log('WARN signed short '+sx.length); currentSigned=sx; signedBox.style.display='block'; signedBox.value=sx; submitBtn.disabled=false; submitBtn.classList.remove('dim'); setStatus('Signed. Ready to submit.',true);} catch(e){ setStatus('Error: '+(e&&e.message||e), false);} };\n// Submit\nif(submitBtn) submitBtn.onclick=async()=>{ if(submitBtn.disabled) return; if(!currentSigned) return setStatus('Sign first.',false); setStatus('Submitting...',false); try { const payload={ guildId, donorPk, signedXdr: currentSigned, memo: (fixedMemo||memoInput.value||'').trim(), amount: (amtInput.value||presetAmount||'').trim() }; const r=await fetch('/donate/submit',{ method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)}); const js=await r.json(); if(!r.ok || !js.ok) throw new Error(js.error||'Failed'); setStatus('Submitted. Hash: '+js.hash,true); submitBtn.disabled=true; signBtn.disabled=true; } catch(e){ setStatus('Submit error: '+(e&&e.message||e), false);} };\n})();`);
  });

  app.post('/donate/submit', async (req: Request, res: Response) => {
    const { guildId, donorPk, signedXdr, memo, amount } = req.body || {};
    logger.info({ guildId, hasPk: !!donorPk, pkPrefix: donorPk?.slice(0,6), xdrLen: signedXdr ? String(signedXdr).length : 0, memo, amount }, 'donation_submit_attempt');
    if(!guildId || !donorPk || !signedXdr) return res.status(400).json({ error: 'MISSING_PARAMS' });
    if(!/^G[A-Z0-9]{55}$/.test(donorPk)) return res.status(400).json({ error: 'BAD_DONOR_PK' });
    try {
      const cfg = await getTreasuryConfig(guildId);
      if(!cfg) return res.status(404).json({ error: 'TREASURY_NOT_CONFIGURED' });
      const networkPassphrase = env.STELLAR_NETWORK === 'PUBLIC' ? Networks.PUBLIC : Networks.TESTNET;
      let tx: Transaction;
      try { tx = new Transaction(signedXdr, networkPassphrase); } catch(e:any){ return res.status(400).json({ error: 'BAD_XDR' }); }
      if(tx.source !== donorPk) return res.status(400).json({ error: 'SOURCE_MISMATCH' });
      if(tx.operations.length !== 1) return res.status(400).json({ error: 'BAD_OPERATION_COUNT' });
      const op = tx.operations[0] as any;
      if(op.type !== 'payment') return res.status(400).json({ error: 'NOT_PAYMENT' });
      if(op.destination !== cfg.stellarPublicKey) return res.status(400).json({ error: 'BAD_DESTINATION' });
      if(!op.asset.isNative()) return res.status(400).json({ error: 'NOT_NATIVE' });
      logger.info({ guildId, opAmount: op.amount, providedAmount: amount }, 'donation_amount_debug');
      // --- Tolerant amount comparison with defensive try/catch ---
      if(amount) {
        try {
          const amtStr = String(amount).trim();
          const validAmt = /^\d+(?:\.\d+)?$/.test(amtStr);
          if(!validAmt) return res.status(400).json({ error: 'BAD_AMOUNT_FORMAT' });
          const toStroops = (s:string): bigint | null => {
            if(!/^\d+(?:\.\d+)?$/.test(s)) return null;
            const [whole, fracRaw=''] = s.split('.');
            if(fracRaw.length > 7) return null; // more than 7 decimal places invalid
            const fracPadded = (fracRaw + '0000000').slice(0,7);
            try { return BigInt(whole) * BigInt(10000000) + BigInt(fracPadded); } catch { return null; }
          };
          const opAmountStr: string = op.amount;
          const aSt = toStroops(amtStr);
          const opSt = toStroops(opAmountStr);
          let mismatch = false;
          if(aSt == null || opSt == null) mismatch = opAmountStr !== amtStr; else mismatch = aSt !== opSt;
          if(mismatch) {
            logger.warn({ guildId, provided: amtStr, opAmount: opAmountStr, providedStroops: aSt?.toString(), opStroops: opSt?.toString() }, 'donation_amount_mismatch');
            return res.status(400).json({ error: 'AMOUNT_MISMATCH', expected: opAmountStr, provided: amtStr });
          }
        } catch(err:any) {
          logger.error({ guildId, errMsg: err?.message, stack: err?.stack }, 'donation_amount_block_error');
          return res.status(500).json({ error: 'AMOUNT_INTERNAL' });
        }
      }

      // --- Enhanced memo handling (defensive) ---
      if(memo) {
        try {
          const expectedRaw: string = String(memo);
          const expectedSanitized = expectedRaw.replace(/[^A-Za-z0-9 _.-]/g,'').slice(0,28);
          const extractTextMemo = (m:any): string => {
            if(!m || m.type !== 'text') return '';
            const candidates: string[] = [];
            for (const k of ['value','_value','_valueDecoded']) {
              const v = m[k];
              if(typeof v === 'string') candidates.push(v);
              else if (v instanceof Buffer) candidates.push(v.toString('utf8'));
            }
            if(!candidates.length && m.value && typeof m.value === 'object' && typeof m.value.toString === 'function') {
              try { const s = m.value.toString('utf8'); if(s) candidates.push(s); } catch(_e) {}
            }
            if(!candidates.length && typeof m.toString === 'function') {
              try { const s = m.toString(); if(s && s !== '[object Object]') candidates.push(s); } catch(_e) {}
            }
            if(!candidates.length) return '';
            return candidates.sort((a,b)=> b.length - a.length)[0];
          };
          let txMemoRaw = '';
          try { txMemoRaw = extractTextMemo((tx as any).memo); } catch(_e) {}
          const txMemoTrim = txMemoRaw.trim();
          const txMemoSanitized = txMemoTrim.replace(/[^A-Za-z0-9 _.-]/g,'').slice(0,28);
          const matched = (txMemoTrim === expectedRaw) || (txMemoTrim === expectedSanitized) || (txMemoSanitized === expectedSanitized);
          if(!matched) {
            logger.warn({ guildId, expectedRaw, expectedSanitized, txMemoRaw, txMemoTrim, txMemoSanitized }, 'donation_memo_mismatch');
            return res.status(400).json({ error: 'MEMO_MISMATCH', expected: expectedRaw, got: txMemoRaw });
          }
        } catch(err:any) {
          logger.error({ guildId, errMsg: err?.message, stack: err?.stack }, 'donation_memo_block_error');
          return res.status(500).json({ error: 'MEMO_INTERNAL' });
        }
      }

      logger.info({ guildId }, 'donation_pre_submit');
      // Submit
      const horizonUrl = process.env.HORIZON_URL || (env.STELLAR_NETWORK === 'PUBLIC' ? 'https://horizon.stellar.org' : 'https://horizon-testnet.stellar.org');
      const server = new Server(horizonUrl);
      try {
        const resp = await server.submitTransaction(tx);
        logger.info({ guildId, hash: resp.hash }, 'donation_submit_ok');
        return res.json({ ok: true, hash: resp.hash });
      } catch(e:any){
        logger.error({ err: e, detail: e?.response?.data || e?.message, guildId }, 'donation_horizon_error');
        return res.status(400).json({ error: 'HORIZON_SUBMIT_FAILED', detail: e?.response?.data || e?.message });
      }
    } catch(e:any){
      logger.error({ err: e, message: e?.message, stack: e?.stack, guildId }, 'donation_submit_error');
      if(!res.headersSent) return res.status(500).json({ error: 'INTERNAL' });
    }
  });

  // NEW JSON signature endpoint (POST)
  app.post('/spend/sign/json', async (req: Request, res: Response) => {
    const { guildId, spendId, userId, publicKey, signedXdr } = req.body || {};
    logger.info({ guildId, spendId, userId, hasPk: !!publicKey, pkPrefix: publicKey?.slice(0,6), xdrLen: signedXdr ? String(signedXdr).length : 0 }, 'spend_json_sign_req');
    if (!guildId || !spendId || !userId || !signedXdr) return res.status(400).json({ error: 'MISSING_PARAMS' });
    try {
      const spend = await getSpend(guildId, spendId);
      if (!spend) return res.status(404).json({ error: 'NOT_FOUND' });
      if (spend.status !== 'collecting') return res.status(400).json({ error: 'NOT_COLLECTING' });
      const signer = await getSigner(guildId, userId).catch(()=>undefined);
      const pk = signer?.publicKey || publicKey;
      if (!pk || !/^G[A-Z0-9]{55}$/.test(pk)) return res.status(400).json({ error: 'BAD_PUBLIC_KEY' });
      logger.info({ guildId, spendId, userId, pkPrefix: pk.slice(0,6), approvalsBefore: spend.approvals.length }, 'spend_add_signature_attempt');
      const { updatedSpend } = await addSignature(guildId, spendId, userId, pk, signedXdr);
      let submitted = false;
      if ((updatedSpend.type === 'MICRO' && updatedSpend.approvals.length >= 1) || (updatedSpend.type === 'MAJOR' && hasQuorum(updatedSpend))) {
        logger.info({ guildId, spendId }, 'spend_quorum_reached_submit');
        await finalizeSubmit(guildId, spendId);
        submitted = true;
      }
      logger.info({ guildId, spendId, approvals: updatedSpend.approvals.length, required: updatedSpend.requiredApprovals, submitted }, 'spend_json_sign_ok');
      return res.json({ ok: true, submitted, spend: { id: updatedSpend.id, approvals: updatedSpend.approvals.length, required: updatedSpend.requiredApprovals, status: updatedSpend.status, hash: updatedSpend.submissionHash, error: updatedSpend.error } });
    } catch (e:any) {
      const msg = e?.message || 'UNKNOWN_ERR';
      logger.error({ errMsg: msg, stack: e?.stack, guildId, spendId, userId, xdrLen: signedXdr ? String(signedXdr).length : 0 }, 'spend_json_sign_error');
      // Map known domain errors to 400-range
      const known = new Set(['BAD_XDR','MISSING_SIGNATURE','HASH_MISMATCH','NOT_FOUND','NOT_COLLECTING']);
      if (known.has(msg)) return res.status(400).json({ error: msg });
      return res.status(500).json({ error: 'INTERNAL' });
    }
  });

  // Legacy GET signature kept temporarily (could be removed later)
  // LEGACY: manter apenas para compatibilidade antiga; frontend novo usa /spend/sign/json
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
      if ((updatedSpend.type === 'MICRO' && updatedSpend.approvals.length >= 1) || (updatedSpend.type === 'MAJOR' && hasQuorum(updatedSpend))) {
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

  // Deprecated stub (kept for now)
  app.get('/freighter-api.bundle.js', async (_req: Request, res: Response) => {
    res.setHeader('Content-Type','application/javascript; charset=utf-8');
    res.send('(function(){if(!window.freighterApi){window.freighterApi={async isConnected(){return false;},async getPublicKey(){throw new Error("Freighter não disponível");},async signTransaction(){throw new Error("Freighter não disponível");},async requestAccess(){throw new Error("Freighter não disponível");}}}})();');
  });

  // Updated JS (no redirect; POST JSON)
  app.get('/spend/tx.js', (_req: Request, res: Response) => {
    res.setHeader('Content-Type','application/javascript; charset=utf-8');
    res.send(`(function(){\n  const meta = document.getElementById('spend-config');\n  if(!meta) return;\n  const baseXdr = meta.getAttribute('data-xdr');\n  const guildId = meta.getAttribute('data-guild-id');\n  const spendId = meta.getAttribute('data-spend-id');\n  const userId = meta.getAttribute('data-user-id');\n  const networkPassphrase = meta.getAttribute('data-network-passphrase');\n  const expectedPk = meta.getAttribute('data-expected-pk');\n  const connectBtn=document.getElementById('connectBtn');\n  const signBtn=document.getElementById('signBtn');\n  const submitBtn=document.getElementById('submitSigBtn');\n  const statusEl=document.getElementById('status');\n  const pubkeyBox=document.getElementById('pubkeyBox');\n  const debugEl=document.getElementById('debug');\n  const signedBox=document.getElementById('signedXdrBox');\n  function api(){ return window.freighterApi; }\n  function logDebug(msg){ if(debugEl) debugEl.textContent += msg+'\\n'; }\n  function setStatus(msg, ok){ if(statusEl){ statusEl.textContent=msg; statusEl.style.color= ok?'#3fb950':'#e6edf3'; } }\n  let currentSigned='';\n  let tries=0; const max=80; const poll=setInterval(()=>{ tries++; if(api() && typeof api().requestAccess==='function'){ clearInterval(poll); setStatus('Clique em Conectar.', true); } else if(tries===1){ setStatus('Aguardando extensão Freighter...', false);} else if(tries>=max){ clearInterval(poll); setStatus('Freighter não detectada.', false);} },250);\n  if(connectBtn) connectBtn.onclick=async()=>{ if(!api()){ setStatus('API indisponível.', false); return;} try{ const access= await api().requestAccess(); logDebug('access '+JSON.stringify(access||{})); const pk=(access && (access.publicKey||access.address)) || access; if(!pk) throw new Error('Sem public key'); pubkeyBox.textContent='PubKey: '+pk+(expectedPk && expectedPk!==pk?' (diferente do esperado)':''); signBtn.disabled=false; signBtn.classList.remove('dim'); setStatus('Conectado. Pronto para assinar.', true);}catch(e){ setStatus('Falha ao conectar: '+(e&&e.message||e), false);} };\n  if(signBtn) signBtn.onclick=async()=>{ if(signBtn.disabled) return; if(!api()|| typeof api().signTransaction!=='function'){ setStatus('signTransaction indisponível.', false); return;} const pkLine=(pubkeyBox.textContent||'').replace('PubKey: ','').split(' ')[0]; if(!pkLine){ setStatus('Conecte primeiro.', false); return;} setStatus('Assinando...', false); try{ const rawRes = await api().signTransaction(baseXdr,{ networkPassphrase }); logDebug('raw sign type='+(typeof rawRes)); let signedXdr = (rawRes && (rawRes.signedXDR || rawRes.signedXdr)) || rawRes; if(typeof signedXdr !== 'string'){ throw new Error('Formato inesperado retorno Freighter'); } if(signedXdr.length < 80) logDebug('WARN: signedXdr muito curto len='+signedXdr.length); currentSigned = signedXdr; if(signedBox){ signedBox.value = signedXdr; signedBox.style.display='block'; } submitBtn.disabled=false; submitBtn.classList.remove('dim'); setStatus('Assinatura gerada. Clique "Enviar Assinatura" para registrar.', true); }catch(e){ setStatus('Erro: '+(e&&e.message||e), false); } };\n  if(submitBtn) submitBtn.onclick=async()=>{ if(submitBtn.disabled) return; if(!currentSigned){ setStatus('Assine primeiro.', false); return;} const pkLine=(pubkeyBox.textContent||'').replace('PubKey: ','').split(' ')[0]; if(!pkLine){ setStatus('Sem public key.', false); return;} setStatus('Enviando assinatura...', false); try { const resp = await fetch('/spend/sign/json',{ method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ guildId, spendId, userId, publicKey: pkLine, signedXdr: currentSigned }) }); const data = await resp.json(); if(!resp.ok || !data.ok) throw new Error(data.error||'Falha'); if (data.submitted) { setStatus('Assinatura registrada. Quorum atingido. Transação será submetida.', true); } else { setStatus('Assinatura registrada.', true); } submitBtn.disabled=true; signBtn.disabled=true; } catch(e){ setStatus('Erro: '+(e&&e.message||e), false);} };\n})();`);
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
      const networkPassphrase = env.STELLAR_NETWORK === 'PUBLIC'
        ? 'Public Global Stellar Network ; September 2015'
        : 'Test SDF Network ; September 2015';
      const html = `<!DOCTYPE html><html><head><meta charset='utf-8'/><title>Sign Spend ${spendId}</title><meta name='viewport' content='width=device-width,initial-scale=1'/><style>body{font-family:system-ui,Arial,sans-serif;background:#0d1117;color:#e6edf3;padding:32px;line-height:1.45}code,textarea{background:#161b22;color:#e6edf3;border:1px solid #30363d;border-radius:6px;}button.btn{background:#238636;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:600;display:inline-block;margin-top:12px;border:none;cursor:pointer}button.btn.dim{background:#30363d}textarea{width:100%;min-height:160px;padding:8px;font-family:monospace;font-size:12px;margin-top:8px}small{opacity:.6;display:block;margin-top:18px}ul{padding-left:18px}#status{margin-top:12px;font-size:.9em}#pubkeyBox{margin-top:6px;font-size:.85em;opacity:.8}#debug{white-space:pre-wrap;font-size:11px;margin-top:12px;opacity:.7}</style><script src='https://cdnjs.cloudflare.com/ajax/libs/stellar-freighter-api/5.0.0/index.min.js' defer></script></head><body><meta id='spend-config' data-xdr='${spend.baseXdr}' data-guild-id='${guildId}' data-spend-id='${spendId}' data-user-id='${userId}' data-network-passphrase='${networkPassphrase}' ${signerPk?`data-expected-pk='${signerPk}'`:''}/><h1>Sign Spend</h1><p>ID: <code>${spendId}</code></p><p>Amount: <strong>${spend.amountXlm} XLM</strong></p>${spend.title?`<p>Title: <code>${spend.title}</code></p>`:''}<ul><li>Network Passphrase: <code>${networkPassphrase}</code></li>${signerPk?`<li>Signer PubKey (expected): <code>${signerPk}</code></li>`:''}</ul><h2>Freighter</h2><p>Flow: 1) Connect 2) Sign XDR 3) Submit Signature.</p><div><button class='btn' id='connectBtn'>Connect Freighter</button> <button class='btn dim' id='signBtn' disabled>Sign XDR</button> <button class='btn dim' id='submitSigBtn' disabled>Submit Signature</button><div id='pubkeyBox'></div><div id='status'></div><div id='debug'></div></div><h2>Base XDR</h2><textarea readonly>${spend.baseXdr}</textarea><h2>Signed XDR</h2><textarea id='signedXdrBox' readonly style='display:none'></textarea><small>Sign locally (like in Stellar Laboratory) then submit the signature. Transaction will only be submitted after quorum.</small><script src='/spend/tx.js' defer></script></body></html>`;
      res.setHeader('Content-Type','text/html; charset=utf-8');
      res.send(html);
    } catch (e:any) {
      logger.error({ e, guildId, spendId }, 'spend_tx_route_err');
      res.status(500).send('internal error');
    }
  });
}
