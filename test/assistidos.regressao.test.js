// =====================================================================
//  Regressões do módulo Assistidos (rota src/routes/assistidos.js)
//  Cobre: ordenação por nome, aba Juntada com vários pendentes,
//  paginação de Concluídos/Arquivados, lote de juntada sem teto de
//  200, responsabilidade do técnico, simulação da importação e a
//  etiqueta (valor legado / vazio nunca trava o salvamento).
//
//  Banco temporário próprio: NUNCA escreve no db.json do projeto.
// =====================================================================
process.env.SUPABASE_URL = '';
process.env.SUPABASE_KEY = '';
const os = require('os');
const fs = require('fs');
const path = require('path');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sisumepe-assistidos-reg-'));
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

let passed = 0, failed = 0;
const assert = (cond, msg) => {
  if (cond) { console.log('  ok.', msg); passed++; }
  else { console.log('  FAIL', msg); failed++; }
};

const ADM = { 'X-Test-Auth': 'admin|admin|Admin', 'Content-Type': 'application/json' };
const TEC_MARIA = { 'X-Test-Auth': 'tecnico|maria|Maria Souza', 'Content-Type': 'application/json' };
const TEC_JOAO = { 'X-Test-Auth': 'tecnico|joao|Joao', 'Content-Type': 'application/json' };
const TEC_OUTRO = { 'X-Test-Auth': 'tecnico|outro|Outro Tecnico', 'Content-Type': 'application/json' };

const get = async (url, headers) => {
  const r = await fetch(BASE + url, { headers: headers || ADM });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};
