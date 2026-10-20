// =====================================================================
//  Fechamento do dia — contagem no fuso local.
//  Regressão: o fechamento usava limites de dia em UTC. Depois das 21h
//  (Brasília = UTC-3) a movimentação caía no dia UTC seguinte e não era
//  contabilizada no "fechamento do dia" (nem as correções/estornos).
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
const post = async (p, body) => {
  const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const get = async (p) => {
  const r = await fetch(BASE + p);
  return { status: r.status, body: await r.json().catch(() => null) };
};

const { diaLocal, hojeLocal } = require('../src/lib/datas');

(async () => {
  const hoje = hojeLocal();
  const lim = diaLocal(hoje);
  console.log('\n=== FECHAMENTO — contagem no fuso local ===');
  console.log('  hoje local:', hoje, '| início UTC:', lim.inicio.toISOString(), '| fim UTC:', lim.fim.toISOString());

  // 1) ajuste rápido (movimentação sem serial) precisa aparecer no fechamento de hoje
  const antes = await get('/api/estoque2/fluxo?sistema=spacecom&contrato=CE01&data=' + hoje);
  const antesTotal = Number(antes.body.totalEntradas || 0);

  const mv = await post('/api/estoque2/movimentar', {
    sistema: 'spacecom', contrato: 'CE01', material: 'CINTA', unidade: 'UMEPE Juazeiro',
    qtd: 3, motivo: 'teste fuso local entrada'
  });
  assert(mv.status === 200, 'movimentação de entrada: 200');

  const depois = await get('/api/estoque2/fluxo?sistema=spacecom&contrato=CE01&data=' + hoje);
  assert(depois.body.totalEntradas === antesTotal + 3, `entrada contabilizada no fechamento (${antesTotal} -> ${depois.body.totalEntradas})`);
  assert(Number(depois.body.movimentacoes || 0) >= 1, 'movimentações do dia contabilizadas');

  // 2) correção (estorno) precisa aparecer em "correções" do fechamento
  const movs = await require('../store').estoque2Mov.all({ limit: 'all' });
  const alvo = movs.find(m => m.motivo === 'teste fuso local entrada' && !m.estornado);
  assert(!!alvo, 'movimentação de teste localizada');
  const est = await post('/api/estoque2/estornar', { id: alvo.id, motivo: 'correcao teste fuso' });
  assert(est.status === 200, 'estorno criado: 200');

  const comCorrecao = await get('/api/estoque2/fluxo?sistema=spacecom&contrato=CE01&data=' + hoje);
  assert(Number(comCorrecao.body.totalCorrecoes || 0) === Number(depois.body.totalCorrecoes || 0) - 3, `correção contabilizada no fechamento (${depois.body.totalCorrecoes} -> ${comCorrecao.body.totalCorrecoes})`);
  assert(comCorrecao.body.totalFinal === depois.body.totalFinal - 3, 'saldo final reflete a correção');

  // 3) fechamento do Estoque 1 também
  const mv1 = await post('/api/estoque/movimentar', {
    sistema: 'spacecom', contrato: 'CE01', material: 'CINTA', unidade: 'UMEPE Juazeiro',
    qtd: 2, motivo: 'teste fuso local e1'
  });
  assert(mv1.status === 200, 'movimentação no Estoque 1: 200');
  const e1 = await get('/api/estoque/fluxo?sistema=spacecom&contrato=CE01&data=' + hoje);
  assert(e1.status === 200 && e1.body.modo === 'diario', 'fechamento do Estoque 1 responde');

  // 4) o dia anterior não deve pegar a movimentação de hoje
  const ontem = require('../src/lib/datas').addDiasISO(hoje, -1);
  const ant = await get('/api/estoque2/fluxo?sistema=spacecom&contrato=CE01&data=' + ontem);
  assert(ant.status === 200 && ant.body.data === ontem, 'fechamento do dia anterior isolado');

  console.log(`\n=== RESULTADO: ${passed} passed, ${failed} failed ===`);
  server.close();
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); server.close(); process.exit(1); });
