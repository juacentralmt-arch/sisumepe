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
// 21 dígitos: formato herdado da Planilha Geral (campo N com 8 dígitos).
const PROC_21 = '02008014-72.2026.8.06.0293';

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

  // 6. Listar (aba Todos) — resposta paginada
  const listRes = await fetch(BASE + '/api/assistidos?page=1&limit=20', { headers: await auth('admin', 'admin', 'Admin') });
  assert(listRes.status === 200, 'GET todos: 200');
  const list = await listRes.json();
  assert(Array.isArray(list.itens), 'GET todos: envelope com itens');
  assert(typeof list.total === 'number', 'GET todos: total numérico');
  assert(list.itens.some((x) => String(x.id) === String(id)), 'GET todos: contém criado');
  assert(list.pagina === 1 && list.limite === 20, 'GET todos: devolve pagina/limite');

  // 6b. Paginação server-side
  const page2 = await (await fetch(BASE + '/api/assistidos?page=1&limit=1', { headers: await auth('admin', 'admin', 'Admin') })).json();
  assert(page2.itens.length === 1, 'GET todos: respeita limite');
  assert(page2.total >= 1, 'GET todos: total independe do limite');
  const busca = await (await fetch(BASE + '/api/assistidos?q=Fulano', { headers: await auth('admin', 'admin', 'Admin') })).json();
  assert(busca.itens.length === 1 && busca.itens[0].nome === 'Fulano de Tal', 'GET todos: busca por nome filtra');

  // 6c. Lista enxuta para seletores
  const listaSimples = await (await fetch(BASE + '/api/assistidos/lista', { headers: await auth('admin', 'admin', 'Admin') })).json();
  assert(Array.isArray(listaSimples) && listaSimples.length >= 1, 'GET /lista: devolve array');
  assert(listaSimples[0] && 'vinculo' in listaSimples[0] && !('endereco' in listaSimples[0]), 'GET /lista: só campos enxutos');

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

  // 9b. PATCH sem nenhum campo válido
  const noFields = await fetch(BASE + '/api/assistidos/' + id, {
    method: 'PATCH', headers: await auth('admin', 'admin', 'Admin'),
    body: JSON.stringify({ nadaDisso: 'x' })
  });
  assert(noFields.status === 400, 'PATCH sem campos editáveis: 400');

  // 10. Registrar comparecimento
  const compRes = await fetch(BASE + '/api/assistidos/' + id + '/comparecimentos', {
    method: 'POST', headers: await auth('tecnico', 'joanderson', 'Joanderson'),
    body: JSON.stringify({ dataComparecimento: '2026-03-01', ppPlantao: 'PP Wanderson', observacao: 'Compareceu normalmente' })
  });
  assert(compRes.status === 201, 'POST comparecimento: 201');
  const compCreated = await compRes.json();
  assert(compCreated.protocolado === false, 'Comparecimento: protocolado=false por padrão');
  assert(!compCreated.juntada, 'Comparecimento: juntada vazia por padrão');

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

  // 12b. Comparecimento pendente aparece na aba Juntada
  const juntadaAntes = await (await fetch(BASE + '/api/assistidos/juntada', { headers: await auth('admin', 'admin', 'Admin') })).json();
  assert(juntadaAntes.some((x) => String(x.id) === String(id)), 'GET juntada: comparecimento novo (não protocolado) aparece');

  // 13. Juntada -> transição para concluido
  const juntadaRes = await fetch(BASE + '/api/assistidos/comparecimentos/' + compCreated.id + '/juntada', {
    method: 'PATCH', headers: await auth('tecnico', 'joanderson', 'Joanderson'),
    body: JSON.stringify({ juntada: 'Juntada documento 123' })
  });
  assert(juntadaRes.status === 200, 'PATCH juntada: 200');
  const juntada = await juntadaRes.json();
  assert(juntada.protocolado === true, 'Juntada: protocolado=true');
  assert(juntada.juntada === 'Juntada documento 123', 'Juntada: número gravado');
  assert(juntada.protocoladoPor === 'Joanderson', 'Juntada: grava quem protocolou');

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

  // =================================================================
  console.log('\n=== ASSISTIDOS - registros legados (Planilha Geral) ===');
  // Injetados direto no store: a API sempre validou, mas a planilha
  // Trouxe processos com 21 dígitos, data de início vazia e status
  // 'arquivado' (fora do enum). Esses registros precisam continuar
  // visíveis e editáveis.

  const legado = await store.assistidos.insert({
    vinculo: PROC_21, nome: 'LEGADO PROCESSO 21 DIGITOS', processo: PROC_21,
    vara: 'Vara Legada', localAssinatura: 'COMEP Cariri', dataInicio: '2026-01-01',
    frequencia: 'mensal', etiqueta: 'sem', status: 'ativo',
  });
  const semData = await store.assistidos.insert({
    vinculo: '3000647-17.2026.8.06.6071', nome: 'LEGADO SEM DATA INICIO',
    processo: '3000647-17.2026.8.06.6071', vara: 'Vara Legada', localAssinatura: 'COMEP Cariri',
    dataInicio: '', frequencia: 'mensal', etiqueta: 'sem', status: 'ativo',
  });
  const arquivado = await store.assistidos.insert({
    vinculo: 'ARQUIVADO', nome: 'LEGADO ARQUIVADO', processo: '80000201-86.2023.8.06.0071',
    vara: 'Vara Legada', localAssinatura: 'COMEP Cariri', dataInicio: '2025-06-17',
    frequencia: 'mensal', etiqueta: 'sem', status: 'arquivado',
  });

  // 18. Leitura funciona (a listagem não valida)
  const listaLegado = await (await fetch(BASE + '/api/assistidos?limit=100', { headers: await auth('admin', 'admin', 'Admin') })).json();
  assert(listaLegado.itens.some((x) => String(x.id) === String(legado.id)), 'Legado: aparece na listagem');

  // 19. PATCH parcial: alterar o nome NÃO revalida o processo herdado
  const patchNome = await fetch(BASE + '/api/assistidos/' + legado.id, {
    method: 'PATCH', headers: await auth('admin', 'admin', 'Admin'),
    body: JSON.stringify({ nome: 'LEGADO RENOMEADO' })
  });
  assert(patchNome.status === 200, 'Legado (CNJ 21 dígitos): editar só o nome → 200');
  const patchNomeJson = await patchNome.json();
  assert(patchNomeJson.nome === 'LEGADO RENOMEADO', 'Legado: nome gravado');
  assert(patchNomeJson.processo === PROC_21, 'Legado: processo preservado (não revalidado)');

  // 20. PATCH parcial: alterar a data de início vazia também funciona
  const patchData = await fetch(BASE + '/api/assistidos/' + semData.id, {
    method: 'PATCH', headers: await auth('admin', 'admin', 'Admin'),
    body: JSON.stringify({ nome: 'LEGADO SEM DATA - RENOMEADO' })
  });
  assert(patchData.status === 200, 'Legado (sem data de início): editar só o nome → 200');

  // 21. PATCH parcial: o campo enviado continua sendo validado
  const patchProcInvalido = await fetch(BASE + '/api/assistidos/' + legado.id, {
    method: 'PATCH', headers: await auth('admin', 'admin', 'Admin'),
    body: JSON.stringify({ processo: '123' })
  });
  assert(patchProcInvalido.status === 400, 'PATCH com processo inválido enviado: 400');

  // 22. PATCH parcial: campos não editáveis são ignorados
  const patchFora = await fetch(BASE + '/api/assistidos/' + legado.id, {
    method: 'PATCH', headers: await auth('admin', 'admin', 'Admin'),
    body: JSON.stringify({ id: 999, deletedAt: 'x', nome: 'OK IGNORADO' })
  });
  assert(patchFora.status === 200, 'PATCH com campo não editável: 200 (ignorado)');
  const patchForaJson = await patchFora.json();
  assert(String(patchForaJson.id) === String(legado.id), 'PATCH: id não pode ser alterado');

  // 23. status 'arquivado' é editável e visível na aba Concluídos
  const patchArquivado = await fetch(BASE + '/api/assistidos/' + arquivado.id, {
    method: 'PATCH', headers: await auth('admin', 'admin', 'Admin'),
    body: JSON.stringify({ nome: 'LEGADO ARQUIVADO - EDITADO' })
  });
  assert(patchArquivado.status === 200, 'Arquivado: editar → 200');
  const concluidosComArq = await (await fetch(BASE + '/api/assistidos/concluidos', { headers: await auth('admin', 'admin', 'Admin') })).json();
  assert(concluidosComArq.some((x) => String(x.id) === String(arquivado.id)), 'Arquivado: aparece na aba Concluídos');

  // 24. Resumo por status
  const resumo = await (await fetch(BASE + '/api/assistidos/resumo', { headers: await auth('admin', 'admin', 'Admin') })).json();
  assert(typeof resumo.total === 'number' && resumo.total >= 3, 'Resumo: total de ativos');
  assert(resumo.arquivado >= 1, 'Resumo: conta arquivados');

  // =================================================================
  console.log('\n=== ASSISTIDOS - regra de pendência de juntada ===');
  // Pendente = NÃO protocolado. A base herdada tem o número da juntada
  // com a flag desligada: esses NÃO são pendentes.
  const aPend = await store.assistidos.insert({
    vinculo: 'PEND1', nome: 'PENDENTE REAL', processo: PROC_OK, vara: 'V',
    localAssinatura: 'COMEP Cariri', dataInicio: '2026-01-01', frequencia: 'mensal',
    etiqueta: 'sem', status: 'ativo',
  });
  await store.assistidosComparecimentos.insert({
    assistidoId: aPend.id, dataComparecimento: '2026-05-01', ppPlantao: 'PP A',
    observacao: null, juntada: null, protocolado: false,
  });
  const aHerda = await store.assistidos.insert({
    vinculo: 'HERD1', nome: 'HERDADO COM JUNTADA', processo: PROC_OK2, vara: 'V',
    localAssinatura: 'COMEP Cariri', dataInicio: '2026-01-01', frequencia: 'mensal',
    etiqueta: 'sem', status: 'ativo',
  });
  await store.assistidosComparecimentos.insert({
    assistidoId: aHerda.id, dataComparecimento: '2026-05-02', ppPlantao: 'PP B',
    observacao: null, juntada: '71377', protocolado: false,
  });

  const pend = await (await fetch(BASE + '/api/assistidos/juntada', { headers: await auth('admin', 'admin', 'Admin') })).json();
  assert(pend.some((x) => String(x.id) === String(aPend.id)), 'Juntada: comparecimento sem juntada E sem flag → pendente');
  assert(!pend.some((x) => String(x.id) === String(aHerda.id)), 'Juntada: juntada preenchida (flag herdada desligada) → NÃO pendente');

  // =================================================================
  console.log('\n=== ASSISTIDOS - soft-delete e compatibilidade ===');
  // 25. Soft-deleted não volta na listagem
  await store.assistidos.remove(aPend.id);
  const aposDel = await (await fetch(BASE + '/api/assistidos?limit=100', { headers: await auth('admin', 'admin', 'Admin') })).json();
  assert(!aposDel.itens.some((x) => String(x.id) === String(aPend.id)), 'Soft-delete: não aparece na listagem');
  const getAposDel = await fetch(BASE + '/api/assistidos/' + aPend.id, { headers: await auth('admin', 'admin', 'Admin') });
  assert(getAposDel.status === 404, 'Soft-delete: GET por id → 404');

  // 26. Vínculo liberado após soft-delete (o índice parcial permite)
  const recadastrar = await fetch(BASE + '/api/assistidos', {
    method: 'POST', headers: await auth('admin', 'admin', 'Admin'),
    body: JSON.stringify({ vinculo: 'PEND1', nome: 'RECADASTrado', processo: PROC_OK, vara: 'V', localAssinatura: 'COMEP Cariri', dataInicio: '2026-01-01' })
  });
  assert(recadastrar.status === 201, 'Soft-delete: mesmo vínculo pode ser recadastrado');

  console.log('\n==================== RESUMO ====================');
  console.log(`Testes: OK=${passed} | Falha=${failed}`);
  process.exit(failed ? 1 : 0);
})();