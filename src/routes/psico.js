const express = require('express');
const shared = require('../lib/shared');
const { store, ah, auth, broadcast, upload } = shared;
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const router = express.Router();

// Módulo Psicossocial — sigilo por padrão: perfil psico tem acesso total.
// Admin tem acesso EMERGENCIAL somente-leitura (?emergencia=1&motivo=...),
// sempre auditado (quem, quando, por quê). Uso: saída do psicólogo, auditoria.
const KINDS = ['prontuario', 'evolucao', 'atendimento', 'grupo', 'encontro', 'encaminhamento', 'medida', 'psc_local', 'psc_vinculo', 'psc_hora'];
const PERIOD_DAYS = { semanal: 7, quinzenal: 15, mensal: 30, bimestral: 60, trimestral: 90 };
// Tags estruturadas de observação (item 6): filtro + relatório em vez de texto livre.
const OBS_TAGS = ['Biometria pendente', 'Contato desatualizado', 'Localizar frequência', 'Aguardando retorno', 'Encaminhamento necessário', 'Medida vencendo', 'Falta reiterada', 'Alta prevista'];

function cleanStr(v, n) { return String(v == null ? '' : v).trim().slice(0, n || 2000); }
function cleanDados(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return {};
  const o = {};
  for (const k of Object.keys(d).slice(0, 60)) {
    if (k === '_arquivado' || k === '_arquivadoEm' || k === '_arquivadoPor') continue; // flags internas: só via arquivar/restaurar
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

// Arquivamento lógico (soft-delete): prontuário clínico nunca é apagado.
// A exclusão física foi removida — DELETE arquiva, PATCH /:id/restore restaura.
const isArchived = r => !!(r && r.dados && r.dados._arquivado === true);
const visible = list => (list || []).filter(r => !isArchived(r));

// Faltas consecutivas sem justificativa (ordenado do mais recente): base do
// alerta crítico + ofício de irregularidade (2+ seguidas).
function faltasConsecutivas(atendimentos) {
  const sorted = [...(atendimentos || [])].sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')));
  let n = 0;
  for (const a of sorted) {
    const st = (a.dados || {}).status;
    if (st === 'falta') n++;
    else break;
  }
  return n;
}
// PSC: horas cumpridas e saldo restante por vínculo.
function pscHorasDoVinculo(all, vinculoId) {
  return all.filter(x => x.kind === 'psc_hora' && String((x.dados || {}).vinculoId) === String(vinculoId));
}
function pscSaldo(vinculo, horas) {
  const total = Number((vinculo.dados || {}).cargaTotal) || 0;
  const feitas = horas.reduce((s, h) => s + (Number((h.dados || {}).horas) || 0), 0);
  return { total, feitas, saldo: Math.max(total - feitas, 0) };
}
function archiveStamps(user) {
  return { _arquivado: true, _arquivadoEm: new Date().toISOString(), _arquivadoPor: String(user || '') };
}

// Gate de acesso: psico passa sempre; admin só leitura + emergência justificada.
function gatePSI(write) {
  return (req, res, next) => {
    auth()(req, res, () => {
      const role = req.auth && req.auth.role;
      if (role === 'psico') return next();
      if (role === 'admin' && !write) {
        const src = (req.method === 'GET' ? req.query : Object.assign({}, req.query, req.body)) || {};
        const motivo = String(src.motivo || '').trim();
        const emerg = src.emergencia === '1' || src.emergencia === true;
        if (!emerg || motivo.length < 10)
          return res.status(403).json({ error: 'Acesso emergencial: informe emergencia=1 e motivo (mín. 10 caracteres). Todo acesso é auditado.' });
        req.breakglass = motivo.slice(0, 280);
        return next();
      }
      if (role === 'admin' && write)
        return res.status(403).json({ error: 'Acesso emergencial do admin é somente leitura. Alterações são exclusivas do psicólogo.' });
      return res.status(403).json({ error: 'Acesso restrito ao perfil psicossocial.' });
    });
  };
}

// Trilha de auditoria do prontuário (LGPD — dado sensível de saúde):
// criações, edições, arquivamentos, restaurações e acessos emergenciais.
// Leituras de rotina do psicólogo NÃO são logadas (evita inundar a trilha).
async function psiAudit(req, action, rec, summary) {
  try {
    const pidRaw = rec ? rec.personId : (req.body && req.body.personId);
    const pid = /^\d+$/.test(String(pidRaw || '')) ? Number(pidRaw) : null;
    await store.audit.insert({
      kind: 'psi',
      action,
      personId: pid,
      personName: (rec && rec.personName) || (req.body && req.body.personName) || '',
      ticketId: null,
      ref: rec ? (rec.kind + '#' + rec.id) : 'psi',
      byUser: req.auth.user, byName: req.auth.name, byRole: req.auth.role,
      summary: summary || '',
      changes: []
    });
  } catch (e) {}
}
async function logBreakglass(req, what, rec) {
  if (!req.breakglass) return;
  await psiAudit(req, 'breakglass', rec, 'Acesso emergencial (' + what + '): ' + req.breakglass);
}

// Lista (filtros opcionais). Arquivados ficam de fora, salvo ?arquivados=1.
router.get('/api/psi', gatePSI(false), ah(async (req, res) => {
  const { kind, personId, grupoId, arquivados, tag } = req.query || {};
  let list = await store.psi.all();
  if (arquivados !== '1') list = visible(list);
  if (kind) list = list.filter(x => x.kind === kind);
  if (personId) list = list.filter(x => String(x.personId) === String(personId));
  if (grupoId) list = list.filter(x => String(x.grupoId) === String(grupoId));
  if (tag) list = list.filter(x => ((x.dados || {}).tags || []).includes(tag));
  await logBreakglass(req, 'lista kind=' + (kind || 'todas'), null);
  res.json(list.slice(0, 2000));
}));

// Cria (prontuário faz upsert por pessoa; salvar reativa prontuário arquivado)
router.post('/api/psi', gatePSI(true), ah(async (req, res) => {
  const { kind, personId, personName, grupoId, data, dados } = req.body || {};
  if (!KINDS.includes(kind)) return res.status(400).json({ error: 'Tipo inválido' });
  if (['prontuario', 'evolucao', 'atendimento', 'encaminhamento', 'medida'].includes(kind) && !personId)
    return res.status(400).json({ error: 'Selecione a pessoa' });
  if (kind === 'grupo' && !cleanStr(dados && dados.nome, 120))
    return res.status(400).json({ error: 'Informe o nome do grupo' });
  if (kind === 'encontro' && !grupoId)
    return res.status(400).json({ error: 'Selecione o grupo' });
  if (kind === 'psc_local' && !cleanStr(dados && dados.nome, 120))
    return res.status(400).json({ error: 'Informe o nome do local de PSC' });
  if ((kind === 'psc_vinculo' || kind === 'psc_hora') && !personId)
    return res.status(400).json({ error: 'Selecione a pessoa' });
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
      const merged = Object.assign({}, ex.dados || {}, row.dados);
      delete merged._arquivado; delete merged._arquivadoEm; delete merged._arquivadoPor;
      const upd = await store.psi.patch(ex.id, { dados: merged, personName: row.personName || ex.personName });
      await psiAudit(req, 'prontuario_atualizado', upd, 'Prontuário atualizado');
      broadcast();
      return res.json(upd);
    }
  }
  const rec = await store.psi.insert(row);
  await psiAudit(req, kind + '_criado', rec, 'Registro ' + kind + ' criado');
  broadcast();
  res.status(201).json(rec);
}));

