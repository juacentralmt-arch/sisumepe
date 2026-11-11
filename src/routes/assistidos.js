const express = require('express');
const shared = require('../lib/shared');
const { store, ah, auth, broadcast, upload } = shared;
const dom = require('../lib/assistidos');
const importPlanilha = require('../lib/importPlanilha');
const router = express.Router();

// =====================================================================
//  Módulo Assistidos — 3 abas: Todos | Juntada | Concluídos
//  + abas de Auditoria e Alertas
//
//  - cadastro: id, vinculo, nome, processo, vara, local de assinatura,
//    data de início do comparecimento, frequência
//  - listagem em cards com histórico de comparecimentos/juntadas
//  - editar, excluir, etiquetar (verde / laranja / vermelho / sem)
//  - adicionar comparecimento: data, PP de plantão, observação
//  - fluxo: comparecimento criado → vai para aba Juntada (pendente)
//  - juntada preenchida → assistido passa para concluído
//
//  Regras de domínio (locais, status, etiquetas, validações, prazos)
//  ficam em src/lib/assistidos.js — esta camada só orquestra HTTP.
// =====================================================================

const { LOCAIS_ASSINATURA, PERIODOS_COMPARECIMENTO, ETIQUETAS, STATUS_ASSISTIDO, STATUS_ENCERRADOS } = dom;

// Campos que aceitam ser esvaziados numa edição (não no cadastro).
const CAMPOS_LIMPAVEIS = ['dataInicio', 'dataFim'];
// Limite de assistidos devolvidos por página.
const LIMITE_MAX = 100;
// Ações registradas na trilha de auditoria do módulo.
const ACOES_ASSISTIDO = ['criado', 'editado', 'etiqueta', 'excluido', 'restaurado', 'comparecimento', 'comparecimento_excluido', 'juntada', 'juntada_lote'];

const normalizaData = dom.normalizaData;
const ehDataValida = dom.ehDataValida;
const ehDataFutura = dom.ehDataFutura;

// Rótulos amigáveis dos campos na trilha de auditoria.
const ROTULOS = {
  vinculo: 'Vínculo', nome: 'Nome', processo: 'Processo', vara: 'Vara',
  localAssinatura: 'Local de assinatura', dataInicio: 'Data de início', dataFim: 'Data de fim',
  frequencia: 'Frequência', etiqueta: 'Etiqueta', status: 'Status',
  responsavelTecnico: 'Responsável técnico', cpf: 'CPF', telefone: 'Telefone',
  endereco: 'Endereço', situacaoJuridica: 'Situação jurídica',
  dataComparecimento: 'Data do comparecimento', ppPlantao: 'PP de plantão',
  juntada: 'Juntada', observacao: 'Observação', protocolado: 'Protocolado',
  protocoladoPor: 'Protocolado por', dataProtocolacao: 'Data de protocolação',
  deletedAt: 'Excluído em',
};

// ---------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------
// Enriquece a lista com o resumo de comparecimentos (último comparecimento,
// pendências de juntada). Os comparecimentos vêm só dos assistidos da
// página — nunca da tabela inteira.
function enriquecer(lista, comps) {
  const porAssistido = dom.agruparComparecimentos(comps);
  return lista.map(a => {
    const cs = porAssistido.get(String(a.id)) || [];
    const last = cs[0] || null;
    return {
      ...a,
      ultimoComparecimento: last ? last.dataComparecimento : null,
      ppPlantao: last ? last.ppPlantao : null,
      observacao: last ? last.observacao : null,
      totalComparecimentos: cs.length,
      pendentesJuntada: cs.filter(c => !dom.comparecimentoProtocolado(c)).length,
    };
  });
}

// Diferença campo a campo entre dois estados — alimenta a aba Auditoria.
function diff(antes, depois, campos) {
  const out = [];
  for (const c of campos) {
    const de = antes && antes[c] != null ? String(antes[c]) : '';
    const para = depois && depois[c] != null ? String(depois[c]) : '';
    if (de !== para) out.push({ campo: c, rotulo: ROTULOS[c] || c, de, para });
  }
  return out;
}

// Cópia dos campos antes da alteração.
// Em modo arquivo o patch muta o MESMO objeto (por referência), então
// comparar `target` com `row` depois daria diff vazio. A cópia isola o
// estado anterior.
function snapshot(registro, campos) {
  const out = {};
  if (!registro) return out;
  for (const c of campos) out[c] = registro[c] == null ? '' : String(registro[c]);
  return out;
}

