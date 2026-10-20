// =====================================================================
//  Bloco de notas por unidade (texto livre de seriais).
//  - GET/PUT em /api/estoque/notas e /api/estoque2/notas
//  - Notas são independentes entre módulos (estoque vs estoque2)
//  - Texto não altera saldos nem pool de seriais
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
const estoqueRouter = require('../src/routes/estoque');
const estoque2Router = require('../src/routes/estoque2');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use((req, res, next) => {
  req.auth = { role: 'admin', user: 'adm1', name: 'Admin', sistema: null, token: 't' };
  next();
});
app.use(estoqueRouter);
app.use(estoque2Router);

const server = app.listen(0);
const BASE = 'http://127.0.0.1:' + server.address().port;
const get = async (p) => {
  const r = await fetch(BASE + p);
  let j = null;
  try { j = await r.json(); } catch (e) {}
  return { status: r.status, body: j };
};
const put = async (p, body) => {
  const r = await fetch(BASE + p, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let j = null;
  try { j = await r.json(); } catch (e) {}
  return { status: r.status, body: j };
};

(async () => {
  const store = require('../store');
  console.log('\n=== NOTAS — bloco por unidade ===');
  const uni = 'UMEPE Juazeiro';

  const vazio = await get('/api/estoque/notas?sistema=spacecom&contrato=CE01&unidade=' + encodeURIComponent(uni));
  assert(vazio.status === 200, 'GET /api/estoque/notas: 200');
  assert(typeof vazio.body.texto === 'string', 'notas começam com texto (string)');

  const salvo = await put('/api/estoque/notas', { sistema: 'spacecom', contrato: 'CE01', unidade: uni, texto: 'TZPR04: 4319870001, 4319870002\nUPR04: 4714569930' });
  assert(salvo.status === 200 && salvo.body.texto.indexOf('4319870001') >= 0, 'PUT salva o texto de seriais (livre)');

  const lido = await get('/api/estoque/notas?sistema=spacecom&contrato=CE01&unidade=' + encodeURIComponent(uni));
  assert(lido.body.texto.indexOf('4319870001') >= 0, 'GET devolve o texto salvo');

  const outraUnidade = await get('/api/estoque/notas?sistema=spacecom&contrato=CE01&unidade=' + encodeURIComponent('UP-Cariri'));
  assert(!outraUnidade.body.texto || outraUnidade.body.texto.indexOf('4319870001') < 0, 'notas são independentes por unidade');

  console.log('\n=== NOTAS — módulos isolados ===');
  const e2 = await get('/api/estoque2/notas?sistema=spacecom&contrato=CE01&unidade=' + encodeURIComponent(uni));
  assert(e2.status === 200 && (!e2.body.texto || e2.body.texto.indexOf('4319870001') < 0), 'Estoque 2 não enxerga as notas do Estoque 1');
  const e2s = await put('/api/estoque2/notas', { sistema: 'spacecom', contrato: 'CE01', unidade: uni, texto: 'notas do e2' });
  assert(e2s.status === 200 && e2s.body.texto === 'notas do e2', 'PUT no Estoque 2 salva');

  console.log('\n=== NOTAS — sem efeito no estoque ===');
  const saldoAntes = await store.estoque.resumo({ contrato: 'CE01', sistema: 'spacecom' });
  const serAntes = (await store.estoqueSerial.all({ limit: 'all' })).length;
  await put('/api/estoque/notas', { sistema: 'spacecom', contrato: 'CE01', unidade: uni, texto: 'alteração de nota' });
  const saldoDepois = await store.estoque.resumo({ contrato: 'CE01', sistema: 'spacecom' });
  const serDepois = (await store.estoqueSerial.all({ limit: 'all' })).length;
  const semVolateis = o => JSON.stringify(o, (k, v) => (k === 'geradoEm' ? undefined : v));
  assert(semVolateis(saldoAntes) === semVolateis(saldoDepois), 'saldos do estoque inalterados');
  assert(serAntes === serDepois, 'pool de seriais inalterado');

  console.log('\n=== NOTAS — backup inclui as notas ===');
  const dump = await store.backup();
  assert(Array.isArray(dump.estoqueNotas) && dump.estoqueNotas.length >= 1, 'backup contém as notas');

  // limpeza
  await put('/api/estoque/notas', { sistema: 'spacecom', contrato: 'CE01', unidade: uni, texto: '' });
  await put('/api/estoque2/notas', { sistema: 'spacecom', contrato: 'CE01', unidade: uni, texto: '' });

  console.log(`\n=== RESULTADO: ${passed} passed, ${failed} failed ===`);
  server.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); server.close(); process.exit(1); });
