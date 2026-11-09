const express = require('express');
const shared = require('../lib/shared');
const { store, ah, auth, broadcast, upload } = shared;
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const {
  LOCAIS_ASSINATURA, PERIODOS_COMPARECIMENTO, FREQ_DAYS,
  STATUS_ASSISTIDO: STATUS_VALIDOS, isoDate, cpfValido,
  agruparComparecimentos: groupCompsByAssistido,
  comparecimentoProtocolado, nomeKey, proximoEsperadoAssistido
} = require('../lib/assistidos');
const router = express.Router();

// =====================================================================
// Constantes de domínio (únicas, usadas por todas as rotas do módulo)
// =====================================================================
const ETIQUETAS_VALIDAS = ['verificado', 'pendente', ''];
const MAX_PDF_ROWS = 500;

// =====================================================================
// Helpers de cálculo
// =====================================================================

// Calcula o próximo comparecimento esperado com base no último comparecimento
// (ou na data de início se nunca compareceu). Retorna string AAAA-MM-DD ou null.
// Dias de tolerância para alerta CRITICO (já passou do prazo da frequência)
function alertaDiasCritico(frequencia) {
  return FREQ_DAYS[frequencia] || 30;
}

// Dias de tolerância para alerta ATENCAO (<= 7 dias ou passou 50% da frequência)
function alertaDiasAtencao(frequencia) {
  return Math.ceil((FREQ_DAYS[frequencia] || 30) * 0.5);
}

// Valida número CNJ (20 dígitos)
function validarCNJ(cnpjStr) {
  const cnpj = String(cnpjStr || '').replace(/[.\-/]/g, '');
  return /^\d{20}$/.test(cnpj);
}

// Agrupa comparecimentos por assistido (Map id -> array ordenado decrescente)
// Último comparecimento por assistido
function ultimoCompPorAssistido(comps) {
  const ultimo = {};
  comps.forEach(c => {
    const aid = String(c.assistidoId);
    if (!ultimo[aid] || String(c.dataComparecimento) > String(ultimo[aid].dataComparecimento)) {
      ultimo[aid] = c;
    }
  });
  return ultimo;
}

// Enriquece um assistido com dados de comparecimento
function enriquecerAssistido(a, ultimo, compsMap, hoje) {
  const cs = compsMap.get(String(a.id)) || [];
  const pendenteJuntada = cs.some(c => !comparecimentoProtocolado(c));
  const prox = ultimo
    ? proximoEsperadoAssistidoFromBase(ultimo.dataComparecimento, a.frequencia)
    : proximoEsperadoAssistido(a, cs);
  const vencendo = prox && prox <= hoje;
  const vencendo7 = prox && !vencendo && prox <= new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  return {
    ...a,
    ultimoComparecimento: ultimo ? ultimo.dataComparecimento : null,
    compId: ultimo ? ultimo.id : null,
    pendenteJuntada,
    proximoEsperado: prox,
    vencendo,
    vencendo7d: vencendo7,
  };
}

// Calcula próximo esperado a partir de uma base de data (usado no fluxo/alertas)
function proximoEsperadoAssistidoFromBase(base, frequencia) {
  if (!base || !/^\d{4}-\d{2}-\d{2}$/.test(String(base))) return null;
  const dias = FREQ_DAYS[frequencia] || 30;
  const dt = new Date(String(base) + 'T00:00:00');
  if (isNaN(dt)) return null;
  return new Date(dt.getTime() + dias * 864e5).toISOString().slice(0, 10);
}

// Paginação helper
function paginar(list, page, limit) {
  const total = list.length;
  let paged = list;
  let pOut = page ? Number(page) : 1;
  let lOut = limit ? Number(limit) : total;
  if (page !== undefined && limit !== undefined) {
    const p = Math.max(Number(page) || 1, 1);
    const l = Math.min(Math.max(Number(limit) || 50, 1), 100);
    const start = (p - 1) * l;
    paged = list.slice(start, start + l);
    pOut = p;
    lOut = l;
  }
  return { items: paged, total, page: pOut, limit: lOut };
}

// =====================================================================
// GET /api/assistidos — listagem com enriquecimento e paginação
// =====================================================================
router.get('/api/assistidos', auth(['admin', 'tecnico']), ah(async (req, res) => {
  const { page, limit } = req.query || {};
  const list = await store.assistidos.all();
  const comps = await store.assistidosComparecimentos.all();
  const compsMap = groupCompsByAssistido(comps);
  const hoje = new Date().toISOString().slice(0, 10);

  const enriched = list.map(a => {
    const cs = compsMap.get(String(a.id)) || [];
    const last = cs[0] || null;
    return enriquecerAssistido(a, last, compsMap, hoje);
  });

  enriched.sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));
  res.json(paginar(enriched, page, limit));
}));

// =====================================================================
// GET /api/assistidos/:id — buscar um assistido
// =====================================================================
router.get('/api/assistidos/:id(\\d+)', auth(['admin', 'tecnico']), ah(async (req, res) => {
  const row = await store.assistidos.byId(req.params.id);
  if (!row) return res.status(404).json({ error: 'Não encontrado' });
  res.json(row);
}));

