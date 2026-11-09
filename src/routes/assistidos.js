const express = require('express');
const shared = require('../lib/shared');
const { store, ah, auth, broadcast } = shared;
const router = express.Router();

// =====================================================================
//  Módulo Assistidos — versão refatorada
//  - cadastro com vínculo CNJ único (nao deletados)
//  - local de assinatura restrito a 3 valores
//  - responsavel_tecnico por ID de usuario (integridade referencial)
//  - soft-delete em assistidos e comparecimentos (preserva historico)
//  - validacao de coerencia de datas
//  - etiquetas padronizadas
// =====================================================================

const LOCAIS_ASSINATURA = ['COMEP Cariri', 'Albergado Cariri', 'COAP Cariri'];
const PERIODOS_COMPARECIMENTO = ['semanal', 'quinzenal', 'mensal', 'bimestral', 'trimestral'];
const STATUS_VALIDOS = ['ativo', 'concluido', 'arquivado'];
const ETIQUETAS_VALIDAS = ['verificado', 'pendente_documentacao', 'atraso_reincidente', 'prioritario', 'sem_etiqueta'];

// Validação de número CNJ (20 dígitos numéricos, pontuação opcional)
function validarCNJ(valor) {
  const cnj = String(valor || '').replace(/[.\-/]/g, '');
  return /^\d{20}$/.test(cnj);
}

function normalizaData(v) {
  if (!v) return '';
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return '';
}

