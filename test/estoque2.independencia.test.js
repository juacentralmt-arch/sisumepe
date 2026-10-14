// =====================================================================
//  Estoque 2 — independência do Estoque 1:
//  - movimentar no Estoque 2 NÃO altera saldos/movs/seriais do Estoque 1;
//  - resumo do Estoque 1 permanece idêntico antes/depois;
//  - tabelas distintas (estoque2/estoque2_mov/estoque2_serial no store);
//  - cache da IA com namespace não vaza entre módulos.
//  Script puro (sem framework), no estilo das demais suítes.
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
const estoque2Router = require('../src/routes/estoque2');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use((req, res, next) => {
  req.auth = { role: 'admin', user: 'adm1', name: 'Admin', sistema: null, token: 't' };
  next();
});
app.use(estoque2Router);

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
  console.log('\n=== ESTOQUE 2 — rotas respondem ===');
  const uni = 'UMEPE Juazeiro';

  const r0 = await get('/api/estoque2/resumo?contrato=CE01&sistema=spacecom');
  assert(r0.status === 200 && r0.body, 'GET /api/estoque2/resumo: 200');

  const antes1 = await store.estoque.resumo({ contrato: 'CE01', sistema: 'spacecom' });
  const movsAntes1 = await store.estoqueMov.all({ limit: 'all' });
  const serAntes1 = await store.estoqueSerial.all({ limit: 'all' });

  // movimenta SÓ no Estoque 2 (entrada sem serial em CINTA para não tocar no pool)
  const mv = await post('/api/estoque2/movimentar', {
    sistema: 'spacecom', contrato: 'CE01', material: 'CINTA', unidade: uni,
    qtd: 7, motivo: 'teste independencia e2'
  });
  assert(mv.status === 200, 'POST /api/estoque2/movimentar: 200');

  console.log('\n=== ESTOQUE 2 — Estoque 1 intacto ===');
  const semVolateis = o => JSON.stringify(o, (k, v) => (k === 'geradoEm' ? undefined : v));
  const depois1 = await store.estoque.resumo({ contrato: 'CE01', sistema: 'spacecom' });
  assert(semVolateis(depois1) === semVolateis(antes1), 'resumo do Estoque 1 idêntico');
  const movsDepois1 = await store.estoqueMov.all({ limit: 'all' });
  assert(movsDepois1.length === movsAntes1.length, `movs do Estoque 1 intactas (${movsAntes1.length})`);
  const serDepois1 = await store.estoqueSerial.all({ limit: 'all' });
  assert(serDepois1.length === serAntes1.length, 'seriais do Estoque 1 intactos');

  const r2 = await get('/api/estoque2/resumo?contrato=CE01&sistema=spacecom');
  assert(r2.status === 200, 'resumo e2 após movimentação: 200');

  // estorna para deixar o módulo como estava (limpeza do teste)
  const movs2 = await store.estoque2Mov.all({ limit: 'all' });
  const alvo = movs2.filter(m => m.motivo === 'teste independencia e2').slice(-1)[0];
  assert(!!alvo, 'movimentação de teste localizada no Estoque 2');
  if (alvo) {
    const est = await post('/api/estoque2/estornar', { id: alvo.id, motivo: 'limpeza teste' });
    assert(est.status === 200, 'estorno da movimentação de teste: 200');
  }

  console.log('\n=== ESTOQUE 2 — evolução por período ===');
  const hoje = new Date().toISOString().slice(0, 10);
  const d3 = new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10);
  const evo = await get(`/api/estoque2/fluxo/evolucao?sistema=spacecom&contrato=CE01&de=${d3}&ate=${hoje}`);
  assert(evo.status === 200 && evo.body.modo === 'evolucao', 'evolução 4 dias: 200');
  assert(Array.isArray(evo.body.dias) && evo.body.dias.length === 4, `4 dias retornados (${(evo.body.dias || []).length})`);
  const dk = ['data', 'totalInicial', 'totalEntradas', 'totalSaidas', 'totalFinal', 'movimentacoes', 'inicial', 'final'];
  assert(evo.body.dias.every(d => dk.every(k => d[k] !== undefined)), 'cada dia com totais + matrizes');
  assert(evo.body.dias[0].data === d3 && evo.body.dias[3].data === hoje, 'dias em ordem cronológica');
  const evoUnd = await get(`/api/estoque2/fluxo/evolucao?sistema=spacecom&contrato=CE01&de=${d3}&ate=${hoje}&unidade=${encodeURIComponent(uni)}`);
  assert(evoUnd.status === 200 && evoUnd.body.unidade === uni, 'filtro por unidade respeitado');
  const evo31 = await get(`/api/estoque2/fluxo/evolucao?sistema=spacecom&contrato=CE01&de=2026-01-01&ate=2026-02-15`);
  assert(evo31.status === 400, 'período >31 dias: 400');
  const evoInv = await get('/api/estoque2/fluxo/evolucao?sistema=spacecom&contrato=CE01&de=xx&ate=' + hoje);
  assert(evoInv.status === 400, 'data inválida: 400');
  const dia = await get(`/api/estoque2/fluxo?sistema=spacecom&contrato=CE01&data=${hoje}`);
  assert(dia.status === 200 && dia.body.modo === 'diario' && dia.body.data === hoje, '?data= segue íntegro após refatoração');

  console.log('\n=== ESTOQUE 2 — cache IA isolado por namespace ===');
  const cache = require('../src/lib/estoqueIA-core/cache');
  const a1 = await cache.getOrFetch('estoque', { x: 'nse2teste' }, () => Promise.resolve('MOD1'));
  const b1 = await cache.getOrFetch('estoque', { x: 'nse2teste' }, () => Promise.resolve('MOD2'), 'e2');
  const a2 = await cache.getOrFetch('estoque', { x: 'nse2teste' }, () => Promise.resolve('MOD1-B'));
  assert(a1 === 'MOD1' && b1 === 'MOD2' && a2 === 'MOD1', 'mesma query, namespaces distintos, sem vazamento');
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
