const {
  answer,
  extractContrato, extractSistema, extractMaterial, extractUnidade,
  extractData, extractPeriodo, extractSerial, extractThreshold,
  normContrato, labelContrato, matTZPR, matsProntos, norm,
  invalidateCache, clearCache
} = require('../src/lib/estoqueIA');

// Mock store para testes
const mockStore = {
  normalizeSistema: (s) => s?.toLowerCase?.() || null,
  normalizeContrato: (c, s) => s === 'infinity' ? 'INF' : c?.toUpperCase?.() || null,
  contratoLabel: (c) => c === 'INF' ? 'Estoque Infinity' : c,
  estoque: {
    all: async () => [
      { contrato: 'CE01', material: 'TZPR04', unidade: 'UMEPE Juazeiro', saldo: 10 },
      { contrato: 'CE01', material: 'UPR04', unidade: 'UMEPE Juazeiro', saldo: 5 },
      { contrato: 'CE01', material: 'TZPR04', unidade: 'UP-Cariri', saldo: 3 },
      { contrato: 'CE01', material: 'FONTE04', unidade: 'UMEPE Juazeiro', saldo: 8 },
      { contrato: 'INF', material: 'TZPR', unidade: 'UMEPE Juazeiro', saldo: 7 }
    ],
    alertas: async () => ({ itens: [], criticos: 0 }),
    atDate: async (contrato, data, unidade) => [
      { contrato, material: 'TZPR04', unidade: unidade || 'UMEPE Juazeiro', saldo: 5 },
      { contrato, material: 'UPR04', unidade: unidade || 'UMEPE Juazeiro', saldo: 3 }
    ].filter(e => !unidade || e.unidade === unidade),
    atDateDetailed: async (contrato, data) => [
      { contrato, material: 'TZPR04', unidade: 'UMEPE Juazeiro', saldo: 5 },
      { contrato, material: 'UPR04', unidade: 'UP-Cariri', saldo: 2 }
    ],
    byContrato: async (contrato, sistema) => [
      { contrato, material: 'TZPR04', unidade: 'UMEPE Juazeiro', saldo: 10 },
      { contrato, material: 'UPR04', unidade: 'UMEPE Juazeiro', saldo: 5 }
    ],
    byContratoUnidade: async (contrato, unidade, sistema) => [
      { contrato, material: 'TZPR04', unidade, saldo: 10 },
      { contrato, material: 'UPR04', unidade, saldo: 5 }
    ]
  },
  estoqueMov: {
    all: async (opts = {}) => {
      const base = [
        { tipo: 'saida', qtd: 2, createdAt: new Date(Date.now() - 5*86400000).toISOString(), contrato: 'CE01', material: 'TZPR04', unidade: 'UMEPE Juazeiro', saldoAntes: 12, saldoDepois: 10, motivo: 'teste', userName: 'test' },
        { tipo: 'saida', qtd: 1, createdAt: new Date(Date.now() - 10*86400000).toISOString(), contrato: 'CE01', material: 'TZPR04', unidade: 'UMEPE Juazeiro', saldoAntes: 11, saldoDepois: 10, motivo: 'teste', userName: 'test' },
        { tipo: 'entrada', qtd: 5, createdAt: new Date(Date.now() - 2*86400000).toISOString(), contrato: 'CE01', material: 'FONTE04', unidade: 'UMEPE Juazeiro', saldoAntes: 3, saldoDepois: 8, motivo: 'recebimento', userName: 'test' }
      ];
      let result = base;
      if (opts.contrato) result = result.filter(m => m.contrato === opts.contrato);
      if (opts.material) result = result.filter(m => m.material === opts.material);
      if (opts.unidade) result = result.filter(m => m.unidade === opts.unidade);
      if (opts.limit && opts.limit !== 'all') result = result.slice(0, opts.limit);
      return result;
    }
  },
  estoqueSerial: {
    all: async (opts = {}) => {
      const base = [
        { serial: '4315023610', unidade: 'UMEPE Juazeiro', contrato: 'CE01', status: 'disponivel' },
        { serial: '4315023611', unidade: 'UMEPE Juazeiro', contrato: 'CE01', status: 'em_uso' },
        { serial: '4714569930', unidade: 'UP-Cariri', contrato: 'CE01', status: 'disponivel' }
      ];
      let result = base;
      if (opts.contrato) result = result.filter(s => s.contrato === opts.contrato);
      if (opts.unidade) result = result.filter(s => s.unidade === opts.unidade);
      return result;
    },
    byContratoUnidade: async (contrato, unidade) => [
      { serial: '4315023610', unidade: 'UMEPE Juazeiro', contrato: 'CE01', status: 'disponivel' },
      { serial: '4315023611', unidade: 'UMEPE Juazeiro', contrato: 'CE01', status: 'em_uso' }
    ].filter(s => s.contrato === contrato && s.unidade === unidade)
  },
  audit: {
    _contexts: {},
    insert: async (data) => {
      if (data.kind === 'ia_contexto') {
        mockStore.audit._contexts[data.byUser] = JSON.parse(data.summary);
      }
      return { id: 1 };
    },
    search: async ({ kind, user, limit }) => {
      if (kind === 'ia_contexto' && user && mockStore.audit._contexts[user]) {
        return { items: [{ summary: JSON.stringify(mockStore.audit._contexts[user]) }] };
      }
      return { items: [] };
    },
    remove: async () => {}
  }
};

