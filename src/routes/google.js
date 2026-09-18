const express = require('express');
const crypto = require('crypto');
const shared = require('../lib/shared');
const { store, ah, auth, broadcast, issueToken, loginRateLimit, isHash, upload, mapFiles, sortQueue, enrich, enrichAll, ticketOwnerOf, infinityBlocked, PERSON_LABELS, MOTIVOS_OK, getGoogleConfig, makeOAuthClient, getAuthedClientForUser, syncAgendaToGoogle, pendingGoogleStates, ROOT, PORT } = shared;
const router = express.Router();

// ============ GOOGLE AGENDA ============
router.get('/api/auth/google', auth(['tecnico','admin']), ah(async (req,res)=>{
  const cfg = getGoogleConfig();
  if(!cfg) return res.status(500).json({ error: 'Google Agenda não configurado. Defina GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI no servidor.' });
  const o = makeOAuthClient();
  const state = crypto.randomBytes(16).toString('hex');
  pendingGoogleStates.set(state, { user: req.auth.user, exp: Date.now()+10*60e3 });
  setTimeout(()=> pendingGoogleStates.delete(state), 10*60e3);
  const url = o.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: ['https://www.googleapis.com/auth/calendar'], state });
  res.json({ url });
}));
router.get('/api/auth/google/callback', ah(async (req,res)=>{
  const { code, state } = req.query;
  if(!code || !state) return res.status(400).send('Código ou estado ausente');
  const rec = pendingGoogleStates.get(String(state));
  if(!rec || rec.exp < Date.now()) return res.status(400).send('Estado expirado. Tente novamente no sistema.');
  pendingGoogleStates.delete(String(state));
  const cfg = getGoogleConfig();
  if(!cfg) return res.status(500).send('Google não configurado');
  const o = makeOAuthClient();
  try{
    const { tokens } = await o.getToken(String(code));
    await store.googleTokens.set(rec.user, tokens);
    // redireciona para o app com sucesso
    res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:40px"><h2>✅ Google Agenda vinculada!</h2><p>Conta <b>${rec.user}</b> conectada com sucesso.</p><p>Você pode fechar esta janela e voltar ao SISUMEPE.</p><script>setTimeout(()=>window.close(),1200); setTimeout(()=>location.href='/',1500);</script></body></html>`);
  }catch(e){
    console.error(e);
    res.status(500).send('Falha ao vincular Google: ' + (e.message||'erro'));
  }
}));
router.get('/api/auth/google/status', auth(), ah(async (req,res)=>{
  const cfg = getGoogleConfig();
  const tokens = await store.googleTokens.get(req.auth.user);
  res.json({ configured: !!cfg, connected: !!tokens, hasRefresh: !!(tokens && tokens.refresh_token) });
}));
router.post('/api/auth/google/disconnect', auth(), ah(async (req,res)=>{
  await store.googleTokens.del(req.auth.user);
  res.json({ ok: true });
}));

module.exports = router;