// Trilha de auditoria: toda mutação do módulo passa por aqui.
// `changes` guarda o antes/depois de cada campo — sem isso a aba de
// Auditoria só mostraria "algo mudou", não o quê.
async function auditar(req, action, ref, personName, summary, personId, changes) {
  try {
    await store.audit.insert({
      kind: 'assistido', action, personId: personId || null,
      personName: personName || '', ref,
      byUser: req.auth.user, byName: req.auth.name, byRole: req.auth.role,
      summary: summary || '',
      changes: Array.isArray(changes) ? changes : [],
    });
  } catch (e) { /* auditoria não bloqueia a operação */ }
}

// ---------------------------------------------------------------------
//  Listagem — aba "Todos" (paginada no servidor)
// ---------------------------------------------------------------------
router.get('/api/assistidos', auth(['admin', 'tecnico']), ah(async (req, res) => {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limite = Math.min(Math.max(Number(req.query.limit) || 20, 1), LIMITE_MAX);
  const busca = String(req.query.q || '').trim().slice(0, 60);
  const status = String(req.query.status || '').trim();

  const { itens, total } = await store.assistidos.list({
    limit: limite, offset: (page - 1) * limite, q: busca, status,
  });
  const comps = await store.assistidosComparecimentos.all(itens.map(a => a.id));
  res.json({ itens: enriquecer(itens, comps), total, pagina: page, limite });
}));

// Lista enxuta para montar seletores (nome/vínculo/status).
router.get('/api/assistidos/lista', auth(['admin', 'tecnico']), ah(async (req, res) => {
  const busca = String(req.query.q || '').trim().slice(0, 60);
  const limite = Math.min(Math.max(Number(req.query.limit) || 500, 1), 2000);
  res.json(await store.assistidos.listaSimples({ limit: limite, q: busca }));
}));

// Contagem por status (badges das abas).
router.get('/api/assistidos/resumo', auth(['admin', 'tecnico']), ah(async (req, res) => {
  res.json(await store.assistidos.contagemPorStatus());
}));

// ---------------------------------------------------------------------
//  Alertas de periodicidade
//  Espelha /api/psi/alerts: comparecimento atrasado, nunca compareceu e
//  faltas consecutivas. Aqui é o que diz se a monitoração está cumprindo.
// ---------------------------------------------------------------------
router.get('/api/assistidos/alertas', auth(['admin', 'tecnico']), ah(async (req, res) => {
  const alertas = await store.assistidos.alertas();
  const porTipo = {};
  alertas.forEach(a => { porTipo[a.tipo] = (porTipo[a.tipo] || 0) + 1; });
  // A lista vem truncada: a UI mostra os 200 mais recentes, o total é completo.
  const LIMITE = 200;
  res.json({
    alertas: alertas.slice(0, LIMITE),
    total: alertas.length,
    porTipo,
    criticos: porTipo.faltas_consecutivas || 0,
    truncado: alertas.length > LIMITE,
  });
}));

// ---------------------------------------------------------------------
//  Aba "Auditoria" — trilha completa do módulo.
//  Filtros: período, usuário, ação e assistido.
// ---------------------------------------------------------------------
router.get('/api/assistidos/auditoria', auth(['admin', 'tecnico']), ah(async (req, res) => {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limite = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const q = String(req.query.q || '').trim().slice(0, 60);
  const usuario = String(req.query.usuario || '').trim().slice(0, 60);
  const acao = String(req.query.acao || '').trim().slice(0, 30);
  const assistidoId = req.query.assistidoId ? Number(req.query.assistidoId) : null;
  const de = req.query.de ? String(req.query.de) : null;
  const ate = req.query.ate ? String(req.query.ate) : null;

  const { total, items } = await store.audit.search({
    q, user: usuario, action: acao, kind: 'assistido',
    from: de, to: ate, limit: limite, offset: (page - 1) * limite,
    personId: assistidoId,
  });

  // Ações usadas na trilha (para o filtro da UI).
  const acoes = ACOES_ASSISTIDO;

  res.json({
    itens: items.map(it => ({
      id: it.id,
      at: it.at,
      acao: it.action,
      usuario: it.byName || it.byUser || '',
      login: it.byUser || '',
      papel: it.byRole || '',
      assistidoId: it.personId || null,
      assistido: it.personName || '',
      ref: it.ref || '',
      resumo: it.summary || '',
      changes: Array.isArray(it.changes) ? it.changes : [],
    })),
    total, pagina: page, limite, acoes,
  });
}));

// ---------------------------------------------------------------------
//  Assistidos arquivados (soft-delete) — precisam de restauração.
// ---------------------------------------------------------------------
router.get('/api/assistidos/arquivados', auth(['admin', 'tecnico']), ah(async (req, res) => {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limite = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const { itens, total } = await store.assistidos.arquivados({ limit: limite, offset: (page - 1) * limite });
  res.json({ itens, total, pagina: page, limite });
}));

