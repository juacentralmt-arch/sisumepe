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

const DB = require('path').join(__dirname, '..', 'db.json');
const fs = require('fs');
const DB_BACKUP = fs.readFileSync(DB, 'utf8');
function restoreDb() { try { fs.writeFileSync(DB, DB_BACKUP); } catch (e) {} }

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

  // Saldo inicial: o teste não pode depender do estado do banco.
  const seedCinta = await post('/api/estoque2/movimentar', {
    sistema: 'spacecom', contrato: 'CE01', material: 'CINTA', unidade: uni,
    qtd: 10, motivo: 'setup saldo teste independencia e2'
  });
  assert(seedCinta.status === 200, 'setup: entrada de CINTA no Estoque 2');

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
  const alvo = movs2.find(m => m.motivo === 'teste independencia e2' && !m.estornado);
  assert(!!alvo, 'movimentação de teste localizada no Estoque 2');
  if (alvo) {
    const est = await post('/api/estoque2/estornar', { id: alvo.id, motivo: 'limpeza teste' });
    assert(est.status === 200, 'estorno da movimentação de teste: 200');
  }

  console.log('\n=== ESTOQUE 2 — evolução por período ===');
  // O fechamento usa dias no fuso operacional (America/Fortaleza)
  const { hojeLocal, addDiasISO } = require('../src/lib/datas');
  const hoje = hojeLocal();
  const d3 = addDiasISO(hoje, -3);
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

  console.log('\n=== ESTOQUE 2 — transferência origem→destino ===');
  const saldoE2 = async (mat, und) => {
    const all = await store.estoque2.all();
    const r = all.find(e => e.sistema === 'spacecom' && e.contrato === 'CE01' && e.material === mat && e.unidade === und);
    return Number(r ? r.saldo : 0);
  };
  const sAntesO = await saldoE2('CINTA', 'UMEPE Juazeiro');
  const sAntesD = await saldoE2('CINTA', 'UP-Juazeiro');
  const tr1 = await post('/api/estoque2/transferir', {
    sistema: 'spacecom', contrato: 'CE01', material: 'CINTA', qtd: 1,
    unidadeOrigem: 'UMEPE Juazeiro', unidadeDestino: 'UP-Juazeiro', motivo: 'teste transferencia e2test'
  });
  assert(tr1.status === 200, 'transferir 1 CINTA UMEPE→UP-Juazeiro: 200');
  assert((await saldoE2('CINTA', 'UMEPE Juazeiro')) === sAntesO - 1, `origem -1 (${sAntesO})`);
  assert((await saldoE2('CINTA', 'UP-Juazeiro')) === sAntesD + 1, `destino +1 (${sAntesD})`);
  assert(tr1.body.origem && tr1.body.destino, 'resposta com pernas origem+destino');
  const movOut = tr1.body.origem.mov;
  assert(movOut.unidadeDestino === 'UP-Juazeiro', 'mov de saída linkada ao destino');
  // seriais saíram da lógica do estoque: a transferência é só quantitativa
  // e o pool de seriais permanece intacto (ficam no bloco de notas).
  const sersAntes = await store.estoque2Serial.all({ limit: 'all' });
  // garante saldo para a transferência quantitativa (independe do estado do banco)
  const seedTzpr = await post('/api/estoque2/movimentar', {
    sistema: 'spacecom', contrato: 'CE01', material: 'TZPR04', unidade: 'UMEPE Juazeiro',
    qtd: 2, motivo: 'setup teste transferencia quantitativa e2test'
  });
  assert(seedTzpr.status === 200, 'setup: entrada 2x TZPR04');
  const salO = await saldoE2('TZPR04', 'UMEPE Juazeiro');
  const salD = await saldoE2('TZPR04', 'UP-Juazeiro');
  const trS = await post('/api/estoque2/transferir', {
    sistema: 'spacecom', contrato: 'CE01', material: 'TZPR04', qtd: 1,
    unidadeOrigem: 'UMEPE Juazeiro', unidadeDestino: 'UP-Juazeiro',
    motivo: 'teste transferencia quantitativa e2test'
  });
  assert(trS.status === 200, 'transferir TZPR04 (só quantidade): 200');
  assert((await saldoE2('TZPR04', 'UMEPE Juazeiro')) === salO - 1, 'origem -1');
  assert((await saldoE2('TZPR04', 'UP-Juazeiro')) === salD + 1, 'destino +1');
  const sersDepois = await store.estoque2Serial.all({ limit: 'all' });
  assert(sersDepois.length === sersAntes.length, 'pool de seriais não é alterado pela transferência');
  const trS2 = await post('/api/estoque2/transferir', {
    sistema: 'spacecom', contrato: 'CE01', material: 'TZPR04', qtd: 1,
    unidadeOrigem: 'UP-Juazeiro', unidadeDestino: 'UMEPE Juazeiro',
    motivo: 'retorno teste quantitativo e2test'
  });
  assert(trS2.status === 200, 'retorno: 200');
  assert((await saldoE2('TZPR04', 'UMEPE Juazeiro')) === salO, 'origem restaurada');
  // desfaz a perna CINTA (saldos voltam; ficam só as linhas de histórico)
  const trBack = await post('/api/estoque2/transferir', {
    sistema: 'spacecom', contrato: 'CE01', material: 'CINTA', qtd: 1,
    unidadeOrigem: 'UP-Juazeiro', unidadeDestino: 'UMEPE Juazeiro', motivo: 'retorno teste e2test'
  });
  assert(trBack.status === 200, 'transferência de retorno: 200');
  assert((await saldoE2('CINTA', 'UMEPE Juazeiro')) === sAntesO, 'origem restaurada');
  assert((await saldoE2('CINTA', 'UP-Juazeiro')) === sAntesD, 'destino restaurado');

  console.log('\n=== ESTOQUE 2 — estorno como correção neutra ===');
  const mvE = await post('/api/estoque2/movimentar', {
    sistema: 'spacecom', contrato: 'CE01', material: 'CINTA', unidade: uni,
    qtd: 5, motivo: 'entrada para estorno e2test'
  });
  assert(mvE.status === 200, 'entrada +5 CINTA: 200');
  const movsE = await store.estoque2Mov.all({ limit: 'all' });
  const alvoE = movsE.find(m => m.motivo === 'entrada para estorno e2test' && !m.estornado);
  assert(!!alvoE, 'movimentação original localizada');
  const diaAntes = await get(`/api/estoque2/fluxo?sistema=spacecom&contrato=CE01&data=${hoje}`);
  const est = await post('/api/estoque2/estornar', { id: alvoE.id, motivo: 'correcao teste e2test' });
  assert(est.status === 200 && est.body.estorno && est.body.estorno.mov.tipo === 'estorno', 'estorno cria mov tipo=estorno');
  const diaDepois = await get(`/api/estoque2/fluxo?sistema=spacecom&contrato=CE01&data=${hoje}`);
  assert(diaDepois.body.totalCorrecoes === diaAntes.body.totalCorrecoes - 5, `correções somam -5 (${diaAntes.body.totalCorrecoes} -> ${diaDepois.body.totalCorrecoes})`);
  assert(diaDepois.body.totalSaidas === diaAntes.body.totalSaidas, 'estorno NÃO infla saídas');
  assert(diaDepois.body.totalEntradas === diaAntes.body.totalEntradas, 'estorno NÃO infla entradas');
  assert(diaDepois.body.totalFinal === diaAntes.body.totalFinal - 5, 'saldo final reflete a reversão');
  const fEst = await get('/api/estoque2-mov?contrato=CE01&sistema=spacecom&tipo=estorno&limit=5');
  assert(fEst.status === 200 && (fEst.body.items || []).length >= 1, 'filtro ?tipo=estorno funciona');
  const origCheck = (await store.estoque2Mov.all({ limit: 'all' })).find(m => Number(m.id) === Number(alvoE.id));
  assert(origCheck && origCheck.estornado === true, 'original marcada estornada');
  const duplo = await post('/api/estoque2/estornar', { id: alvoE.id, motivo: 'tentativa dupla' });
  assert(duplo.status !== 200, 're-estorno da original bloqueado (usa-se a correção)');
  const duplo2 = await post('/api/estoque2/estornar', { id: est.body.estorno.mov.id, motivo: 'tentativa dupla 2' });
  assert(duplo2.status === 400, 'estorno de estorno: 400');

  console.log('\n=== ESTOQUE 2 — cache IA isolado por namespace ===');
  const cache = require('../src/lib/estoqueIA-core/cache');
  const a1 = await cache.getOrFetch('estoque', { x: 'nse2teste' }, () => Promise.resolve('MOD1'));
  const b1 = await cache.getOrFetch('estoque', { x: 'nse2teste' }, () => Promise.resolve('MOD2'), 'e2');
  const a2 = await cache.getOrFetch('estoque', { x: 'nse2teste' }, () => Promise.resolve('MOD1-B'));
  assert(a1 === 'MOD1' && b1 === 'MOD2' && a2 === 'MOD1', 'mesma query, namespaces distintos, sem vazamento');
}

main().then(() => {
  restoreDb();
  console.log(`\n=== RESULTADO: ${passed} passed, ${failed} failed ===`);
  server.close();
  process.exitCode = failed > 0 ? 1 : 0;
}).catch(e => {
  console.error(e);
  try { restoreDb(); server.close(); } catch (_) {}
  process.exit(1);
});
