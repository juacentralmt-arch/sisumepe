// Testes da cadeia tamper-evident da auditoria.
//
// A cadeia liga cada registro ao hash do anterior (prevHash -> hash).
// Tres coisas quebram isso na pratica:
//   1) o Postgres guarda `changes` em jsonb, que NAO preserva a ordem das
//      chaves — o hash gravado deixaria de bater com o recalculado;
//   2) o Postgres devolve timestamptz com offset ('+00:00'), mas na
//      gravacao o `at` e um ISO com 'Z' — mesmo instante, string diferente;
//   3) um latch no processo desabilitava a cadeia para sempre assim que a
//      migration das colunas faltasse.
process.env.SUPABASE_URL = '';
process.env.SUPABASE_KEY = '';
const os = require('os'); const fs = require('fs'); const path = require('path');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sisumepe-audit-chain-'));
process.env.DB_FILE = path.join(tmpDir, 'test-db.json');
fs.writeFileSync(process.env.DB_FILE, '{}');

const store = require('../store');
const dbFile = process.env.DB_FILE;

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

const ler = () => JSON.parse(fs.readFileSync(dbFile, 'utf8'));
const gravar = (mem) => fs.writeFileSync(dbFile, JSON.stringify(mem, null, 2));
const recarregar = () => {
  delete require.cache[require.resolve('../store')];
  return require('../store');
};

(async () => {
  console.log('\n=== AUDITORIA - cadeia tamper-evident ===');
  console.log('  (modo arquivo: as colunas hash/prevhash nao existem no schema, a cadeia e opcional)');

  // 1) Grava registros com `changes` preenchido
  const r1 = await store.audit.insert({
    kind: 'assistido', action: 'editado', personId: 1, personName: 'Teste',
    ref: 'assistido#1', byUser: 'admin', byName: 'Admin', byRole: 'admin',
    summary: 'editado', changes: [{ campo: 'nome', rotulo: 'Nome', de: 'A', para: 'B' }],
  });
  assert(!!r1.hash, 'Audit: hash calculado');
  assert(r1.prevHash !== undefined, 'Audit: prevHash presente');

  const r2 = await store.audit.insert({
    kind: 'assistido', action: 'etiqueta', personId: 1, personName: 'Teste',
    ref: 'assistido#1', byUser: 'admin', byName: 'Admin', byRole: 'admin',
    summary: 'etiqueta', changes: [{ campo: 'etiqueta', rotulo: 'Etiqueta', de: 'sem', para: 'verde' }],
  });
  assert(r2.prevHash === r1.hash, 'Cadeia: o segundo registro aponta para o hash do primeiro');

  // um terceiro registro: sem ele nao da para testar remocao no meio
  const r3 = await store.audit.insert({
    kind: 'assistido', action: 'juntada', personId: 1, personName: 'Teste',
    ref: 'comparecimento#1', byUser: 'admin', byName: 'Admin', byRole: 'admin',
    summary: 'juntada', changes: [{ campo: 'juntada', rotulo: 'Juntada', de: '', para: '999' }],
  });
  assert(r3.prevHash === r2.hash, 'Cadeia: o terceiro registro aponta para o hash do segundo');

  // 2) A cadeia verifica OK
  let v = await store.audit.verify();
  assert(v.ok === true, 'Cadeia: verificacao passa sem adulteracao');

  // guarda o estado integro para os testes de adulteracao
  const integro = fs.readFileSync(dbFile, 'utf8');

  // 3) Simula o que o Postgres faz com jsonb (reordena as chaves)
  {
    const mem = ler();
    mem.audit.forEach(a => { if (a.changes && a.changes.length) a.changes = comoJsonb(a.changes); });
    gravar(mem);
    const s = recarregar();
    v = await s.audit.verify();
    assert(v.ok === true, 'Cadeia: aguenta o jsonb reordenar as chaves (canonicalizacao deterministica)');
  }

  // 4) Simula o Postgres reescrever o instante com offset
  {
    fs.writeFileSync(dbFile, integro);
    const mem = ler();
    mem.audit.forEach(a => { if (a.at) a.at = new Date(a.at).toISOString().replace('Z', '+00:00'); });
    gravar(mem);
    const s = recarregar();
    v = await s.audit.verify();
    assert(v.ok === true, 'Cadeia: aguenta o Postgres reescrever o instante (ISO Z vs +00:00)');
  }

  // 5) Adulterar o conteúdo DEVE ser detectado
  {
    fs.writeFileSync(dbFile, integro);
    const mem = ler();
    mem.audit.find(a => a.hash).summary = ' adulterado!';
    gravar(mem);
    const s = recarregar();
    v = await s.audit.verify();
    assert(v.ok === false, 'Cadeia: adulteracao do resumo e detectada');
    assert(v.reason === 'hash invalido' || v.reason === 'hash inválido', 'Cadeia: motivo e "hash invalido"');
  }

  // 6) Romper o elo (trocar o prevHash) também é detectado
  {
    fs.writeFileSync(dbFile, integro);
    const mem = ler();
    const comHash = mem.audit.filter(a => a.hash);
    if (comHash.length >= 2) {
      comHash[1].prevHash = 'deadbeef';
      gravar(mem);
      const s = recarregar();
      v = await s.audit.verify();
      assert(v.ok === false, 'Cadeia: elo quebrado e detectado');
    } else {
      assert(true, 'Cadeia: elo quebrado (poucos registros com hash, pulado)');
    }
  }

  // 7) Apagar um registro do MEIO também quebra a cadeia
  //    (remover o último é indetectável por natureza: uma cadeia
  //     append-only não tem âncora externa para conferir a cauda)
  {
    fs.writeFileSync(dbFile, integro);
    const mem = ler();
    const comHash = mem.audit.filter(a => a.hash);
    if (comHash.length >= 3) {
      mem.audit = mem.audit.filter(a => a.id !== comHash[1].id);
      gravar(mem);
      const s = recarregar();
      v = await s.audit.verify();
      assert(v.ok === false, 'Cadeia: remocao de registro do meio e detectada');
    } else {
      assert(true, 'Cadeia: remocao de registro (poucos registros com hash, pulado)');
    }
  }

  console.log('\n==================== RESUMO ====================');
  console.log(`Testes: OK=${passed} | Falha=${failed}`);
  process.exit(failed ? 1 : 0);
})();
