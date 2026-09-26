// =====================================================================
//  Seed massivo de estoque — até 300 dias de histórico em TODAS as
//  unidades (6 locais), nos dois sistemas (Spacecom CE01/CE02 e
//  Infinity INF), com:
//    • adições (recebimento de lote) por local;
//    • transferências de material ENTRE os locais;
//    • saídas (instalação, troca, uso em manutenção);
//    • seriais de TZPR04/UPR04 criados e rastreados em cada operação.
//
//  Uso:
//    node scripts/seed-estoque-60d.js                 # 60 dias (padrão)
//    node scripts/seed-estoque-60d.js --dias=300      # até 300 dias, todas as unidades
//    node scripts/seed-estoque-60d.js --dias=30       # janela menor
//    node scripts/seed-estoque-60d.js --seed=7        # outro histórico
//    node scripts/seed-estoque-60d.js --sem-lote      # só movimentações
//    node scripts/seed-estoque-60d.js --dry           # simula, não grava
//  (atalho: npm run seed:estoque)
//
//  O gerador fica em src/lib/estoqueSeed.js e é o MESMO usado pelo
//  endpoint admin POST /api/estoque/seed — logo funciona igual em modo
//  arquivo (db.json) e no Supabase, sem pós-patch do db.json.
//
//  Em modo arquivo, pare o servidor antes de rodar (ele mantém o db.json
//  em memória e sobrescreveria o que for gravado aqui).
// =====================================================================
const { popularEstoque } = require('../src/lib/estoqueSeed');

const argv = process.argv.slice(2);
const argNum = (nome, padrao) => {
  const a = argv.find(x => x.startsWith('--' + nome + '='));
  const v = a ? Number(a.split('=')[1]) : NaN;
  return Number.isFinite(v) ? v : padrao;
};

popularEstoque({
  dias: argNum('dias', 60),
  semente: argNum('seed', 20260925),
  semLote: argv.includes('--sem-lote'),
  dry: argv.includes('--dry'),
  log: console.log,
}).then(rel => {
  if (rel.transferenciasPorPar.length) {
    console.log('\nTransferências por par de locais (origem → destino):');
    rel.transferenciasPorPar.forEach(t => console.log(`  ${t.par}: ${t.total}`));
  }
  console.log(`\nLocais com saldo: ${rel.locaisComSaldo}/${rel.porUnidade.length} | saldos negativos: ${rel.negativos}${rel.dry ? ' — DRY-RUN, nada foi gravado.' : ''}`);
}).catch(e => { console.error(e); process.exit(1); });