const post = async (url, body, headers) => {
  const r = await fetch(BASE + url, { method: 'POST', headers: headers || ADM, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};
const patch = async (url, body, headers) => {
  const r = await fetch(BASE + url, { method: 'PATCH', headers: headers || ADM, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};
const del = async (url, headers) => {
  const r = await fetch(BASE + url, { method: 'DELETE', headers: headers || ADM });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};

// multipart/form-data manual (o multer precisa do corpo cru)
function multipart(filename, conteudo, tipo) {
  const boundary = '----sisumepeRegressao' + Date.now();
  const buf = Buffer.isBuffer(conteudo) ? conteudo : Buffer.from(conteudo, 'utf8');
  const head = Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="arquivo"; filename="${filename}"\r\n` +
    `Content-Type: ${tipo || 'text/csv'}\r\n\r\n`, 'utf8');
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  return { body: Buffer.concat([head, buf, tail]), tipo: 'multipart/form-data; boundary=' + boundary };
}
async function importar(conteudo, query, headers) {
  const mp = multipart('planilha.csv', conteudo);
  const r = await fetch(BASE + '/api/assistidos/import' + (query || ''), {
    method: 'POST',
    headers: Object.assign({}, headers || ADM, { 'Content-Type': mp.tipo }),
    body: mp.body,
  });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}

// CNJ com 20 dígitos (7N + 2J + 4A + 1T + 2U + 4F), único por chamada.
let seq = 0;
const PROC = () => {
  seq++;
  return String(seq).padStart(7, '0') + '-00.2026.8.06.' + String(seq).padStart(4, '0');
};
const hoje = new Date();
const dataISO = d => d.toISOString().slice(0, 10);
const diasAtras = n => {
  const d = new Date(Date.now() - n * 86400000);
  return dataISO(d);
};

async function criar(nome, extra, headers) {
  const p = PROC();
  const r = await post('/api/assistidos', Object.assign({
    vinculo: p,
    nome: nome,
    processo: p,
    vara: 'Vara de Teste',
    localAssinatura: 'COMEP Cariri',
    dataInicio: diasAtras(200),
    frequencia: 'mensal',
  }, extra || {}), headers);
  return r;
}

(async () => {
  // =================================================================
  console.log('\n=== ASSISTIDOS - ordenacao por nome ===');
  // Com ordem=nome e SEM filtro de situacao, a ordenacao nao era
  // aplicada (caia no ramo da listagem, que ordena por id desc).
  const z = await criar('ZETA REGRESSAO');
  const a = await criar('ALFA REGRESSAO');
  const m = await criar('MEDINA REGRESSAO');
  assert(z.status === 201 && a.status === 201 && m.status === 201, 'Ordenacao: 3 assistidos criados');

  const porNome = await get('/api/assistidos?ordem=nome&limit=50');
  const nomes = porNome.json.itens.map(x => x.nome);
  const copia = nomes.slice().sort((x, y) => x.localeCompare(y, 'pt-BR'));
  assert(JSON.stringify(nomes) === JSON.stringify(copia), 'Ordenacao: ordem=nome devolve os nomes em ordem alfabetica');
  assert(nomes.indexOf('ALFA REGRESSAO') < nomes.indexOf('ZETA REGRESSAO'),
    'Ordenacao: ALFA vem antes de ZETA (nao e a ordem de insercao)');

  const porNomeSituacao = await get('/api/assistidos?ordem=nome&situacao=sem_historico&limit=50');
  const nomes2 = porNomeSituacao.json.itens.map(x => x.nome);
  const copia2 = nomes2.slice().sort((x, y) => x.localeCompare(y, 'pt-BR'));
  assert(JSON.stringify(nomes2) === JSON.stringify(copia2), 'Ordenacao: ordem=nome com filtro de situacao tambem ordena');

  const padrao = await get('/api/assistidos?limit=50');
  const idsPadrao = padrao.json.itens.map(x => Number(x.id));
  const decrescente = idsPadrao.every((v, i) => i === 0 || idsPadrao[i - 1] >= v);
  assert(decrescente, 'Ordenacao: sem parametro continua "reconte" (mais recentes primeiro)');

  // =================================================================
  console.log('\n=== ASSISTIDOS - aba Juntada com mais de um pendente ===');
  // A rota expunha so o primeiro pendente: as demais ficavam
  // impossiveis de protocolar em lote.
  const multi = await criar('MULTI PENDENTE');
  const c1 = await post('/api/assistidos/' + multi.json.id + '/comparecimentos',
    { dataComparecimento: diasAtras(60), ppPlantao: 'PP Um' });
  const c2 = await post('/api/assistidos/' + multi.json.id + '/comparecimentos',
    { dataComparecimento: diasAtras(30), ppPlantao: 'PP Dois' });
  assert(c1.status === 201 && c2.status === 201, 'Juntada: 2 comparecimentos registrados');

  const aba = await get('/api/assistidos/juntada');
  const item = aba.json.find(x => String(x.id) === String(multi.json.id));
  assert(!!item, 'Juntada: assistido com pendentes aparece na aba');
  assert(Array.isArray(item.comparecimentosPendentes) && item.comparecimentosPendentes.length === 2,
    'Juntada: comparecimentosPendentes traz TODOS os pendentes (' + (item.comparecimentosPendentes || []).length + ')');
  assert(item.totalPendentes === 2, 'Juntada: totalPendentes conta todos');
  assert(!!item.comparecimentoPendente, 'Juntada: comparecimentoPendente continua sendo o primeiro');
  const idsPend = (item.comparecimentosPendentes || []).map(c => String(c.id));
  assert(idsPend.includes(String(c1.json.id)) && idsPend.includes(String(c2.json.id)),
    'Juntada: os dois comparecimentos pendentes estao na lista');
  assert((item.comparecimentosPendentes || []).every(c => !!c.dataComparecimento),
    'Juntada: cada pendente traz a data do comparecimento');

  // =================================================================
  console.log('\n=== ASSISTIDOS - Concluidos e Arquivados paginados ===');
  // Antes devolviam array cru: sem paginacao e sem o total real.
  const c1r = await criar('CONCLUIDO UM');
  const c2r = await criar('CONCLUIDO DOIS');
  const c3r = await criar('CONCLUIDO TRES');
  await patch('/api/assistidos/' + c1r.json.id, { status: 'concluido' });
  await patch('/api/assistidos/' + c2r.json.id, { status: 'concluido' });
  await patch('/api/assistidos/' + c3r.json.id, { status: 'concluido' });

  const concl = await get('/api/assistidos/concluidos');
  assert(concl.status === 200, 'Concluidos: 200');
  assert(Array.isArray(concl.json.itens) && typeof concl.json.total === 'number'
    && typeof concl.json.pagina === 'number' && typeof concl.json.limite === 'number',
    'Concluidos: envelope {itens,total,pagina,limite}');
  assert(concl.json.total >= 3, 'Concluidos: total real (' + concl.json.total + ')');
  assert(concl.json.limite === 20, 'Concluidos: limite default 20');
  assert(concl.json.itens.length <= 3, 'Concluidos: devolve os concluidos');

  const conclPag = await get('/api/assistidos/concluidos?limit=2&page=1');
  assert(conclPag.json.itens.length === 2 && conclPag.json.limite === 2 && conclPag.json.pagina === 1,
    'Concluidos: respeita limit');
  const conclPag2 = await get('/api/assistidos/concluidos?limit=2&page=2');
  assert(conclPag2.json.pagina === 2, 'Concluidos: respeita page');
  assert(conclPag.json.total === conclPag2.json.total, 'Concluidos: total independe da pagina');

  const arq1 = await criar('ARQUIVADO UM');
  const arq2 = await criar('ARQUIVADO DOIS');
  await del('/api/assistidos/' + arq1.json.id);
  await del('/api/assistidos/' + arq2.json.id);
  const arq = await get('/api/assistidos/arquivados');
  assert(Array.isArray(arq.json.itens) && typeof arq.json.total === 'number'
    && typeof arq.json.pagina === 'number' && typeof arq.json.limite === 'number',
    'Arquivados: envelope {itens,total,pagina,limite}');
  assert(arq.json.total >= 2, 'Arquivados: total real (' + arq.json.total + ')');
  const arqLim = await get('/api/assistidos/arquivados?limit=1');
  assert(arqLim.json.itens.length === 1 && arqLim.json.limite === 1, 'Arquivados: respeita limit');

  // =================================================================
  console.log('\n=== ASSISTIDOS - lote de juntada sem teto de 200 ===');
  // Antes: >200 ids era 400 e nada era gravado (o "selecionar todos"
  // do front falhava inteiro).
  const loteAss = await criar('LOTE GRANDE');
  const compIds = [];
  for (let i = 0; i < 250; i++) {
    const d = new Date(Date.now() - (300 + i) * 86400000);
    const c = await store.assistidosComparecimentos.insert({
      assistidoId: loteAss.json.id,
      dataComparecimento: dataISO(d),
      ppPlantao: 'PP ' + i,
      observacao: '',
      juntada: '',
      protocolado: false,
    });
    compIds.push(c.id);
  }
  assert(compIds.length === 250, 'Lote: 250 pendentes inseridos');

  const lote = await post('/api/assistidos/comparecimentos/juntada-lote',
    { ids: compIds, juntada: 'LOTE-999' });
  assert(lote.status === 200, 'Lote: 200 com 250 ids (antes era 400)');
  assert(lote.json.total === 250, 'Lote: total = quantidade recebida (' + lote.json.total + ')');
  assert(lote.json.atualizados === 250, 'Lote: atualizados = 250 (' + lote.json.atualizados + ')');
  assert(Array.isArray(lote.json.erros) && lote.json.erros.length === 0, 'Lote: sem erros');
  assert(Array.isArray(lote.json.detalhes) && lote.json.detalhes.length === 0,
    'Lote: detalhes lista as falhas (vazio quando deu tudo certo)');
  assert(Array.isArray(lote.json.resultados) && lote.json.resultados.length === 250,
    'Lote: resultados traz o resultado de cada id');
  assert(lote.json.resultados.filter(d => d.ok).length === 250, 'Lote: todos os ids ok');
  assert(lote.json.protocolados === 250, 'Lote: protocolo unico por comparecimento');

  const depoisLote = await get('/api/assistidos/' + loteAss.json.id + '/detalhe');
  const protocolados = (depoisLote.json.comparecimentos || []).filter(c => c.protocolado === true);
  assert(protocolados.length === 250, 'Lote: os 250 comparecimentos gravados como protocolados (' + protocolados.length + ')');

  // Lote com ids inválidos: o resultado vem por id, sem travar o resto.
  const loteErro = await post('/api/assistidos/comparecimentos/juntada-lote',
    { ids: [999999, compIds[0]], juntada: 'OUTRO' });
  assert(loteErro.status === 200, 'Lote com falhas: 200 (nao 400)');
  assert(loteErro.json.total === 2, 'Lote com falhas: total = ids recebidos');
  assert(loteErro.json.atualizados === 0, 'Lote com falhas: nada protocolado');
  assert(loteErro.json.erros.length === 2, 'Lote com falhas: 2 erros (inexistente + ja protocolado)');
  assert(loteErro.json.detalhes.length === 2, 'Lote com falhas: detalhes traz a falha de cada id');
  assert(loteErro.json.detalhes.every(d => !!d.erro), 'Lote com falhas: cada detalhe tem o motivo');

  // =================================================================
  console.log('\n=== ASSISTIDOS - responsabilidade do tecnico ===');
  const resp = await criar('SO MARIA EDITA', { responsavelTecnico: 'Maria Souza' });
  assert(resp.status === 201, 'Responsabilidade: assistido com responsavel criado');

  const ediOutro = await patch('/api/assistidos/' + resp.json.id, { nome: 'EDITADO POR OUTRO' }, TEC_OUTRO);
  assert(ediOutro.status === 403, 'Responsabilidade: tecnico sem responsabilidade -> 403 ao editar');
  assert(/responsabilidade/i.test(ediOutro.json.error || ''), 'Responsabilidade: mensagem clara no 403');
  const delOutro = await del('/api/assistidos/' + resp.json.id, TEC_OUTRO);
  assert(delOutro.status === 403, 'Responsabilidade: tecnico sem responsabilidade -> 403 ao excluir');

  const ediAdmin = await patch('/api/assistidos/' + resp.json.id, { nome: 'EDITADO POR ADMIN' }, ADM);
  assert(ediAdmin.status === 200 && ediAdmin.json.nome === 'EDITADO POR ADMIN',
    'Responsabilidade: admin consegue editar');
  const delAdmin = await del('/api/assistidos/' + resp.json.id, ADM);
  assert(delAdmin.status === 200, 'Responsabilidade: admin consegue excluir');

  const resp2 = await criar('MARIA EDITA', { responsavelTecnico: 'Maria Souza' });
  const ediMaria = await patch('/api/assistidos/' + resp2.json.id, { nome: 'EDITADO PELA MARIA' }, TEC_MARIA);
  assert(ediMaria.status === 200 && ediMaria.json.nome === 'EDITADO PELA MARIA',
    'Responsabilidade: tecnico responsavel consegue editar');
  const delMaria = await del('/api/assistidos/' + resp2.json.id, TEC_MARIA);
  assert(delMaria.status === 200, 'Responsabilidade: tecnico responsavel consegue excluir');

  // Comparação sem acento/caixa: "maria souza" x "Maria Souza"
  const resp3 = await criar('MARIA SEM ACENTO', { responsavelTecnico: 'Maria Souza' });
  const ediLower = await patch('/api/assistidos/' + resp3.json.id, { nome: 'OK' },
    { 'X-Test-Auth': 'tecnico|mmaria|maria souza', 'Content-Type': 'application/json' });
  assert(ediLower.status === 200, 'Responsabilidade: comparação ignora caixa e acentos');

  // Sem responsável definido: liberado (base herdada)
  const resp4 = await criar('SEM RESPONSAVEL');
  const ediSemResp = await patch('/api/assistidos/' + resp4.json.id, { nome: 'OK SEM DONO' }, TEC_JOAO);
  assert(ediSemResp.status === 200, 'Responsabilidade: assistido sem responsavel pode ser editado por qualquer tecnico');

  // =================================================================
  console.log('\n=== ASSISTIDOS - etiqueta nunca trava o salvamento ===');
  // O front abria o editor com o valor cru (legado) num <select> que so
  // tem pendente|conferido: value='' -> gravava etiqueta:'' -> 400 e
  // NENHUM campo era salvo.
  const et = await criar('ETIQUETA TESTE');
  const et1 = await patch('/api/assistidos/' + et.json.id, { nome: 'NOME SALVO', etiqueta: '' });
  assert(et1.status === 200, 'Etiqueta: valor vazio -> 200 (nao 400)');
  assert(et1.json.nome === 'NOME SALVO', 'Etiqueta: os demais campos foram salvos');
  assert(et1.json.etiqueta === 'pendente', 'Etiqueta: vazio normalizado para pendente');

  const et2 = await patch('/api/assistidos/' + et.json.id, { telefone: '88 9999-0000', etiqueta: 'sem' });
  assert(et2.status === 200, 'Etiqueta: legado "sem" -> 200');
  assert(et2.json.telefone === '88 9999-0000', 'Etiqueta: legado nao impede o salvamento dos demais campos');
  assert(et2.json.etiqueta === 'pendente', 'Etiqueta: legado "sem" normalizado para pendente');

  const et3 = await patch('/api/assistidos/' + et.json.id, { etiqueta: 'verde' });
  assert(et3.status === 200 && et3.json.etiqueta === 'conferido', 'Etiqueta: legado "verde" normalizado para conferido');

  const et4 = await patch('/api/assistidos/' + et.json.id + '/etiqueta', { etiqueta: '' });
  assert(et4.status === 200 && et4.json.etiqueta === 'pendente', 'Etiqueta: rota de etiqueta aceita vazio');
  const et5 = await patch('/api/assistidos/' + et.json.id + '/etiqueta', { etiqueta: 'vermelho' });
  assert(et5.status === 200 && et5.json.etiqueta === 'pendente', 'Etiqueta: rota de etiqueta aceita legado');

  // =================================================================
  console.log('\n=== ASSISTIDOS - importacao: etiqueta e simulacao ===');
  const csvSemEtiqueta = [
    'vinculo;nome;vara',
    '9600001-00.2026.8.06.0001;IMPORTADO SEM ETIQUETA;Vara de Teste',
  ].join('\n');
  const imp = await importar(csvSemEtiqueta);
  assert(imp.status === 200, 'Import: 200');
  assert(imp.json.assistidos.novos === 1, 'Import: assistido novo criado');
  const criado = await get('/api/assistidos?limit=50');
  const reg = criado.json.itens.find(x => x.vinculo === '9600001-00.2026.8.06.0001');
  assert(!!reg, 'Import: assistido gravado');
  assert(reg && reg.etiqueta === 'pendente', 'Import: etiqueta gravada como pendente (nao "sem")');

  // Etiqueta legada na planilha: entra normalizada.
  const csvLegado = [
    'vinculo;nome;vara;etiqueta',
    '9600003-00.2026.8.06.0003;IMPORTADO ETIQUETA LEGADA;Vara de Teste;verde',
  ].join('\n');
  await importar(csvLegado);
  const comLegado = await get('/api/assistidos?limit=50');
  const regLegado = comLegado.json.itens.find(x => x.vinculo === '9600003-00.2026.8.06.0003');
  assert(regLegado && regLegado.etiqueta === 'conferido', 'Import: etiqueta legada normalizada para conferido');

  // Registro com etiqueta legada gravado direto na base: a API nunca
  // devolve o valor cru (o <select> do front so conhece os dois novos).
  const legadoCru = await store.assistidos.insert({
    vinculo: '9600099-00.2026.8.06.0099', nome: 'REGISTRO COM ETIQUETA CRUA',
    processo: '9600099-00.2026.8.06.0099', vara: 'Vara de Teste',
    localAssinatura: 'COMEP Cariri', dataInicio: diasAtras(200), frequencia: 'mensal',
    etiqueta: 'verde', status: 'ativo',
  });
  const porId = await get('/api/assistidos/' + legadoCru.id);
  assert(porId.json.etiqueta === 'conferido', 'Etiqueta: GET por id normaliza o valor legado');
  const porDetalhe = await get('/api/assistidos/' + legadoCru.id + '/detalhe');
  assert(porDetalhe.json.assistido.etiqueta === 'conferido', 'Etiqueta: detalhe normaliza o valor legado');

  // Simulação: conta os comparecimentos que SERIAM criados
  const csvSim = [
    'vinculo;nome;vara;ultima_data',
    '9600002-00.2026.8.06.0002;SIMULADO COM COMPARECIMENTO;Vara de Teste;' + diasAtras(10),
  ].join('\n');
  const sim = await importar(csvSim, '?dry=1');
  assert(sim.status === 200, 'Simulacao: 200');
  assert(sim.json.simulado === true, 'Simulacao: marcada como simulada');
  assert(sim.json.assistidos.novos === 1, 'Simulacao: conta o assistido novo');
  assert(sim.json.comparecimentos.novos > 0,
    'Simulacao: conta o comparecimento que SERIA criado (' + sim.json.comparecimentos.novos + ')');
  const depois = await get('/api/assistidos?limit=50');
  assert(!depois.json.itens.some(x => x.vinculo === '9600002-00.2026.8.06.0002'),
    'Simulacao: nada foi gravado');

  // =================================================================
  console.log('\n=== ASSISTIDOS - acao de auditoria da importacao ===');
  const aud = await get('/api/assistidos/auditoria?limit=50');
  assert(Array.isArray(aud.json.acoes) && aud.json.acoes.includes('importacao'),
    'Auditoria: acao "importacao" entra no filtro de acoes');
  const audImp = await get('/api/assistidos/auditoria?acao=importacao&limit=50');
  assert(audImp.json.itens.length >= 1, 'Auditoria: filtro por acao=importacao devolve registros');
  assert(audImp.json.itens.every(x => x.acao === 'importacao'), 'Auditoria: filtro traz so importacao');
  assert(audImp.json.acoesRotulos && audImp.json.acoesRotulos.importacao === 'Importação',
    'Auditoria: rotulo "Importacao" disponivel para o front');

  // =================================================================
  console.log('\n=== ASSISTIDOS - PATCH grava a autoria da conferencia ===');
  // Só a rota /:id/etiqueta gravava quem conferiu: o PATCH /:id (usado
  // pelo editor da ficha) trocava a etiqueta e deixava a autoria de uma
  // conferencia antiga — ou apagava a que acabava de ser feita.
  const cf = await criar('CONFERENCIA VIA PATCH');
  const cf1 = await patch('/api/assistidos/' + cf.json.id, { etiqueta: 'conferido' });
  assert(cf1.status === 200, 'PATCH: etiqueta conferido -> 200');
  assert(cf1.json.etiqueta === 'conferido', 'PATCH: etiqueta gravada como conferido');
  assert(cf1.json.conferidoPor === 'Admin', 'PATCH: grava quem conferiu (' + cf1.json.conferidoPor + ')');
  assert(!!cf1.json.conferidoEm, 'PATCH: grava quando conferiu');
  const cfGravado = await get('/api/assistidos/' + cf.json.id);
  assert(cfGravado.json.conferidoPor === 'Admin' && !!cfGravado.json.conferidoEm,
    'PATCH: a autoria fica gravada no registro');

  const cf2 = await patch('/api/assistidos/' + cf.json.id, { etiqueta: 'pendente' });
  assert(cf2.status === 200, 'PATCH: etiqueta pendente -> 200');
  assert(!cf2.json.conferidoPor, 'PATCH: voltar para pendente limpa quem conferiu');
  assert(!cf2.json.conferidoEm, 'PATCH: voltar para pendente limpa quando conferiu');

  const cf3 = await patch('/api/assistidos/' + cf.json.id, { etiqueta: 'conferido' }, TEC_JOAO);
  assert(cf3.json.conferidoPor === 'Joao', 'PATCH: a autoria e o nome do tecnico logado (' + cf3.json.conferidoPor + ')');

  // A rota de etiqueta usa a MESMA regra (limpa a autoria ao voltar).
  const cf4 = await patch('/api/assistidos/' + cf.json.id + '/etiqueta', { etiqueta: 'pendente' });
  assert(cf4.status === 200 && !cf4.json.conferidoPor && !cf4.json.conferidoEm,
    'Etiqueta: pendente limpa a autoria da conferencia');
  const cf5 = await patch('/api/assistidos/' + cf.json.id + '/etiqueta', { etiqueta: 'conferido' });
  assert(cf5.json.conferidoPor === 'Admin' && !!cf5.json.conferidoEm,
    'Etiqueta: conferido grava quem e quando');

  // A trilha da edição registra a autoria da conferencia junto da etiqueta.
  const audPatch = await get('/api/assistidos/auditoria?acao=editado&limit=50');
  const edicoes = (audPatch.json.itens || []).filter(x => String(x.assistidoId) === String(cf.json.id));
  assert(edicoes.length >= 1, 'Auditoria: o PATCH da etiqueta ficou registrado');
  assert(edicoes.some(x => (x.changes || []).some(c => c.campo === 'conferidoPor' && c.para === 'Admin')),
    'Auditoria: a trilha mostra quem conferiu');

  // =================================================================
  console.log('\n=== ASSISTIDOS - importacao nao reabre assistido encerrado ===');
  const enc = await criar('ASSISTIDO ENCERRADO PARA IMPORT');
  await patch('/api/assistidos/' + enc.json.id, { status: 'concluido' });
  const csvReabre = [
    'vinculo;nome;vara;status',
    enc.json.vinculo + ';ASSISTIDO ENCERRADO PARA IMPORT;Vara de Teste;Ativo',
  ].join('\n');
  const impReabre = await importar(csvReabre);
  assert(impReabre.status === 200, 'Import: planilha com status Ativo processada');
  assert(impReabre.json.falhas.length === 0,
    'Import: a linha nao virou falha (' + JSON.stringify(impReabre.json.falhas || []) + ')');
  const depoisReabre = await get('/api/assistidos/' + enc.json.id);
  assert(depoisReabre.json.status === 'concluido',
    'Import: assistido concluido NAO foi reaberto (ficou ' + depoisReabre.json.status + ')');

  const encArq = await criar('ASSISTIDO ARQUIVADO PARA IMPORT');
  await patch('/api/assistidos/' + encArq.json.id, { status: 'arquivado' });
  const csvReabreArq = [
    'vinculo;nome;vara;status',
    encArq.json.vinculo + ';ASSISTIDO ARQUIVADO PARA IMPORT;Vara de Teste;Ativo',
  ].join('\n');
  await importar(csvReabreArq);
  const depoisReabreArq = await get('/api/assistidos/' + encArq.json.id);
  assert(depoisReabreArq.json.status === 'arquivado',
    'Import: assistido arquivado NAO foi reaberto (ficou ' + depoisReabreArq.json.status + ')');

  // Status lido da planilha com ACENTO: "Concluído" tem que casar com o
  // enum 'concluido' (antes a linha era reprovada como status inválido).
  const csvConcluido = [
    'vinculo;nome;vara;status',
    '9600010-00.2026.8.06.0010;IMPORTADO COM STATUS COM ACENTO;Vara de Teste;Concluído',
  ].join('\n');
  const impConcluido = await importar(csvConcluido);
  assert(impConcluido.json.falhas.length === 0,
    'Import: status "Concluído" (com acento) aceito (' + JSON.stringify(impConcluido.json.falhas || []) + ')');
  const comAcento = await get('/api/assistidos?limit=100&status=concluido');
  const regAcento = (comAcento.json.itens || []).find(x => x.vinculo === '9600010-00.2026.8.06.0010');
  assert(!!regAcento, 'Import: assistido com status "Concluído" gravado');
  assert(regAcento && regAcento.status === 'concluido',
    'Import: "Concluído" (com acento) virou o enum "concluido" (' + (regAcento && regAcento.status) + ')');

  const csvConcluida = [
    'vinculo;nome;vara;status',
    '9600011-00.2026.8.06.0011;IMPORTADO STATUS CONCLUIDA;Vara de Teste;Concluída',
  ].join('\n');
  const impConcluida = await importar(csvConcluida);
  assert(impConcluida.json.falhas.length === 0, 'Import: status "Concluída" (com acento) aceito');
  const comAcento2 = await get('/api/assistidos?limit=100&status=concluido');
  const regAcento2 = (comAcento2.json.itens || []).find(x => x.vinculo === '9600011-00.2026.8.06.0011');
  assert(regAcento2 && regAcento2.status === 'concluido',
    'Import: "Concluída" (com acento) virou o enum "concluido"');

  // =================================================================
  console.log('\n=== ASSISTIDOS - import nao duplica assistido excluido ===');
  // O vinculo de um assistido EXCLUIDO (soft-delete) nao aparece em
  // `byVinculo` (que so ve os ativos): a importacao criava um DUPLICADO
  // do mesmo assistido. Agora a linha e recusada com aviso.
  const excluido = await criar('ASSISTIDO EXCLUIDO PARA IMPORT');
  await del('/api/assistidos/' + excluido.json.id, ADM);
  const csvDuplicado = [
    'vinculo;nome;vara;status',
    excluido.json.vinculo + ';ASSISTIDO EXCLUIDO PARA IMPORT;Vara de Teste;Ativo',
  ].join('\n');
  const impDuplicado = await importar(csvDuplicado);
  assert((impDuplicado.json.falhas || []).length === 1,
    'Import: linha com vinculo de assistido excluido vira falha (' + JSON.stringify(impDuplicado.json.falhas || []) + ')');
  assert(String((impDuplicado.json.falhas || [])[0] && (impDuplicado.json.falhas || [])[0].erro || '').includes('arquivado'),
    'Import: o aviso diz que o assistido esta arquivado');
  const ativosDup = await get('/api/assistidos?limit=200');
  const dups = (ativosDup.json.itens || []).filter(x => x.vinculo === excluido.json.vinculo);
  assert(dups.length === 0, 'Import: NENHUM duplicado foi criado para o vinculo excluido');

  // =================================================================
  console.log('\n=== ASSISTIDOS - restaurar nao ressuscita comparecimento excluido ===');
  // A restauracao trazia de volta TUDO: inclusive o comparecimento que o
  // tecnico tinha excluido isoladamente (apagado de proposito).
  const rest = await criar('RESTAURAR SEM RESSUSCITAR');
  const cMantem = await post('/api/assistidos/' + rest.json.id + '/comparecimentos',
    { dataComparecimento: diasAtras(40), ppPlantao: 'PP Mantido' });
  const cSome = await post('/api/assistidos/' + rest.json.id + '/comparecimentos',
    { dataComparecimento: diasAtras(20), ppPlantao: 'PP Excluido' });
  assert(cMantem.status === 201 && cSome.status === 201, 'Restaurar: 2 comparecimentos registrados');
  const delComp = await del('/api/assistidos/comparecimentos/' + cSome.json.id);
  assert(delComp.status === 200, 'Restaurar: comparecimento excluido isoladamente');
  const arqRest = await del('/api/assistidos/' + rest.json.id);
  assert(arqRest.status === 200, 'Restaurar: assistido arquivado');
  const rest2 = await patch('/api/assistidos/' + rest.json.id + '/restaurar', {});
  assert(rest2.status === 200, 'Restaurar: assistido restaurado');
  const detRest = await get('/api/assistidos/' + rest.json.id + '/detalhe');
  const idsRest = (detRest.json.comparecimentos || []).map(c => String(c.id));
  assert(idsRest.includes(String(cMantem.json.id)),
    'Restaurar: o comparecimento excluido EM CASCATA voltou');
  assert(!idsRest.includes(String(cSome.json.id)),
    'Restaurar: o comparecimento excluido ISOLADAMENTE continua excluído');

  // =================================================================
  console.log('\n=== ASSISTIDOS - etiqueta normalizada em TODAS as leituras ===');
  const legado = '9600098-00.2026.8.06.0098';
  const cruConcluido = await store.assistidos.insert({
    vinculo: legado, nome: 'ETIQUETA CRUA EM TODAS AS ROTAS',
    processo: legado, vara: 'Vara de Teste', localAssinatura: 'COMEP Cariri',
    dataInicio: diasAtras(200), frequencia: 'mensal',
    etiqueta: 'vermelho', status: 'concluido',
  });
  const cruAtivo = await store.assistidos.insert({
    vinculo: '9600097-00.2026.8.06.0097', nome: 'ETIQUETA CRUA ATIVO',
    processo: '9600097-00.2026.8.06.0097', vara: 'Vara de Teste', localAssinatura: 'COMEP Cariri',
    dataInicio: diasAtras(200), frequencia: 'mensal',
    etiqueta: 'laranja', status: 'ativo',
  });
  await store.assistidosComparecimentos.insert({
    assistidoId: cruAtivo.id, dataComparecimento: diasAtras(5), ppPlantao: 'PP Cru',
    observacao: '', juntada: '', protocolado: false,
  });
  await del('/api/assistidos/' + cruAtivo.id);   // arquivado com etiqueta crua

  const OK_ETIQUETAS = ['pendente', 'conferido'];
  const leTodos = await get('/api/assistidos?limit=100');
  assert((leTodos.json.itens || []).every(x => OK_ETIQUETAS.includes(x.etiqueta)),
    'Leitura: /api/assistidos nunca devolve etiqueta crua');
  const leLista = await get('/api/assistidos/lista?limit=200');
  assert((leLista.json || []).every(x => OK_ETIQUETAS.includes(x.etiqueta)),
    'Leitura: /api/assistidos/lista nunca devolve etiqueta crua');
  const leId = await get('/api/assistidos/' + cruConcluido.id);
  assert(leId.json.etiqueta === 'pendente', 'Leitura: GET /:id normaliza etiqueta crua');
  const leDetalhe = await get('/api/assistidos/' + cruConcluido.id + '/detalhe');
  assert(leDetalhe.json.assistido.etiqueta === 'pendente', 'Leitura: GET /:id/detalhe normaliza etiqueta crua');
  const leConcluidos = await get('/api/assistidos/concluidos?limit=100');
  assert((leConcluidos.json.itens || []).every(x => OK_ETIQUETAS.includes(x.etiqueta)),
    'Leitura: /api/assistidos/concluidos nunca devolve etiqueta crua');
  const leArquivados = await get('/api/assistidos/arquivados?limit=100');
  assert((leArquivados.json.itens || []).every(x => OK_ETIQUETAS.includes(x.etiqueta)),
    'Leitura: /api/assistidos/arquivados nunca devolve etiqueta crua');
  const leJuntada = await get('/api/assistidos/juntada');
  assert((leJuntada.json || []).every(x => OK_ETIQUETAS.includes(x.etiqueta)),
    'Leitura: /api/assistidos/juntada nunca devolve etiqueta crua');

  // =================================================================
  console.log('\n=== ASSISTIDOS - resumo traz a lista de responsaveis ===');
  const resumo = await get('/api/assistidos/resumo');
  assert(resumo.status === 200, 'Resumo: 200');
  assert(Array.isArray(resumo.json.responsaveis), 'Resumo: a chave "responsaveis" existe');
  assert(typeof resumo.json.total === 'number' && typeof resumo.json.ativo === 'number'
    && typeof resumo.json.pendentesJuntada === 'number',
    'Resumo: as chaves antigas continuam na resposta');
  assert(resumo.json.responsaveis.includes('Maria Souza'),
    'Resumo: o responsavel preenchido aparece na lista');
  assert(!resumo.json.responsaveis.some(x => !String(x || '').trim()),
    'Resumo: sem responsavel vazio na lista');
  assert(new Set(resumo.json.responsaveis).size === resumo.json.responsaveis.length,
    'Resumo: a lista de responsaveis nao tem repetidos');
  const resumoOrdenado = resumo.json.responsaveis.slice().sort((a, b) =>
    String(a).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      .localeCompare(String(b).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(), 'pt-BR'));
  assert(JSON.stringify(resumo.json.responsaveis) === JSON.stringify(resumoOrdenado),
    'Resumo: a lista de responsaveis vem ordenada alfabeticamente (sem acentos)');

  console.log('\n==================== RESUMO ====================');
  console.log(`Testes: OK=${passed} | Falha=${failed}`);
  process.exit(failed ? 1 : 0);
})().catch(e => {
  console.error('ERRO NA SUITE:', e);
  process.exit(1);
});