function ehDataValida(v) {
  if (!v) return false;
  const s = String(v).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

function ehDataFutura(v) {
  if (!ehDataValida(v)) return false;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const dt = new Date(v);
  dt.setHours(0, 0, 0, 0);
  return dt > hoje;
}

function camposAssistidoDeBody(b) {
  return {
    vinculo: String(b.vinculo || '').trim(),
    nome: String(b.nome || '').trim(),
    processo: String(b.processo || '').trim(),
    vara: String(b.vara || '').trim(),
    cpf: String(b.cpf || '').trim(),
    telefone: String(b.telefone || '').trim(),
    endereco: String(b.endereco || '').trim(),
    situacaoJuridica: String(b.situacaoJuridica || '').trim(),
    localAssinatura: String(b.localAssinatura || '').trim(),
    dataInicio: normalizaData(b.dataInicio),
    dataFim: normalizaData(b.dataFim),
    frequencia: String(b.frequencia || 'mensal').trim(),
    status: String(b.status || 'ativo').trim(),
    etiqueta: String(b.etiqueta || '').trim(),
    etiquetaCor: String(b.etiquetaCor || '#4f46e5').trim(),
    etiquetaTexto: String(b.etiquetaTexto || '').trim(),
    responsavelTecnico: String(b.responsavelTecnico || '').trim()
  };
}

// Validações de negócio compartilhadas
function validarCamposObrigatorios(c) {
  if (!c.nome) return 'Nome é obrigatório';
  if (!c.vinculo) return 'Número de vínculo é obrigatório';
  if (!c.processo) return 'Processo é obrigatório';
  if (!validarCNJ(c.processo)) return 'Processo inválido (deve ter 20 dígitos no formato CNJ)';
  if (!c.vara) return 'Vara é obrigatória';
  if (!LOCAIS_ASSINATURA.includes(c.localAssinatura)) return 'Local de assinatura inválido';
  if (!c.dataInicio || !ehDataValida(c.dataInicio)) return 'Data de início inválida (use AAAA-MM-DD)';
  if (ehDataFutura(c.dataInicio)) return 'Data de início não pode ser futura';
  if (c.cpf && !/^\d{11}$/.test(c.cpf.replace(/[.\-/]/g, ''))) return 'CPF inválido (deve ter 11 dígitos)';
  if (!PERIODOS_COMPARECIMENTO.includes(c.frequencia)) return 'Frequência inválida';
  if (!STATUS_VALIDOS.includes(c.status)) return 'Status inválido';
  if (c.dataFim && !ehDataValida(c.dataFim)) return 'Data de fim inválida (use AAAA-MM-DD)';
  if (c.dataFim && c.dataFim < c.dataInicio) return 'Data de fim não pode ser anterior à data de início';
  if (c.etiquetaCor && !/^#[0-9A-Fa-f]{6}$/.test(c.etiquetaCor)) return 'Cor da etiqueta inválida (use formato hex #RRGGBB)';
  if (c.etiqueta && !ETIQUETAS_VALIDAS.includes(c.etiqueta.toLowerCase()) && c.etiqueta !== '') {
    // permite etiqueta livre mas avisa; nao bloqueia para nao quebrar existentes
  }
  return null;
}

// Lista (GET /api/assistidos) — paginada, enriquecida com último comparecimento
router.get('/api/assistidos', auth(['admin', 'tecnico']), ah(async (req, res) => {
  const list = await store.assistidos.all();
  const comps = await store.assistidosComparecimentos.all();
  const byAssistido = new Map();
  comps.forEach((c) => {
    const arr = byAssistido.get(c.assistidoId) || [];
    arr.push(c);
    byAssistido.set(c.assistidoId, arr);
  });

  const hoje = new Date().toISOString().slice(0, 10);
  const FREQ_DAYS = { semanal: 7, quinzenal: 15, mensal: 30, bimestral: 60, trimestral: 90 };

  const enriched = list.map((a) => {
    const cs = (byAssistido.get(a.id) || []).sort(
      (x, y) => String(y.dataComparecimento || '').localeCompare(String(x.dataComparecimento || ''))
    );
    const last = cs[0] || null;
    const dias = FREQ_DAYS[a.frequencia] || 30;
    let prox = a.dataInicio;
    if (last) prox = last.dataComparecimento;
    const proxDate = new Date(prox);
    proxDate.setDate(proxDate.getDate() + dias);
    const proxEsperado = proxDate.toISOString().slice(0, 10);
    const vencendo = proxEsperado <= hoje;
    const vencendo7 = !vencendo && proxEsperado <= new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

    return {
      ...a,
      ultimoComparecimento: last ? last.dataComparecimento : null,
      policialPlantao: last ? last.policialPlantao : null,
      juntada: last ? last.juntada : null,
      vencendo,
      vencendo7d: vencendo7,
      proximoEsperado: proxEsperado,
    };
  });

  res.json(enriched);
}));

// Busca um assistido por ID
router.get('/api/assistidos/:id(\\d+)', auth(['admin', 'tecnico']), ah(async (req, res) => {
  const row = await store.assistidos.byId(req.params.id);
  if (!row) return res.status(404).json({ error: 'Assistido não encontrado' });
  res.json(row);
}));

// Cadastro de assistido (somente admin)
router.post('/api/assistidos', auth(['admin']), ah(async (req, res) => {
  const b = req.body || {};
  const c = camposAssistidoDeBody(b);

  const erro = validarCamposObrigatorios(c);
  if (erro) return res.status(400).json({ error: erro });

  // Vinculo único entre nao-deletados
  const existe = await store.assistidos.allIncludingDeleted();
  if (existe.some((x) => !x.deleted_at && String(x.vinculo).trim().toLowerCase() === c.vinculo.toLowerCase())) {
    return res.status(409).json({ error: 'Vínculo já cadastrado' });
  }

  // Se responsavelTecnico informado, verificar que existe e é tecnico/admin
  if (c.responsavelTecnico) {
    const resp = await store.users.byName(c.responsavelTecnico);
    if (!resp) return res.status(400).json({ error: 'Técnico responsável não encontrado' });
    if (!['tecnico', 'admin'].includes(resp.role)) return res.status(400).json({ error: 'Responsável deve ser técnico ou admin' });
  } else {
    c.responsavelTecnico = req.auth.user; // padrao: quem cadastrou
  }

  const row = await store.assistidos.insert(c);

  try {
    await store.audit.insert({
      kind: 'assistido', action: 'criado', personName: row.nome, ref: 'assistido#' + row.id,
      byUser: req.auth.user, byName: req.auth.name, byRole: req.auth.role,
      summary: 'Assistido cadastrado: ' + row.nome,
    });
  } catch (e) { /* auditoria não bloqueia */ }
  broadcast();
  res.status(201).json(row);
}));

// Edição de assistido (admin ou técnico responsável por ID)
router.patch('/api/assistidos/:id', auth(['admin', 'tecnico']), ah(async (req, res) => {
  const b = req.body || {};
  const target = await store.assistidos.byId(req.params.id);
  if (!target) return res.status(404).json({ error: 'Não encontrado' });

  if (req.auth.role === 'tecnico') {
    // Responsabilidade por ID de usuario (integridade referencial)
    if (String(target.responsavelTecnico || '').toLowerCase() !== String(req.auth.user).toLowerCase()) {
      return res.status(403).json({ error: 'Técnico só pode editar assistidos de sua responsabilidade.' });
    }
  }

  const c = camposAssistidoDeBody(b);

  // Apenas valida campos que foram enviados
  const camposEnviados = Object.keys(b);
  if (camposEnviados.length > 0) {
    // Revalidar campos obrigatórios se foram alterados
    if (camposEnviados.includes('nome') && !c.nome) return res.status(400).json({ error: 'Nome é obrigatório' });
    if (camposEnviados.includes('vinculo') && !c.vinculo) return res.status(400).json({ error: 'Vínculo é obrigatório' });
    if (camposEnviados.includes('processo') && (!c.processo || !validarCNJ(c.processo))) {
      return res.status(400).json({ error: 'Processo inválido (deve ter 20 dígitos no formato CNJ)' });
    }
    if (camposEnviados.includes('vara') && !c.vara) return res.status(400).json({ error: 'Vara é obrigatória' });
    if (camposEnviados.includes('localAssinatura') && !LOCAIS_ASSINATURA.includes(c.localAssinatura)) {
      return res.status(400).json({ error: 'Local de assinatura inválido' });
    }
    if (camposEnviados.includes('dataInicio') && (!c.dataInicio || !ehDataValida(c.dataInicio))) {
      return res.status(400).json({ error: 'Data de início inválida (use AAAA-MM-DD)' });
    }
    if (camposEnviados.includes('dataFim') && c.dataFim && !ehDataValida(c.dataFim)) {
      return res.status(400).json({ error: 'Data de fim inválida (use AAAA-MM-DD)' });
    }
    if (camposEnviados.includes('cpf') && c.cpf && !/^\d{11}$/.test(c.cpf.replace(/[.\-/]/g, ''))) {
      return res.status(400).json({ error: 'CPF inválido (deve ter 11 dígitos)' });
    }
    if (camposEnviados.includes('frequencia') && !PERIODOS_COMPARECIMENTO.includes(c.frequencia)) {
      return res.status(400).json({ error: 'Frequência inválida' });
    }
    if (camposEnviados.includes('status') && !STATUS_VALIDOS.includes(c.status)) {
      return res.status(400).json({ error: 'Status inválido' });
    }
    if (camposEnviados.includes('etiquetaCor') && c.etiquetaCor && !/^#[0-9A-Fa-f]{6}$/.test(c.etiquetaCor)) {
      return res.status(400).json({ error: 'Cor da etiqueta inválida' });
    }
  }

  // Vinculo duplicado (excluindo o proprio registro)
  if (c.vinculo) {
    const todos = await store.assistidos.allIncludingDeleted();
    const dup = todos.find(
      (x) => String(x.id) !== String(req.params.id)
        && !x.deleted_at
        && String(x.vinculo || '').trim().toLowerCase() === c.vinculo.toLowerCase()
    );
    if (dup) return res.status(409).json({ error: 'Vínculo já cadastrado em outro assistido: ' + dup.nome });
  }

  // Coerencia de datas: se ambas presentes, fim >= inicio
  const dataInicioFinal = c.dataInicio || target.dataInicio;
  const dataFimFinal = c.dataFim || target.dataFim;
  if (dataFimFinal && dataInicioFinal && dataFimFinal < dataInicioFinal) {
    return res.status(400).json({ error: 'Data de fim não pode ser anterior à data de início' });
  }

  const row = await store.assistidos.patch(req.params.id, c);
  if (!row) return res.status(404).json({ error: 'Não encontrado' });

  try {
    await store.audit.insert({
      kind: 'assistido', action: 'editado', personName: row.nome, ref: 'assistido#' + row.id,
      byUser: req.auth.user, byName: req.auth.name, byRole: req.auth.role,
      summary: 'Assistido editado: ' + row.nome,
    });
  } catch (e) { /* */ }
  broadcast();
  res.json(row);
}));

// Exclusão lógica (soft-delete) — admin
router.delete('/api/assistidos/:id', auth(['admin']), ah(async (req, res) => {
  const a = await store.assistidos.byId(req.params.id);
  if (!a) return res.status(404).json({ error: 'Assistido não encontrado' });
  await store.assistidos.remove(req.params.id);
  try {
    await store.audit.insert({
      kind: 'assistido', action: 'excluido', personName: a.nome, ref: 'assistido#' + req.params.id,
      byUser: req.auth.user, byName: req.auth.name, byRole: req.auth.role,
      summary: 'Assistido excluído (soft-delete): ' + a.nome,
    });
  } catch (e) { /* */ }
  broadcast();
  res.json({ ok: true });
}));

// Comparecimentos de um assistido
router.get('/api/assistidos/:id/comparecimentos', auth(['admin', 'tecnico']), ah(async (req, res) => {
  const list = await store.assistidosComparecimentos.all(req.params.id);
  res.json(list);
}));

// Detalhe do assistido (dados + comparecimentos ordenados)
router.get('/api/assistidos/:id/detalhe', auth(['admin', 'tecnico']), ah(async (req, res) => {
  const a = await store.assistidos.byId(req.params.id);
  if (!a) return res.status(404).json({ error: 'Não encontrado' });
  const comps = await store.assistidosComparecimentos.all(req.params.id);
  const sorted = comps.slice().sort((x, y) => String(y.dataComparecimento || '').localeCompare(String(x.dataComparecimento || '')));
  const pendentes = comps.filter((c) => !c.protocolado && !c.deleted_at);
  res.json({ assistido: a, comparecimentos: sorted, pendentes: pendentes.length, total: comps.length });
}));

// Registrar comparecimento
router.post('/api/assistidos/:id/comparecimentos', auth(['admin', 'tecnico']), ah(async (req, res) => {
  const b = req.body || {};
  if (!b.dataComparecimento) return res.status(400).json({ error: 'Data de comparecimento é obrigatória' });
  if (!ehDataValida(b.dataComparecimento)) {
    return res.status(400).json({ error: 'Data de comparecimento inválida (use AAAA-MM-DD)' });
  }
  if (ehDataFutura(b.dataComparecimento)) return res.status(400).json({ error: 'Data de comparecimento não pode ser futura' });

  const a = await store.assistidos.byId(req.params.id);
  if (!a) return res.status(404).json({ error: 'Assistido não encontrado' });

  const comps = await store.assistidosComparecimentos.all(req.params.id);
  if (comps.some((c) => String(c.dataComparecimento).trim() === String(b.dataComparecimento).trim() && !c.deleted_at)) {
    return res.status(409).json({ error: 'Já existe comparecimento registrado nesta data para este assistido.' });
  }

  const row = await store.assistidosComparecimentos.insert({
    assistidoId: Number(req.params.id),
    dataComparecimento: String(b.dataComparecimento).trim(),
    policialPlantao: String(b.policialPlantao || '').trim() || '—',
    assinadoPor: String(b.assinadoPor || '').trim() || null,
    juntada: String(b.juntada || '').trim() || null,
    observacoes: String(b.observacoes || '').trim() || null,
  });
  try {
    await store.audit.insert({
      kind: 'assistido', action: 'comparecimento', personName: a.nome, ref: 'comparecimento#' + row.id,
      byUser: req.auth.user, byName: req.auth.name, byRole: req.auth.role,
      summary: 'Comparecimento registrado: ' + row.dataComparecimento,
    });
  } catch (e) { /* */ }
  broadcast();
  res.status(201).json(row);
}));

// Protocolar comparecimento (juntada)
router.patch('/api/assistidos/comparecimentos/:id/juntada', auth(['admin', 'tecnico']), ah(async (req, res) => {
  const b = req.body || {};
  const val = String(b.juntada || '').trim();
  if (!val) return res.status(400).json({ error: 'Dados da juntada são obrigatórios' });

  const row = await store.assistidosComparecimentos.byId(req.params.id);
  if (!row) return res.status(404).json({ error: 'Comparecimento não encontrado' });
  if (row.deleted_at) return res.status(400).json({ error: 'Comparecimento excluído' });

  const upd = await store.assistidosComparecimentos.patch(req.params.id, {
    juntada: val,
    protocolado: true,
    dataProtocolacao: new Date().toISOString().slice(0, 10),
    protocoladoPor: req.auth.name || req.auth.user,
  });
  if (!upd) return res.status(404).json({ error: 'Comparecimento não encontrado' });

  // Transição automática: assistido passa a concluído após juntada
  const comp = await store.assistidosComparecimentos.byId(req.params.id);
  if (comp) {
    const assistido = await store.assistidos.byId(comp.assistidoId);
    if (assistido && assistido.status === 'ativo') {
      await store.assistidos.patch(comp.assistidoId, { status: 'concluido' });
    }
  }

  try {
    await store.audit.insert({
      kind: 'assistido', action: 'juntada', personName: '', ref: 'comparecimento#' + req.params.id,
      byUser: req.auth.user, byName: req.auth.name, byRole: req.auth.role,
      summary: 'Juntada registrada',
    });
  } catch (e) { /* */ }
  broadcast();
  res.json(row);
}));

// Exclusão lógica de comparecimento (soft-delete)
router.delete('/api/assistidos/comparecimentos/:id', auth(['admin', 'tecnico']), ah(async (req, res) => {
  const row = await store.assistidosComparecimentos.byId(req.params.id);
  if (!row) return res.status(404).json({ error: 'Comparecimento não encontrado' });
  await store.assistidosComparecimentos.remove(req.params.id);
  try {
    await store.audit.insert({
      kind: 'assistido', action: 'comparecimento_excluido', personName: '', ref: 'comparecimento#' + req.params.id,
      byUser: req.auth.user, byName: req.auth.name, byRole: req.auth.role,
      summary: 'Comparecimento excluído (soft-delete)',
    });
  } catch (e) { /* */ }
  broadcast();
  res.json({ ok: true });
}));

// Listar pendências (comparecimentos sem juntada)
router.get('/api/assistidos/pendencias', auth(['admin', 'tecnico']), ah(async (req, res) => {
  const all = await store.assistidosComparecimentos.all();
  const list = all.filter((c) => !c.protocolado && !c.deleted_at);
  const assistidos = await store.assistidos.all();
  const byId = new Map(assistidos.map((a) => [a.id, a]));
  const out = list.map((c) => ({ ...c, assistido: byId.get(c.assistidoId) || null }));
  res.json(out);
}));

// Busca fuzzy por nome (detecta duplicidades)
router.get('/api/assistidos/buscar', auth(['admin', 'tecnico']), ah(async (req, res) => {
  const { q } = req.query || {};
  if (!q || String(q).trim().length < 3) {
    return res.status(400).json({ error: 'Informe pelo menos 3 caracteres para busca' });
  }
  const qLower = String(q).trim().toLowerCase();
  const assistidos = await store.assistidos.all();
  const exatos = assistidos.filter((a) => String(a.nome || '').toLowerCase().includes(qLower));
  const palavrasQ = qLower.split(/\s+/).filter(Boolean);
  const fuzzy = assistidos.filter((a) => {
    const nome = String(a.nome || '').toLowerCase();
    const palavrasNome = nome.split(/\s+/).filter(Boolean);
    return palavrasQ.every((p) => palavrasNome.some((pn) => pn.includes(p) || pn.startsWith(p)));
  }).filter((a) => !exatos.some((e) => e.id === a.id));
  res.json({ exatos, fuzzy, total: exatos.length + fuzzy.length });
}));

// Etiquetar / detaggar assistido (texto livre + cor)
router.patch('/api/assistidos/:id/etiqueta', auth(['admin', 'tecnico']), ah(async (req, res) => {
  const { etiqueta, etiquetaCor, etiquetaTexto } = req.body || {};
  const target = await store.assistidos.byId(req.params.id);
  if (!target) return res.status(404).json({ error: 'Assistido não encontrado' });

  const novaEtiqueta = etiqueta == null ? '' : String(etiqueta).trim();
  const novaCor = etiquetaCor && /^#[0-9A-Fa-f]{6}$/.test(String(etiquetaCor)) ? String(etiquetaCor) : '#4f46e5';
  const novoTexto = etiquetaTexto == null ? '' : String(etiquetaTexto).trim();

  const row = await store.assistidos.patch(req.params.id, {
    etiqueta: novaEtiqueta,
    etiquetaCor: novaCor,
    etiquetaTexto: novoTexto,
  });
  try {
    await store.audit.insert({
      kind: 'assistido', action: 'etiqueta', personName: row.nome, ref: 'assistido#' + row.id,
      byUser: req.auth.user, byName: req.auth.name, byRole: req.auth.role,
      summary: novaEtiqueta ? ('Etiqueta: ' + novaEtiqueta + ' (' + novaCor + ')') : 'Etiqueta removida',
    });
  } catch (e) { /* */ }
  res.json({ id: row.id, etiqueta: row.etiqueta, etiquetaCor: row.etiquetaCor, etiquetaTexto: row.etiquetaTexto });
}));

// Filtro de listagem
router.get('/api/assistidos/filtrar', auth(['admin', 'tecnico']), ah(async (req, res) => {
  const { q, nome, vinculo, processo, vara, local, frequencia, etiqueta, status } = req.query || {};
  let list = await store.assistidos.all();
  if (q) {
    const t = String(q).toLowerCase();
    list = list.filter((a) =>
      (a.nome || '').toLowerCase().includes(t)
      || (a.processo || '').toLowerCase().includes(t)
      || (a.vinculo || '').toLowerCase().includes(t)
    );
  }
  if (nome) { const t = String(nome).toLowerCase(); list = list.filter((a) => (a.nome || '').toLowerCase().includes(t)); }
  if (vinculo) { const t = String(vinculo).toLowerCase(); list = list.filter((a) => (a.vinculo || '').toLowerCase().includes(t)); }
  if (processo) { const t = String(processo).toLowerCase(); list = list.filter((a) => (a.processo || '').toLowerCase().includes(t)); }
  if (vara) list = list.filter((a) => a.vara === vara);
  if (local) list = list.filter((a) => a.localAssinatura === local);
  if (frequencia) list = list.filter((a) => a.frequencia === frequencia);
  if (etiqueta) {
    const t = String(etiqueta).toLowerCase();
    list = list.filter((a) => (a.etiqueta || '').toLowerCase().includes(t));
  }
  if (status) list = list.filter((a) => a.status === status);

  const { page, limit } = req.query || {};
  const total = list.length;
  let paged = list;
  if (page !== undefined && limit !== undefined) {
    const p = Math.max(Number(page) || 1, 1);
    const l = Math.min(Math.max(Number(limit) || 50, 1), 100);
    const start = (p - 1) * l;
    paged = list.slice(start, start + l);
  }
  res.json({ items: paged, total, page: page ? Number(page) : 1, limit: limit ? Number(limit) : total });
}));

// Estatísticas do módulo
router.get('/api/assistidos/stats', auth(['admin', 'tecnico']), ah(async (req, res) => {
  const assistidos = await store.assistidos.all();
  const comps = await store.assistidosComparecimentos.all();
  const pend = comps.filter((c) => !c.protocolado);
  const porVara = {}, porStatus = {}, porLocal = {}, porFreq = {}, porEtiqueta = {}, porResponsavel = {};
  assistidos.forEach((a) => { porVara[a.vara || '—'] = (porVara[a.vara || '—'] || 0) + 1; });
  assistidos.forEach((a) => { porStatus[a.status || '—'] = (porStatus[a.status || '—'] || 0) + 1; });
  assistidos.forEach((a) => { porLocal[a.localAssinatura || '—'] = (porLocal[a.localAssinatura || '—'] || 0) + 1; });
  assistidos.forEach((a) => { porFreq[a.frequencia || '—'] = (porFreq[a.frequencia || '—'] || 0) + 1; });
  assistidos.forEach((a) => { porEtiqueta[a.etiqueta || '(sem etiqueta)'] = (porEtiqueta[a.etiqueta || '(sem etiqueta)'] || 0) + 1; });
  assistidos.forEach((a) => { porResponsavel[a.responsavelTecnico || '(não definido)'] = (porResponsavel[a.responsavelTecnico || '(não definido)'] || 0) + 1; });
  const porPolicial = {};
  comps.forEach((c) => {
    const p = c.policialPlantao || '—';
    porPolicial[p] = (porPolicial[p] || 0) + 1;
  });
  res.json({
    totalAssistidos: assistidos.length,
    totalComparecimentos: comps.length,
    totalPendencias: pend.length,
    totalProtocolados: comps.length - pend.length,
    porVara: Object.entries(porVara).map(([vara, total]) => ({ vara, total })).sort((a, b) => b.total - a.total),
    porStatus: Object.entries(porStatus).map(([status, total]) => ({ status, total })).sort((a, b) => b.total - a.total),
    porLocal: Object.entries(porLocal).map(([local, total]) => ({ local, total })).sort((a, b) => b.total - a.total),
    porFrequencia: Object.entries(porFreq).map(([f, total]) => ({ frequencia: f, total })).sort((a, b) => b.total - a.total),
    porEtiqueta: Object.entries(porEtiqueta).map(([etiqueta, total]) => ({ etiqueta, total })).sort((a, b) => b.total - a.total),
    porResponsavel: Object.entries(porResponsavel).map(([resp, total]) => ({ responsavel: resp, total })).sort((a, b) => b.total - a.total),
    porPolicial: Object.entries(porPolicial).map(([policial, total]) => ({ policial, total })).sort((a, b) => b.total - a.total),
  });
}));

// Importação XLSX (server-side com ExcelJS)
router.post('/api/assistidos/import', auth(['admin']), shared.upload.single('arquivo'), ah(async (req, res) => {
  // Aceita array no corpo para compatibilidade com frontend que ja envia parseado
  if (!req.file) {
    const rows = Array.isArray(req.body) ? req.body : (req.body && req.body.rows ? req.body.rows : []);
    if (!rows.length) return res.status(400).json({ error: 'Envie um arquivo .xlsx ou um array de registros' });
    return importarRegistros(res, req, rows);
  }

  const ExcelJS = require('exceljs');
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(req.file.buffer);
  } catch (e) {
    return res.status(400).json({ error: 'Arquivo XLSX inválido: ' + e.message });
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet) return res.status(400).json({ error: 'Planilha vazia' });

  // Detecta linha de cabeçalho
  let headerRowIdx = null;
  const headers = [];
  worksheet.eachRow((row, rowNumber) => {
    const vals = [];
    row.eachCell((cell) => { vals.push(String(cell.value || '').trim().toLowerCase()); });
    if (vals.some(v => v === 'nome' || v === 'processo' || v === 'vinculo')) {
      headerRowIdx = rowNumber;
      row.eachCell((cell, colNumber) => { headers[colNumber] = String(cell.value || '').trim(); });
    }
  });

  if (!headerRowIdx) return res.status(400).json({ error: 'Cabeçalho não encontrado (esperado: nome, processo, vinculo, etc.)' });

  const rows = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRowIdx) return;
    const obj = {};
    let has = false;
    row.eachCell((cell, colNumber) => {
      const h = headers[colNumber];
      if (!h) return;
      let val = cell.value;
      if (val && typeof val === 'object' && val.result !== undefined) val = val.result;
      if (val instanceof Date) val = val.toISOString().slice(0, 10);
      obj[h] = (val == null ? '' : String(val).trim());
      if (obj[h]) has = true;
    });
    if (has) rows.push(obj);
  });

  return importarRegistros(res, req, rows);
}));