// Relatório mensal em PDF (gestão): indicadores do mês + faltas + medidas + pendências.
// Baixe com o token na query: /api/psi/relatorio?mes=2026-09&token=... (&emergencia=1&motivo=.. p/ admin)
router.get('/api/psi/relatorio', gatePSI(false), ah(async (req, res) => {
  const mes = /^\d{4}-\d{2}$/.test(String(req.query.mes || '')) ? String(req.query.mes) : new Date().toISOString().slice(0, 7);
  const all = visible(await store.psi.all());
  const inMonth = all.filter(x => (x.data || '').slice(0, 7) === mes);
  const byKind = k => inMonth.filter(x => x.kind === k);
  const at = byKind('atendimento');
  const st = s => at.filter(a => ((a.dados || {}).status || 'presente') === s);
  const enc = byKind('encaminhamento');
  const encSt = s => enc.filter(e => ((e.dados || {}).status || 'pendente') === s);
  const today = new Date().toISOString().slice(0, 10);
  const medidasAtivas = all.filter(x => x.kind === 'medida' && ((x.dados || {}).status || 'ativa') === 'ativa');
  const faltas = at.filter(a => ((a.dados || {}).status || '') === 'falta');

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 595.28, H = 841.89, M = 42;
  let page = pdf.addPage([W, H]);
  let y = H - M;
  const line = (text, size, f, color, gap) => {
    const lh = (gap || 15);
    if (y < M + 20) { page = pdf.addPage([W, H]); y = H - M; }
    page.drawText(String(text || '').slice(0, 140), { x: M, y, size: size || 10, font: f || font, color: color || rgb(0.15, 0.15, 0.15) });
    y -= lh;
  };
  const h1 = t => { line(t, 17, bold, rgb(0.05, 0.35, 0.25), 24); };
  const h2 = t => { y -= 4; line(t, 12, bold, rgb(0.1, 0.35, 0.55), 18); };
  const kv = (k, v) => line('• ' + k + ': ' + v, 10, font, rgb(0.15, 0.15, 0.15), 14);

  h1('Relatório Psicossocial — ' + mes.split('-').reverse().join('/'));
  line('SISUMEPE Juazeiro • gerado em ' + new Date().toLocaleString('pt-BR') + ' por ' + (req.auth.name || req.auth.user), 9, font, rgb(0.4, 0.4, 0.4), 20);
  h2('Indicadores do mês');
  kv('Atendimentos', at.length + ' (' + st('presente').length + ' presentes, ' + st('falta').length + ' faltas, ' + st('falta_justificada').length + ' justificadas)');
  kv('Novos prontuários', byKind('prontuario').length);
  kv('Evoluções registradas', byKind('evolucao').length);
  kv('Encontros de grupo', byKind('encontro').length);
  kv('Encaminhamentos', enc.length + ' (' + encSt('efetivado').length + ' efetivados, ' + encSt('pendente').length + ' pendentes, ' + encSt('nao_efetivado').length + ' não efetivados)');
  h2('Acompanhamento geral');
  kv('Medidas ativas', medidasAtivas.length);
  kv('Medidas vencidas', medidasAtivas.filter(m => (m.dados || {}).fim && m.dados.fim < today).length);
  h2('Faltas no mês (' + faltas.length + ')');
  faltas.slice(0, 25).forEach(a => line('  ' + (a.data || '') + ' — ' + (a.personName || ('ID ' + a.personId)), 9, font, rgb(0.2, 0.2, 0.2), 12));
  if (!faltas.length) line('  Nenhuma falta no mês.', 9, font, rgb(0.4, 0.4, 0.4), 12);
  h2('Encaminhamentos pendentes (' + encSt('pendente').length + ')');
  encSt('pendente').slice(0, 25).forEach(e => line('  ' + (e.data || '') + ' — ' + (e.personName || '') + ' → ' + ((e.dados || {}).destino || '?'), 9, font, rgb(0.2, 0.2, 0.2), 12));
  if (!encSt('pendente').length) line('  Nenhum pendente.', 9, font, rgb(0.4, 0.4, 0.4), 12);

  await logBreakglass(req, 'relatorio ' + mes, null);
  const bytes = await pdf.save();
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="relatorio-psicossocial-' + mes + '.pdf"');
  res.send(Buffer.from(bytes));
}));

