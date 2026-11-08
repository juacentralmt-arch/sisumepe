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

async function auth(role, user, name) { return { 'X-Test-Auth': `${role}|${user}|${name}`, 'Content-Type': 'application/json' }; }

(async () => {
  console.log('\n=== ASSISTIDOS - CRUD ===');

  // Criar assistido (admin)
  const createRes = await fetch(BASE + '/api/assistidos', {
    method: 'POST', headers: await auth('admin','admin','Admin'),
    body: JSON.stringify({ vinculo: 'V001', nome: 'Fulano de Tal', processo: '0001234-56.2026', vara: 'Vara X', localAssinatura: 'COMEP Cariri', dataInicio: '2026-01-01', frequencia: 'mensal' })
  });
  assert(createRes.status === 201, 'POST admin: 201');
  const created = await createRes.json();
  assert(created && created.id, 'POST: retorna id');
  const id = created.id;

  // Local inválido
  const badLocal = await fetch(BASE + '/api/assistidos', {
    method: 'POST', headers: await auth('admin','admin','Admin'),
    body: JSON.stringify({ vinculo: 'V002', nome: 'X', processo: 'P', vara: 'V', localAssinatura: 'Invalido', dataInicio: '2026-01-01' })
  });
  assert(badLocal.status === 400, 'POST local inválido: 400');

  // Vínculo duplicado
  const dup = await fetch(BASE + '/api/assistidos', {
    method: 'POST', headers: await auth('admin','admin','Admin'),
    body: JSON.stringify({ vinculo: 'V001', nome: 'Y', processo: 'P', vara: 'V', localAssinatura: 'COMEP Cariri', dataInicio: '2026-01-01' })
  });
  assert(dup.status === 409, 'POST vínculo duplicado: 409');

  // Listar
  const listRes = await fetch(BASE + '/api/assistidos', { headers: await auth('admin','admin','Admin') });
  assert(listRes.status === 200, 'GET admin: 200');
  const list = await listRes.json();
  assert(Array.isArray(list) && list.some(x => String(x.id) === String(id)), 'GET: contém criado');

  // Buscar por ID
  const getRes = await fetch(BASE + '/api/assistidos/' + id, { headers: await auth('admin','admin','Admin') });
  assert(getRes.status === 200, 'GET por ID: 200');
  const got = await getRes.json();
  assert(got.nome === 'Fulano de Tal', 'GET: nome correto');

  // Editar (admin)
  const patchRes = await fetch(BASE + '/api/assistidos/' + id, {
    method: 'PATCH', headers: await auth('admin','admin','Admin'),
    body: JSON.stringify({ nome: 'Fulano Editado', status: 'concluido' })
  });
  assert(patchRes.status === 200, 'PATCH admin: 200');
  const patched = await patchRes.json();
  assert(patched.nome === 'Fulano Editado' && patched.status === 'concluido', 'PATCH: campos atualizados');

  // Técnico NÃO pode editar assistido sem responsabilidade
  const tecnicoPatch = await fetch(BASE + '/api/assistidos/' + id, {
    method: 'PATCH', headers: await auth('tecnico','julio','Júlio Cesar'),
    body: JSON.stringify({ nome: 'Tentativa Técnico' })
  });
  assert(tecnicoPatch.status === 403, 'PATCH técnico sem responsabilidade: 403');

  // Recepção não pode editar
  const recPatch = await fetch(BASE + '/api/assistidos/' + id, {
    method: 'PATCH', headers: await auth('recepcao','rec','Rec'),
    body: JSON.stringify({ nome: 'X' })
  });
  assert(recPatch.status === 403, 'PATCH recepção: 403');

  // Registrar comparecimento (técnico responsável)
  const compRes = await fetch(BASE + '/api/assistidos/' + id + '/comparecimentos', {
    method: 'POST', headers: await auth('tecnico','julio','Júlio Cesar'),
    body: JSON.stringify({ dataComparecimento: '2026-02-02', policialPlantao: 'Júlio Cesar' })
  });
  assert(compRes.status === 201, 'POST comparecimento técnico: 201');
  const comp = await compRes.json();
  assert(comp.id, 'POST comparecimento: retorna id');
  const compId = comp.id;

  // Comparecimento duplicado no mesmo dia
  const dupComp = await fetch(BASE + '/api/assistidos/' + id + '/comparecimentos', {
    method: 'POST', headers: await auth('tecnico','julio','Júlio Cesar'),
    body: JSON.stringify({ dataComparecimento: '2026-02-02', policialPlantao: 'PP Marcos' })
  });
  assert(dupComp.status === 409, 'POST comparecimento duplicado: 409');

  // Registrar juntada (transição automática para concluído)
  const juntadaRes = await fetch(BASE + '/api/assistidos/comparecimentos/' + compId + '/juntada', {
    method: 'PATCH', headers: await auth('tecnico','julio','Júlio Cesar'),
    body: JSON.stringify({ juntada: 'Junta processada' })
  });
  assert(juntadaRes.status === 200, 'PATCH juntada: 200');
  const juntada = await juntadaRes.json();
  assert(juntada.protocolado === true, 'Juntada: protocolado true');
  assert(juntada.juntada === 'Junta processada', 'Juntada: texto salvo');

  // Verificar se o assistido passou para concluído automaticamente
  const after = await fetch(BASE + '/api/assistidos/' + id, { headers: await auth('admin','admin','Admin') });
  const afterJson = await after.json();
  assert(afterJson.status === 'concluido', 'Juntada: assistido transicionou para concluído automaticamente');

  // Técnico edita seu próprio assistido (tem comparecimento com seu PP)
  const tecnicoEdit = await fetch(BASE + '/api/assistidos/' + id, {
    method: 'PATCH', headers: await auth('tecnico','julio','Júlio Cesar'),
    body: JSON.stringify({ nome: 'Fulano Editado por Técnico' })
  });
  assert(tecnicoEdit.status === 200, 'PATCH técnico com responsabilidade: 200');

  // Listar comparecimentos do assistido
  const compsRes = await fetch(BASE + '/api/assistidos/' + id + '/comparecimentos', { headers: await auth('admin','admin','Admin') });
  assert(compsRes.status === 200, 'GET comparecimentos: 200');
  const comps = await compsRes.json();
  assert(comps.length >= 1, 'GET comparecimentos: pelo menos 1 registro');

  // Fluxo: após juntada, assistido transicionou para concluído
  const fluxo = await (await fetch(BASE + '/api/assistidos/fluxo', { headers: await auth('admin','admin','Admin') })).json();
  assert(Array.isArray(fluxo.concluido), 'Fluxo: concluído é array');
  assert(fluxo.concluido.some(x => String(x.id) === String(id)), 'Fluxo: assistido em concluído');

  // Filtros
  const filtros = await (await fetch(BASE + '/api/assistidos/filtrar?nome=Fulano', { headers: await auth('admin','admin','Admin') })).json();
  assert(Array.isArray(filtros) && filtros.some(x => String(x.id) === String(id)), 'Filtro nome: encontrado');

  // Excluir (admin)
  const delRes = await fetch(BASE + '/api/assistidos/' + id, { method: 'DELETE', headers: await auth('admin','admin','Admin') });
  assert(delRes.status === 200, 'DELETE admin: 200');

  // 404 após exclusão
  const get404 = await fetch(BASE + '/api/assistidos/' + id, { method: 'PATCH', headers: await auth('admin','admin','Admin'), body: JSON.stringify({ nome: 'x' }) });
  assert(get404.status === 404, 'PATCH após delete: 404');

  server.close();
  console.log(`\n=== RESULTADO: ${passed} passed, ${failed} failed ===`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FALHA:', e); server.close(); process.exit(1); });
