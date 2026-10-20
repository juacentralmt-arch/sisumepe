// =====================================================================
//  Estorno do KIT completo.
//  Um KIT gera N movimentações (uma por material) com um token comum no
//  motivo: '[KIT x2 #A1B2C3]'. O endpoint /estornar-kit reverte TODOS os
//  itens do lote de uma vez.
//  Script puro (sem framework), no estilo das demais suítes.
// =====================================================================
let passed = 0, failed = 0;
const assert = (cond, msg) => {
  if (cond) { console.log('  ✅', msg); passed++; }
  else { console.log('  ❌', msg); failed++; }
};

process.env.SUPABASE_URL = '';
process.env.SUPABASE_KEY = '';

const fs = require('fs');
const path = require('path');
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

const DB = path.join(__dirname, '..', 'db.json');
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
  const saldos = async (mod, mat) => {
    const all = mod === 'e2' ? await store.estoque2.all() : await store.estoque.all();
    const row = all.find(e => e.sistema === 'spacecom' && e.contrato === 'CE01' && e.material === mat && e.unidade === uni);
    return Number(row ? row.saldo : 0);
  };

  console.log('\n=== KIT — token no motivo ===');
  const r = await post('/api/estoque/movimentar-kit', {
    sistema: 'spacecom', contrato: 'CE01', unidade: uni,
    kits: 2, kit: 'tzpr', tipo: 'entrada', motivo: 'teste estorno kit'
  });
  assert(r.status === 200, 'kit registrado: 200');
  assert(!!r.body.kitToken, `token do kit gerado (${r.body.kitToken})`);
  const token = r.body.kitToken;
  const movs = await store.estoqueMov.all({ limit: 'all' });
  const doKit = movs.filter(m => String(m.motivo || '').includes('#' + token));
  assert(doKit.length === 4, `4 movimentações no lote do kit (${doKit.length})`);
  assert(doKit.every(m => m.motivo.includes('[KIT x2 #' + token + ']')), 'todas carregam o mesmo token');

  console.log('\n=== ESTORNO DO KIT COMPLETO ===');
  const antes = { tzpr: await saldos('e1', 'TZPR04'), cinta: await saldos('e1', 'CINTA'), travas: await saldos('e1', 'TRAVAS'), fonte: await saldos('e1', 'FONTE04') };
  const est = await post('/api/estoque/estornar-kit', { movId: doKit[0].id, motivo: 'estorno do kit completo' });
  assert(est.status === 200, 'estornar-kit: 200');
  assert(est.body.total === 4, `4 itens estornados (${est.body.total})`);
  assert((est.body.estornos || []).length === 4, 'lista de estornos com 4 itens');
  assert((await saldos('e1', 'TZPR04')) === antes.tzpr - 2, `TZPR04 voltou ao saldo anterior (${antes.tzpr} -> ${await saldos('e1', 'TZPR04')})`);
  assert((await saldos('e1', 'CINTA')) === antes.cinta - 2, 'CINTA voltou ao saldo anterior');
  assert((await saldos('e1', 'TRAVAS')) === antes.travas - 4, 'TRAVAS voltou ao saldo anterior');
  assert((await saldos('e1', 'FONTE04')) === antes.fonte - 2, 'FONTE04 voltou ao saldo anterior');

  console.log('\n=== ESTORNO DO KIT — marcação ===');
  const depois = await store.estoqueMov.all({ limit: 'all' });
  const marcados = depois.filter(m => doKit.find(d => d.id === m.id)).every(m => m.estornado === true);
  assert(marcados, 'movimentações originais marcadas como ESTORNADO');
  const estornos = depois.filter(m => String(m.motivo || '').includes('ESTORNO') && String(m.motivo || '').includes(token));
  assert(estornos.length === 4, `4 correções geradas (${estornos.length})`);
  assert(estornos.every(m => m.tipo === 'estorno'), 'correções gravadas como tipo=estorno');

  console.log('\n=== ESTORNO DO KIT — idempotência e erros ===');
  const dnv = await post('/api/estoque/estornar-kit', { movId: doKit[0].id, motivo: 'segunda tentativa' });
  assert(dnv.status === 400, 'kit já estornado: 400');
  const semMotivo = await post('/api/estoque/estornar-kit', { movId: doKit[0].id, motivo: 'x' });
  assert(semMotivo.status === 400, 'motivo curto: 400');
  const naoKit = await post('/api/estoque/estornar-kit', { movId: 999999, motivo: 'teste invalido' });
  assert(naoKit.status === 404, 'movimentação inexistente: 404');

  console.log('\n=== ESTORNO DO KIT — Estoque 2 ===');
  const r2 = await post('/api/estoque2/movimentar-kit', {
    sistema: 'spacecom', contrato: 'CE01', unidade: uni,
    kits: 1, kit: 'tzprsf', tipo: 'entrada', motivo: 'teste estorno kit e2'
  });
  assert(r2.status === 200 && !!r2.body.kitToken, 'kit e2 registrado com token');
  const token2 = r2.body.kitToken;
  const movs2 = await store.estoque2Mov.all({ limit: 'all' });
  const doKit2 = movs2.filter(m => String(m.motivo || '').includes('#' + token2));
  assert(doKit2.length === 3, `3 movimentações no kit e2 (${doKit2.length})`);
  const antes2 = await saldos('e2', 'TZPR04');
  const est2 = await post('/api/estoque2/estornar-kit', { movId: doKit2[0].id, motivo: 'estorno kit e2' });
  assert(est2.status === 200 && est2.body.total === 3, `estorno do kit e2: ${est2.body.total} itens`);
  assert((await saldos('e2', 'TZPR04')) === antes2 - 1, 'TZPR04 (e2) voltou ao saldo anterior');

  restoreDb();
  console.log(`\n=== RESULTADO: ${passed} passed, ${failed} failed ===`);
  server.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); restoreDb(); server.close(); process.exit(1); });