router.get('/api/psi/:id(\\d+)', gatePSI(false), ah(async (req, res) => {
  const r = await store.psi.byId(req.params.id);
  if (!r) return res.status(404).json({ error: 'Registro não encontrado' });
  await logBreakglass(req, 'prontuario ' + r.kind + '#' + r.id, r);
  res.json(r);
}));

function canWrite(req, rec) {
  return rec && rec.user === req.auth.user;
}

router.patch('/api/psi/:id(\\d+)', gatePSI(true), ah(async (req, res) => {
  const r = await store.psi.byId(req.params.id);
  if (!r) return res.status(404).json({ error: 'Registro não encontrado' });
  if (!canWrite(req, r)) return res.status(403).json({ error: 'Somente o autor do registro pode editar.' });
  if (isArchived(r)) return res.status(400).json({ error: 'Registro arquivado. Restaure para editar.' });
  const { data, dados, personName, grupoId } = req.body || {};
  const fields = {};
  if (data !== undefined) fields.data = toISODate(data) || r.data;
  if (grupoId !== undefined) fields.grupoId = String(grupoId);
  if (personName !== undefined) fields.personName = cleanStr(personName, 120);
  if (dados && typeof dados === 'object') fields.dados = Object.assign({}, r.dados || {}, cleanDados(dados));
  const upd = await store.psi.patch(r.id, fields);
  await psiAudit(req, r.kind + '_editado', upd, 'Registro editado');
  broadcast();
  res.json(upd);
}));

// Arquivar (substitui a exclusão física: prontuário clínico não se apaga)
router.delete('/api/psi/:id(\\d+)', gatePSI(true), ah(async (req, res) => {
  const r = await store.psi.byId(req.params.id);
  if (!r) return res.status(404).json({ error: 'Registro não encontrado' });
  if (!canWrite(req, r)) return res.status(403).json({ error: 'Somente o autor do registro pode arquivar.' });
  if (isArchived(r)) return res.json({ ok: true, arquivado: true });
  const upd = await store.psi.patch(r.id, { dados: Object.assign({}, r.dados || {}, archiveStamps(req.auth.user)) });
  await psiAudit(req, r.kind + '_arquivado', upd, 'Registro arquivado (exclusão lógica)');
  broadcast();
  res.json({ ok: true, arquivado: true });
}));

// Restaurar registro arquivado (somente o autor)
router.patch('/api/psi/:id(\\d+)/restore', gatePSI(true), ah(async (req, res) => {
  const r = await store.psi.byId(req.params.id);
  if (!r) return res.status(404).json({ error: 'Registro não encontrado' });
  if (!canWrite(req, r)) return res.status(403).json({ error: 'Somente o autor do registro pode restaurar.' });
  if (!isArchived(r)) return res.json(r);
  const dados = Object.assign({}, r.dados || {});
  delete dados._arquivado; delete dados._arquivadoEm; delete dados._arquivadoPor;
  const upd = await store.psi.patch(r.id, { dados });
  await psiAudit(req, r.kind + '_restaurado', upd, 'Registro restaurado do arquivo');
  broadcast();
  res.json(upd);
}));

// Painel: indicadores do acompanhamento (arquivados não contam)
// (rotas :id aceitam só número, então "dashboard"/"alerts" nunca colidem)
router.get('/api/psi/dashboard', gatePSI(false), ah(async (req, res) => {
  const all = visible(await store.psi.all());
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
  await logBreakglass(req, 'dashboard', null);
  // Série mensal (6 meses, p/ gráfico de comparecimento) + PSC + faltas críticas
  const serie = [];
  for (let i = 5; i >= 0; i--) {
    const m = new Date(now.getFullYear(), now.getMonth() - i, 1).toISOString().slice(0, 7);
    const atM = byKind('atendimento').filter(a => (a.data || '').slice(0, 7) === m);
    serie.push({
      mes: m,
      atendimentos: atM.length,
      presentes: atM.filter(a => ((a.dados || {}).status || 'presente') === 'presente').length,
      faltas: atM.filter(a => ((a.dados || {}).status || '') === 'falta').length
    });
  }
  const vincs = byKind('psc_vinculo').filter(v => ((v.dados || {}).status || 'ativo') === 'ativo');
  const horasMes = byKind('psc_hora')
    .filter(h => (h.data || '').slice(0, 7) === month)
    .reduce((s, h) => s + (Number((h.dados || {}).horas) || 0), 0);
  const porPessoa = {};
  byKind('atendimento').forEach(a => { (porPessoa[a.personId] = porPessoa[a.personId] || []).push(a); });
  const faltasCriticas = Object.values(porPessoa).filter(l => faltasConsecutivas(l) >= 2).length;
  res.json({
    acompanhados: pronts.length,
    atendimentosMes: atMes.length,
    faltasMes: faltasMes.length,
    gruposAtivos: gruposAtivos.length,
    encPendentes: encPend.length,
    medidasVencendo: medidas.length,
    serie, faltasCriticas,
    psc: { vinculosAtivos: vincs.length, horasMes }
  });
}));

