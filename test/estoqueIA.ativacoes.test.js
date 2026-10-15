// =====================================================================
//  IA — Ativações por destino + consumo tzpr/upr em linguagem natural:
//  - "quantas ativações tiveram de réu solto, núcleo de custódia?"
//  - "consumo médio de tzpr/upr nos últimos 30 dias" (tzpr->TZPR04)
//  Usa deltas (antes/depois) para não depender do estado do banco.
// =====================================================================
let passed = 0, failed = 0;
const assert = (cond, msg) => {
  if (cond) { console.log('  ✅', msg); passed++; }
  else { console.log('  ❌', msg); failed++; }
};

process.env.SUPABASE_URL = '';
process.env.SUPABASE_KEY = '';

const ia = require('../src/lib/estoqueIA');
const store = require('../store');
const OPTS = { sistema: 'spacecom', user: 'teste-ia-ativ' };

async function ask(q, st, opts) {
  return ia.answer(q, st || store, { sistema: 'spacecom', user: 'teste-ia-ativ', ...(opts || {}) });
}
async function totais(q) {
  const r = await ask(q);
  return { intent: r.intent, total: r.data ? r.data.totalAtivacoes : null, data: r.data, text: r.text };
}

async function main() {
  console.log('\n=== IA — consumo tzpr/upr ===');
  const c1 = await ask('Consumo médio de tzpr nos ultimos 30 dias?');
  assert(c1.intent === 'media_consumo', 'tzpr: intent media_consumo');
  assert(/TZPR04/.test(c1.text || ''), 'tzpr sozinho vale TZPR04 no spacecom');
  const c2 = await ask('Consumo médio de upr nos ultimos 30 dias?');
  assert(c2.intent === 'media_consumo', 'upr: intent media_consumo');
  assert(/UPR04/.test(c2.text || ''), 'upr vale UPR04');

  console.log('\n=== IA — ativações por destino ===');
  const base = await totais('quantas ativações tiveram?');
  assert(base.intent === 'ativacoes', 'pergunta genérica: intent ativacoes');

  // lastro + 3 ativações de teste (CINTA dispensa serial)
  await store.estoque.adjust({ sistema: 'spacecom', contrato: 'CE01', material: 'CINTA', unidade: 'UMEPE Juazeiro', qtd: 10, motivo: 'setup teste ia ativacoes', user: 'teste-ia-ativ' });
  const mk = (qtd, dest) => store.estoque.adjust({ sistema: 'spacecom', contrato: 'CE01', material: 'CINTA', unidade: 'UMEPE Juazeiro', qtd: -qtd, motivo: `[ATIVACAO] ${dest}`, user: 'teste-ia-ativ' });
  await mk(2, 'Réu Solto');
  await mk(3, 'Réu Solto');
  await mk(1, 'Núcleo de Custódia');
  // o cache da IA (30s) ainda guarda o baseline vazio — invalida p/ ler o novo
  require('../src/lib/estoqueIA-core/cache').invalidate('ativacoes');

  const r = await totais('quantas ativações tiveram de réu solto, núcleo de custódia?');
  assert(r.intent === 'ativacoes', 'pergunta combinada: intent ativacoes');
  assert(r.total === (base.total || 0) + 3, `total +3 (${base.total} -> ${r.total})`);
  const por = Object.fromEntries((r.data.porDestino || []).map(x => [x.destino, x]));
  const bRS = (base.data.porDestino || []).find(x => x.destino === 'Réu Solto');
  const bNC = (base.data.porDestino || []).find(x => x.destino === 'Núcleo de Custódia');
  assert((por['Réu Solto'] ? por['Réu Solto'].ativacoes : 0) === (bRS ? bRS.ativacoes : 0) + 2, 'réu solto +2');
  assert((por['Núcleo de Custódia'] ? por['Núcleo de Custódia'].ativacoes : 0) === (bNC ? bNC.ativacoes : 0) + 1, 'núcleo +1');

  const f = await totais('ativações núcleo de custódia últimos 7 dias');
  assert(f.intent === 'ativacoes', 'filtro destino: intent ativacoes');
  assert((f.data.porDestino || []).length === 1 && f.data.porDestino[0].destino === 'Núcleo de Custódia', 'filtro núcleo: só 1 destino');

  // escopo Estoque 2: mesmo handler, sem crash (lê as coleções e2)
  const scoped = Object.assign({}, store, { estoque: store.estoque2, estoqueMov: store.estoque2Mov, estoqueSerial: store.estoque2Serial });
  const e2 = await ask('quantas ativações tiveram?', scoped, { ns: 'e2' });
  assert(e2.intent === 'ativacoes', 'escopo e2: intent ativacoes');

  // limpeza: desfaz o lastro e as ativações (estorno é neutro; ficam só linhas)
  const movs = await store.estoqueMov.all({ limit: 'all' });
  for (const m of movs.filter(x => ['setup teste ia ativacoes', '[ATIVACAO] Réu Solto', '[ATIVACAO] Núcleo de Custódia'].includes(x.motivo) && !x.estornado)) {
    try { await store.estoque.estornar(m.id, { motivo: 'limpeza teste ia', user: 'teste-ia-ativ' }); } catch (e) {}
  }
  console.log('  (limpeza: movs de teste estornados)');
}

main().then(() => {
  console.log(`\n=== RESULTADO: ${passed} passed, ${failed} failed ===`);
  process.exitCode = failed > 0 ? 1 : 0;
}).catch(e => {
  console.error(e);
  process.exit(1);
});
