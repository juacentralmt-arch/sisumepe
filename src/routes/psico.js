const express = require('express');
const shared = require('../lib/shared');
const { store, ah, auth, broadcast } = shared;
const router = express.Router();

// Módulo Psicossocial — sigilo: só perfil psico + admin
const GATE = ['psico', 'admin'];
const KINDS = ['prontuario', 'evolucao', 'atendimento', 'grupo', 'encontro', 'encaminhamento', 'medida'];
const PERIOD_DAYS = { semanal: 7, quinzenal: 15, mensal: 30, bimestral: 60, trimestral: 90 };

function cleanStr(v, n) { return String(v == null ? '' : v).trim().slice(0, n || 2000); }
function cleanDados(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return {};
  const o = {};
  for (const k of Object.keys(d).slice(0, 60)) {
    const v = d[k];
    if (typeof v === 'string') o[k] = v.trim().slice(0, 2000);
    else if (typeof v === 'number' || typeof v === 'boolean') o[k] = v;
    else if (Array.isArray(v)) o[k] = v.map(x => (typeof x === 'string' ? x.trim().slice(0, 200) : x)).slice(0, 200);
    else if (v && typeof v === 'object') o[k] = cleanDados(v);
  }
  return o;
}
function toISODate(v) {
  if (!v) return null;
  const dt = new Date(v);
  if (isNaN(dt)) return null;
  return dt.toISOString().slice(0, 10);
}
async function personNameOf(personId, fallback) {
  if (fallback && String(fallback).trim()) return String(fallback).trim().slice(0, 120);
  try {
    const p = await store.persons.byId(personId);
    if (p && p.nome) return String(p.nome).slice(0, 120);
  } catch (e) {}
  return '';
}

// Lista (filtros opcionais)
router.get('/api/psi', auth(GATE), ah(async (req, res) => {
  const { kind, personId, grupoId } = req.query || {};
  let list = await store.psi.all();
  if (kind) list = list.filter(x => x.kind === kind);
  if (personId) list = list.filter(x => String(x.personId) === String(personId));
  if (grupoId) list = list.filter(x => String(x.grupoId) === String(grupoId));
  res.json(list.slice(0, 2000));
}));

// Cria (prontuário faz upsert por pessoa)
router.post('/api/psi', auth(GATE), ah(async (req, res) => {
  const { kind, personId, personName, grupoId, data, dados } = req.body || {};
  if (!KINDS.includes(kind)) return res.status(400).json({ error: 'Tipo inválido' });
  if (['prontuario', 'evolucao', 'atendimento', 'encaminhamento', 'medida'].includes(kind) && !personId)
    return res.status(400).json({ error: 'Selecione a pessoa' });
  if (kind === 'grupo' && !cleanStr(dados && dados.nome, 120))
    return res.status(400).json({ error: 'Informe o nome do grupo' });
  if (kind === 'encontro' && !grupoId)
    return res.status(400).json({ error: 'Selecione o grupo' });
  const row = {
    user: req.auth.user, kind,
    personId: personId == null ? '' : String(personId),
    personName: await personNameOf(personId, personName),
    grupoId: grupoId == null ? '' : String(grupoId),
    data: toISODate(data) || new Date().toISOString().slice(0, 10),
    dados: cleanDados(dados)
  };
  if (kind === 'prontuario') {
    const ex = await store.psi.prontuario(row.personId);
    if (ex) {
      const upd = await store.psi.patch(ex.id, { dados: Object.assign({}, ex.dados || {}, row.dados), personName: row.personName || ex.personName });
      broadcast();
      return res.json(upd);
    }
  }
  const rec = await store.psi.insert(row);
  broadcast();
  res.status(201).json(rec);
}));

router.get('/api/psi/:id', auth(GATE), ah(async (req, res) => {
  const r = await store.psi.byId(req.params.id);
  if (!r) return res.status(404).json({ error: 'Registro não encontrado' });
  res.json(r);
}));

function canWrite(req, rec) {
  return req.auth.role === 'admin' || rec.user === req.auth.user;
}

router.patch('/api/psi/:id', auth(GATE), ah(async (req, res) => {
  const r = await store.psi.byId(req.params.id);
  if (!r) return res.status(404).json({ error: 'Registro não encontrado' });
  if (!canWrite(req, r)) return res.status(403).json({ error: 'Só o autor ou admin pode editar' });
  const { data, dados, personName, grupoId } = req.body || {};
  const fields = {};
  if (data !== undefined) fields.data = toISODate(data) || r.data;
  if (grupoId !== undefined) fields.grupoId = String(grupoId);
  if (personName !== undefined) fields.personName = cleanStr(personName, 120);
  if (dados && typeof dados === 'object') fields.dados = Object.assign({}, r.dados || {}, cleanDados(dados));
  const upd = await store.psi.patch(r.id, fields);
  broadcast();
  res.json(upd);
}));