// Alertas: faltas, medidas vencendo, encaminhamentos parados, retornos em atraso
router.get('/api/psi/alerts', gatePSI(false), ah(async (req, res) => {
  const all = visible(await store.psi.all());
  const out = [];
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const d30ago = new Date(now.getTime() - 30 * 864e5).toISOString().slice(0, 10);
  const in30 = new Date(now.getTime() + 30 * 864e5).toISOString().slice(0, 10);
  const d15ago = new Date(now.getTime() - 15 * 864e5).toISOString().slice(0, 10);
  const push = (tipo, texto, personId, personName, ref, extra) => {
    if (out.length < 120) out.push(Object.assign(
      { tipo, texto, personId: personId || '', personName: personName || '', ref: ref || '' },
      extra || {}
    ));
  };
  all.filter(x => x.kind === 'atendimento' && ((x.dados || {}).status || '') === 'falta' && (x.data || '') >= d30ago)
    .forEach(a => push('falta', `Falta sem justificativa em ${a.data}`, a.personId, a.personName, a.id, { data: a.data }));
  // Faltas consecutivas (2+): sugere ofício de irregularidade à vara
  const porPessoa = {};
  all.filter(x => x.kind === 'atendimento').forEach(a => { (porPessoa[a.personId] = porPessoa[a.personId] || []).push(a); });
  Object.entries(porPessoa).forEach(([pid, lista]) => {
    const n = faltasConsecutivas(lista);
    if (n >= 2) {
      const sorted = [...lista].sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')));
      const first = sorted[0];
      push('falta_critica', `${n} faltas consecutivas sem justificativa — gerar ofício à vara`, pid, first.personName, first.id, { data: first.data, acao: 'oficio' });
    }
  });
  // Próximo envio (relatório/retorno à vara): lembra 15 dias antes + vencidos
  all.filter(x => x.kind === 'prontuario' && (x.dados || {}).proximoEnvio)
    .forEach(p => {
      const pe = p.dados.proximoEnvio;
      if (pe <= in30) push('proximo_envio', pe < today ? `Próximo envio VENCIDO em ${pe}` : `Próximo envio em ${pe} — preparar relatório`, p.personId, p.personName, p.id, { data: pe });
    });
  all.filter(x => x.kind === 'medida' && ((x.dados || {}).status || 'ativa') === 'ativa' && (x.dados || {}).fim)
    .forEach(m => {
      const fim = m.dados.fim;
      if (fim < today) push('medida', `Medida vencida em ${fim}`, m.personId, m.personName, m.id, { data: fim });
      else if (fim <= in30) push('medida', `Medida vence em ${fim} — preparar relatório final`, m.personId, m.personName, m.id, { data: fim });
    });
  all.filter(x => x.kind === 'encaminhamento' && ((x.dados || {}).status || 'pendente') === 'pendente' && (x.data || '') <= d15ago)
    .forEach(e => push('encaminhamento', `Encaminhamento parado há 15+ dias (${(e.dados || {}).destino || 'destino?'})`, e.personId, e.personName, e.id, { data: e.data }));
  // Encaminhamento sem retorno há 30+ dias: cobrar a rede (contra-referência)
  const d30enc = new Date(now.getTime() - 30 * 864e5).toISOString().slice(0, 10);
  all.filter(x => x.kind === 'encaminhamento' && ((x.dados || {}).status || 'pendente') === 'pendente' && (x.data || '') <= d30enc)
    .forEach(e => push('enc_30', `Sem contra-referência há 30+ dias (${(e.dados || {}).destino || 'destino?'}) — cobrar`, e.personId, e.personName, e.id, { data: e.data }));
  // PSC sem registro de horas há 15+ dias (vínculo ativo)
  const d15psc = new Date(now.getTime() - 15 * 864e5).toISOString().slice(0, 10);
  all.filter(x => x.kind === 'psc_vinculo' && ((x.dados || {}).status || 'ativo') === 'ativo')
    .forEach(v => {
      const horas = pscHorasDoVinculo(all, v.id).sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')));
      const last = horas.length ? (horas[0].data || '') : ((v.dados || {}).inicio || '');
      if (!last || last <= d15psc) push('psc', `PSC sem horas há 15+ dias (${(v.dados || {}).localNome || 'local?'})`, v.personId, v.personName, v.id, { data: last || undefined });
    });
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
    if (due < today) push('retorno', `Retorno em atraso desde ${due} (${per})`, p.personId, p.personName, p.id, { data: due });
  });
  out.sort((a, b) => (a.tipo > b.tipo ? 1 : -1));
  await logBreakglass(req, 'alertas', null);
  res.json(out);
}));