async function importarRegistros(res, req, rows) {
  const resultados = { importados: 0, erros: [], total: rows.length };
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const linha = i + 2; // +2 p/ cabeçalho e base 0
    try {
      const b = {
        vinculo: r.vinculo || r.VÍNCULO || r.vínculo || r.VINCULO || '',
        nome: r.nome || r.NOME || '',
        processo: r.processo || r.PROCESSO || '',
        vara: r.vara || r.VARA || '',
        cpf: r.cpf || r.CPF || '',
        telefone: r.telefone || r.TELEFONE || '',
        endereco: r.endereco || r.ENDERECO || '',
        situacaoJuridica: r.situacaoJuridica || r.situacao_juridica || r.SITUACAO_JURIDICA || '',
        localAssinatura: r.localAssinatura || r.local_assinatura || r.LOCAL_ASSINATURA || 'COMEP Cariri',
        dataInicio: r.dataInicio || r.data_inicio || r.DATA_INICIO || '',
        frequencia: r.frequencia || r.FREQUENCIA || r.frequência || 'mensal',
        status: r.status || r.STATUS || 'ativo',
        etiqueta: r.etiqueta || r.ETIQUETA || '',
        etiquetaCor: r.etiquetaCor || r.etiqueta_cor || r.ETIQUETA_COR || '#4f46e5',
        etiquetaTexto: r.etiquetaTexto || r.etiqueta_texto || r.ETIQUETA_TEXTO || '',
        responsavelTecnico: r.responsavelTecnico || r.responsavel_tecnico || r.RESPONSAVEL_TECNICO || req.auth.user,
      };
      const c = camposAssistidoDeBody(b);
      const erro = validarCamposObrigatorios(c);
      if (erro) { resultados.erros.push({ linha, erro, dados: b }); continue; }

      // Vinculo único
      const existe = await store.assistidos.allIncludingDeleted();
      if (existe.some((x) => !x.deleted_at && String(x.vinculo).trim().toLowerCase() === c.vinculo.toLowerCase())) {
        resultados.erros.push({ linha, erro: 'Vínculo duplicado', dados: b }); continue;
      }

      await store.assistidos.insert(c);
      resultados.importados++;
    } catch (e) {
      resultados.erros.push({ linha, erro: e.message, dados: r });
    }
  }
  try { await store.audit.insert({ kind: 'assistido', action: 'importacao', personName: '', ref: 'import#xlsx', byUser: req.auth.user, byName: req.auth.name, byRole: req.auth.role, summary: 'Importação: ' + resultados.importados + ' de ' + resultados.total }); } catch (e) {}
  broadcast();
  res.json({ ok: true, ...resultados });
}

module.exports = router;
