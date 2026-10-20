// =====================================================================
//  Movimentar estoque — motivo automático por tipo.
//  Tipos com tag própria (triagem, manutenção, ativação, outros) não
//  exigem motivo do usuário: o servidor gera a tag + descrição.
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

const DB = require('path').join(__dirname, '..', 'db.json');
const fs = require('fs');
const DB_BACKUP = fs.readFileSync(DB, 'utf8');
function restoreDb() { try { fs.writeFileSync(DB, DB_BACKUP); } catch (e) {} }

const server = app.listen(0);
const BASE = 'http://127.0.0.1:' + server.address().port;
const post = async (p, body) => {
  const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const get = async (p) => {
  const r = await fetch(BASE + p);
  return { status: r.status, body: await r.json().catch(() => null) };
};

(async () => {
  const store = require('../store');
  const uni = 'UMEPE Juazeiro';

  console.log('\n=== MOTIVO AUTOMÁTICO — triagem ===');
  const tri = await post('/api/estoque/movimentar', {
    sistema: 'spacecom', contrato: 'CE01', material: 'CINTA', unidade: uni,
    qtd: 2, tipo: 'triagem', motivo: ''
  });
  assert(tri.status === 200, 'triagem sem motivo: 200');
  const movTri = (await store.estoqueMov.all({ limit: 'all' })).find(m => m.motivo && m.motivo.startsWith('[TRIAGEM]'));
  assert(!!movTri, 'movimentação gravada com tag [TRIAGEM]');
  assert(movTri && movTri.tipo === 'entrada', 'triagem contabilizada como entrada');

  console.log('\n=== MOTIVO AUTOMÁTICO — manutenção ===');
  const man = await post('/api/estoque/movimentar', {
    sistema: 'spacecom', contrato: 'CE01', material: 'CINTA', unidade: uni,
    qtd: -1, tipo: 'manutencao', motivo: ''
  });
  assert(man.status === 200, 'manutenção sem motivo: 200');
  const movMan = (await store.estoqueMov.all({ limit: 'all' })).find(m => m.motivo && m.motivo.startsWith('[MANUTENCAO]'));
  assert(!!movMan, 'movimentação gravada com tag [MANUTENCAO]');
  assert(movMan && movMan.tipo === 'saida', 'manutenção contabilizada como saída');

  console.log('\n=== MOTIVO AUTOMÁTICO — ativação ===');
  const ati = await post('/api/estoque/movimentar', {
    sistema: 'spacecom', contrato: 'CE01', material: 'TZPR04', unidade: uni,
    qtd: -1, tipo: 'ativacao', motivo: ''
  });
  assert(ati.status === 200, 'ativação sem motivo: 200');
  const movAti = (await store.estoqueMov.all({ limit: 'all' })).find(m => m.motivo && m.motivo.startsWith('[ATIVACAO]'));
  assert(!!movAti, 'movimentação gravada com tag [ATIVACAO]');

  console.log('\n=== MOTIVO AUTOMÁTICO — outros ===');
  const out = await post('/api/estoque/movimentar', {
    sistema: 'spacecom', contrato: 'CE01', material: 'TRAVAS', unidade: uni,
    qtd: 5, tipo: 'outros_entrada', motivo: ''
  });
  assert(out.status === 200, 'outros sem motivo: 200');
  const movOut = (await store.estoqueMov.all({ limit: 'all' })).find(m => m.motivo && m.motivo.startsWith('[OUTROS]'));
  assert(!!movOut, 'movimentação gravada com tag [OUTROS]');

  console.log('\n=== MOTIVO OBRIGATÓRIO — entrada/saída comuns ===');
  const semMotivo = await post('/api/estoque/movimentar', {
    sistema: 'spacecom', contrato: 'CE01', material: 'CINTA', unidade: uni,
    qtd: 1, tipo: 'entrada', motivo: ''
  });
  assert(semMotivo.status === 400, 'entrada comum sem motivo: 400');

  console.log('\n=== MOTIVO AUTOMÁTICO — Estoque 2 ===');
  const tri2 = await post('/api/estoque2/movimentar', {
    sistema: 'spacecom', contrato: 'CE01', material: 'CINTA', unidade: uni,
    qtd: 2, tipo: 'triagem', motivo: ''
  });
  assert(tri2.status === 200, 'triagem (e2) sem motivo: 200');
  const movTri2 = (await store.estoque2Mov.all({ limit: 'all' })).find(m => m.motivo && m.motivo.startsWith('[TRIAGEM]'));
  assert(!!movTri2, 'movimentação e2 gravada com tag [TRIAGEM]');
  const semMotivo2 = await post('/api/estoque2/movimentar', {
    sistema: 'spacecom', contrato: 'CE01', material: 'CINTA', unidade: uni,
    qtd: 1, tipo: 'entrada', motivo: ''
  });
  assert(semMotivo2.status === 400, 'entrada comum (e2) sem motivo: 400');

  console.log('\n=== FILTRO POR CATEGORIA ===');
  const f = await get('/api/estoque-mov?contrato=CE01&sistema=spacecom&categoria=triagem&limit=20');
  assert(f.status === 200 && (f.body.items || []).length >= 1, 'filtro categoria=triagem encontra os registros');

  restoreDb();
  console.log(`\n=== RESULTADO: ${passed} passed, ${failed} failed ===`);
  server.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); restoreDb(); server.close(); process.exit(1); });
