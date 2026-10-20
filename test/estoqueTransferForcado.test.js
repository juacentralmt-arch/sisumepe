// =====================================================================
//  Transferência entre unidades — SOMENTE QUANTITATIVA.
//  Regra atual: seriais saíram da lógica do estoque (ficam no bloco de
//  notas por unidade). A transferência move apenas quantidade e nunca
//  é bloqueada por serial fora de disponibilidade.
//  Script puro (sem framework), no estilo das demais suítes do projeto.
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

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use((req, res, next) => {
  req.auth = { role: 'tecnico', user: 'tec1', name: 'Tec Um', sistema: 'spacecom', token: 't' };
  next();
});
app.use(estoqueRouter);

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

const DB = path.join(__dirname, '..', 'db.json');
const backup = fs.readFileSync(DB, 'utf8');
function restore() { try { fs.writeFileSync(DB, backup); } catch (e) { console.log('  ⚠️ restore:', e.message); } }

(async () => {
  try {
    const store = require('../store');
    const saldo = async (mat, und) => {
      const all = await store.estoque.all();
      const r = all.find(e => e.sistema === 'spacecom' && e.contrato === 'CE01' && e.material === mat && e.unidade === und);
      return Number(r ? r.saldo : 0);
    };

    console.log('\n=== MOVIMENTAÇÃO — quantitativa (sem seriais) ===');
    const e1 = await post('/api/estoque/movimentar', { contrato: 'CE01', material: 'TZPR04', unidade: 'UMEPE Juazeiro', qtd: 2, motivo: 'teste setup' });
    assert(e1.status === 200, 'entrada 2x TZPR04 sem seriais: 200');

    const s1 = await post('/api/estoque/movimentar', { contrato: 'CE01', material: 'TZPR04', unidade: 'UMEPE Juazeiro', qtd: -1, motivo: 'teste baixa' });
    assert(s1.status === 200, 'saída 1x TZPR04 sem seriais: 200');

    console.log('\n=== TRANSFERÊNCIA — só quantidade ===');
    const antesO = await saldo('TZPR04', 'UMEPE Juazeiro');
    const antesD = await saldo('TZPR04', 'UP-Cariri');
    const t1 = await post('/api/estoque/transferir', { contrato: 'CE01', material: 'TZPR04', qtd: 1, unidadeOrigem: 'UMEPE Juazeiro', unidadeDestino: 'UP-Cariri', motivo: 'teste transferencia' });
    assert(t1.status === 200, 'transferência 1x TZPR04: 200');
    assert((await saldo('TZPR04', 'UMEPE Juazeiro')) === antesO - 1, `origem -1 (${antesO})`);
    assert((await saldo('TZPR04', 'UP-Cariri')) === antesD + 1, `destino +1 (${antesD})`);

    // devolve o saldo
    const t2 = await post('/api/estoque/transferir', { contrato: 'CE01', material: 'TZPR04', qtd: 1, unidadeOrigem: 'UP-Cariri', unidadeDestino: 'UMEPE Juazeiro', motivo: 'retorno teste' });
    assert(t2.status === 200, 'transferência de retorno: 200');
    assert((await saldo('TZPR04', 'UMEPE Juazeiro')) === antesO, 'origem restaurada');

    console.log('\n=== SERIAIS — não atrelados ao estoque ===');
    const serAntes = await store.estoqueSerial.all({ limit: 'all' });
    const e2 = await post('/api/estoque/movimentar', { contrato: 'CE01', material: 'TZPR04', unidade: 'UMEPE Juazeiro', qtd: 1, motivo: 'teste com serial', seriais: ['4319870009'] });
    assert(e2.status === 200, 'movimentação com serial informado: 200');
    const serDepois = await store.estoqueSerial.all({ limit: 'all' });
    assert(serDepois.length === serAntes.length, 'pool de seriais não muda com a movimentação');
  } finally {
    restore();
    server.close();
  }
  console.log(`\n=== RESULTADO: ${passed} passed, ${failed} failed ===`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FALHA:', e); try { restore(); } catch (_) {} server.close(); process.exit(1); });