// =====================================================================
// POST /api/assistidos — cadastrar assistido (apenas admin)
// =====================================================================
router.post('/api/assistidos', auth(['admin']), ah(async (req, res) => {
  const b = req.body || {};
  if (!b.nome || !String(b.nome).trim()) return res.status(400).json({ error: 'Nome é obrigatório' });
  if (!b.vinculo || !String(b.vinculo).trim()) return res.status(400).json({ error: 'Número de vínculo é obrigatório' });
  if (!b.processo || !String(b.processo).trim()) return res.status(400).json({ error: 'Processo é obrigatório' });
  if (!b.vara || !String(b.vara).trim()) return res.status(400).json({ error: 'Vara é obrigatória' });
  if (!LOCAIS_ASSINATURA.includes(String(b.localAssinatura || '').trim())) return res.status(400).json({ error: 'Local de assinatura inválido' });
  if (!b.dataInicio) return res.status(400).json({ error: 'Data de início é obrigatória' });
  if (!isoDate(b.dataInicio)) return res.status(400).json({ error: 'Data de início inválida (informe uma data real em AAAA-MM-DD)' });
  if (b.cpf && !cpfValido(b.cpf)) return res.status(400).json({ error: 'CPF inválido' });
  if (b.processo && !validarCNJ(b.processo)) return res.status(400).json({ error: 'Processo inválido (deve ter 20 dígitos no formato CNJ)' });
  if (b.etiqueta !== undefined && !ETIQUETAS_VALIDAS.includes(String(b.etiqueta).trim())) return res.status(400).json({ error: 'Etiqueta inválida' });

  const freqRaw = String(b.frequencia || '').trim();
  if (freqRaw && !PERIODOS_COMPARECIMENTO.includes(freqRaw)) {
    return res.status(400).json({ error: 'Frequência inválida. Use: semanal, quinzenal, mensal, bimestral ou trimestral' });
  }
  const frequencia = freqRaw || 'mensal';

  if (b.dataFim && !isoDate(b.dataFim)) {
    return res.status(400).json({ error: 'Data de fim inválida (use AAAA-MM-DD)' });
  }
  if (b.dataFim && String(b.dataFim).trim() < String(b.dataInicio).trim()) {
    return res.status(400).json({ error: 'Data de fim não pode ser anterior à data de início' });
  }

  const all = await store.assistidos.all();
  if (all.some(x => nomeKey(x.vinculo) === nomeKey(b.vinculo))) {
    return res.status(409).json({ error: 'Vínculo já cadastrado' });
  }

  const row = await store.assistidos.insert({
    vinculo: String(b.vinculo).trim(),
    nome: String(b.nome).trim(),
    cpf: String(b.cpf || '').trim(),
    telefone: String(b.telefone || '').trim(),
    endereco: String(b.endereco || '').trim(),
    processo: String(b.processo).trim(),
    vara: String(b.vara).trim(),
    situacaoJuridica: String(b.situacaoJuridica || '').trim(),
    tipoMedida: String(b.tipoMedida || '').trim(),
    localAssinatura: String(b.localAssinatura).trim(),
    dataInicio: String(b.dataInicio).trim(),
    dataFim: String(b.dataFim || '').trim(),
    cargaHoraria: String(b.cargaHoraria || '').trim(),
    frequencia,
    etiqueta: String(b.etiqueta || '').trim(),
    status: STATUS_VALIDOS.includes(String(b.status || '').trim()) ? String(b.status).trim() : 'ativo',
  });

  try {
    await store.audit.insert({
      kind: 'assistido', action: 'criado', personName: row.nome, ref: 'assistido#' + row.id,
      byUser: req.auth.user, byName: req.auth.name, byRole: req.auth.role,
      summary: 'Assistido cadastrado: ' + row.nome,
    });
  } catch (e) {}
  broadcast();
  res.status(201).json(row);
}));

// =====================================================================
// PATCH /api/assistidos/:id — editar assistido
// =====================================================================
router.patch('/api/assistidos/:id(\\d+)', auth(['admin', 'tecnico']), ah(async (req, res) => {
  const b = req.body || {};
  const target = await store.assistidos.byId(req.params.id);
  if (!target) return res.status(404).json({ error: 'Não encontrado' });

  // Técnico só edita assistidos de sua responsabilidade
  if (req.auth.role === 'tecnico') {
    const comps = await store.assistidosComparecimentos.all(req.params.id);
    const meu = comps.some(c => nomeKey(c.policialPlantao) === nomeKey(req.auth.name || req.auth.user));
    if (!meu) return res.status(403).json({ error: 'Técnico só pode editar assistidos de sua responsabilidade.' });
  }

  const fields = {};
  const copiaveis = ['vinculo', 'nome', 'processo', 'vara', 'localAssinatura', 'dataInicio',
    'cpf', 'telefone', 'endereco', 'situacaoJuridica', 'tipoMedida', 'cargaHoraria', 'dataFim', 'etiqueta'];
  for (const k of copiaveis) {
    if (b[k] !== undefined) {
      fields[k] = String(b[k] == null ? '' : b[k]).trim();
      if (['vinculo', 'nome', 'processo', 'vara', 'localAssinatura', 'dataInicio'].includes(k) && !fields[k]) {
        return res.status(400).json({ error: `${k} é obrigatório` });
      }
    }
  }
  if (fields.etiqueta !== undefined && !ETIQUETAS_VALIDAS.includes(fields.etiqueta)) return res.status(400).json({ error: 'Etiqueta inválida' });

  if (b.frequencia !== undefined) {
    const frequencia = String(b.frequencia).trim();
    if (!PERIODOS_COMPARECIMENTO.includes(frequencia)) return res.status(400).json({ error: 'Frequência inválida' });
    fields.frequencia = frequencia;
  }

  if (b.localAssinatura !== undefined && !LOCAIS_ASSINATURA.includes(String(b.localAssinatura).trim())) {
    return res.status(400).json({ error: 'Local de assinatura inválido' });
  }
  if (b.cpf !== undefined && b.cpf && !cpfValido(b.cpf)) {
    return res.status(400).json({ error: 'CPF inválido' });
  }
  if (b.processo && !validarCNJ(b.processo)) {
    return res.status(400).json({ error: 'Processo inválido (deve ter 20 dígitos no formato CNJ)' });
  }
  if (b.dataInicio !== undefined && !isoDate(b.dataInicio)) {
    return res.status(400).json({ error: 'Data de início inválida' });
  }
  if (b.dataFim !== undefined && b.dataFim && !isoDate(b.dataFim)) {
    return res.status(400).json({ error: 'Data de fim inválida' });
  }
  const inicioFinal = fields.dataInicio || target.dataInicio;
  if (b.dataFim !== undefined && b.dataFim && inicioFinal && String(b.dataFim).trim() < String(inicioFinal).trim()) {
    return res.status(400).json({ error: 'Data de fim não pode ser anterior à data de início' });
  }
  if (b.status !== undefined) {
    const status = String(b.status).trim();
    if (!STATUS_VALIDOS.includes(status)) return res.status(400).json({ error: 'Status inválido' });
    fields.status = status;
  }

  // Vínculo não pode ser duplicado em outro assistido
  if (fields.vinculo !== undefined && String(fields.vinculo).trim()) {
    const todos = await store.assistidos.allIncludingDeleted();
    const dup = todos.find(
      x => String(x.id) !== String(req.params.id)
        && nomeKey(x.vinculo) === nomeKey(fields.vinculo)
        && !x.deleted_at
    );
    if (dup) {
      return res.status(409).json({ error: 'Vínculo já cadastrado em outro assistido: ' + dup.nome });
    }
  }

  const row = await store.assistidos.patch(req.params.id, fields);
  if (!row) return res.status(404).json({ error: 'Não encontrado' });

  try {
    await store.audit.insert({
      kind: 'assistido', action: 'editado', personName: row.nome, ref: 'assistido#' + row.id,
      byUser: req.auth.user, byName: req.auth.name, byRole: req.auth.role,
      summary: 'Assistido editado: ' + row.nome,
    });
  } catch (e) {}
  broadcast();
  res.json(row);
}));

// =====================================================================
// DELETE /api/assistidos/:id — excluir assistido (apenas admin)
// =====================================================================
router.delete('/api/assistidos/:id(\\d+)', auth(['admin']), ah(async (req, res) => {
  const a = await store.assistidos.byId(req.params.id);
  if (!a) return res.status(404).json({ error: 'Assistido não encontrado' });
  await store.assistidos.remove(req.params.id);
  try {
    await store.audit.insert({
      kind: 'assistido', action: 'excluido', personName: a ? a.nome : '',
      ref: 'assistido#' + req.params.id, byUser: req.auth.user, byName: req.auth.name,
      byRole: req.auth.role, summary: 'Assistido excluído' + (a ? ': ' + a.nome : ''),
    });
  } catch (e) {}
  broadcast();
  res.json({ ok: true });
}));