// ---- Ficha 360 do monitorado (item 1): tudo da pessoa em um só lugar ----
router.get('/api/psi/ficha/:personId(\\d+)', gatePSI(false), ah(async (req, res) => {
  const person = await store.persons.byId(req.params.personId);
  if (!person) return res.status(404).json({ error: 'Pessoa não encontrada' });
  const all = visible(await store.psi.all());
  const mine = all.filter(x => String(x.personId) === String(person.id));
  const desc = (a, b) => String(b.data || '').localeCompare(String(a.data || ''));
  const byK = k => mine.filter(x => x.kind === k).sort(desc);
  const prontuario = byK('prontuario')[0] || null;
  const tags = [...new Set(mine.flatMap(x => ((x.dados || {}).tags) || []))].slice(0, 30);
  const grupos = all
    .filter(x => x.kind === 'grupo' && ((x.dados || {}).integrantes || []).some(m => String((m && m.id) || m) === String(person.id)))
    .map(g => {
      const dd = g.dados || {};
      const me = (dd.integrantes || []).find(m => String((m && m.id) || m) === String(person.id)) || {};
      const encs = all.filter(e => e.kind === 'encontro' && String(e.grupoId) === String(g.id));
      const pres = encs.filter(e => ((e.dados || {}).presentes || []).some(p => String((p && p.id) || p) === String(person.id))).length;
      return { id: g.id, nome: dd.nome, tipo: dd.tipo, dia: dd.dia, status: me.status || 'ativo', encontros: encs.length, presencas: pres };
    });
  const vincs = byK('psc_vinculo').map(v => {
    const horas = pscHorasDoVinculo(all, v.id).sort((a, b) => String(a.data || '').localeCompare(String(b.data || '')));
    const s = pscSaldo(v, horas);
    return { id: v.id, dados: v.dados, data: v.data, total: s.total, feitas: s.feitas, saldo: s.saldo, horas: horas.map(h => ({ id: h.id, data: h.data, dados: h.dados })) };
  });
  const locais = all.filter(x => x.kind === 'psc_local').map(l => ({ id: l.id, dados: l.dados }));
  let documentos = [];
  try {
    const termos = await store.termos.all();
    const nm = String(person.nome || '').trim().toLowerCase();
    documentos = (termos || []).filter(t => t && t.dados && String(t.dados.nome || '').trim().toLowerCase() === nm)
      .map(t => ({ id: t.id, tipo: t.tipo, dataEnvio: t.dataEnvio, destinatario: t.destinatario })).slice(0, 100);
  } catch (e) {}
  const at = byK('atendimento');
  const fc = faltasConsecutivas(at);
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const in30 = new Date(now.getTime() + 30 * 864e5).toISOString().slice(0, 10);
  const d15 = new Date(now.getTime() - 15 * 864e5).toISOString().slice(0, 10);
  const tl = [
    ...byK('evolucao').map(e => ({ id: e.id, kind: 'evolucao', data: e.data, titulo: 'Evolução ' + (((e.dados || {}).tipo) || ''), resumo: ['S', 'O', 'A', 'P'].map(k => (e.dados || {})[k] ? k.toUpperCase() + ': ' + (e.dados || {})[k] : '').filter(Boolean).join(' | ').slice(0, 300) })),
    ...at.map(a => ({ id: a.id, kind: 'atendimento', data: a.data, titulo: 'Atendimento (' + (((a.dados || {}).status) || 'presente') + ')', resumo: (((a.dados || {}).tipo) || '') + ' • ' + (((a.dados || {}).local) || 'UMEPE') + ((((a.dados || {}).obs)) ? ' — ' + ((a.dados || {}).obs) : '') })),
    ...byK('encaminhamento').map(e => ({ id: e.id, kind: 'encaminhamento', data: e.data, titulo: 'Encaminhamento → ' + (((e.dados || {}).destino) || '?'), resumo: (((e.dados || {}).status) || 'pendente') + (((e.dados || {}).contraref) ? ' | Contra-ref.: ' + ((e.dados || {}).contraref) : '') })),
    ...byK('medida').map(m => ({ id: m.id, kind: 'medida', data: (m.dados || {}).inicio || m.data, titulo: 'Medida ' + (((m.dados || {}).tipo) || ''), resumo: (((m.dados || {}).status) || 'ativa') + ' • término ' + (((m.dados || {}).fim) || '?') }))
  ].sort(desc).slice(0, 100);
  const pendencias = {
    faltasConsecutivas: fc,
    medidasVencendo: byK('medida').filter(m => { const dd = m.dados || {}; return (dd.status || 'ativa') === 'ativa' && dd.fim && dd.fim <= in30; }).map(m => ({ id: m.id, tipo: (m.dados || {}).tipo, fim: (m.dados || {}).fim })),
    encPendentes: byK('encaminhamento').filter(e => ((e.dados || {}).status || 'pendente') === 'pendente').map(e => ({ id: e.id, destino: (e.dados || {}).destino, data: e.data })),
    proximoEnvio: (prontuario && prontuario.dados && prontuario.dados.proximoEnvio) || null,
    pscSemHoras: vincs.filter(v => ((v.dados || {}).status || 'ativo') === 'ativo' && ((!v.horas.length && true) || (v.horas.length && v.horas[v.horas.length - 1].data <= d15))).map(v => ({ id: v.id, local: (v.dados || {}).localNome }))
  };
  await logBreakglass(req, 'ficha ' + person.nome, null);
  res.json({ person, prontuario, tags, evolucoes: byK('evolucao'), atendimentos: at, encaminhamentos: byK('encaminhamento'), medidas: byK('medida'), grupos, vincs, locais, documentos, timeline: tl, pendencias, stats: { totalAt: at.length, presentes: at.filter(a => ((a.dados || {}).status || 'presente') === 'presente').length, faltas: at.filter(a => ((a.dados || {}).status) === 'falta').length, evolucoes: byK('evolucao').length } });
}));