// ---------------------------------------------------------------------
//  Contexto do monitorado — usado no modal de comparecimento.
// ---------------------------------------------------------------------
router.get('/api/assistidos/:id(\\d+)/contexto', auth(['admin', 'tecnico']), ah(async (req, res) => {
  const ctx = await store.assistidos.contexto(req.params.id);
  if (!ctx) return res.status(404).json({ error: 'Assistido não encontrado' });
  res.json(ctx);
}));

// ---------------------------------------------------------------------
//  Aba "Juntada" — assistidos com comparecimento PENDENTE de juntada.
//  Pendente = não protocolado. Registros da base herdada têm o número da
//  juntada mas a flag `protocolado` desligada: os dois sinais contam,
//  senão um comparecimento já juntado apareceria como pendente.
// ---------------------------------------------------------------------
router.get('/api/assistidos/juntada', auth(['admin', 'tecnico']), ah(async (req, res) => {
  const pendentes = await store.assistidosComparecimentos.pendentes();
  const porAssistido = new Map();
  for (const c of pendentes) {
    const arr = porAssistido.get(String(c.assistidoId)) || [];
    arr.push(c);
    porAssistido.set(String(c.assistidoId), arr);
  }
  const ids = [...porAssistido.keys()];
  if (!ids.length) return res.json([]);

  const assistidos = await store.assistidos.list({ limit: LIMITE_MAX, offset: 0 });
  const porId = new Map(assistidos.itens.map(a => [String(a.id), a]));
  const out = [];
  for (const id of ids) {
    const a = porId.get(String(id));
    if (!a) continue;
    const cs = porAssistido.get(String(id)).sort(
      (x, y) => String(x.dataComparecimento || '').localeCompare(String(y.dataComparecimento || ''))
    );
    out.push({ ...a, comparecimentoPendente: cs[0], totalPendentes: cs.length });
  }
  res.json(out);
}));

// ---------------------------------------------------------------------
//  Aba "Concluídos" — encerrados: concluído ou arquivado.
//  'arquivado' vem da base herdada da Planilha Geral; sem incluí-lo,
//  esses registros somem da UI sem existir em nenhuma aba.
// ---------------------------------------------------------------------
router.get('/api/assistidos/concluidos', auth(['admin', 'tecnico']), ah(async (req, res) => {
  const { itens } = await store.assistidos.list({ limit: LIMITE_MAX, offset: 0, statusIn: STATUS_ENCERRADOS });
  res.json(itens);
}));

// Detalhe de um assistido (dados + comparecimentos)
router.get('/api/assistidos/:id(\\d+)/detalhe', auth(['admin', 'tecnico']), ah(async (req, res) => {
  const row = await store.assistidos.byId(req.params.id);
  if (!row) return res.status(404).json({ error: 'Assistido não encontrado' });
  const comps = await store.assistidosComparecimentos.all(req.params.id);
  const sorted = comps.slice().sort(
    (x, y) => String(y.dataComparecimento || '').localeCompare(String(x.dataComparecimento || ''))
  );
  res.json({ assistido: row, comparecimentos: sorted });
}));

// Busca um assistido por ID
router.get('/api/assistidos/:id(\\d+)', auth(['admin', 'tecnico']), ah(async (req, res) => {
  const row = await store.assistidos.byId(req.params.id);
  if (!row) return res.status(404).json({ error: 'Assistido não encontrado' });
  res.json(row);
}));

// ---------------------------------------------------------------------
//  Cadastro de assistido
// ---------------------------------------------------------------------
router.post('/api/assistidos', auth(['admin', 'tecnico']), ah(async (req, res) => {
  const b = req.body || {};
  const vinculo = String(b.vinculo || '').trim();
  const c = {
    vinculo,
    nome: String(b.nome || '').trim(),
    // O processo é o próprio vínculo em 99% dos casos: se não vier, deriva.
    processo: String(b.processo || vinculo).trim(),
    vara: String(b.vara || '').trim(),
    localAssinatura: String(b.localAssinatura || '').trim(),
    dataInicio: normalizaData(b.dataInicio),
    frequencia: String(b.frequencia || 'mensal').trim(),
    etiqueta: String(b.etiqueta || 'sem').trim(),
    status: String(b.status || 'ativo').trim(),
    responsavelTecnico: String(b.responsavelTecnico || '').trim(),
    dataFim: normalizaData(b.dataFim),
    situacaoJuridica: String(b.situacaoJuridica || '').trim(),
    cpf: String(b.cpf || '').replace(/\D/g, '').trim(),
    telefone: String(b.telefone || '').trim(),
    endereco: String(b.endereco || '').trim(),
  };
  const erro = dom.validarCampos(dom.CAMPOS_EDITAVEIS, c, { limpaveis: CAMPOS_LIMPAVEIS });
  if (erro) return res.status(400).json({ error: erro });

  const existe = await store.assistidos.allIncludingDeleted();
  if (existe.some((x) => !dom.estaExcluido(x) && dom.nomeKey(x.vinculo) === dom.nomeKey(c.vinculo))) {
    return res.status(409).json({ error: 'Vínculo já cadastrado' });
  }

  const row = await store.assistidos.insert(c);
  await auditar(req, 'criado', 'assistido#' + row.id, row.nome,
    'Assistido cadastrado: ' + row.nome, row.id,
    diff({}, row, dom.CAMPOS_EDITAVEIS));
  broadcast();
  res.status(201).json(row);
}));

