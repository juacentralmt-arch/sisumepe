// =====================================================================
//  Testes do fluxo por unidade (GET /api/estoque/fluxo): entradas x
//  saídas agregadas por unidade × material. Somente leitura.
//  Script puro (sem framework), no estilo das demais suítes do projeto.
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
  req.auth = { role: 'tecnico', user: 'tec1', name: 'Tec Um', sistema: 'spacecom', token: 't' };
  next();
});
app.use(estoqueRouter);

const server = app.listen(0);
const BASE = 'http://127.0.0.1:' + server.address().port;
const get = async (p) => {
  const r = await fetch(BASE + p);
  return { status: r.status, body: await r.json().catch(() => null) };
};

(async () => {
  console.log('\n=== ESTOQUE — fluxo entradas x saídas ===');
  const r = await get('/api/estoque/fluxo?contrato=CE01');
  assert(r.status === 200, 'fluxo CE01: 200');
  const b = r.body || {};
  assert(Array.isArray(b.unidades) && b.unidades.length === 6, 'fluxo: 6 unidades');
  assert(Array.isArray(b.materiais) && b.materiais.join(',') === 'TZPR04,UPR04,FONTE04,CINTA,TRAVAS', 'fluxo: 5 materiais spacecom em ordem');
  assert(b.entradas && b.saidas && typeof b.totalEntradas === 'number' && typeof b.totalSaidas === 'number', 'fluxo: matrizes + totais');
  assert(typeof b.movimentacoes === 'number', 'fluxo: conta movimentações');
  // consistência: totais = soma das matrizes
  let se = 0, ss = 0;
  for (const u of b.unidades) for (const m of b.materiais) { se += Number(b.entradas[u][m] || 0); ss += Number(b.saidas[u][m] || 0); }
  assert(se === b.totalEntradas && ss === b.totalSaidas, `fluxo: totais batem (${se}/${ss})`);
  assert(b.totalEntradas >= 0 && b.totalSaidas >= 0, 'fluxo: sem valores negativos');

  // período futuro => zerado
  const r2 = await get('/api/estoque/fluxo?contrato=CE01&from=2099-01-01');
  assert(r2.status === 200 && r2.body.totalEntradas === 0 && r2.body.totalSaidas === 0, 'fluxo: período futuro zera');

  // contrato inválido => 400
  const r3 = await get('/api/estoque/fluxo?contrato=XX');
  assert(r3.status === 400, 'fluxo: contrato inválido 400');

  server.close();
  console.log(`\n=== RESULTADO: ${passed} passed, ${failed} failed ===`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FALHA:', e); server.close(); process.exit(1); });