// ---- Relatório judicial compilado (item 9): evoluções SOAP + histórico em PDF ----
router.get('/api/psi/judicial/:personId(\\d+)', gatePSI(false), ah(async (req, res) => {
  const person = await store.persons.byId(req.params.personId);
  if (!person) return res.status(404).json({ error: 'Pessoa não encontrada' });
  const all = visible(await store.psi.all());
  const mine = all.filter(x => String(x.personId) === String(person.id));
  const desc = (a, b) => String(b.data || '').localeCompare(String(a.data || ''));
  const pront = mine.filter(x => x.kind === 'prontuario').sort(desc)[0];
  const evol = mine.filter(x => x.kind === 'evolucao').sort((a, b) => String(a.data || '').localeCompare(String(b.data || '')));
  const at = mine.filter(x => x.kind === 'atendimento').sort(desc);
  const enc = mine.filter(x => x.kind === 'encaminhamento').sort(desc);
  const pd = (pront && pront.dados) || {};
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 595.28, H = 841.89, M = 42;
  let page = pdf.addPage([W, H]);
  let y = H - M;
  const line = (text, size, f, color, gap) => {
    const words = String(text || '').split(/\s+/).filter(Boolean);
    const maxW = W - 2 * M;
    const meas = f || font;
    let cur = '';
    const flush = t => {
      if (y < M + 20) { page = pdf.addPage([W, H]); y = H - M; }
      page.drawText(t.slice(0, 130), { x: M, y, size: size || 10, font: meas, color: color || rgb(0.15, 0.15, 0.15) });
      y -= (gap || 14);
    };
    for (const w of words) {
      const t = cur ? cur + ' ' + w : w;
      if (meas.widthOfTextAtSize(t, size || 10) > maxW && cur) { flush(cur); cur = w; }
      else cur = t;
    }
    if (cur) flush(cur); else y -= 2;
  };
  const h1 = t => { line(t, 16, bold, rgb(0.05, 0.3, 0.3), 22); };
  const h2 = t => { y -= 4; line(t, 12, bold, rgb(0.1, 0.35, 0.55), 17); };
  const kv = (k, v) => line('• ' + k + ': ' + (v || '—'), 10, font, rgb(0.15, 0.15, 0.15), 13);
  h1('Relatório Psicossocial — ' + person.nome);
  line('SISUMEPE Juazeiro • gerado em ' + new Date().toLocaleString('pt-BR') + ' por ' + (req.auth.name || req.auth.user), 9, font, rgb(0.4, 0.4, 0.4), 18);
  h2('1. Identificação');
  kv('Nome', person.nome); kv('CPF/RG', [person.cpf, person.rg].filter(Boolean).join(' / '));
  kv('Nascimento', person.dataNascimento); kv('Processo', pd.processo); kv('Vara', pd.vara);
  kv('Medida', pd.medidaTipo || pd.tipoMedida); kv('Período', [pd.medidaInicio, pd.medidaFim].filter(Boolean).join(' a '));
  h2('2. Acompanhamento');
  kv('Periodicidade', pd.periodicidade); kv('Status', pd.status); kv('Queixa inicial', pd.queixa); kv('Metas', pd.metas);
  kv('Atendimentos', at.length + ' (' + at.filter(a => ((a.dados || {}).status || 'presente') === 'presente').length + ' presentes, ' + at.filter(a => ((a.dados || {}).status) === 'falta').length + ' faltas)');
  h2('3. Evoluções (' + evol.length + ')');
  evol.forEach(e => {
    const ed = e.dados || {};
    line((e.data || '') + ' — ' + (ed.tipo || 'individual'), 10, bold, rgb(0.2, 0.2, 0.2), 13);
    ['s', 'o', 'a', 'p'].forEach(k => { if (ed[k]) line(k.toUpperCase() + ': ' + ed[k], 9, font, rgb(0.25, 0.25, 0.25), 12); });
    y -= 3;
  });
  if (!evol.length) line('Sem evoluções registradas.', 9, font, rgb(0.4, 0.4, 0.4), 12);
  h2('4. Encaminhamentos');
  enc.slice(0, 20).forEach(e => line((e.data || '') + ' → ' + ((e.dados || {}).destino || '?') + ' (' + (((e.dados || {}).status) || 'pendente') + ')' + (((e.dados || {}).contraref) ? ' — contra-ref.: ' + ((e.dados || {}).contraref) : ''), 9, font, rgb(0.2, 0.2, 0.2), 12));
  if (!enc.length) line('Nenhum encaminhamento.', 9, font, rgb(0.4, 0.4, 0.4), 12);
  h2('5. Parecer');
  const lastP = evol.length ? ((evol[evol.length - 1].dados || {}).p || '') : '';
  line(lastP || (pd.obs || 'Em acompanhamento.'), 10, font, rgb(0.15, 0.15, 0.15), 14);
  await logBreakglass(req, 'relatório judicial ' + person.nome, null);
  const bytes = await pdf.save();
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="relatorio-judicial-' + person.id + '.pdf"');
  res.send(Buffer.from(bytes));
}));