// =====================================================================
// Comparecimentos
// =====================================================================

// GET /api/assistidos/:id/comparecimentos — listar comparecimentos de um assistido
router.get('/api/assistidos/:id(\\d+)/comparecimentos', auth(['admin', 'tecnico']), ah(async (req, res) => {
  if (!await store.assistidos.byId(req.params.id)) return res.status(404).json({ error: 'Assistido não encontrado' });
  const list = await store.assistidosComparecimentos.all(req.params.id);
  res.json(list);
}));

// GET /api/assistidos/:id/detalhe — detalhe do assistido com comparecimentos
router.get('/api/assistidos/:id(\\d+)/detalhe', auth(['admin', 'tecnico']), ah(async (req, res) => {
  const a = await store.assistidos.byId(req.params.id);
  if (!a) return res.status(404).json({ error: 'Não encontrado' });
  const comps = await store.assistidosComparecimentos.all(req.params.id);
  const sorted = comps.slice().sort((x, y) => String(y.dataComparecimento).localeCompare(String(x.dataComparecimento)));
  const pendentes = comps.filter(c => !comparecimentoProtocolado(c));
  res.json({ assistido: a, comparecimentos: sorted, pendentes: pendentes.length, total: comps.length });
}));

// POST /api/assistidos/:id/comparecimentos — registrar comparecimento
router.post('/api/assistidos/:id(\\d+)/comparecimentos', auth(['admin', 'tecnico']), ah(async (req, res) => {
  const b = req.body || {};
  if (!b.dataComparecimento) return res.status(400).json({ error: 'Data de comparecimento é obrigatória' });
  if (!isoDate(b.dataComparecimento)) {
    return res.status(400).json({ error: 'Data de comparecimento inválida (informe uma data real em AAAA-MM-DD)' });
  }
  const a = await store.assistidos.byId(req.params.id);
  if (!a) return res.status(404).json({ error: 'Assistido não encontrado' });

  // Bloqueia comparecimento duplicado no mesmo dia para o mesmo assistido
  const comps = await store.assistidosComparecimentos.all(req.params.id);
  if (comps.some(c => String(c.dataComparecimento).trim() === String(b.dataComparecimento).trim())) {
    return res.status(409).json({ error: 'Já existe comparecimento registrado nesta data para este assistido.' });
  }

  const row = await store.assistidosComparecimentos.insert({
    assistidoId: Number(req.params.id),
    dataComparecimento: String(b.dataComparecimento).trim(),
    policialPlantao: req.auth.role === 'tecnico'
      ? String(req.auth.name || req.auth.user || '').trim()
      : String(b.policialPlantao || '').trim() || '—',
    assinadoPor: String(b.assinadoPor || '').trim() || null,
  });

  try {
    await store.audit.insert({
      kind: 'assistido', action: 'comparecimento', personName: a.nome, ref: 'comparecimento#' + row.id,
      byUser: req.auth.user, byName: req.auth.name, byRole: req.auth.role,
      summary: 'Comparecimento registrado: ' + row.dataComparecimento,
    });
  } catch (e) {}
  broadcast();
  res.status(201).json(row);
}));

// PATCH /api/assistidos/comparecimentos/:id/protocolar — marcar como protocolado
router.patch('/api/assistidos/comparecimentos/:id(\\d+)/protocolar', auth(['admin', 'tecnico']), ah(async (req, res) => {
  const b = req.body || {};
  if (b.dataProtocolacao && !isoDate(b.dataProtocolacao)) return res.status(400).json({ error: 'Data de protocolação inválida' });
  const row = await store.assistidosComparecimentos.patch(req.params.id, {
    protocolado: true,
    dataProtocolacao: b.dataProtocolacao || new Date().toISOString().slice(0, 10),
    protocoladoPor: req.auth.name || req.auth.user,
    observacoes: b.observacoes || '',
  });
  if (!row) return res.status(404).json({ error: 'Comparecimento não encontrado' });
  try {
    await store.audit.insert({
      kind: 'assistido', action: 'protocolado', personName: '', ref: 'comparecimento#' + req.params.id,
      byUser: req.auth.user, byName: req.auth.name, byRole: req.auth.role,
      summary: 'Comparecimento protocolado',
    });
  } catch (e) {}
  broadcast();
  res.json(row);
}));

// PATCH /api/assistidos/comparecimentos/:id/juntada — registrar juntada
router.patch('/api/assistidos/comparecimentos/:id(\\d+)/juntada', auth(['admin', 'tecnico']), ah(async (req, res) => {
  const b = req.body || {};
  const val = String(b.juntada || '').trim();
  if (!val) return res.status(400).json({ error: 'Dados da juntada são obrigatórios' });
  const row = await store.assistidosComparecimentos.patch(req.params.id, {
    juntada: val,
    protocolado: true,
    dataProtocolacao: new Date().toISOString().slice(0, 10),
    protocoladoPor: req.auth.name || req.auth.user,
  });
  if (!row) return res.status(404).json({ error: 'Comparecimento não encontrado' });

  // Transição automática: assistido passa a concluído após juntada
  try {
    const aid = Number(row.assistidoId);
    const assistido = await store.assistidos.byId(aid);
    if (assistido && assistido.status === 'ativo') {
      await store.assistidos.patch(aid, { status: 'concluido' });
    }
  } catch (e) {}

  try {
    await store.audit.insert({
      kind: 'assistido', action: 'juntada', personName: '', ref: 'comparecimento#' + req.params.id,
      byUser: req.auth.user, byName: req.auth.name, byRole: req.auth.role,
      summary: 'Juntada registrada',
    });
  } catch (e) {}
  broadcast();
  res.json(row);
}));

// =====================================================================
// GET /api/assistidos/pendências — comparecimentos sem juntada
// =====================================================================
router.get('/api/assistidos/pendencias', auth(['admin', 'tecnico']), ah(async (req, res) => {
  const all = await store.assistidosComparecimentos.all();
  const assistidos = await store.assistidos.all();
  const byId = new Map(assistidos.map(a => [String(a.id), a]));
  const out = all.filter(c => !comparecimentoProtocolado(c) && byId.has(String(c.assistidoId)))
    .map(c => ({ ...c, assistido: byId.get(String(c.assistidoId)) }));
  res.json(paginar(out, req.query.page, req.query.limit));
}));