// ---------------------------------------------------------------------
//  Edição de assistido — PATCH PARCIAL.
//
//  Valida e grava apenas os campos enviados. Revalidar o objeto inteiro
//  travava a edição de registros legados (processo com 21 dígitos,
//  data de início vazia) que já existem na base e são válidos no
//  histórico — só o que o usuário mexe é conferido.
// ---------------------------------------------------------------------
router.patch('/api/assistidos/:id', auth(['admin', 'tecnico']), ah(async (req, res) => {
  const b = req.body || {};
  const target = await store.assistidos.byId(req.params.id);
  if (!target) return res.status(404).json({ error: 'Não encontrado' });

  const enviados = dom.CAMPOS_EDITAVEIS.filter(k => b[k] !== undefined && b[k] !== null);
  if (!enviados.length) return res.status(400).json({ error: 'Nenhum campo válido para atualizar.' });

  // Se o vínculo muda e o processo não vem, o processo acompanha o vínculo
  // (o processo é o próprio vínculo em 99% dos casos).
  if (enviados.includes('vinculo') && !enviados.includes('processo')) enviados.push('processo');

  const c = {};
  for (const k of enviados) {
    let v = b[k];
    if (k === 'dataInicio' || k === 'dataFim') v = normalizaData(v);
    else if (k === 'cpf') v = String(v).replace(/\D/g, '').trim();
    else if (k === 'processo' && b[k] === undefined) v = c.vinculo;
    else v = String(v).trim();
    c[k] = v;
  }
  const erro = dom.validarCampos(enviados, c, { limpaveis: CAMPOS_LIMPAVEIS });
  if (erro) return res.status(400).json({ error: erro });

  // Unicidade do vínculo só é conferida quando ele muda.
  if (c.vinculo !== undefined) {
    const todos = await store.assistidos.allIncludingDeleted();
    const dup = todos.find((x) =>
      String(x.id) !== String(req.params.id) &&
      !dom.estaExcluido(x) &&
      dom.nomeKey(x.vinculo || '') === dom.nomeKey(c.vinculo));
    if (dup) return res.status(409).json({ error: 'Vínculo já cadastrado em outro assistido: ' + dup.nome });
  }

  // Snapshot ANTES do patch: em modo arquivo o patch muta o mesmo objeto.
  const antes = snapshot(target, enviados);

  const row = await store.assistidos.patch(req.params.id, c);
  if (!row) return res.status(404).json({ error: 'Não encontrado' });
  const changes = diff(antes, row, enviados);
  const resumo = changes.length
    ? 'Assistido editado (' + changes.map(x => x.rotulo).join(', ') + '): ' + row.nome
    : 'Assistido editado: ' + row.nome;
  await auditar(req, 'editado', 'assistido#' + row.id, row.nome, resumo, row.id, changes);
  broadcast();
  res.json(row);
}));

// Etiquetar assistido.
// A etiqueta é a prioridade de monitoramento (a cor do card): toda
// mudança precisa de motivo, e o motivo vai para a trilha de auditoria.
router.patch('/api/assistidos/:id/etiqueta', auth(['admin', 'tecnico']), ah(async (req, res) => {
  const { etiqueta, motivo } = req.body || {};
  const alvo = String(etiqueta || '').trim().toLowerCase();
  const razao = String(motivo || '').trim();
  const target = await store.assistidos.byId(req.params.id);
  if (!target) return res.status(404).json({ error: 'Assistido não encontrado' });
  if (!ETIQUETAS.includes(alvo)) {
    return res.status(400).json({ error: 'Etiqueta inválida. Use: sem, verde, laranja ou vermelho.' });
  }
  if (razao.length < 5) {
    return res.status(400).json({ error: 'Informe o motivo da mudança de etiqueta (mín. 5 caracteres).' });
  }
  const antesEtiqueta = snapshot(target, ['etiqueta']);
  const row = await store.assistidos.patch(req.params.id, { etiqueta: alvo });
  const changes = diff(antesEtiqueta, row, ['etiqueta']);
  await auditar(req, 'etiqueta', 'assistido#' + row.id, row.nome,
    'Etiqueta: ' + (target.etiqueta || 'sem') + ' → ' + alvo + ' — ' + razao, row.id, changes);
  broadcast();
  res.json({ id: row.id, etiqueta: row.etiqueta });
}));