// ---- Certificado de PSC (item 4) ----
router.get('/api/psi/psc/certificado/:id(\\d+)', gatePSI(false), ah(async (req, res) => {
  const v = await store.psi.byId(req.params.id);
  if (!v || v.kind !== 'psc_vinculo') return res.status(404).json({ error: 'Vínculo de PSC não encontrado' });
  const all = visible(await store.psi.all());
  const horas = pscHorasDoVinculo(all, v.id).sort((a, b) => String(a.data || '').localeCompare(String(b.data || '')));
  const s = pscSaldo(v, horas);
  const dd = v.dados || {};
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const page = pdf.addPage([595.28, 420]);
  const cx = t => { const w = bold.widthOfTextAtSize(t, 13); return (595.28 - w) / 2; };
  let y = 370;
  page.drawText('CERTIFICADO DE PRESTAÇÃO DE SERVIÇOS À COMUNIDADE', { x: cx('CERTIFICADO DE PRESTAÇÃO DE SERVIÇOS À COMUNIDADE'), y, size: 13, font: bold, color: rgb(0.05, 0.3, 0.25) });
  y -= 34;
  const ln = t => { page.drawText(String(t).slice(0, 110), { x: 50, y, size: 10, font, color: rgb(0.15, 0.15, 0.15) }); y -= 17; };
  ln('Monitorado(a): ' + (v.personName || ('ID ' + v.personId)));
  ln('Local: ' + (dd.localNome || '—') + (dd.localEndereco ? ' — ' + dd.localEndereco : ''));
  ln('Período: ' + (dd.inicio || '?') + ' a ' + (dd.previsaoFim || '?'));
  ln('Carga determinada: ' + s.total + 'h   •   Cumpridas: ' + s.feitas + 'h   •   Saldo: ' + s.saldo + 'h');
  ln('Situação: ' + (s.saldo <= 0 && s.total > 0 ? 'CONCLUÍDA' : ((dd.status || 'ativo').toUpperCase())));
  y -= 8;
  ln('Juazeiro do Norte, ' + new Date().toLocaleDateString('pt-BR') + '.');
  y -= 30;
  page.drawText('___________________________________', { x: 180, y, size: 10, font, color: rgb(0.3, 0.3, 0.3) });
  y -= 15;
  page.drawText((req.auth.name || req.auth.user) + ' — Psicólogo(a)', { x: 200, y, size: 9, font, color: rgb(0.3, 0.3, 0.3) });
  await logBreakglass(req, 'certificado PSC ' + (v.personName || v.id), v);
  const bytes = await pdf.save();
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="certificado-psc-' + v.id + '.pdf"');
  res.send(Buffer.from(bytes));
}));

// ---- Relatório de frequência do grupo (item 5) ----
router.get('/api/psi/grupo/:id(\\d+)/relatorio', gatePSI(false), ah(async (req, res) => {
  const g = await store.psi.byId(req.params.id);
  if (!g || g.kind !== 'grupo') return res.status(404).json({ error: 'Grupo não encontrado' });
  const all = visible(await store.psi.all());
  const dd = g.dados || {};
  const ints = dd.integrantes || [];
  const encs = all.filter(e => e.kind === 'encontro' && String(e.grupoId) === String(g.id))
    .sort((a, b) => String(a.data || '').localeCompare(String(b.data || '')));
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 595.28, H = 841.89, M = 42;
  let page = pdf.addPage([W, H]);
  let y = H - M;
  const line = (text, size, f, color, gap) => {
    if (y < M + 20) { page = pdf.addPage([W, H]); y = H - M; }
    page.drawText(String(text || '').slice(0, 130), { x: M, y, size: size || 10, font: f || font, color: color || rgb(0.15, 0.15, 0.15) });
    y -= (gap || 14);
  };
  line('Relatório de Frequência — ' + (dd.nome || ('Grupo #' + g.id)), 15, bold, rgb(0.05, 0.3, 0.25), 20);
  line((dd.tipo || '') + ' • ' + (dd.dia || '') + ' • gerado em ' + new Date().toLocaleString('pt-BR'), 9, font, rgb(0.4, 0.4, 0.4), 18);
  line('Participantes e frequência (' + encs.length + ' encontros)', 12, bold, rgb(0.1, 0.35, 0.55), 17);
  ints.forEach(m => {
    const mid = String((m && m.id) || m);
    const pres = encs.filter(e => ((e.dados || {}).presentes || []).some(p => String((p && p.id) || p) === mid)).length;
    const pct = encs.length ? Math.round(pres / encs.length * 100) : 0;
    line('• ' + (m.nome || ('ID ' + mid)) + ' — ' + (m.status || 'ativo') + ': ' + pres + '/' + encs.length + ' (' + pct + '%)', 10, font, rgb(0.15, 0.15, 0.15), 13);
  });
  y -= 4;
  line('Encontros', 12, bold, rgb(0.1, 0.35, 0.55), 17);
  encs.forEach(e => {
    const ed = e.dados || {};
    line((e.data || '') + ' — ' + (ed.tema || 'Sem tema') + ' (' + ((ed.presentes || []).length) + ' presentes)', 10, bold, rgb(0.2, 0.2, 0.2), 13);
    line('  ' + ((ed.presentes || []).map(p => p.nome || p.id).join(', ') || '—'), 9, font, rgb(0.3, 0.3, 0.3), 12);
  });
  await logBreakglass(req, 'relatório grupo ' + (dd.nome || g.id), g);
  const bytes = await pdf.save();
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="grupo-' + g.id + '-frequencia.pdf"');
  res.send(Buffer.from(bytes));
}));