// =====================================================================
// GET /api/assistidos/stats — quantitativos
// =====================================================================
router.get('/api/assistidos/stats', auth(['admin', 'tecnico']), ah(async (req, res) => {
  const assistidos = await store.assistidos.all();
  const comps = await store.assistidosComparecimentos.all();
  const pend = comps.filter(c => !comparecimentoProtocolado(c));

  const porVara = {};
  const porPolicial = {};
  const porMes = {};
  const porStatus = {};
  const porLocal = {};

  assistidos.forEach(a => { porVara[a.vara || '—'] = (porVara[a.vara || '—'] || 0) + 1; });
  assistidos.forEach(a => { porStatus[a.status || '—'] = (porStatus[a.status || '—'] || 0) + 1; });
  assistidos.forEach(a => { porLocal[a.localAssinatura || '—'] = (porLocal[a.localAssinatura || '—'] || 0) + 1; });

  comps.forEach(c => {
    const p = c.policialPlantao || '—';
    porPolicial[p] = (porPolicial[p] || 0) + 1;
    const mes = String(c.dataComparecimento || '').slice(0, 7) || '—';
    porMes[mes] = (porMes[mes] || 0) + 1;
  });

  res.json({
    totalAssistidos: assistidos.length,
    totalComparecimentos: comps.length,
    totalPendencias: pend.length,
    totalProtocolados: comps.length - pend.length,
    porVara: Object.entries(porVara).map(([vara, total]) => ({ vara, total })).sort((a, b) => b.total - a.total),
    porPolicial: Object.entries(porPolicial).map(([policial, total]) => ({ policial, total })).sort((a, b) => b.total - a.total),
    porMes: Object.entries(porMes).map(([mes, total]) => ({ mes, total })).sort((a, b) => a.mes.localeCompare(b.mes)),
    porStatus: Object.entries(porStatus).map(([s, total]) => ({ status: s, total })).sort((a, b) => b.total - a.total),
    porLocal: Object.entries(porLocal).map(([l, total]) => ({ local: l, total })).sort((a, b) => b.total - a.total),
  });
}));

// =====================================================================
// GET /api/assistidos/filtrar — listagem filtrada com paginação
// =====================================================================
router.get('/api/assistidos/filtrar', auth(['admin', 'tecnico']), ah(async (req, res) => {
  const { q, nome, vinculo, processo, vara, local, status, frequencia, etiqueta, dataProtocolo, usuarioProtocolo, protoDe, protoAte } = req.query || {};
  let list = await store.assistidos.all();

  const applyText = (field, value) => {
    const t = String(value).toLowerCase();
    list = list.filter(a => String(a[field] || '').toLowerCase().includes(t));
  };

  if (q) {
    const t = String(q).toLowerCase();
    list = list.filter(a =>
      (a.nome || '').toLowerCase().includes(t)
      || (a.processo || '').toLowerCase().includes(t)
      || (a.vinculo || '').toLowerCase().includes(t)
    );
  }
  if (nome) applyText('nome', nome);
  if (vinculo) applyText('vinculo', vinculo);
  if (processo) applyText('processo', processo);
  if (vara) applyText('vara', vara);
  if (local) applyText('localAssinatura', local);
  if (status) applyText('status', status);
  if (frequencia) applyText('frequencia', frequencia);
  if (etiqueta) applyText('etiqueta', etiqueta);

  if (dataProtocolo || usuarioProtocolo || protoDe || protoAte) {
    const comps = await store.assistidosComparecimentos.all();
    const compsMap = groupCompsByAssistido(comps);
    list = list.filter(a => {
      const cs = compsMap.get(String(a.id)) || [];
      return cs.some(c => {
        if (dataProtocolo && !String(c.dataProtocolacao || '').includes(dataProtocolo)) return false;
        if (usuarioProtocolo && !String(c.protocoladoPor || '').toLowerCase().includes(String(usuarioProtocolo).toLowerCase())) return false;
        if (protoDe && (!c.dataProtocolacao || String(c.dataProtocolacao) < protoDe)) return false;
        if (protoAte && (!c.dataProtocolacao || String(c.dataProtocolacao) > protoAte)) return false;
        return true;
      });
    });
  }

  list = list.slice().sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));
  res.json(paginar(list, req.query.page, req.query.limit));
}));