// Exclusão lógica (soft-delete)
router.delete('/api/assistidos/:id', auth(['admin', 'tecnico']), ah(async (req, res) => {
  const a = await store.assistidos.byId(req.params.id);
  if (!a) return res.status(404).json({ error: 'Assistido não encontrado' });
  const motivo = String((req.body && req.body.motivo) || '').trim();
  await store.assistidos.remove(req.params.id);
  await auditar(req, 'excluido', 'assistido#' + req.params.id, a.nome,
    'Assistido excluído (soft-delete): ' + a.nome + (motivo ? ' — ' + motivo : ''), a.id,
    [{ campo: 'deletedAt', rotulo: ROTULOS.deletedAt, de: '', para: new Date().toISOString() }]);
  broadcast();
  res.json({ ok: true });
}));

// Restaura um assistido arquivado (soft-delete).
router.patch('/api/assistidos/:id/restaurar', auth(['admin', 'tecnico']), ah(async (req, res) => {
  const row = await store.assistidos.restaurar(req.params.id);
  if (!row) return res.status(404).json({ error: 'Assistido arquivado não encontrado' });
  await auditar(req, 'restaurado', 'assistido#' + row.id, row.nome,
    'Assistido restaurado do arquivo: ' + row.nome, row.id,
    [{ campo: 'deletedAt', rotulo: ROTULOS.deletedAt, de: 'arquivado', para: '' }]);
  broadcast();
  res.json(row);
}));

// ---------------------------------------------------------------------
//  Registrar comparecimento
// ---------------------------------------------------------------------
router.post('/api/assistidos/:id/comparecimentos', auth(['admin', 'tecnico']), ah(async (req, res) => {
  const b = req.body || {};
  if (!b.dataComparecimento) return res.status(400).json({ error: 'Data de comparecimento é obrigatória' });
  if (!ehDataValida(b.dataComparecimento)) return res.status(400).json({ error: 'Data de comparecimento inválida (use AAAA-MM-DD)' });
  if (ehDataFutura(b.dataComparecimento)) return res.status(400).json({ error: 'Data de comparecimento não pode ser futura' });

  const a = await store.assistidos.byId(req.params.id);
  if (!a) return res.status(404).json({ error: 'Assistido não encontrado' });

  const comps = await store.assistidosComparecimentos.all(req.params.id);
  if (comps.some((c) => String(c.dataComparecimento).trim() === String(b.dataComparecimento).trim())) {
    return res.status(409).json({ error: 'Já existe comparecimento registrado nesta data para este assistido.' });
  }

  const row = await store.assistidosComparecimentos.insert({
    assistidoId: Number(req.params.id),
    dataComparecimento: String(b.dataComparecimento).trim(),
    ppPlantao: String(b.ppPlantao || '').trim() || '—',
    // String vazia, nunca null: a coluna tem default '' e a aba Juntada
    // filtra por juntada vazia. Gravar null esconderia o registro.
    observacao: String(b.observacao || '').trim(),
    juntada: '',
    protocolado: false,
  });
  await auditar(req, 'comparecimento', 'comparecimento#' + row.id, a.nome,
    'Comparecimento registrado: ' + row.dataComparecimento, a.id,
    diff({}, row, ['dataComparecimento', 'ppPlantao', 'observacao']));
  broadcast();
  res.status(201).json(row);
}));

// ---------------------------------------------------------------------
//  Adicionar / editar juntada
//  Registrar a juntada = protocolar. Grava quem protocolou e quando.
// ---------------------------------------------------------------------
router.patch('/api/assistidos/comparecimentos/:id/juntada', auth(['admin', 'tecnico']), ah(async (req, res) => {
  const { juntada, observacao } = req.body || {};
  const val = String(juntada || '').trim();
  if (!val) return res.status(400).json({ error: 'Dados da juntada são obrigatórios' });

  const row = await store.assistidosComparecimentos.byId(req.params.id);
  if (!row) return res.status(404).json({ error: 'Comparecimento não encontrado' });
  if (dom.estaExcluido(row)) return res.status(400).json({ error: 'Comparecimento excluído' });

  const quem = String((req.auth && req.auth.name) || req.auth.user || '').trim();
  const antesJuntada = snapshot(row, ['juntada', 'observacao', 'protocolado', 'protocoladoPor', 'dataProtocolacao']);
  const upd = await store.assistidosComparecimentos.patch(req.params.id, {
    juntada: val,
    observacao: observacao != null ? String(observacao).trim() : row.observacao,
    protocolado: true,
    protocoladoPor: quem,
    dataProtocolacao: new Date().toISOString().slice(0, 10),
  });
  if (!upd) return res.status(404).json({ error: 'Comparecimento não encontrado' });

  // Transição: assistido passa para concluído
  const comp = await store.assistidosComparecimentos.byId(req.params.id);
  let assistido = null;
  if (comp) {
    assistido = await store.assistidos.byId(comp.assistidoId);
    if (assistido && assistido.status === 'ativo') {
      await store.assistidos.patch(comp.assistidoId, { status: 'concluido' });
    }
  }

  const changes = diff(antesJuntada, upd, ['juntada', 'observacao', 'protocolado', 'protocoladoPor', 'dataProtocolacao']);
  await auditar(req, 'juntada', 'comparecimento#' + req.params.id, assistido ? assistido.nome : '',
    'Juntada registrada: ' + val + (quem ? ' (por ' + quem + ')' : ''), comp ? comp.assistidoId : null, changes);
  broadcast();
  res.json(upd);
}));

