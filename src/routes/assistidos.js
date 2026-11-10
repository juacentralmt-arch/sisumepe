const express = require('express');
const shared = require('../lib/shared');
const { store, ah, auth, broadcast } = shared;
const dom = require('../lib/assistidos');
const router = express.Router();

// =====================================================================
//  Módulo Assistidos — 3 abas: Todos | Juntada | Concluídos
//  - cadastro: id, vinculo, nome, processo, vara, local de assinatura,
//    data de início do comparecimento, frequência
//  - listagem em cards com histórico de comparecimentos/juntadas
//  - editar, excluir, etiquetar (verde / laranja / vermelho / sem)
//  - adicionar comparecimento: data, PP de plantão, observação
//  - fluxo: comparecimento criado → vai para aba Juntada (pendente)
//  - juntada preenchida → assistido passa para concluído
//
//  Regras de domínio (locais, status, etiquetas, validações) ficam em
//  src/lib/assistidos.js — esta camada só orquestra HTTP.
// =====================================================================

const { LOCAIS_ASSINATURA, PERIODOS_COMPARECIMENTO, ETIQUETAS, STATUS_ASSISTIDO, STATUS_ENCERRADOS } = dom;

// Campos que aceitam ser esvaziados numa edição (não no cadastro).
const CAMPOS_LIMPAVEIS = ['dataInicio', 'dataFim'];
// Limite de assistidos devolvidos por página.
const LIMITE_MAX = 100;

const normalizaData = dom.normalizaData;
const ehDataValida = dom.ehDataValida;
const ehDataFutura = dom.ehDataFutura;
const validarCNJ = dom.validarCNJ;

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

async function auditar(req, action, ref, personName, summary, personId) {
  try {
    await store.audit.insert({
      kind: 'assistido', action, personId: personId || null,
      personName: personName || '', ref,
      byUser: req.auth.user, byName: req.auth.name, byRole: req.auth.role,
      summary: summary || '',
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
  const c = {
    vinculo: String(b.vinculo || '').trim(),
    nome: String(b.nome || '').trim(),
    processo: String(b.processo || '').trim(),
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
  await auditar(req, 'criado', 'assistido#' + row.id, row.nome, 'Assistido cadastrado: ' + row.nome, row.id);
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

  const c = {};
  for (const k of enviados) {
    let v = b[k];
    if (k === 'dataInicio' || k === 'dataFim') v = normalizaData(v);
    else if (k === 'cpf') v = String(v).replace(/\D/g, '').trim();
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

  const row = await store.assistidos.patch(req.params.id, c);
  if (!row) return res.status(404).json({ error: 'Não encontrado' });
  await auditar(req, 'editado', 'assistido#' + row.id, row.nome, 'Assistido editado: ' + row.nome, row.id);
  broadcast();
  res.json(row);
}));

// Etiquetar assistido
router.patch('/api/assistidos/:id/etiqueta', auth(['admin', 'tecnico']), ah(async (req, res) => {
  const { etiqueta } = req.body || {};
  const target = await store.assistidos.byId(req.params.id);
  if (!target) return res.status(404).json({ error: 'Assistido não encontrado' });
  if (!ETIQUETAS.includes(String(etiqueta || '').trim())) {
    return res.status(400).json({ error: 'Etiqueta inválida. Use: sem, verde, laranja ou vermelho.' });
  }
  const row = await store.assistidos.patch(req.params.id, { etiqueta: String(etiqueta).trim() });
  await auditar(req, 'etiqueta', 'assistido#' + row.id, row.nome, 'Etiqueta: ' + etiqueta, row.id);
  broadcast();
  res.json({ id: row.id, etiqueta: row.etiqueta });
}));

// Exclusão lógica (soft-delete)
router.delete('/api/assistidos/:id', auth(['admin', 'tecnico']), ah(async (req, res) => {
  const a = await store.assistidos.byId(req.params.id);
  if (!a) return res.status(404).json({ error: 'Assistido não encontrado' });
  await store.assistidos.remove(req.params.id);
  await auditar(req, 'excluido', 'assistido#' + req.params.id, a.nome, 'Assistido excluído (soft-delete): ' + a.nome, a.id);
  broadcast();
  res.json({ ok: true });
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
    observacao: String(b.observacao || '').trim() || null,
    juntada: null,
    protocolado: false,
  });
  await auditar(req, 'comparecimento', 'comparecimento#' + row.id, a.nome,
    'Comparecimento registrado: ' + row.dataComparecimento, a.id);
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

  const upd = await store.assistidosComparecimentos.patch(req.params.id, {
    juntada: val,
    observacao: observacao != null ? String(observacao).trim() : row.observacao,
    protocolado: true,
    protocoladoPor: String(req.auth && req.auth.name || req.auth.user || '').trim(),
    dataProtocolacao: new Date().toISOString().slice(0, 10),
  });
  if (!upd) return res.status(404).json({ error: 'Comparecimento não encontrado' });

  // Transição: assistido passa para concluído
  const comp = await store.assistidosComparecimentos.byId(req.params.id);
  if (comp) {
    const assistido = await store.assistidos.byId(comp.assistidoId);
    if (assistido && assistido.status === 'ativo') {
      await store.assistidos.patch(comp.assistidoId, { status: 'concluido' });
    }
  }

  const assistido = comp ? await store.assistidos.byId(comp.assistidoId) : null;
  await auditar(req, 'juntada', 'comparecimento#' + req.params.id, assistido ? assistido.nome : '',
    'Juntada registrada', comp ? comp.assistidoId : null);
  broadcast();
  res.json(upd);
}));

// Exclusão lógica de comparecimento
router.delete('/api/assistidos/comparecimentos/:id', auth(['admin', 'tecnico']), ah(async (req, res) => {
  const row = await store.assistidosComparecimentos.byId(req.params.id);
  if (!row) return res.status(404).json({ error: 'Comparecimento não encontrado' });
  await store.assistidosComparecimentos.remove(req.params.id);
  await auditar(req, 'comparecimento_excluido', 'comparecimento#' + req.params.id, '', 'Comparecimento excluído (soft-delete)', row.assistidoId);
  broadcast();
  res.json({ ok: true });
}));

module.exports = router;
