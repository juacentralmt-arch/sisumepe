// =====================================================================
//  Testes da conciliação saldo × seriais + cadastro avulso + filtro OUTROS.
//  O cadastro avulso escreve no db.json local: os seriais de teste são
//  removidos ao final (finally), mesmo se algum assert falhar.
//  Script puro (sem framework), no estilo das demais suítes do projeto.
// =====================================================================
let passed = 0, failed = 0;
const assert = (cond, msg) => {
  if (cond) { console.log('  ✅', msg); passed++; }
  else { console.log('  ❌', msg); failed++; }
};

process.env.SUPABASE_URL = '';
process.env.SUPABASE_KEY = '';

const fs = require('fs');
const path = require('path');
const express = require('express');
const shared = require('../src/lib/shared');
shared.auth = (roles) => (req, res, next) => {
  if (!req.auth) return res.status(401).json({ error: 'sem auth (teste)' });
  if (roles && roles.length && !roles.includes(req.auth.role)) return res.status(403).json({ error: 'Acesso restrito ao seu perfil.' });
  next();
};
const estoqueRouter = require('../src/routes/estoque');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use((req, res, next) => {
  req.auth = { role: 'tecnico', user: 'tec1', name: 'Tec Um', sistema: 'spacecom', token: 't' };
  next();
});
app.use(estoqueRouter);

const server = app.listen(0);
const BASE = 'http://127.0.0.1:' + server.address().port;
const get = async (p) => {
  const r = await fetch(BASE + p);
  return { status: r.status, body: await r.json().catch(() => null) };
};
const post = async (p, body) => {
  const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};

const TEST_SERIAIS = ['4310000001', '4310000002'];
function limparTeste() {
  try {
    const dbPath = path.join(__dirname, '..', 'db.json');
    const j = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    const n0 = (j.estoqueSerial || []).length;
    j.estoqueSerial = (j.estoqueSerial || []).filter(s => !TEST_SERIAIS.includes(String(s.serial)));
    if (j.estoqueSerial.length !== n0) fs.writeFileSync(dbPath, JSON.stringify(j, null, 2));
  } catch (e) { console.log('  ⚠️ limpeza:', e.message); }
}

(async () => {
  try {
    console.log('\n=== ESTOQUE — conciliação saldo × seriais ===');
    const r = await get('/api/estoque/conciliacao?contrato=CE01');
    assert(r.status === 200, 'conciliacao CE01: 200');
    const b = r.body || {};
    assert(Array.isArray(b.linhas) && b.linhas.length === 6 * 6, 'conciliacao: 6 unid × 6 mat (inclui OUTROS)');
    assert(Array.isArray(b.entradasSemSerial), 'conciliacao: lista entradas sem serial');
    let mathOk = true, somaPos = 0;
    for (const l of (b.linhas || [])) {
      if (l.semSerial !== l.saldo - l.disponivel) mathOk = false;
      if (l.semSerial > 0) somaPos += l.semSerial;
    }
    assert(mathOk, 'conciliacao: semSerial = saldo − disponivel em todas as linhas');
    assert(b.totalSemSerial === somaPos, `conciliacao: totalSemSerial soma os positivos (${b.totalSemSerial})`);
    for (const m of (b.entradasSemSerial || []).slice(0, 5)) {
      assert(!m.seriais || !m.seriais.length, 'conciliacao: entradas listadas sem seriais');
    }

    console.log('\n=== ESTOQUE — filtro OUTROS + avulso ===');
    const ro = await get('/api/estoque/seriais?material=OUTROS&limit=all');
    assert(ro.status === 200 && Array.isArray(ro.body), 'seriais OUTROS: 200 array');

    const vazio = await post('/api/estoque/seriais/avulso', { contrato: 'CE01', unidade: 'UMEPE Juazeiro', seriais: '' });
    assert(vazio.status === 400, 'avulso vazio: 400');

    const inval = await post('/api/estoque/seriais/avulso', { contrato: 'CE01', unidade: 'UMEPE Juazeiro', seriais: 'ABC\n123' });
    assert(inval.status === 201 && inval.body.ok.length === 0 && inval.body.erros.length === 2, 'avulso inválidos: 0 ok, 2 erros');

    const und = await post('/api/estoque/seriais/avulso', { contrato: 'CE01', unidade: 'Lugar Nenhum', seriais: '4310000001' });
    assert(und.status === 400, 'avulso unidade inválida: 400');

    limparTeste();
    const ok1 = await post('/api/estoque/seriais/avulso', { contrato: 'CE01', unidade: 'UMEPE Juazeiro', seriais: TEST_SERIAIS.join('\n') });
    assert(ok1.status === 201 && ok1.body.total === 2, 'avulso: 2 seriais cadastrados');
    const dup = await post('/api/estoque/seriais/avulso', { contrato: 'CE01', unidade: 'UMEPE Juazeiro', seriais: '4310000001' });
    assert(dup.status === 201 && dup.body.total === 0 && dup.body.erros.length === 1, 'avulso duplicado: 0 ok, 1 erro');

    const r2 = await get('/api/estoque/conciliacao?contrato=CE01');
    const linha = (r2.body.linhas || []).find(l => l.unidade === 'UMEPE Juazeiro' && l.material === 'TZPR04');
    assert(r2.status === 200 && linha && linha.disponivel >= 2, 'conciliacao: avulsos somam nos disponíveis');
  } finally {
    limparTeste();
    server.close();
  }
  console.log(`\n=== RESULTADO: ${passed} passed, ${failed} failed ===`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FALHA:', e); try { limparTeste(); } catch (_) {} server.close(); process.exit(1); });