// =====================================================================
// GET /api/assistidos/relatorio/pdf — relatório em PDF
// =====================================================================
router.get('/api/assistidos/relatorio/pdf', auth(['admin', 'tecnico']), ah(async (req, res) => {
  const { q, nome, vinculo, processo, vara, local, status, frequencia, etiqueta,
    dataProtocolo, usuarioProtocolo, protoDe, protoAte, campos } = req.query || {};

  let list = await store.assistidos.all();

  if (q) {
    const t = String(q).toLowerCase();
    list = list.filter(a =>
      (a.nome || '').toLowerCase().includes(t)
      || (a.processo || '').toLowerCase().includes(t)
      || (a.vinculo || '').toLowerCase().includes(t)
    );
  }
  if (nome) { const t = String(nome).toLowerCase(); list = list.filter(a => (a.nome || '').toLowerCase().includes(t)); }
  if (vinculo) { const t = String(vinculo).toLowerCase(); list = list.filter(a => (a.vinculo || '').toLowerCase().includes(t)); }
  if (processo) { const t = String(processo).toLowerCase(); list = list.filter(a => (a.processo || '').toLowerCase().includes(t)); }
  if (vara) list = list.filter(a => String(a.vara || '').toLowerCase().includes(String(vara).toLowerCase()));
  if (local) list = list.filter(a => String(a.localAssinatura || '').toLowerCase().includes(String(local).toLowerCase()));
  if (status) list = list.filter(a => String(a.status || '').toLowerCase().includes(String(status).toLowerCase()));
  if (frequencia) list = list.filter(a => String(a.frequencia || '').toLowerCase().includes(String(frequencia).toLowerCase()));
  if (etiqueta) list = list.filter(a => String(a.etiqueta || '').toLowerCase().includes(String(etiqueta).toLowerCase()));

  const comps = await store.assistidosComparecimentos.all();
  const compsMap = groupCompsByAssistido(comps);
  if (dataProtocolo || usuarioProtocolo || protoDe || protoAte) {
    list = list.filter(a => {
      const cs = compsMap.get(String(a.id)) || [];
      return cs.some(c => {
        if (dataProtocolo && !String(c.dataProtocolacao || '').includes(dataProtocolo)) return false;
        if (usuarioProtocolo && !String(c.protocoladoPor || '').toLowerCase().includes(String(usuarioProtocolo).toLowerCase())) return false;
        if (protoDe && (!c.dataProtocolacao || String(c.dataProtocolacao) < protoDe)) return false;
        if (protoAte && (!c.dataProtocolacao || String(c.dataProtocolacao) > protoAte)) return false;
        return true;
      });
    });
  }

  list = list.map(a => {
    const cs = compsMap.get(String(a.id)) || [];
    const last = cs[0] || {};
    const protocolado = cs.find(comparecimentoProtocolado) || {};
    return {
      ...a,
      ultimoComparecimento: last.dataComparecimento || null,
      policialPlantao: last.policialPlantao || null,
      juntada: last.juntada || null,
      dataProtocolacao: protocolado.dataProtocolacao || null,
      protocoladoPor: protocolado.protocoladoPor || null,
    };
  });
  list = list.slice().sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));

  const pdfTruncado = list.length > MAX_PDF_ROWS;
  list = list.slice(0, MAX_PDF_ROWS);

  const CAMPOS_PERMITIDOS = [
    'vinculo', 'nome', 'processo', 'vara', 'localAssinatura', 'dataInicio', 'status',
    'ultimoComparecimento', 'policialPlantao', 'juntada', 'dataProtocolacao',
    'protocoladoPor', 'cpf', 'telefone', 'endereco', 'situacaoJuridica', 'tipoMedida',
    'cargaHoraria', 'dataFim', 'frequencia', 'etiqueta',
  ];
  const defaults = 'vinculo,nome,processo,vara,localAssinatura,dataInicio,status,ultimoComparecimento,policialPlantao,juntada,dataProtocolacao,protocoladoPor';
  const camposSel = (campos || defaults)
    .split(',')
    .filter(Boolean)
    .filter(k => CAMPOS_PERMITIDOS.includes(k));
  if (camposSel.length === 0) camposSel.push('vinculo', 'nome', 'processo', 'vara', 'localAssinatura', 'dataInicio', 'status');

  const labels = {
    vinculo: 'Vínculo', nome: 'Nome', processo: 'Processo', vara: 'Vara',
    localAssinatura: 'Local', dataInicio: 'Início', status: 'Status',
    ultimoComparecimento: 'Últ. Comparecimento', policialPlantao: 'Policial',
    juntada: 'Juntada', dataProtocolacao: 'Protocolado em', protocoladoPor: 'Protocolado por',
  };
  const fmtBR = (v) => {
    if (!v) return '—';
    const s = String(v).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
      const [y, m, d] = s.slice(0, 10).split('-');
      return d + '/' + m + '/' + y;
    }
    return s;
  };

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 595.28, H = 841.89, M = 40;
  let page = pdf.addPage([W, H]);
  let y = H - M;
  let totalPages = 1;
  let currentPage = 0;

  function drawHeader(pg, pageNum) {
    pg.drawText('Relatório de Assistidos — SISUMEPE Juazeiro', {
      x: M, y: H - M, size: 14, font: boldFont, color: rgb(0.1, 0.2, 0.5),
    });
    pg.drawText('Gerado em: ' + new Date().toLocaleString('pt-BR', { timeZone: 'America/Fortaleza' }), {
      x: M, y: H - M - 18, size: 8, font, color: rgb(0.4, 0.4, 0.4),
    });
    const totalMsg = 'Total de registros: ' + list.length + (pdfTruncado ? ' (limite de ' + MAX_PDF_ROWS + ' aplicado)' : '');
    pg.drawText(totalMsg, { x: M, y: H - M - 30, size: 9, font: boldFont, color: rgb(0, 0, 0) });
    pg.drawText('Página ' + pageNum + ' de ' + totalPages, {
      x: W - M - 80, y: H - M, size: 8, font, color: rgb(0.4, 0.4, 0.4),
    });
    pg.drawRectangle({ x: M, y: H - M - 46, width: W - 2 * M, height: 14, color: rgb(0.2, 0.3, 0.6) });
    const colW = (W - 2 * M) / camposSel.length;
    let hx = M;
    camposSel.forEach(k => {
      let txt = String(labels[k] || k);
      while (txt.length > 1 && boldFont.widthOfTextAtSize(txt, 7.5) > colW - 6) {
        txt = txt.slice(0, -1);
      }
      pg.drawText(txt, { x: hx + 2, y: H - M - 42, size: 7.5, font: boldFont, color: rgb(1, 1, 1) });
      hx += colW;
    });
    return H - M - 62;
  }

  const rowH = 14;
  const estRowsPerPage = Math.floor((H - 2 * M - 80) / (rowH + 4));
  totalPages = Math.max(1, Math.ceil(list.length / estRowsPerPage));
  currentPage = 1;

  let cy = drawHeader(page, currentPage);
  list.forEach((a, i) => {
    if (cy < M + 30) {
      currentPage++;
      page = pdf.addPage([W, H]);
      cy = drawHeader(page, currentPage);
    }
    if (i % 2 === 0) {
      page.drawRectangle({ x: M, y: cy - rowH + 2, width: W - 2 * M, height: rowH, color: rgb(0.97, 0.97, 0.98) });
    }
    const colW = (W - 2 * M) / camposSel.length;
    let px = M;
    camposSel.forEach(k => {
      let v = a[k];
      if (k === 'dataInicio' || k === 'ultimoComparecimento' || k === 'dataProtocolacao') v = fmtBR(v);
      let txt = String(v || '—');
      while (txt.length > 1 && font.widthOfTextAtSize(txt, 7.5) > colW - 6) {
        txt = txt.slice(0, -1);
      }
      page.drawText(txt, { x: px + 2, y: cy - 10, size: 7.5, font, color: rgb(0, 0, 0) });
      px += colW;
    });
    cy -= rowH + 4;
  });

  const bytes = await pdf.save();
  const buf = Buffer.from(bytes);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="relatorio-assistidos.pdf"');
  res.send(buf);
}));

// =====================================================================
// GET /api/assistidos/pendencias-comparecimento — vencidos
// =====================================================================
router.get('/api/assistidos/pendencias-comparecimento', auth(['admin', 'tecnico']), ah(async (req, res) => {
  const assistidos = await store.assistidos.all();
  const comps = await store.assistidosComparecimentos.all();
  const hoje = new Date().toISOString().slice(0, 10);
  const ultimo = ultimoCompPorAssistido(comps);
  const compsMap = groupCompsByAssistido(comps);

  const out = [];
  for (const a of assistidos) {
    if (a.status && a.status !== 'ativo') continue;
    const prox = ultimo[String(a.id)]
      ? proximoEsperadoAssistidoFromBase(ultimo[String(a.id)].dataComparecimento, a.frequencia)
      : proximoEsperadoAssistido(a, compsMap.get(String(a.id)) || []);
    if (!prox) continue;
    if (prox <= hoje) {
      const last = ultimo[String(a.id)];
      out.push({
        ...a,
        ultimoComparecimento: last ? last.dataComparecimento : null,
        proximoEsperado: prox,
      });
    }
  }

  res.json(paginar(out, req.query.page, req.query.limit));
}));

