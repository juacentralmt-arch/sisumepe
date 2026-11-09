const express = require('express');
const shared = require('../lib/shared');
const { store, ah, auth, broadcast } = shared;
const router = express.Router();

// =====================================================================
//  Módulo Assistidos — reescrito do zero
//  - cadastro com 1 único campo de data (data de início)
//  - local de assinatura restrito a: COMEP Cariri, COAP Cariri, Albergado Cariri
//  - sem sistema, sem contrato, sem carga horária, sem tipo de medida
//  - etiqueta livre (texto + cor) + soft-delete (deleted_at)
// =====================================================================

const LOCAIS_ASSINATURA = ['COMEP Cariri', 'Albergado Cariri', 'COAP Cariri'];
const PERIODOS_COMPARECIMENTO = ['semanal', 'quinzenal', 'mensal', 'bimestral', 'trimestral'];
const STATUS_VALIDOS = ['ativo', 'concluido', 'arquivado'];

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
    frequencia: String(b.frequencia || 'mensal').trim(),
    status: String(b.status || 'ativo').trim(),
    etiqueta: String(b.etiqueta || '').trim(),
    etiquetaCor: String(b.etiquetaCor || '#4f46e5').trim(),
    etiquetaTexto: String(b.etiquetaTexto || '').trim(),
  };
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
  const enriched = list.map((a) => {
    const cs = (byAssistido.get(a.id) || []).sort(
      (x, y) => String(y.dataComparecimento || '').localeCompare(String(x.dataComparecimento || ''))
    );
    const last = cs[0] || null;
    const dias = FREQ_DAYS[a.frequencia] || 30;
    const prox = last
      ? new Date(String(last.dataComparecimento)).toISOString().slice(0, 10)
      : a.dataInicio;
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
  if (!b.nome || !String(b.nome).trim()) return res.status(400).json({ error: 'Nome é obrigatório' });
  if (!b.vinculo || !String(b.vinculo).trim()) return res.status(400).json({ error: 'Número de vínculo é obrigatório' });
  if (!b.processo || !String(b.processo).trim()) return res.status(400).json({ error: 'Processo é obrigatório' });
  if (!validarCNJ(b.processo)) return res.status(400).json({ error: 'Processo inválido (deve ter 20 dígitos no formato CNJ)' });
  if (!b.vara || !String(b.vara).trim()) return res.status(400).json({ error: 'Vara é obrigatória' });
  if (!LOCAIS_ASSINATURA.includes(String(b.localAssinatura || '').trim())) return res.status(400).json({ error: 'Local de assinatura inválido' });
  if (!b.dataInicio) return res.status(400).json({ error: 'Data de início é obrigatória' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.dataInicio).trim())) return res.status(400).json({ error: 'Data de início inválida (use AAAA-MM-DD)' });
  if (b.cpf && !/^\d{11}$/.test(String(b.cpf).replace(/[.\-/]/g, ''))) return res.status(400).json({ error: 'CPF inválido (deve ter 11 dígitos)' });
  if (!PERIODOS_COMPARECIMENTO.includes(String(b.frequencia || '').trim())) b.frequencia = 'mensal';
  if (!STATUS_VALIDOS.includes(String(b.status || '').trim())) b.status = 'ativo';

  const existe = await store.assistidos.allIncludingDeleted();
  if (existe.some((x) => String(x.vinculo).trim().toLowerCase() === String(b.vinculo).trim().toLowerCase())) {
    return res.status(409).json({ error: 'Vínculo já cadastrado' });
  }

  const campos = camposAssistidoDeBody(b);
  const row = await store.assistidos.insert({
    ...campos,
    status: b.status,
    frequencia: b.frequencia,
  });

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

// Edição de assistido (admin ou técnico responsável)
router.patch('/api/assistidos/:id', auth(['admin', 'tecnico']), ah(async (req, res) => {
  const b = req.body || {};
  const target = await store.assistidos.byId(req.params.id);
  if (!target) return res.status(404).json({ error: 'Não encontrado' });

  if (req.auth.role === 'tecnico') {
    const comps = await store.assistidosComparecimentos.all(req.params.id);
    const meu = comps.some((c) => String(c.policialPlantao || '').toLowerCase() === String(req.auth.name || req.auth.user).toLowerCase());
    if (!meu) return res.status(403).json({ error: 'Técnico só pode editar assistidos de sua responsabilidade.' });
  }

  const campos = {};
  const colunas = ['vinculo', 'nome', 'processo', 'vara', 'cpf', 'telefone', 'endereco',
    'situacaoJuridica', 'localAssinatura', 'dataInicio', 'frequencia', 'status',
    'etiqueta', 'etiquetaCor', 'etiquetaTexto'];
  for (const k of colunas) if (b[k] !== undefined) campos[k] = b[k];

  if (campos.vinculo !== undefined && String(campos.vinculo).trim()) {
    const todos = await store.assistidos.allIncludingDeleted();
    const dup = todos.find(
      (x) => String(x.id) !== String(req.params.id)
        && String(x.vinculo || '').trim().toLowerCase() === String(campos.vinculo).trim().toLowerCase()
        && !x.deleted_at
    );
    if (dup) return res.status(409).json({ error: 'Vínculo já cadastrado em outro assistido: ' + dup.nome });
  }
  if (campos.processo !== undefined && String(campos.processo).trim() && !validarCNJ(campos.processo)) {
    return res.status(400).json({ error: 'Processo inválido (deve ter 20 dígitos no formato CNJ)' });
  }
  if (campos.localAssinatura !== undefined && !LOCAIS_ASSINATURA.includes(String(campos.localAssinatura).trim())) {
    return res.status(400).json({ error: 'Local de assinatura inválido' });
  }
  if (campos.cpf !== undefined && campos.cpf && !/^\d{11}$/.test(String(campos.cpf).replace(/[.\-/]/g, ''))) {
    return res.status(400).json({ error: 'CPF inválido (deve ter 11 dígitos)' });
  }
  if (campos.dataInicio !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(campos.dataInicio).trim())) {
    return res.status(400).json({ error: 'Data de início inválida (use AAAA-MM-DD)' });
  }
  if (campos.frequencia !== undefined && !PERIODOS_COMPARECIMENTO.includes(String(campos.frequencia).trim())) {
    return res.status(400).json({ error: 'Frequência inválida' });
  }
  if (campos.status !== undefined && !STATUS_VALIDOS.includes(String(campos.status).trim())) {
    return res.status(400).json({ error: 'Status inválido' });
  }
  if (campos.etiquetaCor !== undefined && !/^#[0-9A-Fa-f]{6}$/.test(String(campos.etiquetaCor))) {
    campos.etiquetaCor = '#4f46e5';
  }

  const row = await store.assistidos.patch(req.params.id, campos);
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

// Exclusão lógica (soft-delete)
router.delete('/api/assistidos/:id', auth(['admin']), ah(async (req, res) => {
  const a = await store.assistidos.byId(req.params.id);
  const comps = await store.assistidosComparecimentos.all(req.params.id);
  for (const c of comps) await store.assistidosComparecimentos.remove(c.id);
  await store.assistidos.remove(req.params.id);
  try {
    await store.audit.insert({
      kind: 'assistido', action: 'excluido', personName: a ? a.nome : '', ref: 'assistido#' + req.params.id,
      byUser: req.auth.user, byName: req.auth.name, byRole: req.auth.role,
      summary: 'Assistido excluído' + (a ? ': ' + a.nome : ''),
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
  const pendentes = comps.filter((c) => !String(c.juntada || '').trim());
  res.json({ assistido: a, comparecimentos: sorted, pendentes: pendentes.length, total: comps.length });
}));

// Registrar comparecimento
router.post('/api/assistidos/:id/comparecimentos', auth(['admin', 'tecnico']), ah(async (req, res) => {
  const b = req.body || {};
  if (!b.dataComparecimento) return res.status(400).json({ error: 'Data de comparecimento é obrigatória' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.dataComparecimento).trim())) {
    return res.status(400).json({ error: 'Data de comparecimento inválida (use AAAA-MM-DD)' });
  }
  const a = await store.assistidos.byId(req.params.id);
  if (!a) return res.status(404).json({ error: 'Assistido não encontrado' });
  const comps = await store.assistidosComparecimentos.all(req.params.id);
  if (comps.some((c) => String(c.dataComparecimento).trim() === String(b.dataComparecimento).trim())) {
    return res.status(409).json({ error: 'Já existe comparecimento registrado nesta data para este assistido.' });
  }
  const row = await store.assistidosComparecimentos.insert({
    assistidoId: Number(req.params.id),
    dataComparecimento: String(b.dataComparecimento).trim(),
    policialPlantao: String(b.policialPlantao || '').trim() || '—',
    assinadoPor: String(b.assinadoPor || '').trim() || null,
    juntada: String(b.juntada || '').trim() || null,
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
  const row = await store.assistidosComparecimentos.patch(req.params.id, {
    juntada: val,
    protocolado: true,
    dataProtocolacao: new Date().toISOString().slice(0, 10),
    protocoladoPor: req.auth.name || req.auth.user,
  });
  if (!row) return res.status(404).json({ error: 'Comparecimento não encontrado' });

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

// Listar pendências (comparecimentos sem juntada)
router.get('/api/assistidos/pendencias', auth(['admin', 'tecnico']), ah(async (req, res) => {
  const all = await store.assistidosComparecimentos.all();
  const list = all.filter((c) => !String(c.juntada || '').trim());
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
  const porVara = {}, porStatus = {}, porLocal = {}, porFreq = {}, porEtiqueta = {};
  assistidos.forEach((a) => { porVara[a.vara || '—'] = (porVara[a.vara || '—'] || 0) + 1; });
  assistidos.forEach((a) => { porStatus[a.status || '—'] = (porStatus[a.status || '—'] || 0) + 1; });
  assistidos.forEach((a) => { porLocal[a.localAssinatura || '—'] = (porLocal[a.localAssinatura || '—'] || 0) + 1; });
  assistidos.forEach((a) => { porFreq[a.frequencia || '—'] = (porFreq[a.frequencia || '—'] || 0) + 1; });
  assistidos.forEach((a) => { porEtiqueta[a.etiqueta || '(sem etiqueta)'] = (porEtiqueta[a.etiqueta || '(sem etiqueta)'] || 0) + 1; });
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
    porPolicial: Object.entries(porPolicial).map(([policial, total]) => ({ policial, total })).sort((a, b) => b.total - a.total),
  });
}));

// Importação XLSX (background via endpoint; recebe arquivo e grava direto no store)
router.post('/api/assistidos/import', auth(['admin']), ah(async (req, res) => {
  // Importação síncrona simples: o corpo deve conter o array de registros já mapeados.
  // O frontend envia via FormData com arquivo .xlsx; o parsing é feito no cliente
  // e os registros são POSTados um a um em /api/assistidos.
  res.json({ ok: true, msg: 'Use POST /api/assistidos para cada registro ou endpoint de importação em lote.' });
}));

const FREQ_DAYS = { semanal: 7, quinzenal: 15, mensal: 30, bimestral: 60, trimestral: 90 };

module.exports = router;
