// Testes da CAMADA DE DADOS do módulo Assistidos (store.js + lib/assistidos).
// Foco: backup/restore (o módulo não pode ser apagado na restauração),
// paginação real dos comparecimentos, busca acento-insensível e as datas
// no fuso local.
process.env.SUPABASE_URL = '';
process.env.SUPABASE_KEY = '';
const os = require('os'); const fs = require('fs'); const path = require('path');
// Banco temporário próprio: o db.json do projeto NÃO é tocado.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sisumepe-assistidos-store-'));
process.env.DB_FILE = path.join(tmpDir, 'test-db.json');
fs.writeFileSync(process.env.DB_FILE, JSON.stringify({ persons: [], tickets: [], chat: [], audit: [], agenda: [], termos: [] }));

const store = require('../store');
const dom = require('../src/lib/assistidos');
const { hojeLocal, addDiasISO, tzOffsetMs, TZ_PADRAO } = require('../src/lib/datas');

let passed = 0, failed = 0;
const assert = (cond, msg) => {
  if (cond) { console.log('  ok.', msg); passed++; }
  else { console.log('  FAIL', msg); failed++; }
};

const PROC = n => '000000' + n + '-00.2026.8.06.0293';

(async () => {
  console.log('\n=== ASSISTIDOS - camada de dados (backup/restore/paginacao) ===');

  // ------------------------------------------------------------------
  console.log('\n--- backup inclui o módulo Assistidos ---');

  const a1 = await store.assistidos.insert({
    vinculo: 'V-BK-1', nome: 'João da Silva', processo: PROC(1), vara: '1a VARA',
    localAssinatura: 'COMEP Cariri', dataInicio: '2026-01-10', frequencia: 'mensal',
    etiqueta: 'pendente', status: 'ativo',
  });
  const a2 = await store.assistidos.insert({
    vinculo: 'V-BK-2', nome: 'Maria Souza', processo: PROC(2), vara: '2a VARA',
    localAssinatura: 'COMEP Cariri', dataInicio: '2026-02-10', frequencia: 'quinzenal',
    etiqueta: 'conferido', status: 'ativo',
  });
  await store.assistidosComparecimentos.insert({
    assistidoId: a1.id, dataComparecimento: '2026-11-02', juntada: '71377', protocolado: true,
  });
  assert(!!a1.id && !!a2.id, 'Cadastro: dois assistidos criados');

  const dump = await store.backup();
  assert(Array.isArray(dump.assistidos), 'Backup: assistidos é uma lista');
  assert(Array.isArray(dump.assistidosComparecimentos), 'Backup: assistidosComparecimentos é uma lista');
  assert(dump.assistidos.length === 2, 'Backup: os 2 assistidos estão no backup (' + dump.assistidos.length + ')');
  assert(dump.assistidosComparecimentos.length === 1, 'Backup: o comparecimento está no backup (' + dump.assistidosComparecimentos.length + ')');
  assert(dump.assistidos.some(x => String(x.id) === String(a1.id) && x.nome === 'João da Silva'),
    'Backup: o assistido gravado (com acento) está no backup');
  assert(typeof dump.seqAssistido === 'number' && dump.seqAssistido > 2, 'Backup: seqAssistido vai junto (' + dump.seqAssistido + ')');
  assert(typeof dump.seqAssistidoComp === 'number' && dump.seqAssistidoComp > 1, 'Backup: seqAssistidoComp vai junto (' + dump.seqAssistidoComp + ')');
  // as outras coleções continuam no mesmo formato (front de Estoque/Admin)
  assert(Array.isArray(dump.persons) && Array.isArray(dump.tickets) && Array.isArray(dump.users) && Array.isArray(dump.estoque),
    'Backup: as demais coleções continuam no formato atual');

  // ------------------------------------------------------------------
  console.log('\n--- restore de backup ANTIGO (sem assistidos) NÃO esvazia o módulo ---');

  const a3 = await store.assistidos.insert({
    vinculo: 'V-BK-3', nome: 'Depois do backup', processo: PROC(3), vara: '3a VARA',
    localAssinatura: 'COMEP Cariri', dataInicio: '2026-03-10', frequencia: 'mensal',
    etiqueta: 'pendente', status: 'ativo',
  });
  const backupAntigo = Object.assign({}, dump);
  delete backupAntigo.assistidos;
  delete backupAntigo.assistidosComparecimentos;
  delete backupAntigo.seqAssistido;
  delete backupAntigo.seqAssistidoComp;

  await store.restore(backupAntigo);
  const depoisDoAntigo = await store.assistidos.all();
  assert(depoisDoAntigo.length === 3, 'Restore antigo: os assistidos continuam na base (' + depoisDoAntigo.length + ')');
  assert(depoisDoAntigo.some(x => String(x.id) === String(a3.id)), 'Restore antigo: o assistido criado depois do backup foi preservado');
  const compsDepoisDoAntigo = await store.assistidosComparecimentos.all();
  assert(compsDepoisDoAntigo.length === 1, 'Restore antigo: os comparecimentos continuam na base (' + compsDepoisDoAntigo.length + ')');

  // a sequência é preservada: um novo cadastro não pode colidir com id existente
  const a4 = await store.assistidos.insert({
    vinculo: 'V-BK-4', nome: 'Pos restore', processo: PROC(4), vara: '4a VARA',
    localAssinatura: 'COMEP Cariri', dataInicio: '2026-04-10', frequencia: 'mensal',
    etiqueta: 'pendente', status: 'ativo',
  });
  const idsAtuais = (await store.assistidos.all()).map(x => Number(x.id));
  assert(new Set(idsAtuais).size === idsAtuais.length, 'Restore antigo: sem colisão de id (seq preservada)');
  assert(Number(a4.id) > Math.max(...idsAtuais.slice(0, -1)), 'Restore antigo: novo registro recebe id livre');

  // ------------------------------------------------------------------
  console.log('\n--- restore de backup NOVO (com assistidos) restaura os dados ---');

  const dump2 = await store.backup();
  assert(dump2.assistidos.length === 4, 'Backup: 4 assistidos no segundo backup (' + dump2.assistidos.length + ')');

  await store.restore(dump);           // volta para o primeiro backup (2 assistidos)
  const restaurados = await store.assistidos.all();
  assert(restaurados.length === 2, 'Restore novo: os assistidos do dump voltaram (' + restaurados.length + ')');
  assert(restaurados.some(x => String(x.id) === String(a1.id) && x.nome === 'João da Silva'),
    'Restore novo: o assistido do dump foi restaurado');
  assert(!restaurados.some(x => String(x.id) === String(a3.id)),
    'Restore novo: o assistido que estava no servidor (fora do dump) saiu');
  const compsRestaurados = await store.assistidosComparecimentos.all();
  assert(compsRestaurados.length === 1, 'Restore novo: o comparecimento do dump voltou (' + compsRestaurados.length + ')');
  const seqRestaurado = await store.assistidos.insert({
    vinculo: 'V-BK-5', nome: 'Apos restaurar', processo: PROC(5), vara: '5a VARA',
    localAssinatura: 'COMEP Cariri', dataInicio: '2026-05-10', frequencia: 'mensal',
    etiqueta: 'pendente', status: 'ativo',
  });
  const maiorId = Math.max(...(await store.assistidos.all()).map(x => Number(x.id)).filter(n => n !== Number(seqRestaurado.id)));
  assert(Number(seqRestaurado.id) > maiorId, 'Restore novo: a sequência do dump evita colisão de id');

  // ------------------------------------------------------------------
  console.log('\n--- situacoes() consulta só os comparecimentos da lista ---');

  const lista = await store.assistidos.all();
  const alvo = lista.slice(0, 2);
  const allOriginal = store.assistidosComparecimentos.all;
  let idsVistos = null;
  store.assistidosComparecimentos.all = async (ids) => {
    idsVistos = ids === undefined ? null : ids;
    return allOriginal(ids);
  };
  const mapa = await store.assistidos.situacoes(alvo);
  store.assistidosComparecimentos.all = allOriginal;

  assert(Array.isArray(idsVistos), 'Situacoes: os comparecimentos foram filtrados por id');
  assert(idsVistos && idsVistos.length === alvo.length, 'Situacoes: só os ids da lista foram pedidos (' + JSON.stringify(idsVistos) + ')');
  assert(alvo.every(a => idsVistos.map(String).includes(String(a.id))), 'Situacoes: os ids pedidos são os da lista');
  assert(mapa instanceof Map, 'Situacoes: devolve um Map');
  assert(mapa.size === alvo.length, 'Situacoes: um registro por assistido (' + mapa.size + ')');
  const um = mapa.get(String(alvo[0].id)) || {};
  assert(typeof um.codigo === 'string' && um.codigo.length > 0, 'Situacoes: formato preservado (codigo: ' + um.codigo + ')');
  assert('dias' in um && 'prazo' in um && 'faltas' in um, 'Situacoes: formato preservado (dias/prazo/faltas)');
  assert(['em_dia', 'atrasado', 'sem_comparecimento', 'sem_historico'].includes(um.codigo), 'Situacoes: codigo valido');

  // sem argumento: comportamento antigo (todos os comparecimentos)
  const todos = await store.assistidos.ultimosComparecimentos();
  assert(todos instanceof Map && todos.size >= 1, 'ultimosComparecimentos(): sem argumento devolve todos (' + todos.size + ')');
  const filtrado = await store.assistidos.ultimosComparecimentos([alvo[0].id]);
  assert(filtrado instanceof Map && filtrado.size <= 1, 'ultimosComparecimentos(): com lista devolve só os pedidos (' + filtrado.size + ')');

  // ------------------------------------------------------------------
  console.log('\n--- busca acento-insensível (modo arquivo) ---');

  await store.assistidos.insert({
    vinculo: 'V-AC-1', nome: 'João Santos', processo: PROC(6), vara: '6a VARA',
    localAssinatura: 'COMEP Cariri', dataInicio: '2026-06-10', frequencia: 'mensal',
    etiqueta: 'pendente', status: 'ativo',
  });
  const porJoao = await store.assistidos.list({ q: 'Joao', limit: 50 });
  assert(porJoao.itens.some(x => x.nome === 'João Santos'), 'Busca: "Joao" acha "João Santos"');
  const porJoao2 = await store.assistidos.list({ q: 'joao', limit: 50 });
  assert(porJoao2.itens.some(x => x.nome === 'João Santos'), 'Busca: "joao" (minusculo) acha "João Santos"');
  const listaSimplesJoao = await store.assistidos.listaSimples({ q: 'Joao', limit: 50 });
  assert(listaSimplesJoao.some(x => x.nome === 'João Santos'), 'Busca: listaSimples acha "João Santos"');
  const porNomeErrado = await store.assistidos.list({ q: 'Zezinho', limit: 50 });
  assert(porNomeErrado.total === 0, 'Busca: termo inexistente não devolve nada');

  // ------------------------------------------------------------------
  console.log('\n--- datas no fuso local (hojeLocal) ---');

  const hoje = hojeLocal();
  const amanha = addDiasISO(hoje, 1);
  const ontem = addDiasISO(hoje, -1);
  const hojeEsperado = new Date(Date.now() + tzOffsetMs(new Date(), TZ_PADRAO)).toISOString().slice(0, 10);
  assert(hoje === hojeEsperado, 'Datas: hojeLocal devolve o dia do fuso operacional (' + TZ_PADRAO + ': ' + hoje + ')');
  assert(dom.ehDataFutura(amanha) === true, 'Datas: amanhã é futura (data de início rejeitada)');
  assert(dom.ehDataFutura(hoje) === false, 'Datas: hoje não é futura (data de início aceita)');
  assert(dom.ehDataFutura(ontem) === false, 'Datas: ontem não é futura');
  assert(dom.ehDataFutura('2099-01-01') === true, 'Datas: 2099 é futura');
  assert(dom.ehDataFutura('') === false, 'Datas: data invalida não é futura');
  const regra = dom.validarCampos(['dataInicio'], { dataInicio: hoje });
  assert(regra === null, 'Validação: data de início de hoje é aceita');
  const regraAmanha = dom.validarCampos(['dataInicio'], { dataInicio: amanha });
  assert(typeof regraAmanha === 'string' && /futura/i.test(regraAmanha), 'Validação: data de início de amanhã é rejeitada');

  // ------------------------------------------------------------------
  console.log('\n--- normalizaEtiqueta ---');
  assert(dom.normalizaEtiqueta('') === 'pendente', 'Etiqueta: vazio -> pendente');
  assert(dom.normalizaEtiqueta(null) === 'pendente', 'Etiqueta: null -> pendente');
  assert(dom.normalizaEtiqueta(undefined) === 'pendente', 'Etiqueta: indefinido -> pendente');
  assert(dom.normalizaEtiqueta('conferido') === 'conferido', 'Etiqueta: conferido fica');
  assert(dom.normalizaEtiqueta('sem') === 'pendente', 'Etiqueta: legado "sem" -> pendente');
  assert(dom.normalizaEtiqueta('verde') === 'conferido', 'Etiqueta: legado "verde" -> conferido');

  // ------------------------------------------------------------------
  console.log('\n--- todosAtivos devolve o registro completo ---');
  await store.assistidos.patch(a1.id, {
    cpf: '12345678901', telefone: '(85) 99999-0000', endereco: 'Rua Teste, 10',
    situacaoJuridica: 'Em liberdade', dataFim: '2027-01-01',
    extras: { origem: 'importacao' }, conferidoPor: 'Admin', conferidoEm: '2026-11-01T10:00:00.000Z',
  });
  const todosAtivos = await store.assistidos.todosAtivos({
    campos: 'id,nome,vinculo,processo,vara,local_assinatura,data_inicio,data_fim,frequencia,etiqueta,status,responsavel_tecnico,cpf,telefone,endereco,situacao_juridica,extras,conferido_por,conferido_em,deleted_at,createdat,updatedat',
  });
  assert(Array.isArray(todosAtivos) && todosAtivos.length > 0, 'todosAtivos: devolve a lista');
  const reg = todosAtivos.find(x => String(x.id) === String(a1.id));
  assert(!!reg, 'todosAtivos: contém o assistido criado');
  assert('nome' in reg && 'vinculo' in reg && 'dataInicio' in reg, 'todosAtivos: devolve os campos pedidos');
  assert(reg.cpf === '12345678901' && reg.telefone === '(85) 99999-0000' && reg.endereco === 'Rua Teste, 10',
    'todosAtivos: campos de contato do registro estão no retorno');
  assert(reg.situacaoJuridica === 'Em liberdade' && reg.dataFim === '2027-01-01',
    'todosAtivos: situacao juridica e data de fim estão no retorno');
  assert(reg.extras && reg.extras.origem === 'importacao', 'todosAtivos: extras está no retorno');
  assert(reg.conferidoPor === 'Admin' && !!reg.conferidoEm, 'todosAtivos: conferido_por/conferido_em estão no retorno');
  const semCampo = todosAtivos.find(x => String(x.id) !== String(a1.id));
  assert(semCampo && 'cpf' in semCampo && 'dataFim' in semCampo,
    'todosAtivos: os campos existem mesmo quando o registro não gravou o valor');

  console.log('\n==================== RESUMO ====================');
  console.log(`Testes: OK=${passed} | Falha=${failed}`);
  process.exit(failed ? 1 : 0);
})().catch(e => {
  console.error('ERRO NA SUÍTE:', e);
  process.exit(1);
});
