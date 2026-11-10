const express = require('express');
const shared = require('../lib/shared');
const { store, ah, auth, broadcast } = shared;
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
// =====================================================================

const LOCAIS_ASSINATURA = ['COMEP Cariri', 'Albergado Cariri', 'COAP Cariri'];
const FREQUENCIAS = ['semanal', 'quinzenal', 'mensal', 'bimestral', 'trimestral'];
const ETIQUETAS = ['sem', 'verde', 'laranja', 'vermelho'];
const STATUS = ['ativo', 'concluido'];

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

function validarCNJ(v) {
  return /^\d{20}$/.test(String(v || '').replace(/[.\-/]/g, ''));
}

// Lista todos (aba Todos) — enriquecida com último comparecimento
router.get('/api/assistidos', auth(['admin', 'tecnico']), ah(async (req, res) => {
  const list = await store.assistidos.all();
  const comps = await store.assistidosComparecimentos.all();
  const byAssistido = new Map();
  comps.forEach((c) => {
    const arr = byAssistido.get(c.assistidoId) || [];
    arr.push(c);
    byAssistido.set(c.assistidoId, arr);
  });
  const enriched = list.map((a) => {
    const cs = (byAssistido.get(a.id) || []).sort(
      (x, y) => String(y.dataComparecimento || '').localeCompare(String(x.dataComparecimento || ''))
    );
    const last = cs[0] || null;
    return {
      ...a,
      ultimoComparecimento: last ? last.dataComparecimento : null,
      ppPlantao: last ? last.ppPlantao : null,
      observacao: last ? last.observacao : null,
      totalComparecimentos: cs.filter(c => !c.deleted_at).length,
      pendentesJuntada: cs.filter(c => !c.juntada && !c.deleted_at).length,
    };
  });
  res.json(enriched);
}));

// Aba Juntada — assistidos com comparecimentos pendentes de juntada
router.get('/api/assistidos/juntada', auth(['admin', 'tecnico']), ah(async (req, res) => {
  const list = await store.assistidos.all();
  const comps = await store.assistidosComparecimentos.all();
  const byAssistido = new Map();
  comps.forEach((c) => {
    if (c.juntada || c.deleted_at) return;
    const arr = byAssistido.get(c.assistidoId) || [];
    arr.push(c);
    byAssistido.set(c.assistidoId, arr);
  });
  const pendentes = list
    .filter(a => byAssistido.has(a.id))
    .map((a) => {
      const cs = byAssistido.get(a.id).sort(
        (x, y) => String(x.dataComparecimento || '').localeCompare(String(y.dataComparecimento || ''))
      );
      return { ...a, comparecimentoPendente: cs[0] };
    });
  res.json(pendentes);
}));

// Aba Concluídos — assistidos com status concluido
router.get('/api/assistidos/concluidos', auth(['admin', 'tecnico']), ah(async (req, res) => {
  const list = await store.assistidos.all();
  res.json(list.filter(a => a.status === 'concluido'));
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

// Cadastro de assistido
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
  };
  const erro = validarAssistido(c);
  if (erro) return res.status(400).json({ error: erro });

  const existe = await store.assistidos.allIncludingDeleted();
  if (existe.some((x) => !x.deleted_at && !x.deletedAt && String(x.vinculo).trim().toLowerCase() === c.vinculo.toLowerCase())) {
    return res.status(409).json({ error: 'Vínculo já cadastrado' });
  }

  const row = await store.assistidos.insert(c);
  try {
    await store.audit.insert({ kind: 'assistido', action: 'criado', personName: row.nome, ref: 'assistido#' + row.id, byUser: req.auth.user, byName: req.auth.name, byRole: req.auth.role, summary: 'Assistido cadastrado: ' + row.nome });
  } catch (e) { /* */ }
  broadcast();
  res.status(201).json(row);
}));

// Edição de assistido
router.patch('/api/assistidos/:id', auth(['admin', 'tecnico']), ah(async (req, res) => {
  const b = req.body || {};
  const target = await store.assistidos.byId(req.params.id);
  if (!target) return res.status(404).json({ error: 'Não encontrado' });

  // Mescla com dados existentes, validando apenas campos enviados
  const c = {
    vinculo: b.vinculo != null ? String(b.vinculo).trim() : target.vinculo,
    nome: b.nome != null ? String(b.nome).trim() : target.nome,
    processo: b.processo != null ? String(b.processo).trim() : target.processo,
    vara: b.vara != null ? String(b.vara).trim() : target.vara,
    localAssinatura: b.localAssinatura != null ? String(b.localAssinatura).trim() : target.localAssinatura,
    dataInicio: b.dataInicio != null ? normalizaData(b.dataInicio) : target.dataInicio,
    frequencia: b.frequencia != null ? String(b.frequencia).trim() : target.frequencia,
    etiqueta: b.etiqueta != null ? String(b.etiqueta).trim() : target.etiqueta,
    status: b.status != null ? String(b.status).trim() : target.status,
  };
  const erro = validarAssistido(c);
  if (erro) return res.status(400).json({ error: erro });

  if (c.vinculo) {
    const todos = await store.assistidos.allIncludingDeleted();
    const dup = todos.find((x) => String(x.id) !== String(req.params.id) && !x.deleted_at && !x.deletedAt && String(x.vinculo || '').trim().toLowerCase() === c.vinculo.toLowerCase());
    if (dup) return res.status(409).json({ error: 'Vínculo já cadastrado em outro assistido: ' + dup.nome });
  }

  const row = await store.assistidos.patch(req.params.id, c);
  if (!row) return res.status(404).json({ error: 'Não encontrado' });
  try {
    await store.audit.insert({ kind: 'assistido', action: 'editado', personName: row.nome, ref: 'assistido#' + row.id, byUser: req.auth.user, byName: req.auth.name, byRole: req.auth.role, summary: 'Assistido editado: ' + row.nome });
  } catch (e) { /* */ }
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
  try {
    await store.audit.insert({ kind: 'assistido', action: 'etiqueta', personName: row.nome, ref: 'assistido#' + row.id, byUser: req.auth.user, byName: req.auth.name, byRole: req.auth.role, summary: 'Etiqueta: ' + etiqueta });
  } catch (e) { /* */ }
  broadcast();
  res.json({ id: row.id, etiqueta: row.etiqueta });
}));