// ---------------------------------------------------------------------
//  Protocolar vários comparecimentos de uma vez (lote).
//  Cada comparecimento guarda quem protocolou e quando; a trilha
//  registra o lote com a lista do que entrou.
// ---------------------------------------------------------------------
router.post('/api/assistidos/comparecimentos/juntada-lote', auth(['admin', 'tecnico']), ah(async (req, res) => {
  const { ids, juntada, observacao } = req.body || {};
  const lista = Array.isArray(ids) ? ids.map(Number).filter(n => Number.isFinite(n) && n > 0) : [];
  const val = String(juntada || '').trim();
  if (!lista.length) return res.status(400).json({ error: 'Selecione ao menos um comparecimento.' });
  if (lista.length > 200) return res.status(400).json({ error: 'Máximo de 200 comparecimentos por lote.' });
  if (!val) return res.status(400).json({ error: 'Informe o número/documento da juntada.' });

  const quem = String((req.auth && req.auth.name) || req.auth.user || '').trim();
  const hoje = new Date().toISOString().slice(0, 10);
  const feitos = [];
  const erros = [];

  for (const id of lista) {
    try {
      const row = await store.assistidosComparecimentos.byId(id);
      if (!row) { erros.push({ id, erro: 'não encontrado' }); continue; }
      if (dom.estaExcluido(row)) { erros.push({ id, erro: 'excluído' }); continue; }
      if (dom.comparecimentoProtocolado(row)) { erros.push({ id, erro: 'já protocolado' }); continue; }
      const upd = await store.assistidosComparecimentos.patch(id, {
        juntada: val,
        observacao: observacao != null ? String(observacao).trim() : row.observacao,
        protocolado: true,
        protocoladoPor: quem,
        dataProtocolacao: hoje,
      });
      if (!upd) { erros.push({ id, erro: 'não encontrado' }); continue; }
      // Assistido concluído quando o primeiro comparecimento é protocolado.
      const comp = await store.assistidosComparecimentos.byId(id);
      let assistido = null;
      if (comp) {
        assistido = await store.assistidos.byId(comp.assistidoId);
        if (assistido && assistido.status === 'ativo') {
          await store.assistidos.patch(comp.assistidoId, { status: 'concluido' });
        }
      }
      feitos.push({ id, assistidoId: comp ? comp.assistidoId : null, nome: assistido ? assistido.nome : '' });
    } catch (e) {
      erros.push({ id, erro: 'falha ao salvar' });
    }
  }

  if (feitos.length) {
    await auditar(req, 'juntada_lote', 'lote#' + Date.now(), feitos[0].nome || '',
      'Juntada em lote (' + feitos.length + ' comparecimento(s)): ' + val + (quem ? ' (por ' + quem + ')' : ''),
      feitos[0].assistidoId,
      [{ campo: 'juntada', rotulo: ROTULOS.juntada, de: '', para: val },
       { campo: 'protocolado', rotulo: ROTULOS.protocolado, de: 'false', para: 'true' },
       { campo: 'comparecimentos', rotulo: 'Comparecimentos protocolados', de: '', para: feitos.map(f => '#' + f.id).join(', ') }]);
    broadcast();
  }
  res.json({ protocolados: feitos.length, erros, ids: feitos.map(f => f.id) });
}));

