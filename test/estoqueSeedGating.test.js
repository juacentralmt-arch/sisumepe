// =====================================================================
//  Testes do gate de produção dos endpoints de carga massiva de estoque
//  (POST /api/estoque/seed e /api/estoque/seed-demo).
//
//  Esses endpoints escrevem histórico em massa e antes ficavam disponíveis
//  em produção para qualquer admin. Agora só rodam fora de produção ou com
//  ENABLE_STOCK_SEED=1 explícito. Este teste garante que o gate não regrida
//  (um dia alguém "conserta" o 403 removendo o middleware).
// =====================================================================
let passed = 0, failed = 0;
const assert = (cond, msg) => {
  if (cond) { console.log('  ✅', msg); passed++; }
  else { console.log('  ❌', msg); failed++; }
};

process.env.SUPABASE_URL = '';
process.env.SUPABASE_KEY = '';

const express = require('express');
const shared = require('../src/lib/shared');
shared.auth = (roles) => (req, res, next) => {
  if (!req.auth) return res.status(401).json({ error: 'sem auth (teste)' });
  if (roles && roles.length && !roles.includes(req.auth.role)) return res.status(403).json({ error: 'Acesso restrito ao seu perfil.' });
  next();
};
const estoqueRouter = require('../src/routes/estoque');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use((req, res, next) => {
  req.auth = { role: 'admin', user: 'admin', name: 'Administrador', sistema: null, token: 't' };
  next();
});
app.use(estoqueRouter);

const server = app.listen(0);
const BASE = 'http://127.0.0.1:' + server.address().port;

async function post(path) {
  const res = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
  let j = null;
  try { j = await res.json(); } catch (e) { /* corpo não-JSON */ }
  return { status: res.status, body: j };
}

async function main() {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalFlag = process.env.ENABLE_STOCK_SEED;

  try {
    console.log('\n=== SEED — bloqueado em produção por padrão ===');
    process.env.NODE_ENV = 'production';
    delete process.env.ENABLE_STOCK_SEED;

    {
      const r = await post('/api/estoque/seed?dias=1&lote=0');
      assert(r.status === 403, 'POST /api/estoque/seed em produção → 403');
      assert(!!(r.body && /ENABLE_STOCK_SEED/.test(String(r.body.error))), 'mensagem indica como habilitar (ENABLE_STOCK_SEED)');
    }
    {
      const r = await post('/api/estoque/seed-demo');
      assert(r.status === 403, 'POST /api/estoque/seed-demo em produção → 403');
    }

    console.log('\n=== SEED — liberado com ENABLE_STOCK_SEED=1 ===');
    process.env.ENABLE_STOCK_SEED = '1';
    {
      const r = await post('/api/estoque/seed?dias=1&lote=0');
      assert(r.status !== 403, 'com ENABLE_STOCK_SEED=1 o gate não bloqueia (status ' + r.status + ')');
    }
    delete process.env.ENABLE_STOCK_SEED;

    console.log('\n=== SEED — liberado fora de produção (dev/teste) ===');
    process.env.NODE_ENV = 'development';
    {
      const r = await post('/api/estoque/seed-demo');
      assert(r.status !== 403, 'sem NODE_ENV=production o gate não bloqueia (status ' + r.status + ')');
    }
  } finally {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = originalNodeEnv;
    if (originalFlag === undefined) delete process.env.ENABLE_STOCK_SEED; else process.env.ENABLE_STOCK_SEED = originalFlag;
  }
}

main()
  .catch(e => { console.log('  ❌ erro inesperado:', e && e.message); failed++; })
  .finally(() => {
    server.close();
    console.log(`\n=== RESULTADO: ${passed} passed, ${failed} failed ===`);
    process.exit(failed ? 1 : 0);
  });
