// Clona os DADOS do Estoque 1 para o Estoque 2 (arquivo local db.json):
// saldos + movimentações + seriais, com os mesmos ids/datas/histórico.
// Substitui o conteúdo atual do Estoque 2 (espelho fiel, não soma).
// Backup automático em %TEMP% antes de gravar.
//
// USO (com o servidor PARADO — ele mantém o banco na RAM):
//   node scripts/clonar-estoque-para-estoque2.js [--dry]
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DB = path.join(ROOT, 'db.json');
const dry = process.argv.includes('--dry');

function main() {
  if (!fs.existsSync(DB)) throw new Error('db.json não encontrado');
  const bak = path.join(
    process.env.TEMP || require('os').tmpdir(),
    `db-antes-clone-e2-${Date.now()}.json`
  );
  const mem = JSON.parse(fs.readFileSync(DB, 'utf8'));
  for (const k of ['estoque', 'estoqueMov', 'estoqueSerial']) {
    if (!Array.isArray(mem[k])) throw new Error(`db.json sem ${k}`);
  }
  const copia = a => JSON.parse(JSON.stringify(a));
  const n1 = { saldos: mem.estoque.length, movs: mem.estoqueMov.length, seriais: mem.estoqueSerial.length };
  const antes2 = { saldos: (mem.estoque2 || []).length, movs: (mem.estoque2Mov || []).length, seriais: (mem.estoque2Serial || []).length };
  const mx = a => a.reduce((m, x) => Math.max(m, Number(x.id) || 0), 0);

  console.log(`Estoque 1: ${n1.saldos} saldos, ${n1.movs} movs, ${n1.seriais} seriais`);
  console.log(`Estoque 2 (atual, será substituído): ${antes2.saldos} saldos, ${antes2.movs} movs, ${antes2.seriais} seriais`);
  if (dry) { console.log('DRY-RUN — nada gravado'); return; }

  fs.writeFileSync(bak, JSON.stringify(mem));
  console.log('Backup em: ' + bak);

  mem.estoque2 = copia(mem.estoque);
  mem.estoque2Mov = copia(mem.estoqueMov);
  mem.estoque2Serial = copia(mem.estoqueSerial);
  mem.seqEstoque2 = mx(mem.estoque2) + 1;
  mem.seqEstoque2Mov = mx(mem.estoque2Mov) + 1;
  mem.seqEstoque2Serial = mx(mem.estoque2Serial) + 1;

  const tmp = DB + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(mem, null, 2));
  fs.renameSync(tmp, DB);
  console.log(`Estoque 2 agora: ${mem.estoque2.length} saldos, ${mem.estoque2Mov.length} movs, ${mem.estoque2Serial.length} seriais`);
  console.log('OK — suba o servidor para carregar.');
}

try { main(); } catch (e) { console.error('FALHA: ' + e.message); process.exit(1); }
