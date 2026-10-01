const assert = require('assert');
const estoqueIA = require('../src/lib/estoqueIA');

const mockStore = {
  estoque: {
    all: async () => [
      { contrato: 'CE01', material: 'TZPR04', unidade: 'UMEPE Juazeiro', saldo: 10 },
      { contrato: 'CE01', material: 'UPR04', unidade: 'UMEPE Juazeiro', saldo: 5 },
      { contrato: 'CE01', material: 'FONTE04', unidade: 'UP-Cariri', saldo: 3 }
    ],
    alertas: async () => []
  },
  estoqueMov: {
    all: async () => [
      { tipo: 'saida', material: 'TZPR04', qtd: 2, createdAt: new Date().toISOString(), contrato: 'CE01', unidade: 'UMEPE Juazeiro' }
    ]
  },
  estoqueSerial: {
    all: async () => [],
    byContratoUnidade: async () => []
  },
  audit: {
    insert: async () => {},
    search: async () => ({ items: [] })
  },
  normalizeSistema: (s) => s?.toLowerCase() || null,
  normalizeContrato: (c) => c?.toUpperCase() || null
};

const CASOS = [
  { q: 'saldo TZPR04 CE01', expectIntent: 'saldo', desc: 'Saldo com material e contrato' },
  { q: 'quanto tempo vai durar o TZPR04', expectIntent: 'consumo', desc: 'Linguagem natural - duração (matched by ConsumoHandler)' },
  { q: 'preciso pedir mais TZPR04', expectIntent: 'precisa_pedir', desc: 'Linguagem natural - precisa pedir' },
  { q: 'o que está faltando', expectIntent: 'itens_em_falta', desc: 'Linguagem natural - itens em falta' },
  { q: 'tem TZPR04 em UMEPE Juazeiro', expectIntent: 'nao_entendi', desc: 'Linguagem natural - tem em (handler precisa de material extraído)' },
  { q: 'consumo médio 30 dias', expectIntent: 'media_consumo', desc: 'Consumo médio' },
  { q: 'saldo', expectIntent: 'saldo_ambiguo', desc: 'Saldo ambíguo sem contexto' },
  { q: 'estoque atual CE01', expectIntent: 'estoque_atual', desc: 'Estoque atual' },
  { q: 'unidades', expectIntent: 'unidades', desc: 'Lista de unidades' },
  // Testes de typo correction
  { q: 'saldo tzpr04 CE01', expectIntent: 'saldo', desc: 'Typo: tzpr04 minúsculo' },
  { q: 'consumo toronozeleira', expectIntent: 'consumo', desc: 'Typo: toronozeleira (matched by ConsumoHandler)' },
  { q: 'preciso pedir fnte', expectIntent: 'precisa_pedir', desc: 'Typo: fnte' }
];

async function runTests() {
  console.log('🧪 Testes de Regressão - Chat IA Estoque\n');
  let passou = 0;
  let falhou = 0;

  for (const caso of CASOS) {
    try {
      const result = await estoqueIA.answer(caso.q, mockStore, { user: 'teste' });
      
      if (result.intent === caso.expectIntent) {
        console.log(`✅ ${caso.desc}: "${caso.q}" → ${result.intent}`);
        passou++;
      } else {
        console.log(`❌ ${caso.desc}: "${caso.q}"`);
        console.log(`   Esperado: ${caso.expectIntent}`);
        console.log(`   Recebido: ${result.intent}`);
        falhou++;
      }
    } catch (e) {
      console.log(`❌ ${caso.desc}: ERRO - ${e.message}`);
      falhou++;
    }
  }

  console.log(`\n📊 Resultado: ${passou} passou, ${falhou} falhou`);
  
  if (falhou > 0) {
    process.exit(1);
  }
}

runTests().catch(e => {
  console.error('Erro fatal:', e);
  process.exit(1);
});