router.delete('/api/psi/:id', auth(GATE), ah(async (req, res) => {
  const r = await store.psi.byId(req.params.id);
  if (!r) return res.status(404).json({ error: 'Registro não encontrado' });
  if (!canWrite(req, r)) return res.status(403).json({ error: 'Só o autor ou admin pode excluir' });
  await store.psi.remove(r.id);
  broadcast();
  res.json({ ok: true });
}));

// Painel: indicadores do acompanhamento
router.get('/api/psi/dashboard', auth(GATE), ah(async (req, res) => {
  const all = await store.psi.all();
  const now = new Date();
  const month = now.toISOString().slice(0, 7);
  const byKind = k => all.filter(x => x.kind === k);
  const pronts = byKind('prontuario').filter(p => ((p.dados || {}).status || 'ativo') === 'ativo');
  const atMes = byKind('atendimento').filter(a => (a.data || '').slice(0, 7) === month);
  const faltasMes = atMes.filter(a => ((a.dados || {}).status || '') !== 'presente');
  const gruposAtivos = byKind('grupo').filter(g => (g.dados || {}).ativo !== false);
  const encPend = byKind('encaminhamento').filter(e => ((e.dados || {}).status || 'pendente') === 'pendente');
  const in30 = new Date(now.getTime() + 30 * 864e5).toISOString().slice(0, 10);
  const medidas = byKind('medida').filter(m => {
    const dd = (m.dados || {});
    return (dd.status || 'ativa') === 'ativa' && dd.fim && dd.fim <= in30;
  });
  res.json({
    acompanhados: pronts.length,
    atendimentosMes: atMes.length,
    faltasMes: faltasMes.length,
    gruposAtivos: gruposAtivos.length,
    encPendentes: encPend.length,
    medidasVencendo: medidas.length
  });
}));

// Alertas: faltas, medidas vencendo, encaminhamentos parados, retornos em atraso
router.get('/api/psi/alerts', auth(GATE), ah(async (req, res) => {
  const all = await store.psi.all();
  const out = [];
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const d30ago = new Date(now.getTime() - 30 * 864e5).toISOString().slice(0, 10);
  const in30 = new Date(now.getTime() + 30 * 864e5).toISOString().slice(0, 10);
  const d15ago = new Date(now.getTime() - 15 * 864e5).toISOString().slice(0, 10);
  const push = (tipo, texto, personId, personName, ref) => {
    if (out.length < 100) out.push({ tipo, texto, personId: personId || '', personName: personName || '', ref: ref || '' });
  };
  all.filter(x => x.kind === 'atendimento' && ((x.dados || {}).status || '') === 'falta' && (x.data || '') >= d30ago)
    .forEach(a => push('falta', `Falta sem justificativa em ${a.data}`, a.personId, a.personName, a.id));
  all.filter(x => x.kind === 'medida' && ((x.dados || {}).status || 'ativa') === 'ativa' && (x.dados || {}).fim)
    .forEach(m => {
      const fim = m.dados.fim;
      if (fim < today) push('medida', `Medida vencida em ${fim}`, m.personId, m.personName, m.id);
      else if (fim <= in30) push('medida', `Medida vence em ${fim}`, m.personId, m.personName, m.id);
    });
  all.filter(x => x.kind === 'encaminhamento' && ((x.dados || {}).status || 'pendente') === 'pendente' && (x.data || '') <= d15ago)
    .forEach(e => push('encaminhamento', `Encaminhamento parado há 15+ dias (${(e.dados || {}).destino || 'destino?'})`, e.personId, e.personName, e.id));
  // retorno em atraso: último atendimento + periodicidade do plano
  const lastAt = {};
  all.filter(x => x.kind === 'atendimento').forEach(a => {
    const k = String(a.personId);
    if (!lastAt[k] || (a.data || '') > lastAt[k]) lastAt[k] = a.data || '';
  });
  all.filter(x => x.kind === 'prontuario').forEach(p => {
    const per = (p.dados || {}).periodicidade;
    const days = PERIOD_DAYS[per];
    if (!days || ((p.dados || {}).status || 'ativo') !== 'ativo') return;
    const last = lastAt[String(p.personId)] || (p.dados || {}).inicioAcomp || '';
    if (!last) return;
    const due = new Date(new Date(last + 'T12:00:00').getTime() + days * 864e5).toISOString().slice(0, 10);
    if (due < today) push('retorno', `Retorno em atraso desde ${due} (${per})`, p.personId, p.personName, p.id);
  });
  out.sort((a, b) => (a.tipo > b.tipo ? 1 : -1));
  res.json(out);
}));

module.exports = router;
