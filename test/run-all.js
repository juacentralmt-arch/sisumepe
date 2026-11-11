// =====================================================================
//  Runner de todas as suítes — mesma lista do script "test", mas sem
//  mascarar falhas: o encadeamento com `&&` parava na 1ª suíte com
//  falha e escondia o restante (foi assim que o crash do AutoRenomear
//  passou despercebido). Aqui cada suíte roda isolada e o resumo
//  final lista quem falhou. Saída 1 se qualquer suíte falhar.
// =====================================================================
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const suites = [
  'test/assistidos.test.js',
  'test/assistidos.auditoria.test.js',
  'test/assistidos.conferencia.test.js',
  'test/assistidos.import.test.js',
  'test/audit.chain.test.js',
  'test/psi.routes.test.js',
  'test/estoqueSeedGating.test.js',
  'test/estoqueIA.test.js',
  'test/estoqueIA.regressao.test.js',
  'test/estoqueIA.ativacoes.test.js',
  'test/autoRenomear.test.js',
  'test/ocrServidor.test.js',
  'test/ocrNuvem.test.js',
  'test/autorenomearOcr.test.js',
  'test/termos.routes.test.js',
  'test/termos.historico.test.js',
  'test/tickets.audio.test.js',
  'test/tickets.anexos.test.js',
  'test/pdfTools.test.js',
  'test/tickets.edit.test.js',
  'test/fila.render.test.js',
  'test/admin.dashboard.test.js',
  'test/estoqueFluxo.test.js',
  'test/estoqueConciliacao.test.js',
  'test/estoqueTransferForcado.test.js',
  'test/estoqueNotas.test.js',
  'test/estoqueFechamentoFuso.test.js',
  'test/estoqueMotivoAuto.test.js',
  'test/estoqueKitSemFonte.test.js',
  'test/estoqueEstornoKit.test.js',
  'test/estoque.estorno.test.js',
];

// Isola cada suíte: copia o db.json para um diretório temporário e aponta
// DB_FILE para a cópia. Assim os testes não alteram o banco de desenvolvimento
// e não compartilham estado entre si.
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sisumepe-test-'));
const originalDb = path.join(__dirname, '..', 'db.json');
const template = path.join(tmpRoot, 'db-template.json');
const hasOriginalDb = fs.existsSync(originalDb);
if (hasOriginalDb) fs.copyFileSync(originalDb, template);

const failed = [];
for (const s of suites) {
  console.log(`\n########## ${s} ##########`);
  const dbFile = path.join(tmpRoot, path.basename(s, '.js') + '.db.json');
  if (hasOriginalDb) fs.copyFileSync(template, dbFile);
  const env = { ...process.env, DB_FILE: dbFile };
  const r = spawnSync(process.execPath, [s], { stdio: 'inherit', env });
  if (r.status !== 0 || r.error) failed.push(`${s} (exit ${r.error ? 'erro: ' + r.error.message : r.status})`);
}
fs.rmSync(tmpRoot, { recursive: true, force: true });

console.log('\n==================== RESUMO ====================');
console.log(`Suítes: ${suites.length} | OK: ${suites.length - failed.length} | Falha: ${failed.length}`);
failed.forEach(f => console.log('  ❌', f));
process.exit(failed.length ? 1 : 0);