// =====================================================================
// GET /api/assistidos/fluxo — kanban por etapa
// =====================================================================
router.get('/api/assistidos/fluxo', auth(['admin', 'tecnico']), ah(async (req, res) => {
  const assistidos = await store.assistidos.all();
  const comps = await store.assistidosComparecimentos.all();
  const hoje = new Date().toISOString().slice(0, 10);
  const etapas = {
    aguardando: [],
    compareceu: [],
    atrasado: [],
    protocolado: [],
    concluido: [],
  };

  const ultimo = ultimoCompPorAssistido(comps);

  for (const a of assistidos) {
    if (a.status === 'concluido' || a.status === 'arquivado') {
      etapas.concluido.push(a);
      continue;
    }
    const last = ultimo[String(a.id)];
    if (!last) {
      etapas.aguardando.push(a);
      continue;
    }

    const prox = proximoEsperadoAssistidoFromBase(last.dataComparecimento, a.frequencia);
    const vencido = prox && prox <= hoje;

    const base = {
      ...a,
      ultimoComparecimento: last.dataComparecimento,
      compId: last.id,
      juntada: last.juntada,
      policialPlantao: last.policialPlantao,
      dataProtocolacao: last.dataProtocolacao || null,
      protocoladoPor: last.protocoladoPor || null,
      proximoEsperado: prox,
    };

    if (comparecimentoProtocolado(last)) {
      etapas.protocolado.push({ ...base, vencido });
    } else if (vencido) {
      etapas.atrasado.push({ ...base, vencido: true });
    } else {
      etapas.compareceu.push({ ...base, vencido: false });
    }
  }

  res.json(etapas);
}));

// =====================================================================
// GET /api/assistidos/pendentes-vinculo — vínculos PENDENTE-
// =====================================================================
router.get('/api/assistidos/pendentes-vinculo', auth(['admin', 'tecnico']), ah(async (req, res) => {
  const todos = await store.assistidos.allIncludingDeleted();
  const pendentes = todos.filter(a => String(a.vinculo || '').startsWith('PENDENTE-') && !a.deleted_at);
  res.json(pendentes.sort((a, b) => String(a.vinculo || '').localeCompare(String(b.vinculo || ''))));
}));

// =====================================================================
// PATCH /api/assistidos/bulk-vinculo — edição em lote de vínculos pendentes
// =====================================================================
router.patch('/api/assistidos/bulk-vinculo', auth(['admin']), ah(async (req, res) => {
  const { items } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Informe a lista de itens para atualizar' });
  }

  // Carrega todos os assistidos uma única vez (evita N+1)
  const todos = await store.assistidos.allIncludingDeleted();
  const vinculosEmUso = new Map();
  todos.forEach(x => {
    if (x.deleted_at) return;
    vinculosEmUso.set(String(x.vinculo || '').trim().toLowerCase(), String(x.id));
  });

  let atualizados = 0;
  let erros = 0;
  const detalhes = [];

  for (const item of items) {
    const { id, vinculo } = item;
    if (!id || !vinculo || String(vinculo).trim() === '') {
      erros++;
      detalhes.push({ id, erro: 'ID e vínculo são obrigatórios' });
      continue;
    }

    const vinculoNorm = String(vinculo).trim();
    const vinculoKey = vinculoNorm.toLowerCase();

    try {
      const existingId = vinculosEmUso.get(vinculoKey);
      if (existingId && String(existingId) !== String(id)) {
        const dup = todos.find(x => String(x.id) === String(existingId));
        erros++;
        detalhes.push({
          id, vinculo: vinculoNorm,
          erro: `Vínculo já cadastrado em outro assistido (${dup ? dup.nome : 'desconhecido'})`,
        });
        continue;
      }

      const atualizado = await store.assistidos.patch(id, { vinculo: vinculoNorm });
      if (atualizado) {
        const prev = todos.find(x => String(x.id) === String(id));
        const oldKey = prev ? String(prev.vinculo || '').trim().toLowerCase() : '';
        if (oldKey && oldKey !== vinculoKey) vinculosEmUso.delete(oldKey);
        vinculosEmUso.set(vinculoKey, String(id));
        atualizados++;
        detalhes.push({ id, vinculo: atualizado.vinculo, status: 'atualizado' });
      } else {
        erros++;
        detalhes.push({ id, erro: 'Assistido não encontrado' });
      }
    } catch (e) {
      erros++;
      detalhes.push({ id, erro: e.message });
    }
  }

  const todosApós = await store.assistidos.allIncludingDeleted();
  const pendentes = todosApós.filter(a => String(a.vinculo || '').startsWith('PENDENTE-') && !a.deleted_at);

  res.json({
    atualizados,
    erros,
    total: items.length,
    pendentesRestantes: pendentes.length,
    detalhes,
  });
}));

// =====================================================================
// GET /api/assistidos/alertas — semáforo EM_DIA / ATENCAO / CRITICO
// =====================================================================
router.get('/api/assistidos/alertas', auth(['admin', 'tecnico']), ah(async (req, res) => {
  const assistidos = await store.assistidos.all();
  const comps = await store.assistidosComparecimentos.all();
  const hoje = new Date().toISOString().slice(0, 10);
  const hojeDate = new Date(hoje);
  const ultimo = ultimoCompPorAssistido(comps);
  const historicos = groupCompsByAssistido(comps);

  const alertas = [];
  for (const a of assistidos) {
    if (a.status !== 'ativo') continue;

    // Base: último comparecimento, ou data de início se nunca compareceu
    const last = ultimo[String(a.id)];
    const base = last ? last.dataComparecimento : a.dataInicio;
    if (!isoDate(base)) continue;
    const ultimoProtocolo = (historicos.get(String(a.id)) || []).find(comparecimentoProtocolado);
    const diasProtocolacao = ultimoProtocolo && isoDate(ultimoProtocolo.dataProtocolacao)
      ? Math.floor((hojeDate - new Date(ultimoProtocolo.dataProtocolacao)) / 86400000)
      : null;

    const ultimaData = new Date(base);
    if (isNaN(ultimaData)) continue;

    const freqDias = FREQ_DAYS[a.frequencia] || 30;
    const diasDiff = Math.floor((hojeDate - ultimaData) / (1000 * 60 * 60 * 24));
    const diasAteProximo = freqDias - diasDiff;

    let tipo = 'EM_DIA';
    if (diasDiff > freqDias) tipo = 'CRITICO';
    else if (diasAteProximo <= 7 || diasDiff > Math.ceil(freqDias * 0.5)) tipo = 'ATENCAO';

    // Só alerta se já passou do prazo ou está prestes a vencer (7 dias)
    if (diasDiff > freqDias || diasAteProximo <= 7) {
      alertas.push({
        assistidoId: a.id,
        nome: a.nome,
        vinculo: a.vinculo,
        tipo,
        diasUltimaJuntada: diasProtocolacao,
        diasUltimoComparecimento: last ? diasDiff : null,
        diasAteProximo: diasAteProximo > 0 ? diasAteProximo : 0,
        frequencia: a.frequencia,
        ultimaJuntada: ultimoProtocolo ? ultimoProtocolo.dataProtocolacao : null,
        ultimoComparecimento: last ? last.dataComparecimento : null,
        base,
        local: a.localAssinatura,
        vara: a.vara,
      });
    }
  }

  alertas.sort((a, b) => {
    const ordem = { CRITICO: 0, ATENCAO: 1, EM_DIA: 2 };
    return (ordem[a.tipo] ?? 99) - (ordem[b.tipo] ?? 99);
  });

  res.json(paginar(alertas, req.query.page, req.query.limit));
}));

