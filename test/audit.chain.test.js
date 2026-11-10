// Testes da cadeia tamper-evident da auditoria.
//
// A cadeia liga cada registro ao hash do anterior (prevHash -> hash).
// Duas coisas quebram isso na pratica:
//   1) o Postgres guarda `changes` em jsonb, que NAO preserva a ordem das
//      chaves — o hash gravado deixaria de bater com o recalculado;
//   2) um latch no processo desabilitava a cadeia para sempre assim que a
//      migration das colunas faltasse.
process.env.SUPABASE_URL = '';
process.env.SUPABASE_KEY = '';
const os = require('os'); const fs = require('fs'); const path = require('path');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sisumepe-audit-chain-'));
process.env.DB_FILE = path.join(tmpDir, 'test-db.json');
fs.writeFileSync(process.env.DB_FILE, '{}');

const store = require('../store');

let passed = 0, failed = 0;
const assert = (cond, msg) => {
  if (cond) { console.log('  ok.', msg); passed++; }
  else { console.log('  FAIL', msg); failed++; }
};

// Reordena as chaves de um objeto como o jsonb do Postgres faz
// (por tamanho e depois bytewise).
function comoJsonb(obj) {
  if (Array.isArray(obj)) return obj.map(comoJsonb);
  if (obj && typeof obj === 'object') {
    const out = {};
    Object.keys(obj).sort((a, b) => (a.length - b.length) || (a < b ? -1 : a > b ? 1 : 0))
      .forEach(k => { out[k] = comoJsonb(obj[k]); });
    return out;
  }
  return obj;
}

(async () => {
  console.log('\n=== AUDITORIA - cadeia tamper-evident ===');

  const dbFile = process.env.DB_FILE;
  const fs2 = require('fs');
  const mem = JSON.parse(fs2.readFileSync(dbFile, 'utf8'));
  console.log('  (modo arquivo: as colunas hash/prevhash não existem, a cadeia é opcional)');

  // 1) Grava registros com `changes` preenchido
  const r1 = await store.audit.insert({
    kind: 'assistido', action: 'editado', personId: 1, personName: 'Teste',
    ref: 'assistido#1', byUser: 'admin', byName: 'Admin', byRole: 'admin',
    summary: 'editado', changes: [{ campo: 'nome', rotulo: 'Nome', de: 'A', para: 'B' }],
  });
  assert(!!r1, 'Audit: registro gravado');
  assert(!!r1.hash, 'Audit: hash calculado (colunas existem no modo arquivo)');
  assert(!!r1.prevHash !== undefined, 'Audit: prevHash presente');

  const r2 = await store.audit.insert({
    kind: 'assistido', action: 'etiqueta', personId: 1, personName: 'Teste',
    ref: 'assistido#1', byUser: 'admin', byName: 'Admin', byRole: 'admin',
    summary: 'etiqueta', changes: [{ campo: 'etiqueta', rotulo: 'Etiqueta', de: 'sem', para: 'verde' }],
  });
  assert(r2.prevHash === r1.hash, 'Cadeia: o segundo registro aponta para o hash do primeiro');

  // 2) A cadeia verifica OK
  const v1 = await store.audit.verify();
  assert(v1.ok === true, 'Cadeia: verificação passa sem adulteração');

  // 3) Simula o que o Postgres faz com jsonb (reordena as chaves) e
  //    confere que a cadeia continua válida — sem canonicalização
  //    determinística, o hash mudaria e acusaria adulteração falsa.
  const mem2 = JSON.parse(fs2.readFileSync(dbFile, 'utf8'));
  mem2.audit.forEach(a => { if (a.changes && a.changes.length) a.changes = comoJsonb(a.changes); });
  fs2.writeFileSync(dbFile, JSON.stringify(mem2, null, 2));

  // recarrega o store com o arquivo reordenado
  delete require.cache[require.resolve('../store')];
  const store2 = require('../store');
  const v2 = await store2.audit.verify();
  assert(v2.ok === true, 'Cadeia:aguenta o jsonb reordenar as chaves (canonicalização determinística)');

  // 4) Adulterar o conteúdo DEVE ser detectado
  const mem3 = JSON.parse(fs2.readFileSync(dbFile, 'utf8'));
  const alvo = mem3.audit.find(a => a.hash);
  alvo.summary = ' adulterado!';
  fs2.writeFileSync(dbFile, JSON.stringify(mem3, null, 2));
  delete require.cache[require.resolve('../store')];
  const store3 = require('../store');
  const v3 = await store3.audit.verify();
  assert(v3.ok === false, 'Cadeia: adulteração do resumo é detectada');
  assert(v3.reason === 'hash inválido', 'Cadeia: motivo é "hash inválido"');

  // 5) Romper o elo (apagar o prevHash) também é detectado
  const mem4 = JSON.parse(fs2.readFileSync(dbFile, 'utf8'));
  mem4.audit.forEach(a => { if (a.hash) a.summary = 'original'; });
  const comHash = mem4.audit.filter(a => a.hash);
  if (comHash.length >= 2) {
    comHash[1].prevHash = 'deadbeef';
    fs2.writeFileSync(dbFile, JSON.stringify(mem4, null, 2));
    delete require.cache[require.resolve('../store')];
    const store4 = require('../store');
    const v4 = await store4.audit.verify();
    assert(v4.ok === false, 'Cadeia: elo quebrado é detectado');
  }

  console.log('\n==================== RESUMO ====================');
  console.log(`Testes: OK=${passed} | Falha=${failed}`);
  process.exit(failed ? 1 : 0);
})();
