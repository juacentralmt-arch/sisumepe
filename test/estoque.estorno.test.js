// =====================================================================
//  Estoque 1 — estorno neutro + evolução por período (port do Estoque 2):
//  - estorno grava tipo='estorno' (fora de entradas/saídas);
//  - ?data= e /fluxo/evolucao expõem correções;
//  - ?tipo=estorno filtra.
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
const router = require('../src/routes/estoque');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use((req, res, next) => {
  req.auth = { role: 'admin', user: 'adm1', name: 'Admin', sistema: null, token: 't' };
  next();
});
app.use(router);

const server = app.listen(0);
const BASE = 'http://127.0.0.1:' + server.address().port;

async function post(path, body) {
  const res = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let j = null;
  try { j = await res.json(); } catch (e) {}
  return { status: res.status, body: j };
}
async function get(path) {
  const res = await fetch(BASE + path);
  let j = null;
  try { j = await res.json(); } catch (e) {}
  return { status: res.status, body: j };
}

async function main() {
  const store = require('../store');
  const uni = 'UMEPE Juazeiro';
  const hoje = new Date().toISOString().slice(0, 10);
  const d3 = new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10);

  console.log('\n=== ESTOQUE 1 — estorno neutro ===');
  const mv = await post('/api/estoque/movimentar', {
    sistema: 'spacecom', contrato: 'CE01', material: 'CINTA', unidade: uni,
    qtd: 4, motivo: 'entrada para estorno e1test'
  });
  assert(mv.status === 200, 'entrada +4 CINTA: 200');
  const all = await store.estoqueMov.all({ limit: 'all' });
  const alvo = all.find(m => m.motivo === 'entrada para estorno e1test' && !m.estornado);
  assert(!!alvo, 'original localizada');
  const diaAntes = await get(`/api/estoque/fluxo?sistema=spacecom&contrato=CE01&data=${hoje}`);
  assert(diaAntes.status === 200 && diaAntes.body.modo === 'diario', '?data=: 200');
  const est = await post('/api/estoque/estornar', { id: alvo.id, motivo: 'correcao teste e1test' });
  assert(est.status === 200 && est.body.estorno && est.body.estorno.mov.tipo === 'estorno', 'estorno tipo=estorno');
  const dia = await get(`/api/estoque/fluxo?sistema=spacecom&contrato=CE01&data=${hoje}`);
  assert(dia.body.totalCorrecoes === diaAntes.body.totalCorrecoes - 4, 'correções -4');
  assert(dia.body.totalSaidas === diaAntes.body.totalSaidas, 'saídas intactas');
  assert(dia.body.totalEntradas === diaAntes.body.totalEntradas, 'entradas intactas');
  const f = await get('/api/estoque-mov?contrato=CE01&sistema=spacecom&tipo=estorno&limit=5');
  assert(f.status === 200 && (f.body.items || []).length >= 1, '?tipo=estorno funciona');
  const duplo = await post('/api/estoque/estornar', { id: alvo.id, motivo: 'x2' });
  assert(duplo.status === 400, 're-estorno: 400');

  console.log('\n=== ESTOQUE 1 — evolução por período ===');
  const evo = await get(`/api/estoque/fluxo/evolucao?sistema=spacecom&contrato=CE01&de=${d3}&ate=${hoje}`);
  assert(evo.status === 200 && evo.body.modo === 'evolucao', 'evolução: 200');
  assert(Array.isArray(evo.body.dias) && evo.body.dias.length === 4, '4 dias');
  assert(evo.body.dias.every(d => d.totalCorrecoes !== undefined && d.inicial && d.final), 'dias com correções + matrizes');
  const evo31 = await get('/api/estoque/fluxo/evolucao?sistema=spacecom&contrato=CE01&de=2026-01-01&ate=2026-03-01');
  assert(evo31.status === 400, '>31 dias: 400');
}

main().then(() => {
  console.log(`\n=== RESULTADO: ${passed} passed, ${failed} failed ===`);
  server.close();
  process.exitCode = failed > 0 ? 1 : 0;
}).catch(e => {
  console.error(e);
  try { server.close(); } catch (_) {}
  process.exit(1);
});
