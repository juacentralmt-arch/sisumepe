#!/usr/bin/env node
// Bot anti-oscilação Render Free (15min sleep → 30-50s cold start)
// Pinga /api/health a cada 4-5 min para manter o serviço acordado.
// Uso: node scripts/keep-alive.js (local, VPS, ou GitHub Actions)
// Env: KEEP_ALIVE_URL=https://sisumepe.onrender.com  INTERVAL_MS=240000
require('dotenv').config();
const URL = (process.env.KEEP_ALIVE_URL || process.env.RENDER_EXTERNAL_URL || 'https://sisumepe.onrender.com').replace(/\/$/,'');
const HEALTH = `${URL}/api/health`;
const INTERVAL = Number(process.env.INTERVAL_MS) || 4 * 60 * 1000; // 4 min (Render dorme em 15min)
const TIMEOUT = 15000;

async function ping(){
  const t0 = Date.now();
  try{
    const ctrl = new AbortController();
    const to = setTimeout(()=> ctrl.abort(), TIMEOUT);
    const r = await fetch(HEALTH, { signal: ctrl.signal, headers: { 'User-Agent': 'sisumepe-keepalive/1.0' } });
    clearTimeout(to);
    const dt = Date.now()-t0;
    if(r.ok){
      const j = await r.json().catch(()=>({}));
      console.log(`[${new Date().toISOString()}] OK ${r.status} ${dt}ms store=${j.store||'?'} uptime=${j.uptime_s||'?'}s`);
    } else {
      console.warn(`[${new Date().toISOString()}] WARN ${r.status} ${dt}ms`);
    }
  }catch(e){
    const dt = Date.now()-t0;
    console.error(`[${new Date().toISOString()}] FAIL ${dt}ms ${e.name}: ${e.message}`);
  }
}

console.log(`Keep-alive bot iniciado: ${HEALTH} a cada ${Math.round(INTERVAL/60000)}min`);
ping();
setInterval(ping, INTERVAL);

// Mantém processo vivo mesmo se fetch falhar
process.on('uncaughtException', e=> console.error('uncaught', e.message));
process.on('unhandledRejection', e=> console.error('unhandled', e));