async function runTests() {
  let passed = 0, failed = 0;

  function assert(condition, msg) {
    if (condition) { console.log('  ✅', msg); passed++; }
    else { console.log('  ❌', msg); failed++; }
  }

  console.log('\n=== TESTES EXTRACTORS ===');

  // extractContrato
  assert(extractContrato('saldo CE01 UMEPE') === 'CE01', 'extractContrato: CE01');
  assert(extractContrato('estoque CE02') === 'CE02', 'extractContrato: CE02');
  assert(extractContrato('Infinity') === 'INF', 'extractContrato: INF');
  assert(extractContrato('ESTOQUE INFINITY') === 'INF', 'extractContrato: ESTOQUE INFINITY');
  assert(extractContrato('saldo TZPR04') === null, 'extractContrato: null sem contrato');

  // extractSistema
  assert(extractSistema('infinity') === 'infinity', 'extractSistema: infinity');
  assert(extractSistema('INFINITO') === 'infinity', 'extractSistema: infinito');
  assert(extractSistema('spacecom') === 'spacecom', 'extractSistema: spacecom');
  assert(extractSistema('SPC') === 'spacecom', 'extractSistema: spc');
  assert(extractSistema('ambos') === null, 'extractSistema: null para ambos');

  // extractMaterial
  assert(extractMaterial('saldo TZPR04') === 'TZPR04', 'extractMaterial: TZPR04');
  assert(extractMaterial('tornozeleira') === 'TZPR04', 'extractMaterial: alias tornozeleira');
  assert(extractMaterial('upr') === 'UPR04', 'extractMaterial: upr');
  assert(extractMaterial('fonte') === 'FONTE04', 'extractMaterial: fonte');
  assert(extractMaterial('cinta') === 'CINTA', 'extractMaterial: cinta');
  assert(extractMaterial('trava') === 'TRAVAS', 'extractMaterial: trava');
  assert(extractMaterial('xyz') === null, 'extractMaterial: null inválido');

  // extractUnidade
  assert(extractUnidade('UMEPE Juazeiro') === 'UMEPE Juazeiro', 'extractUnidade: UMEPE Juazeiro');
  assert(extractUnidade('UP-Cariri') === 'UP-Cariri', 'extractUnidade: UP-Cariri');
  assert(extractUnidade('forum de crato') === 'Fórum de Crato', 'extractUnidade: forum de crato');
  assert(extractUnidade('jardim') === 'Fórum de Jardim', 'extractUnidade: jardim');
  assert(extractUnidade('xyz') === null, 'extractUnidade: null inválido');

  // extractData
  assert(extractData('2026-09-27') === '2026-09-27', 'extractData: ISO');
  assert(extractData('27/09/2026') === '2026-09-27', 'extractData: BR');
  assert(extractData('hoje') === new Date().toISOString().slice(0,10), 'extractData: hoje');
  assert(extractData('ontem').length === 10, 'extractData: ontem');

  // extractPeriodo
  assert(extractPeriodo('últimos 7 dias') === 7, 'extractPeriodo: 7 dias');
  assert(extractPeriodo('últimos 30 dias') === 30, 'extractPeriodo: 30 dias');
  assert(extractPeriodo('esta semana') === 7, 'extractPeriodo: esta semana');
  assert(extractPeriodo('este mes') === 30, 'extractPeriodo: este mes');

  // extractSerial
  assert(extractSerial('serial 4315023610') === '4315023610', 'extractSerial: exato');
  assert(extractSerial('buscar 4315') === '4315', 'extractSerial: parcial com buscar');
  assert(extractSerial('4315023610') === '4315023610', 'extractSerial: só número');

  // extractThreshold
  assert(extractThreshold('abaixo de 10', 'TZPR04') === 10, 'extractThreshold: abaixo de');
  assert(extractThreshold('menor que 5', 'TZPR04') === 5, 'extractThreshold: menor que');
  assert(extractThreshold('estoque baixo', 'TZPR04') === 5, 'extractThreshold: baixo usa limite');

  // normContrato
  assert(normContrato('ce01', 'spacecom', mockStore) === 'CE01', 'normContrato: spacecom');
  assert(normContrato('INF', 'infinity', mockStore) === 'INF', 'normContrato: infinity');
  assert(normContrato('ce01', 'infinity', mockStore) === 'INF', 'normContrato: infinity força INF');

  // labelContrato
  assert(labelContrato('CE01', mockStore) === 'CE01', 'labelContrato: CE01');
  assert(labelContrato('INF', mockStore) === 'Estoque Infinity', 'labelContrato: INF');

  // matTZPR / matsProntos
  assert(matTZPR('infinity') === 'TZPR', 'matTZPR: infinity');
  assert(matTZPR('spacecom') === 'TZPR04', 'matTZPR: spacecom');
  assert(matsProntos('infinity').join(',') === 'TZPR', 'matsProntos: infinity');
  assert(matsProntos('spacecom').join(',') === 'TZPR04,UPR04', 'matsProntos: spacecom');

  // norm
  assert(norm('ÚLTIMOS 7 DIAS') === 'ultimos 7 dias', 'norm: remove acentos e lower');

  console.log('\n=== TESTES INTENTS (answer) ===');

  // Testes de intents principais
  const r1 = await answer('estoque atual CE01 UMEPE Juazeiro', mockStore, { user: 'test1' });
  assert(r1.intent === 'estoque_atual', 'intent: estoque_atual');
  assert(r1.text.includes('TZPR04'), 'estoque_atual: menciona TZPR04');

  const r2 = await answer('média de consumo mensal CE01', mockStore, { user: 'test2' });
  assert(r2.intent === 'media_consumo', 'intent: media_consumo');

  const r3 = await answer('necessidade de reposição CE01', mockStore, { user: 'test3' });
  assert(r3.intent === 'reposicao_seguranca', 'intent: reposicao_seguranca');

  const r4 = await answer('reposição CE01', mockStore, { user: 'test4' });
  assert(r4.intent === 'reposicao', 'intent: reposicao');

  const r5 = await answer('comparar UMEPE vs UP-Cariri CE01', mockStore, { user: 'test5' });
  assert(r5.intent === 'comparar', 'intent: comparar');

  const r6 = await answer('consumo TZPR04 CE01', mockStore, { user: 'test6' });
  assert(r6.intent === 'consumo', 'intent: consumo');

  const r7 = await answer('ficha TZPR04 UMEPE Juazeiro', mockStore, { user: 'test7' });
  assert(r7.intent === 'ficha', 'intent: ficha');

  const r8 = await answer('histórico ontem CE01', mockStore, { user: 'test8' });
  assert(r8.intent === 'historico', 'intent: historico');

  const r9 = await answer('movimentações hoje', mockStore, { user: 'test9' });
  assert(r9.intent === 'movs', 'intent: movs');

  const r10 = await answer('seriais CE01', mockStore, { user: 'test10' });
  assert(r10.intent === 'seriais', 'intent: seriais');

  const r11 = await answer('buscar serial 4315023610', mockStore, { user: 'test11' });
  assert(r11.intent === 'serial', 'intent: serial exato');
  assert(r11.data.found === true, 'serial: encontrado');

  const r12 = await answer('ranking TZPR04 CE01', mockStore, { user: 'test12' });
  assert(r12.intent === 'ranking', 'intent: ranking');

  const r13 = await answer('alertas CE01', mockStore, { user: 'test13' });
  assert(r13.intent === 'baixo', 'intent: baixo/alertas');

  const r14 = await answer('unidades', mockStore, { user: 'test14' });
  assert(r14.intent === 'unidades', 'intent: unidades');

  const r15 = await answer('saldo total', mockStore, { user: 'test15' });
  assert(r15.intent === 'saldo', 'intent: saldo geral');

  const r16 = await answer('ajuda', mockStore, { user: 'test16' });
  assert(r16.intent === 'help', 'intent: help');

  // Novos intents avançados
  const r17 = await answer('previsão ruptura TZPR04 UMEPE 30 dias', mockStore, { user: 'test17' });
  assert(r17.intent === 'previsao_ruptura', 'intent: previsao_ruptura');

  const r18 = await answer('sugestão pedido compra CE01 próximo mês', mockStore, { user: 'test18' });
  assert(r18.intent === 'sugestao_compra', 'intent: sugestao_compra');

  const r19 = await answer('transferência sugerida UMEPE → UP-Cariri', mockStore, { user: 'test19' });
  assert(r19.intent === 'transferencia_sugerida', 'intent: transferencia_sugerida');

  // Contexto follow-up
  await answer('saldo TZPR04 UMEPE CE01', mockStore, { user: 'ctx_test' });
  const r20 = await answer('e UPR?', mockStore, { user: 'ctx_test' });
  assert(r20.intent === 'saldo' && r20.text.includes('UPR04'), 'contexto follow-up: e UPR?');

  // Infinity normaliza TZPR04→TZPR
  const r21 = await answer('saldo TZPR04', mockStore, { user: 'inf_test', sistema: 'infinity' });
  assert(r21.data?.material === 'TZPR' || r21.text.includes('TZPR'), 'infinity: normaliza TZPR04→TZPR');

  console.log(`\n=== RESULTADO: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exitCode = 1;
}

runTests().catch(e => { console.error(e); process.exit(1); });