// Exclusão lógica (soft-delete)
router.delete('/api/assistidos/:id', auth(['admin', 'tecnico']), ah(async (req, res) => {
  const a = await store.assistidos.byId(req.params.id);
  if (!a) return res.status(404).json({ error: 'Assistido não encontrado' });
  await store.assistidos.remove(req.params.id);
  try {
    await store.audit.insert({ kind: 'assistido', action: 'excluido', personName: a.nome, ref: 'assistido#' + req.params.id, byUser: req.auth.user, byName: req.auth.name, byRole: req.auth.role, summary: 'Assistido excluído (soft-delete): ' + a.nome });
  } catch (e) { /* */ }
  broadcast();
  res.json({ ok: true });
}));

// Registrar comparecimento
router.post('/api/assistidos/:id/comparecimentos', auth(['admin', 'tecnico']), ah(async (req, res) => {
  const b = req.body || {};
  if (!b.dataComparecimento) return res.status(400).json({ error: 'Data de comparecimento é obrigatória' });
  if (!ehDataValida(b.dataComparecimento)) return res.status(400).json({ error: 'Data de comparecimento inválida (use AAAA-MM-DD)' });
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
    ppPlantao: String(b.ppPlantao || '').trim() || '—',
    observacao: String(b.observacao || '').trim() || null,
    juntada: null,
    protocolado: false,
  });
  try {
    await store.audit.insert({ kind: 'assistido', action: 'comparecimento', personName: a.nome, ref: 'comparecimento#' + row.id, byUser: req.auth.user, byName: req.auth.name, byRole: req.auth.role, summary: 'Comparecimento registrado: ' + row.dataComparecimento });
  } catch (e) { /* */ }
  broadcast();
  res.status(201).json(row);
}));

// Adicionar / editar juntada
router.patch('/api/assistidos/comparecimentos/:id/juntada', auth(['admin', 'tecnico']), ah(async (req, res) => {
  const { juntada, observacao } = req.body || {};
  const val = String(juntada || '').trim();
  if (!val) return res.status(400).json({ error: 'Dados da juntada são obrigatórios' });

  const row = await store.assistidosComparecimentos.byId(req.params.id);
  if (!row) return res.status(404).json({ error: 'Comparecimento não encontrado' });
  if (row.deleted_at) return res.status(400).json({ error: 'Comparecimento excluído' });

  const upd = await store.assistidosComparecimentos.patch(req.params.id, {
    juntada: val,
    observacao: observacao != null ? String(observacao).trim() : row.observacao,
    protocolado: true,
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

  try {
    await store.audit.insert({ kind: 'assistido', action: 'juntada', personName: '', ref: 'comparecimento#' + req.params.id, byUser: req.auth.user, byName: req.auth.name, byRole: req.auth.role, summary: 'Juntada registrada' });
  } catch (e) { /* */ }
  broadcast();
  res.json(upd);
}));

// Exclusão lógica de comparecimento
router.delete('/api/assistidos/comparecimentos/:id', auth(['admin', 'tecnico']), ah(async (req, res) => {
  const row = await store.assistidosComparecimentos.byId(req.params.id);
  if (!row) return res.status(404).json({ error: 'Comparecimento não encontrado' });
  await store.assistidosComparecimentos.remove(req.params.id);
  try {
    await store.audit.insert({ kind: 'assistido', action: 'comparecimento_excluido', personName: '', ref: 'comparecimento#' + req.params.id, byUser: req.auth.user, byName: req.auth.name, byRole: req.auth.role, summary: 'Comparecimento excluído (soft-delete)' });
  } catch (e) { /* */ }
  broadcast();
  res.json({ ok: true });
}));

function validarAssistido(c) {
  if (!c.nome) return 'Nome é obrigatório';
  if (!c.vinculo) return 'Vínculo é obrigatório';
  if (!c.processo) return 'Processo é obrigatório';
  if (!validarCNJ(c.processo)) return 'Processo inválido (deve ter 20 dígitos no formato CNJ)';
  if (!c.vara) return 'Vara é obrigatória';
  if (!LOCAIS_ASSINATURA.includes(c.localAssinatura)) return 'Local de assinatura inválido';
  if (!c.dataInicio || !ehDataValida(c.dataInicio)) return 'Data de início inválida (use AAAA-MM-DD)';
  if (ehDataFutura(c.dataInicio)) return 'Data de início não pode ser futura';
  if (!FREQUENCIAS.includes(c.frequencia)) return 'Frequência inválida';
  if (!ETIQUETAS.includes(c.etiqueta)) return 'Etiqueta inválida';
  if (!STATUS.includes(c.status)) return 'Status inválido';
  return null;
}

module.exports = router;
