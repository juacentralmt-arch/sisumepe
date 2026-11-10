process.env.SUPABASE_URL = '';
process.env.SUPABASE_KEY = '';
// Usa banco temporário para não poluir o db.json de desenvolvimento
const os = require('os');
const fs = require('fs');
const path = require('path');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sisumepe-assistidos-test-'));
process.env.DB_FILE = path.join(tmpDir, 'test-db.json');
fs.writeFileSync(process.env.DB_FILE, '{}');

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

const PROC_OK = '0000000-00.0000.0.00.0000';
const PROC_OK2 = '0000001-00.0000.0.00.0000';

(async () => {
  console.log('\n=== ASSISTIDOS - CRUD (3 abas: Todos | Juntada | Concluídos) ===');

  // 1. Criar assistido
  const createRes = await fetch(BASE + '/api/assistidos', {
    method: 'POST', headers: await auth('admin', 'admin', 'Admin'),
    body: JSON.stringify({ vinculo: 'V001', nome: 'Fulano de Tal', processo: PROC_OK, vara: 'Vara X', localAssinatura: 'COMEP Cariri', dataInicio: '2026-01-01', frequencia: 'mensal' })
  });
  assert(createRes.status === 201, 'POST admin: 201');
  const created = await createRes.json();
  assert(created && created.id, 'POST: retorna id');
  const id = created.id;
  assert(created.etiqueta === 'sem', 'POST: etiqueta default sem');
  assert(created.status === 'ativo', 'POST: status default ativo');

  // 2. Processo inválido
  const badProc = await fetch(BASE + '/api/assistidos', {
    method: 'POST', headers: await auth('admin', 'admin', 'Admin'),
    body: JSON.stringify({ vinculo: 'V002', nome: 'X', processo: '0001234-56.2026', vara: 'V', localAssinatura: 'COMEP Cariri', dataInicio: '2026-01-01' })
  });
  assert(badProc.status === 400, 'POST processo inválido: 400');

  // 3. Local inválido
  const badLocal = await fetch(BASE + '/api/assistidos', {
    method: 'POST', headers: await auth('admin', 'admin', 'Admin'),
    body: JSON.stringify({ vinculo: 'V003', nome: 'Y', processo: PROC_OK2, vara: 'V', localAssinatura: 'Invalido', dataInicio: '2026-01-01' })
  });
  assert(badLocal.status === 400, 'POST local inválido: 400');

  // 4. Data futura
  const badData = await fetch(BASE + '/api/assistidos', {
    method: 'POST', headers: await auth('admin', 'admin', 'Admin'),
    body: JSON.stringify({ vinculo: 'V004', nome: 'Z', processo: PROC_OK2, vara: 'V', localAssinatura: 'COMEP Cariri', dataInicio: '2099-01-01' })
  });
  assert(badData.status === 400, 'POST data futura: 400');

  // 5. Vínculo duplicado
  const dup = await fetch(BASE + '/api/assistidos', {
    method: 'POST', headers: await auth('admin', 'admin', 'Admin'),
    body: JSON.stringify({ vinculo: 'V001', nome: 'Dup', processo: PROC_OK2, vara: 'V', localAssinatura: 'COMEP Cariri', dataInicio: '2026-01-01' })
  });
  assert(dup.status === 409, 'POST vínculo duplicado: 409');

  // 6. Listar (aba Todos)
  const listRes = await fetch(BASE + '/api/assistidos', { headers: await auth('admin', 'admin', 'Admin') });
  assert(listRes.status === 200, 'GET todos: 200');
  const list = await listRes.json();
  assert(Array.isArray(list) && list.some((x) => String(x.id) === String(id)), 'GET todos: contém criado');

  // 7. Buscar por ID
  const getById = await fetch(BASE + '/api/assistidos/' + id, { headers: await auth('admin', 'admin', 'Admin') });
  assert(getById.status === 200, 'GET por ID: 200');
  const byId = await getById.json();
  assert(byId.nome === 'Fulano de Tal', 'GET por ID: nome correto');

  // 8. Edição
  const editRes = await fetch(BASE + '/api/assistidos/' + id, {
    method: 'PATCH', headers: await auth('admin', 'admin', 'Admin'),
    body: JSON.stringify({ nome: 'Fulano Atualizado', etiqueta: 'verde' })
  });
  assert(editRes.status === 200, 'PATCH admin: 200');
  const edited = await editRes.json();
  assert(edited.nome === 'Fulano Atualizado', 'PATCH: nome atualizado');
  assert(edited.etiqueta === 'verde', 'PATCH: etiqueta verde');

  // 9. Etiqueta inválida
  const badEtiqueta = await fetch(BASE + '/api/assistidos/' + id, {
    method: 'PATCH', headers: await auth('admin', 'admin', 'Admin'),
    body: JSON.stringify({ etiqueta: 'azul' })
  });
  assert(badEtiqueta.status === 400, 'PATCH etiqueta inválida: 400');

  // 10. Registrar comparecimento
  const compRes = await fetch(BASE + '/api/assistidos/' + id + '/comparecimentos', {
    method: 'POST', headers: await auth('tecnico', 'joanderson', 'Joanderson'),
    body: JSON.stringify({ dataComparecimento: '2026-03-01', ppPlantao: 'PP Wanderson', observacao: 'Compareceu normalmente' })
  });
  assert(compRes.status === 201, 'POST comparecimento: 201');
  const compCreated = await compRes.json();
  assert(compCreated.protocolado === false, 'Comparecimento: protocolado=false por padrão');
  assert(compCreated.juntada === null, 'Comparecimento: juntada=null por padrão');

  // 11. Data futura no comparecimento
  const compFuturo = await fetch(BASE + '/api/assistidos/' + id + '/comparecimentos', {
    method: 'POST', headers: await auth('tecnico', 'joanderson', 'Joanderson'),
    body: JSON.stringify({ dataComparecimento: '2099-01-01', ppPlantao: 'PP Wanderson' })
  });
  assert(compFuturo.status === 400, 'POST comparecimento data futura: 400');

  // 12. Comparecimento duplicado (mesma data)
  const compDup = await fetch(BASE + '/api/assistidos/' + id + '/comparecimentos', {
    method: 'POST', headers: await auth('tecnico', 'joanderson', 'Joanderson'),
    body: JSON.stringify({ dataComparecimento: '2026-03-01', ppPlantao: 'PP Wanderson' })
  });
  assert(compDup.status === 409, 'POST comparecimento duplicado: 409');

  // 13. Juntada -> transição para concluido
  const juntadaRes = await fetch(BASE + '/api/assistidos/comparecimentos/' + compCreated.id + '/juntada', {
    method: 'PATCH', headers: await auth('tecnico', 'joanderson', 'Joanderson'),
    body: JSON.stringify({ juntada: 'Juntada documento 123' })
  });
  assert(juntadaRes.status === 200, 'PATCH juntada: 200');
  const juntada = await juntadaRes.json();
  assert(juntada.protocolado === true, 'Juntada: protocolado=true');

  const assistidoApos = await fetch(BASE + '/api/assistidos/' + id, { headers: await auth('admin', 'admin', 'Admin') });
  const assistidoJson = await assistidoApos.json();
  assert(assistidoJson.status === 'concluido', 'Juntada: assistido passou para concluido');

  // 14. Aba Juntada - não deve conter mais (já tem juntada)
  const juntadaList = await fetch(BASE + '/api/assistidos/juntada', { headers: await auth('admin', 'admin', 'Admin') });
  assert(juntadaList.status === 200, 'GET juntada: 200');
  const juntadaData = await juntadaList.json();
  assert(!juntadaData.some((x) => String(x.id) === String(id)), 'GET juntada: não contém assistido com juntada já feita');

  // 15. Aba Concluídos - deve conter o assistido
  const concluidosList = await fetch(BASE + '/api/assistidos/concluidos', { headers: await auth('admin', 'admin', 'Admin') });
  assert(concluidosList.status === 200, 'GET concluidos: 200');
  const concluidosData = await concluidosList.json();
  assert(concluidosData.some((x) => String(x.id) === String(id)), 'GET concluidos: contém assistido concluído');

  // 16. Detalhe com histórico
  const detalheRes = await fetch(BASE + '/api/assistidos/' + id + '/detalhe', { headers: await auth('admin', 'admin', 'Admin') });
  assert(detalheRes.status === 200, 'GET detalhe: 200');
  const detalhe = await detalheRes.json();
  assert(detalhe.assistido.id === id, 'Detalhe: ID correto');
  assert(Array.isArray(detalhe.comparecimentos), 'Detalhe: comparecimentos array');
  assert(detalhe.comparecimentos.length === 1, 'Detalhe: 1 comparecimento');

  // 17. Exclusão lógica
  const delRes = await fetch(BASE + '/api/assistidos/' + id, {
    method: 'DELETE', headers: await auth('admin', 'admin', 'Admin')
  });
  assert(delRes.status === 200, 'DELETE admin: 200');
  const getDel = await fetch(BASE + '/api/assistidos/' + id, { headers: await auth('admin', 'admin', 'Admin') });
  assert(getDel.status === 404, 'GET após soft-delete: 404');

  console.log('\n==================== RESUMO ====================');
  console.log(`Testes: OK=${passed} | Falha=${failed}`);
  process.exit(failed ? 1 : 0);
})();
