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
  console.log('\n=== ASSISTIDOS - CRUD (refatorado) ===');

  const PROC_OK = '0000000-00.0000.0.00.0000'; // 20 dígitos
  const PROC_OK2 = '0000001-00.0000.0.00.0000';

  // 1. Criar assistido (admin)
  const createRes = await fetch(BASE + '/api/assistidos', {
    method: 'POST', headers: await auth('admin', 'admin', 'Admin'),
    body: JSON.stringify({ vinculo: 'V001', nome: 'Fulano de Tal', processo: PROC_OK, vara: 'Vara X', localAssinatura: 'COMEP Cariri', dataInicio: '2026-01-01', frequencia: 'mensal', etiqueta: 'verificado', etiquetaCor: '#10b981', etiquetaTexto: 'Conforme', responsavelTecnico: 'joanderson' })
  });
  assert(createRes.status === 201, 'POST admin: 201');
  const created = await createRes.json();
  assert(created && created.id, 'POST: retorna id');
  const id = created.id;
  assert(created.etiqueta === 'verificado', 'POST: etiqueta persistida');
  assert(created.etiquetaCor === '#10b981', 'POST: etiquetaCor persistida');
  assert(created.responsavelTecnico === 'joanderson', 'POST: responsavelTecnico persistido');

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

  // 4. Data de início futura
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

  // 6. Listar
  const listRes = await fetch(BASE + '/api/assistidos', { headers: await auth('admin', 'admin', 'Admin') });
  assert(listRes.status === 200, 'GET admin: 200');
  const list = await listRes.json();
  assert(Array.isArray(list) && list.some((x) => String(x.id) === String(id)), 'GET: contém criado');

  // 7. Buscar por ID
  const getById = await fetch(BASE + '/api/assistidos/' + id, { headers: await auth('admin', 'admin', 'Admin') });
  assert(getById.status === 200, 'GET por ID: 200');
  const byId = await getById.json();
  assert(byId.nome === 'Fulano de Tal', 'GET por ID: nome correto');

  // 8. Edição por admin
  const editRes = await fetch(BASE + '/api/assistidos/' + id, {
    method: 'PATCH', headers: await auth('admin', 'admin', 'Admin'),
    body: JSON.stringify({ nome: 'Fulano Atualizado', etiqueta: 'pendente_documentacao' })
  });
  assert(editRes.status === 200, 'PATCH admin: 200');
  const edited = await editRes.json();
  assert(edited.nome === 'Fulano Atualizado', 'PATCH: nome atualizado');
  assert(edited.etiqueta === 'pendente_documentacao', 'PATCH: etiqueta atualizada');

  // 9. Técnico NÃO responsável não pode editar
  const editTecNaoResp = await fetch(BASE + '/api/assistidos/' + id, {
    method: 'PATCH', headers: await auth('tecnico', 'adailton', 'Adailton'),
    body: JSON.stringify({ nome: 'Tentativa' })
  });
  assert(editTecNaoResp.status === 403, 'PATCH tecnico não responsável: 403');

  // 10. Técnico responsável pode editar (criar assistido com responsavel=joanderson, editar como joanderson)
  const createResp = await fetch(BASE + '/api/assistidos', {
    method: 'POST', headers: await auth('admin', 'admin', 'Admin'),
    body: JSON.stringify({ vinculo: 'V005', nome: 'Tecnico Teste', processo: PROC_OK2, vara: 'V', localAssinatura: 'COAP Cariri', dataInicio: '2026-02-01', responsavelTecnico: 'joanderson' })
  });
  assert(createResp.status === 201, 'POST com responsavel: 201');
  const criadoResp = await createResp.json();
  const idResp = criadoResp.id;
  const editRespTec = await fetch(BASE + '/api/assistidos/' + idResp, {
    method: 'PATCH', headers: await auth('tecnico', 'joanderson', 'Joanderson'),
    body: JSON.stringify({ nome: 'Tecnico Editado' })
  });
  assert(editRespTec.status === 200, 'PATCH tecnico responsável: 200');

  // 11. Exclusão lógica (soft-delete) — admin
  const delRes = await fetch(BASE + '/api/assistidos/' + id, {
    method: 'DELETE', headers: await auth('admin', 'admin', 'Admin')
  });
  assert(delRes.status === 200, 'DELETE admin: 200');
  const getDel = await fetch(BASE + '/api/assistidos/' + id, { headers: await auth('admin', 'admin', 'Admin') });
  assert(getDel.status === 404, 'GET após soft-delete: 404');

  // 12. Comparecimentos
  const compRes = await fetch(BASE + '/api/assistidos/' + idResp + '/comparecimentos', {
    method: 'POST', headers: await auth('tecnico', 'joanderson', 'Joanderson'),
    body: JSON.stringify({ dataComparecimento: '2026-03-01', policialPlantao: 'Joanderson' })
  });
  assert(compRes.status === 201, 'POST comparecimento: 201');
  const compCreated = await compRes.json();
  assert(compCreated.protocolado === false, 'Comparecimento: protocolado=false por padrão');

  // 12b. Duplicidade de data
  const compDup = await fetch(BASE + '/api/assistidos/' + idResp + '/comparecimentos', {
    method: 'POST', headers: await auth('tecnico', 'joanderson', 'Joanderson'),
    body: JSON.stringify({ dataComparecimento: '2026-03-01' })
  });
  assert(compDup.status === 409, 'POST comparecimento duplicado: 409');

  // 12c. Data futura bloqueada
  const compFuturo = await fetch(BASE + '/api/assistidos/' + idResp + '/comparecimentos', {
    method: 'POST', headers: await auth('tecnico', 'joanderson', 'Joanderson'),
    body: JSON.stringify({ dataComparecimento: '2099-01-01' })
  });
  assert(compFuturo.status === 400, 'POST comparecimento data futura: 400');

  // 13. Juntada -> transição para concluido
  const juntadaRes = await fetch(BASE + '/api/assistidos/comparecimentos/' + compCreated.id + '/juntada', {
    method: 'PATCH', headers: await auth('tecnico', 'joanderson', 'Joanderson'),
    body: JSON.stringify({ juntada: 'Juntada documento 123' })
  });
  assert(juntadaRes.status === 200, 'PATCH juntada: 200');
  const juntada = await juntadaRes.json();
  assert(juntada.protocolado === true, 'Juntada: protocolado=true');
  const assistidoApos = await fetch(BASE + '/api/assistidos/' + idResp, { headers: await auth('admin', 'admin', 'Admin') });
  const assistidoJson = await assistidoApos.json();
  assert(assistidoJson.status === 'concluido', 'Juntada: assistido passou para concluido');

  // 14. Pendências
  const pendRes = await fetch(BASE + '/api/assistidos/pendencias', { headers: await auth('admin', 'admin', 'Admin') });
  assert(pendRes.status === 200, 'GET pendencias: 200');
  const pend = await pendRes.json();
  assert(Array.isArray(pend), 'Pendências: retorna array');

  // 15. Busca fuzzy
  const buscaRes = await fetch(BASE + '/api/assistidos/buscar?q=Tecnico', { headers: await auth('admin', 'admin', 'Admin') });
  assert(buscaRes.status === 200, 'GET buscar: 200');
  const busca = await buscaRes.json();
  assert(busca.total >= 0, 'Busca: total válido');

  // 16. Etiqueta
  const etiquetaRes = await fetch(BASE + '/api/assistidos/' + idResp + '/etiqueta', {
    method: 'PATCH', headers: await auth('admin', 'admin', 'Admin'),
    body: JSON.stringify({ etiqueta: 'prioritario', etiquetaCor: '#ef4444' })
  });
  assert(etiquetaRes.status === 200, 'PATCH etiqueta: 200');
  const etiqueta = await etiquetaRes.json();
  assert(etiqueta.etiqueta === 'prioritario', 'Etiqueta: persistida');

  // 17. Estatísticas
  const statsRes = await fetch(BASE + '/api/assistidos/stats', { headers: await auth('admin', 'admin', 'Admin') });
  assert(statsRes.status === 200, 'GET stats: 200');
  const stats = await statsRes.json();
  assert(typeof stats.totalAssistidos === 'number', 'Stats: totalAssistidos número');

  // 18. Filtro
  const filtroRes = await fetch(BASE + '/api/assistidos/filtrar?status=concluido', { headers: await auth('admin', 'admin', 'Admin') });
  assert(filtroRes.status === 200, 'GET filtrar: 200');
  const filtro = await filtroRes.json();
  assert(filtro.items.every(x => x.status === 'concluido'), 'Filtro: todos concluidos');

  // 19. Detalhe
  const detalheRes = await fetch(BASE + '/api/assistidos/' + idResp + '/detalhe', { headers: await auth('admin', 'admin', 'Admin') });
  assert(detalheRes.status === 200, 'GET detalhe: 200');
  const detalhe = await detalheRes.json();
  assert(detalhe.assistido.id === idResp, 'Detalhe: ID correto');
  assert(Array.isArray(detalhe.comparecimentos), 'Detalhe: comparecimentos array');

  // 20. Exclusão lógica de comparecimento (soft-delete)
  const compDel = await fetch(BASE + '/api/assistidos/comparecimentos/' + compCreated.id, {
    method: 'DELETE', headers: await auth('admin', 'admin', 'Admin')
  });
  assert(compDel.status === 200, 'DELETE comparecimento: 200');

  console.log('\n==================== RESUMO ====================');
  console.log(`Testes: OK=${passed} | Falha=${failed}`);
  process.exit(failed ? 1 : 0);
})();