// ---- Exportação CSV (item 11): Excel das varas/órgãos ----
function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function psiResumo(kind, dados) {
  const d = dados || {};
  switch (kind) {
    case 'atendimento': return [d.status, d.tipo, d.local].filter(Boolean).join(' / ');
    case 'evolucao': return d.tipo || '';
    case 'encaminhamento': return (d.destino || '') + ' (' + (d.status || 'pendente') + ')';
    case 'medida': return (d.tipo || '') + ' • fim ' + (d.fim || '?') + ' (' + (d.status || 'ativa') + ')';
    case 'psc_hora': return (d.horas || 0) + 'h • ' + (d.obs || '');
    case 'psc_vinculo': return (d.localNome || '') + ' • ' + (d.cargaTotal || 0) + 'h';
    case 'grupo': return d.nome || '';
    case 'encontro': return d.tema || '';
    case 'prontuario': return (d.status || 'ativo') + ' • ' + (d.periodicidade || '');
    default: return '';
  }
}
router.get('/api/psi/export', gatePSI(false), ah(async (req, res) => {
  const { kind, tag, mes } = req.query || {};
  let list = visible(await store.psi.all());
  if (kind) list = list.filter(x => x.kind === kind);
  if (tag) list = list.filter(x => ((x.dados || {}).tags || []).includes(tag));
  if (mes) list = list.filter(x => (x.data || '').slice(0, 7) === mes);
  const rows = [['id', 'tipo', 'data', 'personId', 'pessoa', 'autor', 'grupoId', 'resumo', 'tags']];
  list.slice(0, 5000).forEach(r => rows.push([r.id, r.kind, r.data, r.personId, r.personName, r.user, r.grupoId, psiResumo(r.kind, r.dados), ((r.dados || {}).tags || []).join('|')]));
  await logBreakglass(req, 'exportação CSV (' + (kind || 'todos') + ')', null);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="psi-export-' + (kind || 'todos') + '.csv"');
  res.send('﻿' + rows.map(r => r.map(csvCell).join(';')).join('\r\n'));
}));

// ---- Importação CSV de atendimentos (item 11): assistente simples ----
// Colunas (pt, com ou sem acento): personId|cpf|nome; data; tipo; status; local; obs
function normHeader(h) {
  return String(h || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function parseCsv(buf) {
  const text = String(buf.toString('utf8')).replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
  if (!lines.length) return { head: [], rows: [] };
  const delim = (lines[0].match(/;/g) || []).length >= (lines[0].match(/,/g) || []).length ? ';' : ',';
  const split = line => {
    const out = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === delim) { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out.map(s => s.trim());
  };
  return { head: split(lines[0]).map(normHeader), rows: lines.slice(1).map(split) };
}
router.post('/api/psi/import', gatePSI(true), upload.single('arquivo'), ah(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Envie o arquivo CSV (.csv)' });
  const { head, rows } = parseCsv(req.file.buffer);
  const idx = n => head.indexOf(n);
  const iId = idx('personid') >= 0 ? idx('personid') : idx('id');
  const iCpf = idx('cpf'), iNome = idx('nome'), iData = idx('data'), iTipo = idx('tipo'),
    iStatus = [idx('status'), idx('situacao'), idx('situacao')].find(i => i >= 0);
  const iLocal = idx('local'), iObs = [idx('obs'), idx('observacao')].find(i => i >= 0);
  if (iData < 0 && iNome < 0 && iCpf < 0 && iId < 0)
    return res.status(400).json({ error: 'Cabeçalho inválido. Use: nome;cpf;data;tipo;status;local;obs' });
  const validStatus = ['presente', 'falta', 'falta_justificada'];
  let importados = 0;
  const falhas = [];
  for (let li = 0; li < Math.min(rows.length, 500); li++) {
    const r = rows[li];
    try {
      const get = i => (i >= 0 && r[i] != null ? String(r[i]).trim() : '');
      let person = null;
      const idRaw = get(iId);
      if (/^\d+$/.test(idRaw)) person = await store.persons.byId(Number(idRaw));
      if (!person && get(iCpf)) {
        const found = await store.persons.search(get(iCpf), 10);
        person = found.find(p => (p.cpf || '').replace(/\D/g, '') === get(iCpf).replace(/\D/g, '')) || null;
      }
      if (!person && get(iNome)) {
        const found = await store.persons.search(get(iNome), 10);
        const exact = found.filter(p => String(p.nome || '').trim().toLowerCase() === get(iNome).toLowerCase());
        if (exact.length === 1) person = exact[0];
        else if (exact.length > 1) throw new Error('nome ambíguo: ' + get(iNome));
      }
      if (!person) throw new Error('pessoa não localizada (id/cpf/nome)');
      const data = toISODate(get(iData)) || new Date().toISOString().slice(0, 10);
      const status = validStatus.includes(get(iStatus).toLowerCase()) ? get(iStatus).toLowerCase() : 'presente';
      await store.psi.insert({
        user: req.auth.user, kind: 'atendimento',
        personId: String(person.id), personName: person.nome, grupoId: '',
        data,
        dados: { tipo: get(iTipo) || 'individual', status, local: get(iLocal) || 'UMEPE', obs: get(iObs) }
      });
      importados++;
    } catch (e) { falhas.push({ linha: li + 2, erro: e.message || 'Erro' }); }
  }
  await psiAudit(req, 'importacao_csv', null, importados + ' atendimento(s) importado(s), ' + falhas.length + ' falha(s)');
  broadcast();
  res.json({ ok: true, importados, falhas: falhas.slice(0, 50) });
}));

module.exports = router;
