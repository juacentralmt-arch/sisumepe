process.env.SUPABASE_URL = '';
process.env.SUPABASE_KEY = '';

const store = require('../store');
const shared = require('../src/lib/shared');
shared.auth = (roles) => (req, res, next) => {
  if (!req.auth) return res.status(401).json({ error: 'sem auth (teste)' });
  if (roles && roles.length && !roles.includes(req.auth.role)) return res.status(403).json({ error: 'Acesso restrito.' });
  next();
};
const router = require('../src/routes/assistidos');

const express = require('express');
const app = express();
app.use(express.json({ limit: '2mb' }));
app.use((req, res, next) => {
  const raw = req.headers['x-test-auth'] || '';
  const [role, user, name] = raw.split('|');
  req.auth = { role: role || 'admin', user: user || 'admin', name: name || 'Admin', sistema: null, token: 't' };
  next();
});
app.use(router);

const server = app.listen(0);
const BASE = 'http://127.0.0.1:' + server.address().port;

let passed = 0, failed = 0;
const assert = (cond, msg) => {
  if (cond) { console.log('  ok.', msg); passed++; }
  else { console.log('  FAIL', msg); failed++; }
};

(async () => {
  console.log('\n=== ASSISTIDOS - CRUD ===');
  // criar
  const createRes = await fetch(BASE + '/api/assistidos', {
    method: 'POST',
    headers: { 'X-Test-Auth': 'admin|admin|Admin', 'Content-Type': 'application/json' },
    body: JSON.stringify({ nome: 'TESTE ASSISTIDO', processo: '123', vara: 'VARA X', status: 'ATIVO', juntadas: 'J1: teste' })
  });
  assert(createRes.status === 201, 'POST: 201');
  const created = await createRes.json();
  assert(created && created.id, 'POST: retorna id');
  const id = created.id;

  // listar
  const listRes = await fetch(BASE + '/api/assistidos', { headers: { 'X-Test-Auth': 'admin|admin|Admin' } });
  assert(listRes.status === 200, 'GET: 200');
  const list = await listRes.json();
  assert(Array.isArray(list) && list.some(x => String(x.id) === String(id)), 'GET: contem criado');

  // editar
  const patchRes = await fetch(BASE + '/api/assistidos/' + id, {
    method: 'PATCH',
    headers: { 'X-Test-Auth': 'admin|admin|Admin', 'Content-Type': 'application/json' },
    body: JSON.stringify({ observacao: 'obs teste', dias: '10' })
  });
  assert(patchRes.status === 200, 'PATCH: 200');
  const patched = await patchRes.json();
  assert(patched.observacao === 'obs teste' && patched.dias === '10', 'PATCH: campos atualizados');

  // concluir -> concluidos
  const concRes = await fetch(BASE + '/api/assistidos/' + id + '/concluir', {
    method: 'POST',
    headers: { 'X-Test-Auth': 'admin|admin|Admin' }
  });
  assert(concRes.status === 200, 'CONCLUIR: 200');
  const conc = await concRes.json();
  assert(conc.statusGrupo === 'concluido', 'CONCLUIR: statusGrupo concluido');

  // reabrir -> ativos
  const reabRes = await fetch(BASE + '/api/assistidos/' + id + '/reabrir', {
    method: 'POST',
    headers: { 'X-Test-Auth': 'admin|admin|Admin' }
  });
  assert(reabRes.status === 200, 'REABRIR: 200');
  const reab = await reabRes.json();
  assert(reab.statusGrupo === 'ativo', 'REABRIR: statusGrupo ativo');

  // permissao: tecnico pode concluir, recepcao nao edita
  const recPatch = await fetch(BASE + '/api/assistidos/' + id, {
    method: 'PATCH',
    headers: { 'X-Test-Auth': 'recepcao|rec|Rec', 'Content-Type': 'application/json' },
    body: JSON.stringify({ observacao: 'x' })
  });
  assert(recPatch.status === 403, 'PATCH recepcao: 403');

  // excluir
  const delRes = await fetch(BASE + '/api/assistidos/' + id, {
    method: 'DELETE',
    headers: { 'X-Test-Auth': 'admin|admin|Admin' }
  });
  assert(delRes.status === 200, 'DELETE: 200');
  const delJson = await delRes.json();
  assert(delJson.ok === true, 'DELETE: ok true');

  // 404 apos exclusao
  const get404 = await fetch(BASE + '/api/assistidos/' + id, {
    method: 'PATCH',
    headers: { 'X-Test-Auth': 'admin|admin|Admin', 'Content-Type': 'application/json' },
    body: JSON.stringify({ nome: 'x' })
  });
  assert(get404.status === 404, 'PATCH apos delete: 404');

  server.close();
  console.log(`\n=== RESULTADO: ${passed} passed, ${failed} failed ===`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FALHA:', e); server.close(); process.exit(1); });
