// =====================================================================
//  Runner de todas as suítes — mesma lista do script "test", mas sem
//  mascarar falhas: o encadeamento com `&&` parava na 1ª suíte com
//  falha e escondia o restante (foi assim que o crash do AutoRenomear
//  passou despercebido). Aqui cada suíte roda isolada e o resumo
//  final lista quem falhou. Saída 1 se qualquer suíte falhar.
// =====================================================================
const { spawnSync } = require('child_process');

const suites = [
  'test/estoqueIA.test.js',
  'test/autoRenomear.test.js',
  'test/ocrServidor.test.js',
  'test/autorenomearOcr.test.js',
  'test/termos.routes.test.js',
  'test/tickets.audio.test.js',
  'test/pdfTools.test.js',
  'test/tickets.edit.test.js',
  'test/admin.dashboard.test.js',
  'test/estoqueFluxo.test.js',
  'test/estoqueConciliacao.test.js'
];

const failed = [];
for (const s of suites) {
  console.log(`\n########## ${s} ##########`);
  const r = spawnSync(process.execPath, [s], { stdio: 'inherit' });
  if (r.status !== 0 || r.error) failed.push(`${s} (exit ${r.error ? 'erro: ' + r.error.message : r.status})`);
}

console.log('\n==================== RESUMO ====================');
console.log(`Suítes: ${suites.length} | OK: ${suites.length - failed.length} | Falha: ${failed.length}`);
failed.forEach(f => console.log('  ❌', f));
process.exit(failed.length ? 1 : 0);
