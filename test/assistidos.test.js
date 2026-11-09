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

async function auth(role, user, name) { return { 'X-Test-Auth': `${role}|${user}|${name}`, 'Content-Type': 'application/json' }; }

let passed = 0, failed = 0;
const assert = (cond, msg) => {
  if (cond) { console.log('  ok.', msg); passed++; }
  else { console.log('  FAIL', msg); failed++; }
};

(async () => {
  console.log('\n=== ASSISTIDOS - CRUD (reescrito) ===');

  const PROC_OK = '0000000-00.0000.0.00.0000'; // 20 dígitos
  const PROC_OK2 = '0000001-00.0000.0.00.0000';

  // 1. Criar assistido (admin)
  const createRes = await fetch(BASE + '/api/assistidos', {
    method: 'POST', headers: await auth('admin', 'admin', 'Admin'),
    body: JSON.stringify({ vinculo: 'V001', nome: 'Fulano de Tal', processo: PROC_OK, vara: 'Vara X', localAssinatura: 'COMEP Cariri', dataInicio: '2026-01-01', frequencia: 'mensal', etiqueta: 'Verificado', etiquetaCor: '#10b981', etiquetaTexto: 'Conforme' })
  });
  assert(createRes.status === 201, 'POST admin: 201');
  const created = await createRes.json();
  assert(created && created.id, 'POST: retorna id');
  const id = created.id;
  assert(created.etiqueta === 'Verificado', 'POST: etiqueta persistida');
  assert(created.etiquetaCor === '#10b981', 'POST: etiquetaCor persistida');

  // 2. Processo inválido (menos de 20 dígitos)
  const badProc = await fetch(BASE + '/api/assistidos', {
    method: 'POST', headers: await auth('admin', 'admin', 'Admin'),
    body: JSON.stringify({ vinculo: 'V002', nome: 'X', processo: '0001234-56.2026', vara: 'V', localAssinatura: 'COMEP Cariri', dataInicio: '2026-01-01' })
  });
  assert(badProc.status === 400, 'POST processo inválido: 400');

  // 3. Local inválido
  const badLocal = await fetch(BASE + '/api/assistidos', {
    method: 'POST', headers: await auth('admin', 'admin', 'Admin'),
    body: JSON.stringify({ vinculo: 'V003', nome: 'Y', processo: PROC_OK, vara: 'V', localAssinatura: 'Invalido', dataInicio: '2026-01-01' })
  });
  assert(badLocal.status === 400, 'POST local inválido: 400');

  // 4. Vínculo duplicado
  const dup = await fetch(BASE + '/api/assistidos', {
    method: 'POST', headers: await auth('admin', 'admin', 'Admin'),
    body: JSON.stringify({ vinculo: 'V001', nome: 'Z', processo: PROC_OK2, vara: 'V', localAssinatura: 'COMEP Cariri', dataInicio: '2026-01-01' })
  });
  assert(dup.status === 409, 'POST vínculo duplicado: 409');

  // 5. Listar
  const listRes = await fetch(BASE + '/api/assistidos', { headers: await auth('admin', 'admin', 'Admin') });
  assert(listRes.status === 200, 'GET admin: 200');
  const list = await listRes.json();
  assert(Array.isArray(list) && list.some((x) => String(x.id) === String(id)), 'GET: contém criado');

  // 6. Buscar por ID
  const getRes = await fetch(BASE + '/api/assistidos/' + id, { headers: await auth('admin', 'admin', 'Admin') });
  assert(getRes.status === 200, 'GET por ID: 200');
  const got = await getRes.json();
  assert(got.nome === 'Fulano de Tal', 'GET: nome correto');

  // 7. Editar (admin)
  const patchRes = await fetch(BASE + '/api/assistidos/' + id, {
    method: 'PATCH', headers: await auth('admin', 'admin', 'Admin'),
    body: JSON.stringify({ nome: 'Fulano Editado', status: 'concluido', etiqueta: 'Pendente', etiquetaCor: '#f43f5e' })
  });
  assert(patchRes.status === 200, 'PATCH admin: 200');
  const patched = await patchRes.json();
  assert(patched.nome === 'Fulano Editado' && patched.status === 'concluido', 'PATCH: campos atualizados');
  assert(patched.etiqueta === 'Pendente', 'PATCH: etiqueta atualizada');

  // 8. Técnico NÃO pode editar assistido sem responsabilidade
  const tecnicoPatch = await fetch(BASE + '/api/assistidos/' + id, {
    method: 'PATCH', headers: await auth('tecnico', 'julio', 'Júlio Cesar'),
    body: JSON.stringify({ nome: 'Tentativa Técnico' })
  });
  assert(tecnicoPatch.status === 403, 'PATCH técnico sem responsabilidade: 403');

  // 9. Etiquetar endpoint
  const etqRes = await fetch(BASE + '/api/assistidos/' + id + '/etiqueta', {
    method: 'PATCH', headers: await auth('admin', 'admin', 'Admin'),
    body: JSON.stringify({ etiqueta: 'Revisado', etiquetaCor: '#8b5cf6', etiquetaTexto: 'Pendente revisão' })
  });
  assert(etqRes.status === 200, 'PATCH etiqueta: 200');
  const etq = await etqRes.json();
  assert(etq.etiqueta === 'Revisado' && etq.etiquetaCor === '#8b5cf6' && etq.etiquetaTexto === 'Pendente revisão', 'PATCH etiqueta: campos');

  // 10. Remover etiqueta
  const remRes = await fetch(BASE + '/api/assistidos/' + id + '/etiqueta', {
    method: 'PATCH', headers: await auth('admin', 'admin', 'Admin'),
    body: JSON.stringify({ etiqueta: '', etiquetaCor: '', etiquetaTexto: '' })
  });
  assert(remRes.status === 200, 'PATCH remover etiqueta: 200');
  const rem = await remRes.json();
  assert(rem.etiqueta === '', 'PATCH remover etiqueta: etiqueta vazia');

  // 11. Excluir (soft-delete)
  const delRes = await fetch(BASE + '/api/assistidos/' + id, { method: 'DELETE', headers: await auth('admin', 'admin', 'Admin') });
  assert(delRes.status === 200, 'DELETE: 200');
  const getAfter = await fetch(BASE + '/api/assistidos/' + id, { headers: await auth('admin', 'admin', 'Admin') });
  assert(getAfter.status === 404, 'DELETE: GET após exclusão retorna 404');

  // 12. Busca fuzzy
  await fetch(BASE + '/api/assistidos', {
    method: 'POST', headers: await auth('admin', 'admin', 'Admin'),
    body: JSON.stringify({ vinculo: 'V010', nome: 'Maria da Silva Souza', processo: PROC_OK2, vara: 'Vara Y', localAssinatura: 'COAP Cariri', dataInicio: '2026-02-01' })
  });
  const busca = await fetch(BASE + '/api/assistidos/buscar?q=Maria', { headers: await auth('admin', 'admin', 'Admin') });
  assert(busca.status === 200, 'GET buscar: 200');
  const buscaJson = await busca.json();
  assert(buscaJson.total >= 1, 'GET buscar: encontra Maria');

  // 13. Filtros
  const filtro = await fetch(BASE + '/api/assistidos/filtrar?local=COMEP Cariri&status=concluido', { headers: await auth('admin', 'admin', 'Admin') });
  assert(filtro.status === 200, 'GET filtrar: 200');
  const filtroJson = await filtro.json();
  assert(Array.isArray(filtroJson.items), 'GET filtrar: retorna items');

  // 14. Stats
  const stats = await fetch(BASE + '/api/assistidos/stats', { headers: await auth('admin', 'admin', 'Admin') });
  assert(stats.status === 200, 'GET stats: 200');
  const statsJson = await stats.json();
  assert(typeof statsJson.totalAssistidos === 'number', 'stats: totalAssistidos número');

  // 15. Comparecimento
  const compRes = await fetch(BASE + '/api/assistidos/pendencias', { headers: await auth('admin', 'admin', 'Admin') });
  assert(compRes.status === 200, 'GET pendencias: 200');

  console.log('\nResultado: ' + passed + ' passou, ' + failed + ' falhou');
  process.exit(failed > 0 ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