// =====================================================================
// GET /api/assistidos/buscar — busca fuzzy por nome, vínculo e processo
// =====================================================================
router.get('/api/assistidos/buscar', auth(['admin', 'tecnico']), ah(async (req, res) => {
  const { q } = req.query || {};
  if (!q || String(q).trim().length < 3) {
    return res.status(400).json({ error: 'Informe pelo menos 3 caracteres para busca' });
  }

  const qLower = String(q).trim().toLowerCase();
  const assistidos = await store.assistidos.all();

  function scoreRelevancia(a) {
    const nome = String(a.nome || '').toLowerCase();
    const vinculo = String(a.vinculo || '').toLowerCase();
    const processo = String(a.processo || '').toLowerCase();
    let score = 0;
    if (nome.startsWith(qLower)) score += 100;
    else if (nome.includes(qLower)) score += 50;
    if (vinculo === qLower) score += 80;
    else if (vinculo.startsWith(qLower)) score += 60;
    else if (vinculo.includes(qLower)) score += 30;
    if (processo.includes(qLower)) score += 40;
    return score;
  }

  const resultados = assistidos
    .map(a => ({ a, score: scoreRelevancia(a) }))
    .filter(({ score }) => score > 0)
    .sort((x, y) => y.score - x.score);

  const exatos = resultados.filter(r => String(r.a.nome).toLowerCase().includes(qLower)).map(r => r.a);
  const fuzzy = resultados.filter(r => !exatos.includes(r.a)).map(r => r.a);

  res.json({ exatos, fuzzy, total: exatos.length + fuzzy.length });
}));

// =====================================================================
// PATCH /api/assistidos/:id/etiqueta — verificado / pendente / ''
// =====================================================================
router.patch('/api/assistidos/:id(\\d+)/etiqueta', auth(['admin', 'tecnico']), ah(async (req, res) => {
  const { etiqueta } = req.body || {};
  if (!ETIQUETAS_VALIDAS.includes(etiqueta)) {
    return res.status(400).json({ error: 'Etiqueta inválida. Use: verificado, pendente ou vazio' });
  }
  const target = await store.assistidos.byId(req.params.id);
  if (!target) return res.status(404).json({ error: 'Assistido não encontrado' });

  // Técnico só pode etiquetar assistidos de sua responsabilidade
  if (req.auth.role === 'tecnico') {
    const comps = await store.assistidosComparecimentos.all(req.params.id);
    const meu = comps.some(c => String(c.policialPlantao || '').toLowerCase() === String(req.auth.name || req.auth.user).toLowerCase());
    if (!meu) return res.status(403).json({ error: 'Técnico só pode etiquetar assistidos de sua responsabilidade.' });
  }

  const row = await store.assistidos.patch(req.params.id, { etiqueta });
  if (!row) return res.status(404).json({ error: 'Assistido não encontrado ou não foi possível atualizar' });
  try {
    await store.audit.insert({
      kind: 'assistido', action: 'etiqueta', personName: row.nome, ref: 'assistido#' + row.id,
      byUser: req.auth.user, byName: req.auth.name, byRole: req.auth.role,
      summary: 'Etiqueta: ' + etiqueta,
    });
  } catch (e) {}
  res.json({ id: row.id, etiqueta: row.etiqueta });
}));

// =====================================================================
// Importação assíncrona de Excel
// =====================================================================
let lastImportStatus = { state: 'idle', total: 0, processed: 0, totalRows: 0, progress: 0, error: null, at: null };

function excelSerialToISO(v) {
  if (v == null || v === '') return '';
  if (v instanceof Date) {
    const iso = v.toISOString().slice(0, 10);
    return isoDate(iso) ? iso : '';
  }
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return isoDate(s.slice(0, 10)) ? s.slice(0, 10) : '';
  if (/^\d{4,6}$/.test(s)) {
    const d = new Date((Number(s) - 25569) * 86400 * 1000);
    if (!isNaN(d)) return d.toISOString().slice(0, 10);
  }
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    let [, dd, mm, yyyy] = m;
    if (yyyy.length === 2) yyyy = '20' + yyyy;
    const y = Number(yyyy), month = Number(mm), day = Number(dd);
    const d = new Date(Date.UTC(y, month - 1, day));
    if (!isNaN(d) && d.getUTCFullYear() === y && d.getUTCMonth() === month - 1 && d.getUTCDate() === day) return d.toISOString().slice(0, 10);
  }
  return s;
}

function normFreq(v) {
  const s = String(v || '').trim().toLowerCase();
  if (s.startsWith('sem')) return 'semanal';
  if (s.startsWith('quin')) return 'quinzenal';
  if (s.startsWith('bim')) return 'bimestral';
  if (s.startsWith('trim')) return 'trimestral';
  return 'mensal';
}

router.get('/api/assistidos/import/status', auth(['admin']), ah(async (req, res) => {
  res.json(lastImportStatus);
}));

