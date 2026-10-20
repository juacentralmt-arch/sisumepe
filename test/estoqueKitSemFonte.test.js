// =====================================================================
//  Kit TZPR (sem fonte): 1x TZPR04 + 1x CINTA + 2x TRAVAS (sem FONTE04).
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

  console.log('\n=== KIT TZPR (sem fonte) — composição ===');
  const r = await post('/api/estoque/movimentar-kit', {
    sistema: 'spacecom', contrato: 'CE01', unidade: uni,
    kits: 2, kit: 'tzprsf', tipo: 'entrada', motivo: 'teste kit sem fonte'
  });
  assert(r.status === 200, 'movimentar-kit tzprsf: 200');
  assert(r.body.kit === 'tzprsf', 'resposta com kit=tzprsf');
  const itens = (r.body.itens || []).map(i => i.material + ':' + i.qtd).sort();
  assert(itens.join(',') === 'CINTA:2,TRAVAS:4,TZPR04:2', `composição aplicada (${itens.join(', ')})`);
  assert(!(r.body.itens || []).some(i => i.material === 'FONTE04'), 'FONTE04 NÃO foi movimentado');

  console.log('\n=== KIT TZPR (sem fonte) — saldos ===');
  const saldos = async (mat) => {
    const all = await store.estoque.all();
    const row = all.find(e => e.sistema === 'spacecom' && e.contrato === 'CE01' && e.material === mat && e.unidade === uni);
    return Number(row ? row.saldo : 0);
  };
  const antes = { tzpr: await saldos('TZPR04'), cinta: await saldos('CINTA'), travas: await saldos('TRAVAS'), fonte: await saldos('FONTE04') };
  const r2 = await post('/api/estoque/movimentar-kit', {
    sistema: 'spacecom', contrato: 'CE01', unidade: uni,
    kits: 3, kit: 'tzprsf', tipo: 'entrada', motivo: 'teste kit sem fonte 2'
  });
  assert(r2.status === 200, 'segundo kit: 200');
  assert((await saldos('TZPR04')) === antes.tzpr + 3, `TZPR04 +3 (${antes.tzpr} -> ${await saldos('TZPR04')})`);
  assert((await saldos('CINTA')) === antes.cinta + 3, `CINTA +3`);
  assert((await saldos('TRAVAS')) === antes.travas + 6, `TRAVAS +6`);
  assert((await saldos('FONTE04')) === antes.fonte, 'FONTE04 inalterado');

  console.log('\n=== KIT TZPR (sem fonte) — saídas ===');
  const r3 = await post('/api/estoque/movimentar-kit', {
    sistema: 'spacecom', contrato: 'CE01', unidade: uni,
    kits: 1, kit: 'tzprsf', tipo: 'saida', motivo: 'teste kit saida'
  });
  assert(r3.status === 200, 'saída de kit: 200');
  assert((await saldos('TZPR04')) === antes.tzpr + 2, 'TZPR04 volta ao saldo anterior (+2)');
  assert((await saldos('TRAVAS')) === antes.travas + 4, 'TRAVAS volta ao saldo anterior (+4)');

  console.log('\n=== KIT TZPR (sem fonte) — Estoque 2 ===');
  const r4 = await post('/api/estoque2/movimentar-kit', {
    sistema: 'spacecom', contrato: 'CE01', unidade: uni,
    kits: 1, kit: 'tzprsf', tipo: 'entrada', motivo: 'teste kit sem fonte e2'
  });
  assert(r4.status === 200, 'movimentar-kit (e2) tzprsf: 200');
  const itens2 = (r4.body.itens || []).map(i => i.material + ':' + i.qtd).sort();
  assert(itens2.join(',') === 'CINTA:1,TRAVAS:2,TZPR04:1', `composição e2 (${itens2.join(', ')})`);

  console.log('\n=== KIT TZPR (sem fonte) — kit completo continua íntegro ===');
  const r5 = await post('/api/estoque/movimentar-kit', {
    sistema: 'spacecom', contrato: 'CE01', unidade: uni,
    kits: 1, kit: 'tzpr', tipo: 'entrada', motivo: 'teste kit completo'
  });
  const itens3 = (r5.body.itens || []).map(i => i.material + ':' + i.qtd).sort();
  assert(itens3.join(',') === 'CINTA:1,FONTE04:1,TRAVAS:2,TZPR04:1', `kit completo com FONTE04 (${itens3.join(', ')})`);

  restoreDb();
  console.log(`\n=== RESULTADO: ${passed} passed, ${failed} failed ===`);
  server.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); restoreDb(); server.close(); process.exit(1); });
