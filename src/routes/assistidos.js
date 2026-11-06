const express = require('express');
const shared = require('../lib/shared');
const { store, ah, auth, broadcast } = shared;
const router = express.Router();

// Cadastro de assistido
router.get('/api/assistidos', auth(['admin','tecnico']), ah(async (req, res) => {
  const list = await store.assistidos.all();
  res.json(list);
}));

router.post('/api/assistidos', auth(['admin']), ah(async (req, res) => {
  const b = req.body || {};
  if (!b.nome || !String(b.nome).trim()) return res.status(400).json({ error: 'Nome é obrigatório' });
  if (!b.vinculo || !String(b.vinculo).trim()) return res.status(400).json({ error: 'Número de vínculo é obrigatório' });
  if (!b.processo || !String(b.processo).trim()) return res.status(400).json({ error: 'Processo é obrigatório' });
  if (!b.vara || !String(b.vara).trim()) return res.status(400).json({ error: 'Vara é obrigatória' });
  if (!b.localAssinatura || !String(b.localAssinatura).trim()) return res.status(400).json({ error: 'Local de assinatura é obrigatório' });
  if (!b.dataInicio) return res.status(400).json({ error: 'Data de início é obrigatória' });
  const row = await store.assistidos.insert({
    vinculo: String(b.vinculo).trim(),
    nome: String(b.nome).trim(),
    processo: String(b.processo).trim(),
    vara: String(b.vara).trim(),
    localAssinatura: String(b.localAssinatura).trim(),
    dataInicio: String(b.dataInicio).trim()
  });
  broadcast();
  res.status(201).json(row);
}));

router.patch('/api/assistidos/:id', auth(['admin']), ah(async (req, res) => {
  const b = req.body || {};
  const fields = {};
  for (const k of ['vinculo','nome','processo','vara','localAssinatura','dataInicio']) if (b[k] !== undefined) fields[k] = b[k];
  const row = await store.assistidos.patch(req.params.id, fields);
  if (!row) return res.status(404).json({ error: 'Não encontrado' });
  broadcast();
  res.json(row);
}));

router.delete('/api/assistidos/:id', auth(['admin']), ah(async (req, res) => {
  await store.assistidos.remove(req.params.id);
  broadcast();
  res.json({ ok: true });
}));

// Comparecimentos
router.get('/api/assistidos/:id/comparecimentos', auth(['admin','tecnico']), ah(async (req, res) => {
  const list = await store.assistidosComparecimentos.all(req.params.id);
  res.json(list);
}));

router.post('/api/assistidos/:id/comparecimentos', auth(['admin','tecnico']), ah(async (req, res) => {
  const b = req.body || {};
  if (!b.dataComparecimento) return res.status(400).json({ error: 'Data de comparecimento é obrigatória' });
  if (!b.policialPlantao || !String(b.policialPlantao).trim()) return res.status(400).json({ error: 'Policial de plantão é obrigatório' });
  const a = await store.assistidos.byId(req.params.id);
  if (!a) return res.status(404).json({ error: 'Assistido não encontrado' });
  const row = await store.assistidosComparecimentos.insert({
    assistidoId: Number(req.params.id),
    dataComparecimento: String(b.dataComparecimento).trim(),
    policialPlantao: String(b.policialPlantao).trim()
  });
  broadcast();
  res.status(201).json(row);
}));

// Protocolar pendência (marcar comparecimento como protocolado + observações)
router.patch('/api/assistidos/comparecimentos/:id/protocolar', auth(['admin','tecnico']), ah(async (req, res) => {
  const b = req.body || {};
  const row = await store.assistidosComparecimentos.patch(req.params.id, {
    protocolado: true,
    dataProtocolacao: b.dataProtocolacao || new Date().toISOString().slice(0,10),
    observacoes: b.observacoes || ''
  });
  if (!row) return res.status(404).json({ error: 'Comparecimento não encontrado' });
  broadcast();
  res.json(row);
}));

// Listar pendências (comparecimentos não protocolados)
router.get('/api/assistidos/pendencias', auth(['admin','tecnico']), ah(async (req, res) => {
  const list = await store.assistidosComparecimentos.pendencias();
  const out = [];
  for (const c of list) {
    const a = await store.assistidos.byId(c.assistidoId);
    out.push({ ...c, assistido: a });
  }
  res.json(out);
}));

// Filtros + quantitativos
router.get('/api/assistidos/stats', auth(['admin','tecnico']), ah(async (req, res) => {
  const assistidos = await store.assistidos.all();
  const comps = await store.assistidosComparecimentos.all();
  const pend = comps.filter(c => !c.protocolado);
  const porVara = {};
  const porPolicial = {};
  const porMes = {};
  assistidos.forEach(a => { porVara[a.vara || '—'] = (porVara[a.vara || '—'] || 0) + 1; });
  comps.forEach(c => {
    const p = c.policialPlantao || '—';
    porPolicial[p] = (porPolicial[p] || 0) + 1;
    const mes = String(c.dataComparecimento || '').slice(0,7) || '—';
    porMes[mes] = (porMes[mes] || 0) + 1;
  });
  res.json({
    totalAssistidos: assistidos.length,
    totalComparecimentos: comps.length,
    totalPendencias: pend.length,
    totalProtocolados: comps.length - pend.length,
    porVara: Object.entries(porVara).map(([vara,total]) => ({ vara, total })).sort((a,b)=>b.total-a.total),
    porPolicial: Object.entries(porPolicial).map(([policial,total]) => ({ policial, total })).sort((a,b)=>b.total-a.total),
    porMes: Object.entries(porMes).map(([mes,total]) => ({ mes, total })).sort((a,b)=>a.mes.localeCompare(b.mes))
  });
}));

// Filtro de listagem
router.get('/api/assistidos/filtrar', auth(['admin','tecnico']), ah(async (req, res) => {
  const { q, vara } = req.query || {};
  let list = await store.assistidos.all();
  if (q) {
    const t = String(q).toLowerCase();
    list = list.filter(a => (a.nome||'').toLowerCase().includes(t) || (a.processo||'').toLowerCase().includes(t) || (a.vinculo||'').toLowerCase().includes(t));
  }
  if (vara) list = list.filter(a => a.vara === vara);
  res.json(list);
}));

module.exports = router;