router.post('/api/assistidos/import', auth(['admin']), upload.single('arquivo'), ah(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Envie o arquivo .xlsx' });
  if (lastImportStatus.state === 'running') return res.status(409).json({ error: 'Já existe uma importação em andamento.' });
  const buffer = req.file.buffer;
  lastImportStatus = {
    state: 'running', total: 0, processed: 0, totalRows: 0, progress: 0,
    error: null, at: new Date().toISOString(),
  };
  res.json({ ok: true, assincrono: true, msg: 'Importação iniciada em background.' });

  setImmediate(async () => {
    let total = 0;
    let failedRows = 0;
    try {
      const ExcelJS = require('exceljs');
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      let totalRows = 0;
      const allExisting = await store.assistidos.all();
      const seenVinculo = new Set(allExisting.map(a => nomeKey(a.vinculo)));

      const LOCAIS_VALIDOS = ['COAP CARIRI', 'COMEP CARIRI', 'ALBERGADO CARIRI'];
      const PPS_CONHECIDOS = ['ERMINIO', 'MARCOS', 'WANDERSON', 'JOANDERSON', 'JULIANA', 'REJANE', 'AILTON'];

      function isProcessoLike(v) {
        const s = String(v || '').trim();
        if (!s) return false;
        if (/^(ARQUIVADO|INATIVO|SEM DIGITAL)$/i.test(s)) return true;
        return /^\d{7,}[\-\.]\d{2}[\.\-]\d{4}\.\d\.\d{2}\.\d{4}$/.test(s)
          || /^\d{7,}[\-\.]\d{2}$/.test(s);
      }
      function isLocalLike(v) {
        return LOCAIS_VALIDOS.includes(String(v || '').trim().toUpperCase());
      }
      function isFrequenciaLike(v) {
        const s = String(v || '').trim().toUpperCase();
        return /^(SEMANAL|MENSAL|QUINZENAL|BIMENSAL|TRIMENSAL|DIÁRIA|DIARIA|QUINQUEMESTRAL)$/.test(s);
      }
      function isDataLike(v) {
        if (v instanceof Date) return true;
        const s = String(v || '').trim();
        if (!s) return false;
        return /^\d{4}-\d{2}-\d{2}$/.test(s)
          || /^\d{2}\/\d{2}\/\d{4}$/.test(s)
          || /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s);
      }
      function isVaraLike(v) {
        const s = String(v || '').trim().toUpperCase();
        return /VARA|JUIZADO|NÚCLEO|NUCLEO/.test(s);
      }
      function classifyCell(val) {
        if (val == null) return 'vazio';
        if (val instanceof Date) return 'data';
        const s = String(val).trim();
        if (!s) return 'vazio';
        const u = s.toUpperCase();
        if (isProcessoLike(s)) return 'processo';
        if (isLocalLike(s)) return 'local';
        if (isFrequenciaLike(s)) return 'frequencia';
        if (isDataLike(s)) return 'data';
        if (isVaraLike(s)) return 'vara';
        if (PPS_CONHECIDOS.includes(u)) return 'pp';
        return 'texto';
      }
      function lerLinhaAssistido(row) {
        const campos = {
          vinculo: '', nome: '', processo: '', vara: '', localAssinatura: '',
          dataInicio: '', frequencia: 'mensal', dataComparecimento: '', policialPlantao: '',
          observacao: '', status: 'ativo',
        };
        let melhorNome = '';
        row.eachCell((c, colIdx) => {
          const v = row.getCell(colIdx).value;
          const tipo = classifyCell(v);
          const s = String(v || '').trim();
          const u = s.toUpperCase();
          switch (tipo) {
            case 'processo':
              if (!campos.vinculo) campos.vinculo = s;
              else if (!campos.processo) campos.processo = s;
              break;
            case 'local':
              if (!campos.localAssinatura) campos.localAssinatura = s;
              break;
            case 'frequencia':
              if (!campos.frequencia || campos.frequencia === 'mensal') campos.frequencia = normFreq(s);
              break;
            case 'data': {
              const iso = excelSerialToISO(v);
              if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
                if (!campos.dataInicio) campos.dataInicio = iso;
                else if (!campos.dataComparecimento) campos.dataComparecimento = iso;
              }
              break;
            }
            case 'vara':
              if (!campos.vara) campos.vara = s;
              break;
            case 'pp':
              if (!campos.policialPlantao) campos.policialPlantao = s;
              break;
            case 'texto':
              if (/^\d{1,4}$/.test(s)) break;
              if (!melhorNome && s.split(/\s+/).filter(Boolean).length >= 2
                && !/ARQUIVADO|INATIVO|SEM DIGITAL|JUNTADA|SEEU|FLS|PROTOCOL/.test(u)) {
                melhorNome = s;
              } else if (!campos.observacao && s.length > 3) {
                campos.observacao = s;
              }
              break;
          }
        });
        if (melhorNome) campos.nome = melhorNome;
        if (!campos.processo && campos.vinculo && isProcessoLike(campos.vinculo)) {
          campos.processo = campos.vinculo;
        }
        campos.frequencia = normFreq(campos.frequencia);
        if (/ARQUIVADO/.test(String(campos.processo).toUpperCase()) || /ARQUIVADO/.test(String(campos.vara).toUpperCase())) {
          campos.status = 'arquivado';
        }
        return campos;
      }

      // Primeira passagem: contar linhas válidas
      for (const ws of wb.worksheets) {
        ws.eachRow((row, idx) => {
          if (idx === 1) return;
          let temDado = false;
          row.eachCell((c) => { if (c.value != null && String(c.value).trim()) temDado = true; });
          if (!temDado) return;
          const campos = lerLinhaAssistido(row);
          if (!campos.vinculo || !campos.nome) return;
          if (seenVinculo.has(nomeKey(campos.vinculo))) return;
          totalRows++;
        });
      }
      lastImportStatus.totalRows = totalRows;

      // Segunda passagem: coletar e processar
      const linhasParaProcessar = [];
      for (const ws of wb.worksheets) {
        ws.eachRow((row, idx) => {
          if (idx === 1) return;
          let temDado = false;
          row.eachCell((c) => { if (c.value != null && String(c.value).trim()) temDado = true; });
          if (!temDado) return;
          const campos = lerLinhaAssistido(row);
          const { vinculo, nome } = campos;
          if (!vinculo || !nome) return;
          if (seenVinculo.has(nomeKey(vinculo))) return;
          linhasParaProcessar.push({ campos });
        });
      }

      for (const { campos } of linhasParaProcessar) {
        const { vinculo } = campos;
        if (seenVinculo.has(nomeKey(vinculo))) continue;
        try {
          let localFinal = campos.localAssinatura;
          if (!LOCAIS_ASSINATURA.includes(localFinal)) localFinal = '';
          if (!localFinal) localFinal = 'COMEP Cariri';

          const processoFinal = campos.processo || '';
          const varaFinal = campos.vara || '';
          const statusFinal = (processoFinal.toUpperCase() === 'ARQUIVADO'
            || varaFinal.toUpperCase() === 'ARQUIVADO' || campos.status === 'arquivado')
            ? 'arquivado' : 'ativo';

          const a = await store.assistidos.insert({
            vinculo,
            nome: campos.nome,
            processo: processoFinal,
            vara: varaFinal,
            localAssinatura: localFinal,
            dataInicio: campos.dataInicio || '',
            frequencia: campos.frequencia,
            status: statusFinal,
          });
          seenVinculo.add(nomeKey(vinculo));
          total++;
          lastImportStatus.processed = total;
          lastImportStatus.progress = lastImportStatus.totalRows > 0
            ? Math.round((total / lastImportStatus.totalRows) * 100) : 0;
          lastImportStatus.at = new Date().toISOString();

          if (isoDate(campos.dataComparecimento)) {
            const cmp = await store.assistidosComparecimentos.insert({
              assistidoId: a.id,
              dataComparecimento: campos.dataComparecimento,
              policialPlantao: campos.policialPlantao || '—',
            });
            if (campos.observacao) {
              await store.assistidosComparecimentos.patch(cmp.id, { juntada: campos.observacao });
            }
          }

        } catch (e) {
          failedRows++;
          lastImportStatus.failures = failedRows;
          lastImportStatus.lastError = String(e && e.message || e).slice(0, 250);
          console.error('import row error', e.message);
        }
      }

      lastImportStatus = { state: failedRows ? 'done_with_errors' : 'done', total, failures: failedRows, error: null, at: new Date().toISOString() };
      shared.broadcast({ type: 'assistidos_import_done', total });
      console.log('[assistidos] importação concluída:', total);
    } catch (e) {
      console.error('[assistidos] importação falhou:', e && e.stack ? e.stack : e.message);
      lastImportStatus = {
        state: 'error', total, failures: failedRows,
        error: String(e && e.message ? e.message : e), at: new Date().toISOString(),
      };
    }
  });
}));

module.exports = router;