// Exclusão lógica de comparecimento
router.delete('/api/assistidos/comparecimentos/:id', auth(['admin', 'tecnico']), ah(async (req, res) => {
  const row = await store.assistidosComparecimentos.byId(req.params.id);
  if (!row) return res.status(404).json({ error: 'Comparecimento não encontrado' });
  const assistido = await store.assistidos.byId(row.assistidoId);
  await store.assistidosComparecimentos.remove(req.params.id);
  await auditar(req, 'comparecimento_excluido', 'comparecimento#' + req.params.id,
    assistido ? assistido.nome : '', 'Comparecimento excluído (soft-delete)', row.assistidoId,
    [{ campo: 'deletedAt', rotulo: ROTULOS.deletedAt, de: '', para: new Date().toISOString() }]);
  broadcast();
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------
//  Importacao da Planilha Geral (CSV ou XLSX)
//  Upsert por vinculo. ?dry=1 processa e relata sem gravar.
// ---------------------------------------------------------------------
router.post('/api/assistidos/import', auth(['admin', 'tecnico']), upload.single('arquivo'), ah(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Envie o arquivo da planilha (CSV ou XLSX)' });
  const dry = String(req.query.dry || '') === '1';

  let planilha;
  try {
    planilha = await importPlanilha.lerPlanilha(req.file.buffer, req.file.originalname);
  } catch (e) {
    return res.status(400).json({ error: 'Não consegui ler a planilha: ' + (e.message || 'formato inválido') });
  }

  const mapa = importPlanilha.mapearColunas(planilha.head);
  if (mapa.vinculo == null && mapa.nome == null) {
    return res.status(400).json({
      error: 'Cabeçalho não reconhecido. Precisa de uma coluna de Vínculo (ou Processo) e, de preferência, Nome.',
      cabecalhoRecebido: planilha.head,
    });
  }

  const stats = { assistidos: { novos: 0, atualizados: 0, ignorados: 0 }, comparecimentos: { novos: 0, ignorados: 0 } };
  const falhas = [];
  const avisos = [];
  let linhaBase = 2;

  for (let li = 0; li < planilha.rows.length; li++) {
    const r = planilha.rows[li];
    const get = campo => (mapa[campo] != null && r[mapa[campo]] != null ? String(r[mapa[campo]]).trim() : '');
    try {
      const vinculo = get('vinculo');
      const nome = get('nome');
      if (!vinculo && !nome) { stats.assistidos.ignorados++; continue; }

      // --- localiza o assistido ---
      let alvo = vinculo ? await store.assistidos.byVinculo(vinculo) : null;
      if (!alvo && !vinculo && nome) {
        const achados = await store.assistidos.list({ limit: 100, offset: 0, q: nome });
        const exatos = achados.itens.filter(x => importPlanilha.normalizaChave(x.nome) === importPlanilha.normalizaChave(nome));
        if (exatos.length === 1) alvo = exatos[0];
        else if (exatos.length > 1) { falhas.push({ linha: li + linhaBase, erro: 'nome ambíguo: ' + nome }); continue; }
      }
      if (!alvo && !vinculo) {
        falhas.push({ linha: li + linhaBase, erro: 'sem vínculo e nome não localizado: ' + nome });
        continue;
      }

      // --- campos do assistido ---
      const dados = {};
      if (nome) dados.nome = nome;
      if (mapa.vara != null && get('vara')) dados.vara = get('vara');
      if (mapa.local != null && get('local')) dados.localAssinatura = get('local');
      if (mapa.dataInicio != null && get('dataInicio')) dados.dataInicio = importPlanilha.dataISO(get('dataInicio'));
      if (mapa.frequencia != null && get('frequencia')) dados.frequencia = get('frequencia').toLowerCase();
      if (mapa.etiqueta != null && get('etiqueta')) dados.etiqueta = get('etiqueta').toLowerCase();
      if (mapa.status != null && get('status')) dados.status = get('status').toLowerCase();
      if (mapa.responsavel != null) dados.responsavelTecnico = get('responsavel');
      if (mapa.cpf != null) dados.cpf = get('cpf').replace(/\D/g, '');
      if (mapa.telefone != null) dados.telefone = get('telefone');
      if (mapa.endereco != null) dados.endereco = get('endereco');
      if (mapa.situacaoJuridica != null) dados.situacaoJuridica = get('situacaoJuridica');
      // 'processo' e o proprio vinculo em 99% dos casos: so grava se vier diferente
      if (mapa.processo != null && get('processo') && get('processo') !== vinculo) dados.processo = get('processo');

      // --- colunas nao reconhecidas vao para `extras` (jsonb) ---
      // A Planilha Geral pode ter colunas que o modulo nao conhece. Em vez
      // de descartar, o conteudo fica guardado: nao se perde dado e nao
      // exige migration a cada campo novo.
      const usados = new Set(Object.values(mapa));
      const extras = {};
      planilha.head.forEach((h, i) => {
        if (usados.has(i)) return;
        const rotulo = String(h || '').trim();
        if (!rotulo) return;
        const valor = r[i] == null ? '' : String(r[i]).trim();
        if (valor) extras[rotulo] = valor;   // preserva o nome original da coluna
      });
      if (Object.keys(extras).length) dados.extras = extras;

      // --- validacao antes de gravar ---
      // `extras` é uma bolsa livre (jsonb) e nao tem regra de validacao.
      const erro = dom.validarCampos(Object.keys(dados).filter(k => k !== 'extras'), dados, { limpaveis: CAMPOS_LIMPAVEIS });
      if (erro) { falhas.push({ linha: li + linhaBase, erro }); continue; }

      if (!alvo) {
        // --- novo assistido ---
        if (!vinculo) { falhas.push({ linha: li + linhaBase, erro: 'novo assistido sem vínculo' }); continue; }
        if (!dados.nome) { falhas.push({ linha: li + linhaBase, erro: 'novo assistido sem nome' }); continue; }
        const base = {
          vinculo,
          nome: dados.nome,
          processo: dados.processo || vinculo,
          vara: dados.vara || '—',
          localAssinatura: dados.localAssinatura || LOCAIS_ASSINATURA[0],
          dataInicio: dados.dataInicio || '',
          frequencia: dados.frequencia || 'mensal',
          etiqueta: dados.etiqueta || 'sem',
          status: dados.status || 'ativo',
          responsavelTecnico: dados.responsavelTecnico || '',
          cpf: dados.cpf || '',
          telefone: dados.telefone || '',
          endereco: dados.endereco || '',
          situacaoJuridica: dados.situacaoJuridica || '',
        };
        const erroBase = dom.validarCampos(dom.CAMPOS_EDITAVEIS, base, { limpaveis: CAMPOS_LIMPAVEIS });
        if (erroBase) { falhas.push({ linha: li + linhaBase, erro: erroBase }); continue; }
        if (dados.extras) base.extras = dados.extras;
        if (!dry) {
          const criado = await store.assistidos.insert(base);
          alvo = criado;
        }
        stats.assistidos.novos++;
      } else {
        // --- assistido existente ---
        const antes = importPlanilha.normalizaChave(alvo.nome) + '|' + importPlanilha.normalizaChave(alvo.vara || '');
        if (!dry && Object.keys(dados).length) {
          await store.assistidos.patch(alvo.id, dados);
        }
        const depois = importPlanilha.normalizaChave(dados.nome || alvo.nome) + '|' + importPlanilha.normalizaChave(dados.vara || alvo.vara || '');
        if (antes !== depois) stats.assistidos.atualizados++;
        else stats.assistidos.ignorados++;
      }

      // --- comparecimento (se a planilha trouxer a data) ---
      const dataComp = mapa.dataComparecimento != null ? importPlanilha.dataISO(get('dataComparecimento')) : '';
      if (dataComp && alvo && alvo.id) {
        const existing = await store.assistidosComparecimentos.all(alvo.id);
        const jaTem = existing.some(c => String(c.dataComparecimento) === dataComp);
        if (jaTem) {
          stats.comparecimentos.ignorados++;
        } else if (!dry) {
          const juntada = get('juntada');
          const novo = await store.assistidosComparecimentos.insert({
            assistidoId: Number(alvo.id),
            dataComparecimento: dataComp,
            ppPlantao: get('pp') || '—',
            observacao: get('observacao') || '',
            juntada: juntada || '',
            protocolado: !!juntada,
            protocoladoPor: juntada ? (get('protocoladoPor') || '') : '',
            dataProtocolacao: juntada ? dataComp : '',
          });
          stats.comparecimentos.novos++;
          await auditar(req, 'importacao', 'comparecimento#' + novo.id, alvo.nome,
            'Comparecimento importado da planilha: ' + dataComp, alvo.id,
            importPlanilha.diff({}, novo, ['dataComparecimento', 'ppPlantao', 'juntada']));
        } else {
          stats.comparecimentos.novos++;
        }
      }
    } catch (e) {
      falhas.push({ linha: li + linhaBase, erro: (e && e.message) || 'erro inesperado' });
    }
  }

  if (!dry) {
    await auditar(req, 'importacao', 'planilha#' + Date.now(), '',
      'Importação da Planilha Geral: ' + stats.assistidos.novos + ' novo(s), ' + stats.assistidos.atualizados +
      ' atualizado(s), ' + stats.comparecimentos.novos + ' comparecimento(s), ' + falhas.length + ' falha(s)' +
      (req.file && req.file.originalname ? ' — arquivo: ' + req.file.originalname : ''), null,
      [{ campo: 'arquivo', rotulo: 'Arquivo', de: '', para: (req.file && req.file.originalname) || '' },
       { campo: 'resultado', rotulo: 'Resultado', de: '', para: JSON.stringify(stats) }]);
    broadcast();
  }

  res.json({
    ok: falhas.length === 0,
    simulado: dry,
    formato: planilha.formato,
    cabecalho: planilha.head,
    colunasReconhecidas: Object.keys(mapa),
    ...stats,
    falhas: falhas.slice(0, 100),
    totalFalhas: falhas.length,
  });
}));

module.exports = router;
