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

// ============================================================================
// FICHA 360 — VERSÃO 2.0 (otimizada, paginada, com score de risco)
// ============================================================================
function buildRiskScore(personId, mine, now) {
  const today = now.toISOString().slice(0, 10);
  const in30 = new Date(now.getTime() + 30 * 864e5).toISOString().slice(0, 10);
  const d15 = new Date(now.getTime() - 15 * 864e5).toISOString().slice(0, 10);
  const d30 = new Date(now.getTime() - 30 * 864e5).toISOString().slice(0, 10);

  const at = mine.filter(x => x.kind === 'atendimento');
  const ev = mine.filter(x => x.kind === 'evolucao');
  const enc = mine.filter(x => x.kind === 'encaminhamento');
  const med = mine.filter(x => x.kind === 'medida');
  const vincs = mine.filter(x => x.kind === 'psc_vinculo' && ((x.dados || {}).status || 'ativo') === 'ativo');
  const pront = mine.filter(x => x.kind === 'prontuario')[0] || null;

  const fc = faltasConsecutivas(at);
  const faltasMes = at.filter(a => ((a.dados || {}).status || '') === 'falta' && (a.data || '') >= d30).length;
  const totalAt = at.length;
  const taxaFalta = totalAt ? (faltasMes / totalAt) * 100 : 0;

  const medVencendo = med.filter(m => { const dd = m.dados || {}; return (dd.status || 'ativa') === 'ativa' && dd.fim && dd.fim <= in30; }).length;
  const medVencidas = med.filter(m => { const dd = m.dados || {}; return (dd.status || 'ativa') === 'ativa' && dd.fim && dd.fim < today; }).length;
  const encPend = enc.filter(e => ((e.dados || {}).status || 'pendente') === 'pendente').length;
  const encSemRetorno30 = enc.filter(e => ((e.dados || {}).status || 'pendente') === 'pendente' && (e.data || '') <= d30).length;

  const pscSemHoras = vincs.filter(v => {
    const horas = mine.filter(x => x.kind === 'psc_hora' && String((x.dados || {}).vinculoId) === String(v.id))
      .sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')));
    return !horas.length || (horas[0].data || '') <= d15;
  }).length;

  const prontIncompleto = pront ? (
    !pront.dados.processo || !pront.dados.vara || !pront.dados.medidaTipo || !pront.dados.periodicidade
  ) : true;

  const proximoEnvioVencido = pront && pront.dados && pront.dados.proximoEnvio && pront.dados.proximoEnvio < today;

  // Pesos (soma = 100)
  const weights = {
    faltasConsecutivas: 25,   // 2+ faltas = crítico
    taxaFalta: 15,            // % faltas no mês
    medVencendo: 15,          // medidas vencendo em 30d
    medVencidas: 10,          // medidas já vencidas
    encPendentes: 10,         // encaminhamentos pendentes
    encSemRetorno: 10,        // encaminhamentos sem retorno 30d
    pscSemHoras: 10,          // PSC sem registro 15d
    prontIncompleto: 5        // prontuário sem dados obrigatórios
  };

  let score = 0;
  const fatores = [];

  if (fc >= 2) { score += weights.faltasConsecutivas; fatores.push({ tipo: 'falta_critica', peso: weights.faltasConsecutivas, desc: `${fc} faltas consecutivas sem justificativa` }); }
  else if (fc === 1) { score += Math.round(weights.faltasConsecutivas * 0.4); fatores.push({ tipo: 'falta_simples', peso: Math.round(weights.faltasConsecutivas * 0.4), desc: '1 falta consecutiva' }); }

  if (taxaFalta > 30) { score += weights.taxaFalta; fatores.push({ tipo: 'taxa_falta_alta', peso: weights.taxaFalta, desc: `Taxa de falta ${taxaFalta.toFixed(0)}% no mês` }); }
  else if (taxaFalta > 15) { score += Math.round(weights.taxaFalta * 0.5); fatores.push({ tipo: 'taxa_falta_media', peso: Math.round(weights.taxaFalta * 0.5), desc: `Taxa de falta ${taxaFalta.toFixed(0)}% no mês` }); }

  if (medVencidas > 0) { score += weights.medVencidas; fatores.push({ tipo: 'medida_vencida', peso: weights.medVencidas, desc: `${medVencidas} medida(s) vencida(s)` }); }
  if (medVencendo > 0) { score += weights.medVencendo; fatores.push({ tipo: 'medida_vencendo', peso: weights.medVencendo, desc: `${medVencendo} medida(s) vencendo em 30 dias` }); }

  if (encSemRetorno30 > 0) { score += weights.encSemRetorno; fatores.push({ tipo: 'enc_sem_retorno', peso: weights.encSemRetorno, desc: `${encSemRetorno30} encaminhamento(s) sem contra-referência 30+ dias` }); }
  else if (encPend > 0) { score += weights.encPendentes; fatores.push({ tipo: 'enc_pendente', peso: weights.encPendentes, desc: `${encPend} encaminhamento(s) pendente(s)` }); }

  if (pscSemHoras > 0) { score += weights.pscSemHoras; fatores.push({ tipo: 'psc_sem_horas', peso: weights.pscSemHoras, desc: `${pscSemHoras} vínculo(s) PSC sem horas 15+ dias` }); }

  if (prontIncompleto) { score += weights.prontIncompleto; fatores.push({ tipo: 'pront_incompleto', peso: weights.prontIncompleto, desc: 'Prontuário sem processo/vara/medida/periodicidade' }); }

  score = Math.min(100, Math.max(0, score));
  let nivel = 'baixo';
  if (score >= 70) nivel = 'critico';
  else if (score >= 45) nivel = 'alto';
  else if (score >= 25) nivel = 'medio';

  return { valor: score, nivel, fatores };
}

function buildTimeline(mine, opts = {}) {
  const { limit = 100, cursor, kinds } = opts;
  const allowedKinds = kinds || ['evolucao', 'atendimento', 'encaminhamento', 'medida', 'psc_hora'];
  const desc = (a, b) => String(b.data || '').localeCompare(String(a.data || ''));
  let events = mine
    .filter(x => allowedKinds.includes(x.kind))
    .map(x => {
      const d = x.dados || {};
      let titulo = '', resumo = '';
      switch (x.kind) {
        case 'evolucao':
          titulo = 'Evolução ' + (d.tipo || '');
          resumo = ['S', 'O', 'A', 'P'].map(k => d[k] ? k.toUpperCase() + ': ' + d[k] : '').filter(Boolean).join(' | ').slice(0, 300);
          break;
        case 'atendimento':
          titulo = 'Atendimento (' + (d.status || 'presente') + ')';
          resumo = (d.tipo || '') + ' • ' + (d.local || 'UMEPE') + (d.obs ? ' — ' + d.obs : '');
          break;
        case 'encaminhamento':
          titulo = 'Encaminhamento → ' + (d.destino || '?');
          resumo = (d.status || 'pendente') + (d.contraref ? ' | Contra-ref.: ' + d.contraref : '');
          break;
        case 'medida':
          titulo = 'Medida ' + (d.tipo || '');
          resumo = (d.status || 'ativa') + ' • término ' + (d.fim || '?');
          break;
        case 'psc_hora':
          titulo = 'Horas PSC';
          resumo = (d.horas || 0) + 'h • ' + (d.localNome || '') + (d.obs ? ' — ' + d.obs : '');
          break;
      }
      return { id: x.id, kind: x.kind, data: x.data, titulo, resumo, dados: x.dados };
    })
    .sort(desc);

  if (cursor) {
    events = events.filter(e => String(e.data) > String(cursor));
  }
  const hasMore = events.length > limit;
  return { events: events.slice(0, limit), nextCursor: hasMore ? events[limit - 1].data : null, hasMore };
}

// ---- Ficha 360 completa (com paginação na timeline) ----
router.get('/api/psi/ficha/:personId(\\d+)', gatePSI(false), ah(async (req, res) => {
  const person = await store.persons.byId(req.params.personId);
  if (!person) return res.status(404).json({ error: 'Pessoa não encontrada' });

  const personId = String(person.id);
  const { cursor, limit = 100, kinds } = req.query;

  // Busca otimizada: só registros da pessoa
  const mine = await store.psi.byPerson(personId, { limit: 2000 });
  const visibleMine = mine.filter(r => !r.dados?._arquivado);

  // Prontuário (upsert garante 1 por pessoa)
  const prontuario = visibleMine.find(x => x.kind === 'prontuario') || null;

  // Tags únicas
  const tags = [...new Set(visibleMine.flatMap(x => ((x.dados || {}).tags) || []))].slice(0, 30);

  // Atendimentos
  const at = visibleMine.filter(x => x.kind === 'atendimento').sort((a,b) => String(b.data).localeCompare(String(a.data)));
  const presentes = at.filter(a => ((a.dados || {}).status || 'presente') === 'presente').length;
  const faltas = at.filter(a => ((a.dados || {}).status) === 'falta').length;

  // Grupos da pessoa
  const allPsi = visible(await store.psi.all());
  const grupos = allPsi
    .filter(x => x.kind === 'grupo' && ((x.dados || {}).integrantes || []).some(m => String((m && m.id) || m) === personId))
    .map(g => {
      const dd = g.dados || {};
      const me = (dd.integrantes || []).find(m => String((m && m.id) || m) === personId) || {};
      const encs = allPsi.filter(e => e.kind === 'encontro' && String(e.grupoId) === String(g.id));
      const pres = encs.filter(e => ((e.dados || {}).presentes || []).some(p => String((p && p.id) || p) === personId)).length;
      return { id: g.id, nome: dd.nome, tipo: dd.tipo, dia: dd.dia, status: me.status || 'ativo', encontros: encs.length, presencas: pres };
    });

  // PSC
  const vincs = visibleMine.filter(x => x.kind === 'psc_vinculo').map(v => {
    const horas = visibleMine.filter(x => x.kind === 'psc_hora' && String((x.dados || {}).vinculoId) === String(v.id))
      .sort((a, b) => String(a.data).localeCompare(String(b.data)));
    const s = pscSaldo(v, horas);
    return { id: v.id, dados: v.dados, data: v.data, total: s.total, feitas: s.feitas, saldo: s.saldo, horas: horas.map(h => ({ id: h.id, data: h.data, dados: h.dados })) };
  });
  const locais = visibleMine.filter(x => x.kind === 'psc_local').map(l => ({ id: l.id, dados: l.dados }));

  // Documentos (termos)
  let documentos = [];
  try {
    const termos = await store.termos.all();
    const nm = String(person.nome || '').trim().toLowerCase();
    documentos = (termos || []).filter(t => t && t.dados && String(t.dados.nome || '').trim().toLowerCase() === nm)
      .map(t => ({ id: t.id, tipo: t.tipo, dataEnvio: t.dataEnvio, destinatario: t.destinatario })).slice(0, 100);
  } catch (e) {}

  // Timeline paginada
  const timeline = buildTimeline(visibleMine, { limit: Number(limit), cursor, kinds: kinds ? String(kinds).split(',') : undefined });

  // Pendências
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const in30 = new Date(now.getTime() + 30 * 864e5).toISOString().slice(0, 10);
  const d15 = new Date(now.getTime() - 15 * 864e5).toISOString().slice(0, 10);

  const pendencias = {
    faltasConsecutivas: faltasConsecutivas(at),
    medidasVencendo: visibleMine.filter(x => { if (x.kind !== 'medida') return false; const dd = x.dados || {}; return (dd.status || 'ativa') === 'ativa' && dd.fim && dd.fim <= in30; }).map(m => ({ id: m.id, tipo: (m.dados || {}).tipo, fim: (m.dados || {}).fim })),
    encPendentes: visibleMine.filter(x => x.kind === 'encaminhamento' && ((x.dados || {}).status || 'pendente') === 'pendente').map(e => ({ id: e.id, destino: (e.dados || {}).destino, data: e.data })),
    proximoEnvio: (prontuario && prontuario.dados && prontuario.dados.proximoEnvio) || null,
    pscSemHoras: vincs.filter(v => ((v.dados || {}).status || 'ativo') === 'ativo' && ((!v.horas.length && true) || (v.horas.length && v.horas[v.horas.length - 1].data <= d15))).map(v => ({ id: v.id, local: (v.dados || {}).localNome }))
  };

  // Score de risco
  const riskScore = buildRiskScore(personId, visibleMine, now);

  // Alertas estruturados
  const alertas = {
    criticos: [],
    atencao: [],
    info: []
  };
  if (riskScore.fatores.some(f => f.tipo === 'falta_critica' || f.tipo === 'medida_vencida')) alertas.criticos.push(...riskScore.fatores.filter(f => f.tipo === 'falta_critica' || f.tipo === 'medida_vencida'));
  if (riskScore.fatores.some(f => f.tipo === 'medida_vencendo' || f.tipo === 'enc_sem_retorno' || f.tipo === 'taxa_falta_alta')) alertas.atencao.push(...riskScore.fatores.filter(f => f.tipo === 'medida_vencendo' || f.tipo === 'enc_sem_retorno' || f.tipo === 'taxa_falta_alta'));
  if (riskScore.fatores.some(f => f.tipo === 'psc_sem_horas' || f.tipo === 'pront_incompleto' || f.tipo === 'enc_pendente')) alertas.info.push(...riskScore.fatores.filter(f => f.tipo === 'psc_sem_horas' || f.tipo === 'pront_incompleto' || f.tipo === 'enc_pendente'));

  await logBreakglass(req, 'ficha ' + person.nome, null);

  // ETag para cache
  const lastUpdate = visibleMine.reduce((max, r) => Math.max(max, new Date(r.updatedAt || r.createdAt).getTime()), 0);
  const etag = `"psi-ficha-${personId}-${lastUpdate}"`;
  res.setHeader('ETag', etag);
  if (req.headers['if-none-match'] === etag) return res.status(304).end();

  res.json({
    meta: { versao: '2.0', geradoEm: new Date().toISOString(), usuario: req.auth.name, etag },
    person: { id: person.id, nome: person.nome, cpf: person.cpf, cpfn: person.cpfn, rg: person.rg, nomeMae: person.nomeMae, dataNascimento: person.dataNascimento, modeloTornozeleira: person.modeloTornozeleira },
    prontuario,
    tags,
    evolucoes: visibleMine.filter(x => x.kind === 'evolucao').sort((a,b) => String(a.data).localeCompare(String(b.data))),
    atendimentos: { resumo: { total: at.length, presentes, faltas, taxaFalta: at.length ? ((faltas/at.length)*100).toFixed(1) : 0 }, ultimos: at.slice(0, 20), serieMensal: buildSerieMensal(at) },
    grupos,
    psc: { vinculos: vincs, locais, totalHoras: vincs.reduce((s,v) => s + (v.feitas || 0), 0), saldoTotal: vincs.reduce((s,v) => s + (v.saldo || 0), 0) },
    encaminhamentos: { pendentes: visibleMine.filter(x => x.kind === 'encaminhamento' && ((x.dados || {}).status || 'pendente') === 'pendente'), efetivados: visibleMine.filter(x => x.kind === 'encaminhamento' && ((x.dados || {}).status || 'pendente') === 'efetivado'), semRetorno: visibleMine.filter(x => x.kind === 'encaminhamento' && ((x.dados || {}).status || 'pendente') === 'pendente' && (x.data || '') <= new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10)) },
    medidas: { ativas: visibleMine.filter(x => x.kind === 'medida' && ((x.dados || {}).status || 'ativa') === 'ativa'), vencidas: visibleMine.filter(x => x.kind === 'medida' && ((x.dados || {}).status || 'ativa') === 'ativa' && (x.dados || {}).fim && (x.dados || {}).fim < today), vencendo: visibleMine.filter(x => x.kind === 'medida' && ((x.dados || {}).status || 'ativa') === 'ativa' && (x.dados || {}).fim && (x.dados || {}).fim <= in30) },
    documentos,
    timeline,
    pendencias,
    alertas,
    riskScore,
    stats: { totalAt: at.length, presentes, faltas, evolucoes: visibleMine.filter(x => x.kind === 'evolucao').length, grupos: grupos.length, vinculosPSC: vincs.length }
  });
}));

// Helper para série mensal de atendimentos
function buildSerieMensal(atendimentos) {
  const now = new Date();
  const serie = [];
  for (let i = 5; i >= 0; i--) {
    const m = new Date(now.getFullYear(), now.getMonth() - i, 1).toISOString().slice(0, 7);
    const atM = atendimentos.filter(a => (a.data || '').slice(0, 7) === m);
    serie.push({
      mes: m,
      atendimentos: atM.length,
      presentes: atM.filter(a => ((a.dados || {}).status || 'presente') === 'presente').length,
      faltas: atM.filter(a => ((a.dados || {}).status || '') === 'falta').length,
      faltasJustificadas: atM.filter(a => ((a.dados || {}).status || '') === 'falta_justificada').length
    });
  }
  return serie;
}

// ---- Ficha 360 Resumo (KPIs leves, sem timeline) ----
router.get('/api/psi/ficha/:personId(\\d+)/resumo', gatePSI(false), ah(async (req, res) => {
  const person = await store.persons.byId(req.params.personId);
  if (!person) return res.status(404).json({ error: 'Pessoa não encontrada' });
  const personId = String(person.id);
  const mine = await store.psi.byPerson(personId, { limit: 2000 });
  const visibleMine = mine.filter(r => !r.dados?._arquivado);
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const in30 = new Date(now.getTime() + 30 * 864e5).toISOString().slice(0, 10);

  const at = visibleMine.filter(x => x.kind === 'atendimento');
  const ev = visibleMine.filter(x => x.kind === 'evolucao');
  const enc = visibleMine.filter(x => x.kind === 'encaminhamento');
  const med = visibleMine.filter(x => x.kind === 'medida');
  const vincs = visibleMine.filter(x => x.kind === 'psc_vinculo' && ((x.dados || {}).status || 'ativo') === 'ativo');
  const pront = visibleMine.find(x => x.kind === 'prontuario') || null;
  const fc = faltasConsecutivas(at);

  const riskScore = buildRiskScore(personId, visibleMine, now);

  res.json({
    meta: { versao: '2.0', geradoEm: new Date().toISOString() },
    person: { id: person.id, nome: person.nome, cpf: person.cpf, dataNascimento: person.dataNascimento },
    prontuario: pront ? { status: pront.dados?.status, periodicidade: pront.dados?.periodicidade, processo: pront.dados?.processo, vara: pront.dados?.vara, medidaTipo: pront.dados?.medidaTipo, proximoEnvio: pront.dados?.proximoEnvio } : null,
    kpis: {
      acompanhamento: { status: pront?.dados?.status || 'sem_prontuario', totalAtendimentos: at.length, faltasConsecutivas: fc, taxaFaltaMes: at.length ? ((at.filter(a => ((a.dados || {}).status || '') === 'falta').length / at.length) * 100).toFixed(1) : 0 },
      evolucoes: ev.length,
      grupos: visibleMine.filter(x => x.kind === 'grupo' && ((x.dados || {}).integrantes || []).some(m => String((m && m.id) || m) === personId)).length,
      psc: { vinculosAtivos: vincs.length, totalHoras: vincs.reduce((s,v) => s + (v.dados?.cargaTotal || 0), 0), horasCumpridas: vincs.reduce((s,v) => s + (visibleMine.filter(x => x.kind === 'psc_hora' && String((x.dados || {}).vinculoId) === String(v.id)).reduce((s,h) => s + (h.dados?.horas || 0), 0)), 0) },
      encaminhamentos: { pendentes: enc.filter(e => ((e.dados || {}).status || 'pendente') === 'pendente').length, efetivados: enc.filter(e => ((e.dados || {}).status || 'pendente') === 'efetivado').length, semRetorno30d: enc.filter(e => ((e.dados || {}).status || 'pendente') === 'pendente' && (e.data || '') <= new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10)).length },
      medidas: { ativas: med.filter(m => ((m.dados || {}).status || 'ativa') === 'ativa').length, vencidas: med.filter(m => ((m.dados || {}).status || 'ativa') === 'ativa' && (m.dados || {}).fim && (m.dados || {}).fim < today).length, vencendo30d: med.filter(m => ((m.dados || {}).status || 'ativa') === 'ativa' && (m.dados || {}).fim && (m.dados || {}).fim <= in30).length },
      documentos: 0 // termos serão contados se necessário
    },
    riskScore,
    alertas: {
      criticos: riskScore.fatores.filter(f => f.tipo === 'falta_critica' || f.tipo === 'medida_vencida').map(f => f.desc),
      atencao: riskScore.fatores.filter(f => f.tipo === 'medida_vencendo' || f.tipo === 'enc_sem_retorno' || f.tipo === 'taxa_falta_alta').map(f => f.desc),
      info: riskScore.fatores.filter(f => f.tipo === 'psc_sem_horas' || f.tipo === 'pront_incompleto' || f.tipo === 'enc_pendente').map(f => f.desc)
    }
  });
}));

// ---- Ficha 360 Export PDF (completa, para anexar ao processo) ----
router.get('/api/psi/ficha/:personId(\\d+)/export-pdf', gatePSI(false), ah(async (req, res) => {
  const person = await store.persons.byId(req.params.personId);
  if (!person) return res.status(404).json({ error: 'Pessoa não encontrada' });
  const personId = String(person.id);
  const mine = await store.psi.byPerson(personId, { limit: 5000 });
  const visibleMine = mine.filter(r => !r.dados?._arquivado);

  const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
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
  const section = (title, items) => {
    if (!items || !items.length) return;
    h2(title);
    items.forEach(i => line('  - ' + i, 9, font, rgb(0.2, 0.2, 0.2), 12));
    y -= 4;
  };

  const at = visibleMine.filter(x => x.kind === 'atendimento');
  const ev = visibleMine.filter(x => x.kind === 'evolucao');
  const enc = visibleMine.filter(x => x.kind === 'encaminhamento');
  const med = visibleMine.filter(x => x.kind === 'medida');
  const vincs = visibleMine.filter(x => x.kind === 'psc_vinculo');
  const pront = visibleMine.find(x => x.kind === 'prontuario') || null;
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const riskScore = buildRiskScore(personId, visibleMine, now);

  // Watermark confidencial
  page.drawText('CONFIDENCIAL — DADOS SENSÍVEIS DE SAÚDE — LGPD Art. 11', { x: M, y: H - 20, size: 8, font, color: rgb(0.8, 0.2, 0.2), opacity: 0.5 });

  h1('FICHA 360 — ACOMPANHAMENTO PSICOSSOCIAL');
  line('SISUMEPE Juazeiro • ' + new Date().toLocaleString('pt-BR') + ' • Gerado por ' + (req.auth.name || req.auth.user), 9, font, rgb(0.4, 0.4, 0.4), 20);
  y -= 6;

  h2('1. IDENTIFICAÇÃO');
  kv('Nome', person.nome); kv('CPF', person.cpf); kv('RG', person.rg);
  kv('Nascimento', person.dataNascimento); kv('Nome da Mãe', person.nomeMae);
  if (pront) {
    const pd = pront.dados || {};
    kv('Processo', pd.processo); kv('Vara', pd.vara);
    kv('Medida', pd.medidaTipo || pd.tipoMedida); kv('Período', [pd.medidaInicio, pd.medidaFim].filter(Boolean).join(' a '));
    kv('Periodicidade', pd.periodicidade); kv('Status', pd.status);
  }

  h2('2. SCORE DE RISCO');
  const riskColor = riskScore.nivel === 'critico' ? rgb(0.8, 0.1, 0.1) : riskScore.nivel === 'alto' ? rgb(0.9, 0.5, 0.1) : riskScore.nivel === 'medio' ? rgb(0.9, 0.7, 0.1) : rgb(0.1, 0.6, 0.2);
  line('NÍVEL: ' + riskScore.nivel.toUpperCase() + ' (' + riskScore.valor + '/100)', 12, bold, riskColor, 18);
  riskScore.fatores.forEach(f => line('  • [' + f.peso + 'pts] ' + f.desc, 9, font, rgb(0.25, 0.25, 0.25), 12));

  h2('3. ATENDIMENTOS (Últimos 6 meses)');
  const serie = buildSerieMensal(at);
  serie.forEach(s => line(`  ${s.mes.slice(5)}: ${s.atendimentos} total (${s.presentes} P, ${s.faltas} F, ${s.faltasJustificadas} FJ)`, 9, font, rgb(0.2, 0.2, 0.2), 12));

  h2('4. EVOLUÇÕES SOAP (' + ev.length + ')');
  ev.sort((a,b) => String(a.data).localeCompare(String(b.data))).slice(-10).forEach(e => {
    const ed = e.dados || {};
    line((e.data || '') + ' — ' + (ed.tipo || 'individual'), 10, bold, rgb(0.2, 0.2, 0.2), 13);
    ['s', 'o', 'a', 'p'].forEach(k => { if (ed[k]) line(k.toUpperCase() + ': ' + ed[k], 9, font, rgb(0.25, 0.25, 0.25), 12); });
    y -= 3;
  });
  if (!ev.length) line('  Sem evoluções registradas.', 9, font, rgb(0.4, 0.4, 0.4), 12);

  h2('5. ENCAMINHAMENTOS');
  section('Pendentes', enc.filter(e => ((e.dados || {}).status || 'pendente') === 'pendente').map(e => (e.data || '') + ' → ' + ((e.dados || {}).destino || '?') + ' (' + ((e.dados || {}).status || 'pendente') + ')'));
  section('Efetivados', enc.filter(e => ((e.dados || {}).status || 'pendente') === 'efetivado').map(e => (e.data || '') + ' → ' + ((e.dados || {}).destino || '?') + (e.dados?.contraref ? ' | CR: ' + e.dados.contraref : '')));
  section('Sem retorno 30+ dias', enc.filter(e => ((e.dados || {}).status || 'pendente') === 'pendente' && (e.data || '') <= new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10)).map(e => (e.data || '') + ' → ' + ((e.dados || {}).destino || '?')));

  h2('6. MEDIDAS');
  section('Ativas', med.filter(m => ((m.dados || {}).status || 'ativa') === 'ativa').map(m => (m.dados?.tipo || '') + ' — fim ' + (m.dados?.fim || '?') + ' (' + (m.dados?.status || 'ativa') + ')'));
  section('Vencendo 30d', med.filter(m => ((m.dados || {}).status || 'ativa') === 'ativa' && (m.dados || {}).fim && (m.dados || {}).fim <= in30).map(m => (m.dados?.tipo || '') + ' — vence ' + m.dados.fim));
  section('Vencidas', med.filter(m => ((m.dados || {}).status || 'ativa') === 'ativa' && (m.dados || {}).fim && (m.dados || {}).fim < today).map(m => (m.dados?.tipo || '') + ' — venceu ' + m.dados.fim));

  h2('7. PSC (PRESTAÇÃO DE SERVIÇOS À COMUNIDADE)');
  vincs.forEach(v => {
    const horas = visibleMine.filter(x => x.kind === 'psc_hora' && String((x.dados || {}).vinculoId) === String(v.id));
    const s = pscSaldo(v, horas);
    line('  ' + (v.dados?.localNome || 'Local?') + ' — ' + s.feitas + '/' + s.total + 'h (saldo: ' + s.saldo + 'h)', 10, font, rgb(0.15, 0.15, 0.15), 13);
    horas.sort((a,b) => String(a.data).localeCompare(String(b.data))).forEach(h => line('    ' + (h.data || '') + ': ' + (h.dados?.horas || 0) + 'h — ' + (h.dados?.obs || ''), 9, font, rgb(0.3, 0.3, 0.3), 11));
  });
  if (!vincs.length) line('  Nenhum vínculo PSC.', 9, font, rgb(0.4, 0.4, 0.4), 12);

  h2('8. GRUPOS REFLEXIVOS');
  const grupos = visibleMine.filter(x => x.kind === 'grupo' && ((x.dados || {}).integrantes || []).some(m => String((m && m.id) || m) === personId));
  grupos.forEach(g => {
    const dd = g.dados || {};
    line('  ' + (dd.nome || '') + ' (' + (dd.tipo || '') + ', ' + (dd.dia || '') + ') — ' + (dd.ativo !== false ? 'Ativo' : 'Inativo'), 10, font, rgb(0.15, 0.15, 0.15), 13);
  });
  if (!grupos.length) line('  Nenhum grupo.', 9, font, rgb(0.4, 0.4, 0.4), 12);

  h2('9. DOCUMENTOS (TERMOS)');
  let documentos = [];
  try {
    const termos = await store.termos.all();
    const nm = String(person.nome || '').trim().toLowerCase();
    documentos = (termos || []).filter(t => t && t.dados && String(t.dados.nome || '').trim().toLowerCase() === nm);
  } catch (e) {}
  section('Termos', documentos.map(t => (t.tipo || '') + ' — ' + (t.dataEnvio || '') + ' → ' + (t.destinatario || '')));
  if (!documentos.length) line('  Nenhum termo localizado.', 9, font, rgb(0.4, 0.4, 0.4), 12);

  await logBreakglass(req, 'export-pdf ficha ' + person.nome, null);
  const bytes = await pdf.save();
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="ficha-360-' + person.id + '-' + today + '.pdf"');
  res.send(Buffer.from(bytes));
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
  const med = mine.filter(x => x.kind === 'medida');
  const vincs = mine.filter(x => x.kind === 'psc_vinculo');
  const grupos = all.filter(x => x.kind === 'grupo' && ((x.dados || {}).integrantes || []).some(m => String((m && m.id) || m) === String(person.id)));
  const pd = (pront && pront.dados) || {};
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 595.28, H = 841.89, M = 42;
  let page = pdf.addPage([W, H]);
  let y = H - M;

  // Cores institucionais
  const COR_PRIMARIA = rgb(0.05, 0.35, 0.3);
  const COR_SECUNDARIA = rgb(0.1, 0.4, 0.55);
  const COR_TEXTO = rgb(0.15, 0.15, 0.15);
  const COR_SUAVE = rgb(0.4, 0.4, 0.4);
  const COR_LINHA = rgb(0.85, 0.85, 0.85);
  const COR_DESTAQUE = rgb(0.8, 0.2, 0.1);
  const COR_VERDE = rgb(0.1, 0.6, 0.2);
  const COR_AMARELO = rgb(0.9, 0.7, 0.1);

  const line = (text, size, f, color, gap) => {
    const words = String(text || '').split(/\s+/).filter(Boolean);
    const maxW = W - 2 * M;
    const meas = f || font;
    let cur = '';
    const flush = t => {
      if (y < M + 20) { page = pdf.addPage([W, H]); y = H - M; drawHeader(); }
      page.drawText(t.slice(0, 130), { x: M, y, size: size || 10, font: meas, color: color || COR_TEXTO });
      y -= (gap || 14);
    };
    for (const w of words) {
      const t = cur ? cur + ' ' + w : w;
      if (meas.widthOfTextAtSize(t, size || 10) > maxW && cur) { flush(cur); cur = w; }
      else cur = t;
    }
    if (cur) flush(cur); else y -= 2;
  };

  const drawHeader = () => {
    // Linha superior decorativa
    page.drawRectangle({ x: M, y: H - 30, width: W - 2 * M, height: 4, color: COR_PRIMARIA });
    // Marca d'água confidencial
    page.drawText('CONFIDENCIAL — DADOS SENSÍVEIS DE SAÚDE — LGPD Art. 11', { x: M, y: H - 18, size: 7, font, color: rgb(0.8, 0.2, 0.2), opacity: 0.4 });
  };
  drawHeader();

  const h1 = t => {
    line(t, 18, bold, COR_PRIMARIA, 24);
    // Linha separadora
    page.drawLine({ start: { x: M, y: y + 8 }, end: { x: W - M, y: y + 8 }, thickness: 1.5, color: COR_PRIMARIA });
    y -= 6;
  };
  const h2 = t => {
    y -= 6;
    line(t, 13, bold, COR_SECUNDARIA, 19);
    page.drawLine({ start: { x: M, y: y + 5 }, end: { x: W - M, y: y + 5 }, thickness: 0.8, color: COR_LINHA });
    y -= 4;
  };
  const h3 = t => { line(t, 11, bold, COR_TEXTO, 15); };
  const kv = (k, v) => line('  ' + k + ': ' + (v || '—'), 10, font, COR_TEXTO, 13);
  const bullet = (text, indent = 15) => line('  • ' + text, 9, font, COR_TEXTO, 12);
  const soapField = (label, value) => line('    ' + label + ': ' + value, 9, font, rgb(0.25, 0.25, 0.25), 11);
  const tableRow = (cells, widths, isHeader = false) => {
    if (y < M + 30) { page = pdf.addPage([W, H]); y = H - M; drawHeader(); }
    let x = M;
    const rowH = 18;
    cells.forEach((cell, i) => {
      const w = widths[i];
      const bgColor = isHeader ? COR_PRIMARIA : (y % 36 < 18 ? rgb(0.97, 0.97, 0.97) : rgb(1, 1, 1));
      page.drawRectangle({ x, y: y - rowH, width: w, height: rowH, color: bgColor });
      page.drawRectangle({ x, y: y - rowH, width: w, height: rowH, borderColor: COR_LINHA, borderWidth: 0.5 });
      const txt = String(cell || '').slice(0, Math.max(5, Math.floor(w / 5.5)));
      page.drawText(txt, { x: x + 3, y: y - rowH + 4, size: isHeader ? 9 : 8, font: isHeader ? bold : font, color: isHeader ? rgb(1, 1, 1) : COR_TEXTO });
      x += w;
    });
    y -= rowH;
  };

  // ===== CAPA =====
  h1('RELATÓRIO PSICOSSOCIAL PARA FINS JUDICIAIS');
  line('SISUMEPE Juazeiro — Sistema de Monitoramento de Pessoas com Uso de Pulseiras Eletrônicas', 10, font, COR_SECUNDARIA, 20);
  line('Gerado em ' + now.toLocaleString('pt-BR') + ' por ' + (req.auth.name || req.auth.user) + ' (' + req.auth.role + ')', 9, font, COR_SUAVE, 18);
  y -= 10;

  // ===== 1. IDENTIFICAÇÃO =====
  h2('1. IDENTIFICAÇÃO DO MONITORADO');
  const idWidths = [140, W - 2 * M - 140];
  tableRow(['CAMPO', 'INFORMAÇÃO'], idWidths, true);
  tableRow(['Nome completo', person.nome], idWidths);
  tableRow(['CPF', person.cpf || '—'], idWidths);
  tableRow(['RG', person.rg || '—'], idWidths);
  tableRow(['Data de nascimento', person.dataNascimento || '—'], idWidths);
  tableRow(['Nome da mãe', person.nomeMae || '—'], idWidths);
  if (pd.processo) tableRow(['Processo', pd.processo], idWidths);
  if (pd.vara) tableRow(['Vara', pd.vara], idWidths);
  if (pd.medidaTipo || pd.tipoMedida) tableRow(['Medida', pd.medidaTipo || pd.tipoMedida], idWidths);
  if (pd.medidaInicio || pd.medidaFim) tableRow(['Período da medida', [pd.medidaInicio, pd.medidaFim].filter(Boolean).join(' a ')], idWidths);
  y -= 8;

  // ===== 2. ACOMPANHAMENTO =====
  h2('2. DADOS DO ACOMPANHAMENTO');
  const acompWidths = [140, W - 2 * M - 140];
  tableRow(['CAMPO', 'INFORMAÇÃO'], acompWidths, true);
  tableRow(['Status do acompanhamento', pd.status || 'Não informado'], acompWidths);
  tableRow(['Periodicidade', pd.periodicidade || 'Não definida'], acompWidths);
  tableRow(['Queixa inicial / Motivo', pd.queixa || 'Não registrada'], acompWidths);
  tableRow(['Metas terapêuticas', pd.metas || 'Não definidas'], acompWidths);
  const atPresentes = at.filter(a => ((a.dados || {}).status || 'presente') === 'presente').length;
  const atFaltas = at.filter(a => ((a.dados || {}).status) === 'falta').length;
  tableRow(['Total de atendimentos', at.length + ' (' + atPresentes + ' presentes, ' + atFaltas + ' faltas)'], acompWidths);
  tableRow(['Faltas consecutivas (atuais)', faltasConsecutivas(at) + (faltasConsecutivas(at) >= 2 ? ' ⚠️ GERAR OFÍCIO' : '')], acompWidths);
  y -= 8;

  // Série mensal em mini-tabela
  h3('Evolução mensal de comparecimento (últimos 6 meses)');
  const serie = buildSerieMensal(at);
  const serieWidths = [80, 70, 70, 70, 70, W - 2 * M - 290];
  tableRow(['Mês', 'Total', 'Presentes', 'Faltas', 'F. Just.', '% Presença'], serieWidths, true);
  serie.forEach(s => {
    const pct = s.atendimentos ? Math.round((s.presentes / s.atendimentos) * 100) : 0;
    tableRow([s.mes.slice(5), s.atendimentos, s.presentes, s.faltas, s.faltasJustificadas, pct + '%'], serieWidths);
  });
  y -= 8;

  // ===== 3. EVOLUÇÕES SOAP =====
  h2('3. EVOLUÇÕES CLÍNICAS — FORMATO SOAP (' + evol.length + ')');
  if (!evol.length) {
    bullet('Sem evoluções registradas no período.');
  } else {
    evol.slice(-15).forEach(e => {
      if (y < M + 80) { page = pdf.addPage([W, H]); y = H - M; drawHeader(); }
      const ed = e.dados || {};
      // Cabeçalho da evolução
      page.drawRectangle({ x: M, y: y - 18, width: W - 2 * M, height: 18, color: rgb(0.95, 0.97, 0.97), borderColor: COR_LINHA, borderWidth: 0.5 });
      page.drawText((e.data || '') + ' — ' + (ed.tipo || 'individual'), { x: M + 5, y: y - 15, size: 10, font: bold, color: COR_SECUNDARIA });
      y -= 20;
      ['s', 'o', 'a', 'p'].forEach(k => {
        if (ed[k]) {
          line('  ' + k.toUpperCase() + ':', 9, bold, COR_TEXTO, 11);
          line('    ' + ed[k], 9, font, rgb(0.25, 0.25, 0.25), 11);
        }
      });
      y -= 4;
    });
  }
  y -= 6;

  // ===== 4. ENCAMINHAMENTOS =====
  h2('4. ENCAMINHAMENTOS E CONTRA-REFERÊNCIA');
  const encWidths = [60, 180, 70, 90, W - 2 * M - 400];
  tableRow(['Data', 'Destino', 'Status', 'Contra-ref.', 'Observação'], encWidths, true);
  enc.slice(0, 30).forEach(e => {
    const ed = e.dados || {};
    const statusColor = ed.status === 'efetivado' ? COR_VERDE : ed.status === 'nao_efetivado' ? COR_DESTAQUE : COR_AMARELO;
    const rowY = y;
    tableRow([e.data || '', ed.destino || '?', ed.status || 'pendente', ed.contraref || '—', ed.obs || ''], encWidths);
    // Colorir status
    const statusX = M + 60 + 180 + 70;
    page.drawRectangle({ x: statusX, y: rowY - 18, width: 90, height: 18, color: statusColor, opacity: 0.15 });
  });
  if (!enc.length) bullet('Nenhum encaminhamento registrado.');
  y -= 6;

  // ===== 5. MEDIDAS =====
  h2('5. MEDIDAS JUDICIAIS');
  const medWidths = [60, 120, 70, 80, W - 2 * M - 330];
  tableRow(['Início', 'Tipo', 'Status', 'Término', 'Observação'], medWidths, true);
  med.forEach(m => {
    const md = m.dados || {};
    const statusColor = md.status === 'vencida' ? COR_DESTAQUE : md.fim && md.fim < today ? COR_DESTAQUE : md.fim && md.fim <= new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10) ? COR_AMARELO : COR_VERDE;
    const rowY = y;
    tableRow([md.inicio || m.data || '', md.tipo || '', md.status || 'ativa', md.fim || '—', md.obs || ''], medWidths);
    const statusX = M + 60 + 120;
    page.drawRectangle({ x: statusX, y: rowY - 18, width: 70, height: 18, color: statusColor, opacity: 0.15 });
  });
  if (!med.length) bullet('Nenhuma medida registrada.');
  y -= 6;

  // ===== 6. PSC =====
  h2('6. PRESTAÇÃO DE SERVIÇOS À COMUNIDADE (PSC)');
  if (!vincs.length) {
    bullet('Nenhum vínculo PSC registrado.');
  } else {
    const pscWidths = [60, 150, 60, 60, 70, W - 2 * M - 400];
    tableRow(['Início', 'Local', 'Carga (h)', 'Cumpridas (h)', 'Saldo (h)', 'Status'], pscWidths, true);
    vincs.forEach(v => {
      const horas = mine.filter(x => x.kind === 'psc_hora' && String((x.dados || {}).vinculoId) === String(v.id));
      const s = pscSaldo(v, horas);
      const statusColor = s.saldo <= 0 && s.total > 0 ? COR_VERDE : s.saldo > s.total * 0.5 ? COR_AMARELO : COR_DESTAQUE;
      const rowY = y;
      tableRow([v.dados?.inicio || '', v.dados?.localNome || '—', s.total, s.feitas, s.saldo, v.dados?.status || 'ativo'], pscWidths);
      const statusX = M + 60 + 150 + 60 + 60 + 70;
      page.drawRectangle({ x: statusX, y: rowY - 18, width: W - 2 * M - 400, height: 18, color: statusColor, opacity: 0.15 });
      horas.sort((a,b) => String(a.data).localeCompare(String(b.data))).forEach(h => {
        if (y < M + 30) { page = pdf.addPage([W, H]); y = H - M; drawHeader(); }
        line('    ' + (h.data || '') + ': ' + (h.dados?.horas || 0) + 'h — ' + (h.dados?.obs || ''), 8, font, rgb(0.3, 0.3, 0.3), 10);
      });
    });
  }
  y -= 6;

  // ===== 7. GRUPOS REFLEXIVOS =====
  h2('7. GRUPOS REFLEXIVOS');
  if (!grupos.length) {
    bullet('Nenhum grupo reflexivo vinculado.');
  } else {
    grupos.forEach(g => {
      const dd = g.dados || {};
      const encs = all.filter(e => e.kind === 'encontro' && String(e.grupoId) === String(g.id));
      const pres = encs.filter(e => ((e.dados || {}).presentes || []).some(p => String((p && p.id) || p) === String(person.id))).length;
      bullet(dd.nome + ' (' + (dd.tipo || '') + ', ' + (dd.dia || '') + ') — ' + (dd.ativo !== false ? 'Ativo' : 'Inativo') + ' — ' + pres + '/' + encs.length + ' presenças');
      encs.slice(-5).forEach(e => {
        line('    ' + (e.data || '') + ' — ' + (e.dados?.tema || 'Sem tema') + ' (' + (e.dados?.presentes?.length || 0) + ' presentes)', 8, font, rgb(0.3, 0.3, 0.3), 10);
      });
    });
  }
  y -= 6;

  // ===== 8. PARECER TÉCNICO =====
  h2('8. PARECER TÉCNICO CONCLUSIVO');
  const lastP = evol.length ? ((evol[evol.length - 1].dados || {}).p || '') : '';
  const parecer = lastP || pd.obs || 'Em acompanhamento. Continuidade do tratamento recomendada.';
  const words = parecer.split(/\s+/);
  let cur = '';
  words.forEach(w => {
    const t = cur ? cur + ' ' + w : w;
    if (font.widthOfTextAtSize(t, 10) > W - 2 * M && cur) { line(cur, 10, font, COR_TEXTO, 14); cur = w; } else cur = t;
  });
  if (cur) line(cur, 10, font, COR_TEXTO, 14);

  // Rodapé com assinatura
  y = Math.max(y, M + 80);
  if (y < M + 80) { page = pdf.addPage([W, H]); y = H - M; drawHeader(); }
  y -= 30;
  page.drawLine({ start: { x: M + 200, y }, end: { x: W - M - 200, y }, thickness: 1, color: COR_LINHA });
  y -= 12;
  line(req.auth.name + ' — Psicólogo(a) — CRP: [informar]', 10, bold, COR_TEXTO, 13);
  line('SISUMEPE Juazeiro — ' + now.toLocaleDateString('pt-BR'), 9, font, COR_SUAVE, 12);

  await logBreakglass(req, 'relatório judicial ' + person.nome, null);
  const bytes = await pdf.save();
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="relatorio-judicial-' + person.id + '-' + today + '.pdf"');
  res.send(Buffer.from(bytes));
}));

// ---- Certificado de PSC (item 4) - Visual profissional ----
router.get('/api/psi/psc/certificado/:id(\\d+)', gatePSI(false), ah(async (req, res) => {
  const v = await store.psi.byId(req.params.id);
  if (!v || v.kind !== 'psc_vinculo') return res.status(404).json({ error: 'Vínculo de PSC não encontrado' });
  const all = visible(await store.psi.all());
  const horas = pscHorasDoVinculo(all, v.id).sort((a, b) => String(a.data || '').localeCompare(String(b.data || '')));
  const s = pscSaldo(v, horas);
  const dd = v.dados || {};
  const person = await store.persons.byId(v.personId);
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const concluido = s.saldo <= 0 && s.total > 0;

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 595.28, H = 841.89, M = 60;
  const page = pdf.addPage([W, H]);

  // Cores
  const COR_AZUL = rgb(0.05, 0.25, 0.45);
  const COR_DOURADO = rgb(0.75, 0.6, 0.15);
  const COR_TEXTO = rgb(0.1, 0.1, 0.1);
  const COR_SUAVE = rgb(0.4, 0.4, 0.4);

  const cx = t => { const w = bold.widthOfTextAtSize(t, 13); return (W - w) / 2; };
  let y = H - 80;

  // Borda decorativa
  page.drawRectangle({ x: 30, y: 30, width: W - 60, height: H - 60, borderColor: COR_DOURADO, borderWidth: 2 });
  page.drawRectangle({ x: 40, y: 40, width: W - 80, height: H - 80, borderColor: COR_DOURADO, borderWidth: 0.5 });

  // Brasão / Logo (placeholder)
  page.drawText('SISUMEPE JUAZEIRO', { x: cx('SISUMEPE JUAZEIRO'), y, size: 11, font: bold, color: COR_AZUL });
  y -= 18;
  page.drawText('SECRETARIA DA ADMINISTRAÇÃO PENITENCIÁRIA', { x: cx('SECRETARIA DA ADMINISTRAÇÃO PENITENCIÁRIA'), y, size: 9, font, color: COR_SUAVE });
  y -= 30;

  // Título
  page.drawLine({ start: { x: 100, y }, end: { x: W - 100, y }, thickness: 1.5, color: COR_DOURADO });
  y -= 20;
  page.drawText('CERTIFICADO DE PRESTAÇÃO DE SERVIÇOS À COMUNIDADE', { x: cx('CERTIFICADO DE PRESTAÇÃO DE SERVIÇOS À COMUNIDADE'), y, size: 18, font: bold, color: COR_AZUL });
  y -= 10;
  page.drawLine({ start: { x: 100, y }, end: { x: W - 100, y }, thickness: 1.5, color: COR_DOURADO });
  y -= 30;

  // Texto introdutório
  const intro = 'Certificamos que o(a) monitorado(a) abaixo identificado(a) cumpriu as horas de Prestação de Serviços à Comunidade (PSC) conforme determinado judicialmente, nos termos da Lei de Execução Penal (Lei nº 7.210/84) e resoluções do CNJ.';
  const words = intro.split(/\s+/);
  let cur = '';
  words.forEach(w => {
    const t = cur ? cur + ' ' + w : w;
    if (font.widthOfTextAtSize(t, 11) > W - 2 * M && cur) { page.drawText(cur, { x: M, y, size: 11, font, color: COR_TEXTO }); y -= 16; cur = w; } else cur = t;
  });
  if (cur) { page.drawText(cur, { x: M, y, size: 11, font, color: COR_TEXTO }); y -= 16; }
  y -= 20;

  // Dados do monitorado em tabela
  const drawField = (label, value) => {
    page.drawText(label, { x: M + 20, y, size: 11, font: bold, color: COR_AZUL });
    page.drawText(String(value || '—'), { x: M + 220, y, size: 11, font, color: COR_TEXTO });
    y -= 22;
  };

  drawField('Monitorado(a):', person?.nome || v.personName || ('ID ' + v.personId));
  if (person?.cpf) drawField('CPF:', person.cpf);
  if (person?.rg) drawField('RG:', person.rg);
  drawField('Local de execução:', dd.localNome + (dd.localEndereco ? ' — ' + dd.localEndereco : '') || 'Não informado');
  drawField('Período determinado:', (dd.inicio || '?') + ' a ' + (dd.previsaoFim || '?'));
  drawField('Carga horária total:', s.total + ' horas');
  drawField('Horas cumpridas:', s.feitas + ' horas');
  drawField('Saldo restante:', s.saldo + ' horas');

  // Status destacado
  y -= 10;
  const statusText = concluido ? 'CONCLUÍDA COM ÊXITO ✓' : ((dd.status || 'ativo').toUpperCase());
  const statusColor = concluido ? COR_VERDE : rgb(0.8, 0.2, 0.1);
  page.drawRectangle({ x: M + 20, y: y - 30, width: W - 2 * M - 40, height: 38, color: statusColor, opacity: 0.12, borderColor: statusColor, borderWidth: 1.5 });
  page.drawText('SITUAÇÃO: ' + statusText, { x: M + 40, y: y - 10, size: 14, font: bold, color: statusColor });
  y -= 45;

  // Detalhamento de horas (mini tabela)
  if (horas.length) {
    page.drawText('DETALHAMENTO DAS HORAS CUMPRIDAS', { x: M + 20, y, size: 11, font: bold, color: COR_AZUL });
    y -= 18;
    const colW = [80, 180, 80, W - 2 * M - 360];
    const drawRow = (cells, isHeader) => {
      let x = M + 20;
      cells.forEach((cell, i) => {
        page.drawRectangle({ x, y: y - 20, width: colW[i], height: 22, color: isHeader ? COR_AZUL : (y % 44 < 22 ? rgb(0.97, 0.97, 0.97) : rgb(1, 1, 1)), borderColor: COR_SUAVE, borderWidth: 0.5 });
        page.drawText(String(cell).slice(0, Math.floor(colW[i] / 5)), { x: x + 5, y: y - 15, size: 9, font: isHeader ? bold : font, color: isHeader ? rgb(1, 1, 1) : COR_TEXTO });
        x += colW[i];
      });
      y -= 22;
    };
    drawRow(['Data', 'Descrição / Local', 'Horas', 'Observação'], true);
    horas.forEach(h => drawRow([h.data || '', h.dados?.localNome || (h.dados?.obs || '').slice(0, 30), h.dados?.horas || 0, (h.dados?.obs || '').slice(0, 40)], false));
    y -= 10;
  }

  // Rodapé com assinatura
  y = Math.max(y, 150);
  page.drawLine({ start: { x: M + 150, y: 130 }, end: { x: W - M - 150, y: 130 }, thickness: 1, color: COR_TEXTO });
  page.drawText('Juazeiro do Norte, ' + now.toLocaleDateString('pt-BR'), { x: M + 20, y: 115, size: 11, font, color: COR_TEXTO });
  page.drawText((req.auth.name || req.auth.user) + ' — Psicólogo(a)', { x: M + 20, y: 100, size: 11, font: bold, color: COR_TEXTO });
  page.drawText('CRP: [informar]  |  SISUMEPE Juazeiro', { x: M + 20, y: 85, size: 9, font, color: COR_SUAVE });

  // QR Code placeholder para validação (opcional)
  page.drawRectangle({ x: W - M - 80, y: 70, width: 60, height: 60, borderColor: COR_SUAVE, borderWidth: 1 });
  page.drawText('QR Code', { x: W - M - 70, y: 95, size: 8, font, color: COR_SUAVE });
  page.drawText('Validação', { x: W - M - 70, y: 85, size: 8, font, color: COR_SUAVE });

  await logBreakglass(req, 'certificado PSC ' + (v.personName || v.id), v);
  const bytes = await pdf.save();
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="certificado-psc-' + v.id + '-' + today + '.pdf"');
  res.send(Buffer.from(bytes));
}));

// ---- Relatório de frequência do grupo (item 5) - Visual profissional ----
router.get('/api/psi/grupo/:id(\\d+)/relatorio', gatePSI(false), ah(async (req, res) => {
  const g = await store.psi.byId(req.params.id);
  if (!g || g.kind !== 'grupo') return res.status(404).json({ error: 'Grupo não encontrado' });
  const all = visible(await store.psi.all());
  const dd = g.dados || {};
  const ints = dd.integrantes || [];
  const encs = all.filter(e => e.kind === 'encontro' && String(e.grupoId) === String(g.id))
    .sort((a, b) => String(a.data || '').localeCompare(String(b.data || '')));
  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 595.28, H = 841.89, M = 42;
  let page = pdf.addPage([W, H]);
  let y = H - M;

  const COR_PRIMARIA = rgb(0.05, 0.3, 0.25);
  const COR_SECUNDARIA = rgb(0.1, 0.4, 0.55);
  const COR_TEXTO = rgb(0.15, 0.15, 0.15);
  const COR_SUAVE = rgb(0.4, 0.4, 0.4);
  const COR_LINHA = rgb(0.85, 0.85, 0.85);
  const COR_VERDE = rgb(0.1, 0.6, 0.2);
  const COR_AMARELO = rgb(0.9, 0.7, 0.1);
  const COR_VERMELHO = rgb(0.8, 0.2, 0.1);

  const line = (text, size, f, color, gap) => {
    if (y < M + 20) { page = pdf.addPage([W, H]); y = H - M; drawHeader(); }
    page.drawText(String(text || '').slice(0, 130), { x: M, y, size: size || 10, font: f || font, color: color || COR_TEXTO });
    y -= (gap || 14);
  };
  const drawHeader = () => {
    page.drawRectangle({ x: M, y: H - 30, width: W - 2 * M, height: 4, color: COR_PRIMARIA });
    page.drawText('CONFIDENCIAL — DADOS SENSÍVEIS — LGPD Art. 11', { x: M, y: H - 18, size: 7, font, color: rgb(0.8, 0.2, 0.2), opacity: 0.4 });
  };
  drawHeader();

  const h1 = t => {
    line(t, 18, bold, COR_PRIMARIA, 24);
    page.drawLine({ start: { x: M, y: y + 8 }, end: { x: W - M, y: y + 8 }, thickness: 1.5, color: COR_PRIMARIA });
    y -= 6;
  };
  const h2 = t => {
    y -= 6;
    line(t, 13, bold, COR_SECUNDARIA, 19);
    page.drawLine({ start: { x: M, y: y + 5 }, end: { x: W - M, y: y + 5 }, thickness: 0.8, color: COR_LINHA });
    y -= 4;
  };
  const tableRow = (cells, widths, isHeader = false) => {
    if (y < M + 30) { page = pdf.addPage([W, H]); y = H - M; drawHeader(); }
    let x = M;
    const rowH = 20;
    cells.forEach((cell, i) => {
      const w = widths[i];
      const bgColor = isHeader ? COR_PRIMARIA : (y % 40 < 20 ? rgb(0.97, 0.97, 0.97) : rgb(1, 1, 1));
      page.drawRectangle({ x, y: y - rowH, width: w, height: rowH, color: bgColor, borderColor: COR_LINHA, borderWidth: 0.5 });
      const txt = String(cell || '').slice(0, Math.max(5, Math.floor(w / 5.5)));
      page.drawText(txt, { x: x + 3, y: y - rowH + 5, size: isHeader ? 9 : 8, font: isHeader ? bold : font, color: isHeader ? rgb(1, 1, 1) : COR_TEXTO });
      x += w;
    });
    y -= rowH;
  };

  h1('RELATÓRIO DE FREQUÊNCIA — GRUPO REFLEXIVO');
  line('SISUMEPE Juazeiro • ' + now.toLocaleString('pt-BR') + ' • Gerado por ' + (req.auth.name || req.auth.user), 9, font, COR_SUAVE, 20);
  y -= 6;

  h2('1. DADOS DO GRUPO');
  const gWidths = [140, W - 2 * M - 140];
  tableRow(['CAMPO', 'INFORMAÇÃO'], gWidths, true);
  tableRow(['Nome', dd.nome || ('Grupo #' + g.id)], gWidths);
  tableRow(['Tipo / Temática', dd.tipo || 'Não informado'], gWidths);
  tableRow(['Dia / Periodicidade', dd.dia || 'Não definido'], gWidths);
  tableRow(['Status', dd.ativo !== false ? 'Ativo' : 'Inativo'], gWidths);
  tableRow(['Total de encontros realizados', encs.length], gWidths);
  tableRow(['Responsável técnico', req.auth.name || req.auth.user], gWidths);
  y -= 10;

  // Tabela de participantes
  h2('2. PARTICIPANTES E FREQUÊNCIA CONSOLIDADA');
  const pWidths = [30, 180, 70, 70, 70, 70, W - 2 * M - 470];
  tableRow(['#', 'Nome', 'Status', 'Presenças', 'Total', 'Faltas', '% Frequência'], pWidths, true);
  ints.forEach((m, idx) => {
    const mid = String((m && m.id) || m);
    const pres = encs.filter(e => ((e.dados || {}).presentes || []).some(p => String((p && p.id) || p) === mid)).length;
    const faltas = encs.length - pres;
    const pct = encs.length ? Math.round((pres / encs.length) * 100) : 0;
    const statusColor = pct >= 75 ? COR_VERDE : pct >= 50 ? COR_AMARELO : COR_VERMELHO;
    const rowY = y;
    tableRow([idx + 1, m.nome || ('ID ' + mid), m.status || 'ativo', pres, encs.length, faltas, pct + '%'], pWidths);
    // Colorir % frequência
    const pctX = M + 30 + 180 + 70 + 70 + 70;
    page.drawRectangle({ x: pctX, y: rowY - 20, width: 70, height: 20, color: statusColor, opacity: 0.15 });
  });
  if (!ints.length) {
    bullet('Nenhum participante cadastrado no grupo.');
  }
  y -= 10;

  // Tabela de encontros
  h2('3. ENCONTROS REALIZADOS (' + encs.length + ')');
  const eWidths = [80, 200, 70, W - 2 * M - 350];
  tableRow(['Data', 'Tema', 'Presentes', 'Observações'], eWidths, true);
  encs.forEach(e => {
    const ed = e.dados || {};
    const presentesNomes = (ed.presentes || []).map(p => p.nome || p.id).join(', ').slice(0, 80);
    tableRow([e.data || '', ed.tema || 'Sem tema', ed.presentes?.length || 0, presentesNomes || ed.obs || ''], eWidths);
  });
  if (!encs.length) {
    bullet('Nenhum encontro registrado para este grupo.');
  }
  y -= 10;

  // Resumo estatístico
  h2('4. RESUMO ESTATÍSTICO');
  const mediaPresenca = ints.length ? Math.round(ints.reduce((s, m) => {
    const mid = String((m && m.id) || m);
    const pres = encs.filter(e => ((e.dados || {}).presentes || []).some(p => String((p && p.id) || p) === mid)).length;
    return s + (encs.length ? pres / encs.length : 0);
  }, 0) / ints.length * 100) : 0;
  const assiduidade75 = ints.filter(m => {
    const mid = String((m && m.id) || m);
    const pres = encs.filter(e => ((e.dados || {}).presentes || []).some(p => String((p && p.id) || p) === mid)).length;
    return encs.length && (pres / encs.length) >= 0.75;
  }).length;
  const stats = [
    ['Média de frequência do grupo', mediaPresenca + '%'],
    ['Participantes com ≥ 75% frequência', assiduidade75 + ' de ' + ints.length],
    ['Participantes com < 50% frequência', ints.filter(m => {
      const mid = String((m && m.id) || m);
      const pres = encs.filter(e => ((e.dados || {}).presentes || []).some(p => String((p && p.id) || p) === mid)).length;
      return encs.length && (pres / encs.length) < 0.5;
    }).length],
    ['Total de encontros no período', encs.length],
    ['Período coberto', encs.length ? (encs[0].data || '') + ' a ' + (encs[encs.length - 1].data || '') : '—']
  ];
  const sWidths = [250, W - 2 * M - 250];
  tableRow(['INDICADOR', 'VALOR'], sWidths, true);
  stats.forEach(row => tableRow(row, sWidths));
  y -= 10;

  // Assinatura
  y = Math.max(y, M + 80);
  if (y < M + 80) { page = pdf.addPage([W, H]); y = H - M; drawHeader(); }
  y -= 30;
  page.drawLine({ start: { x: M + 200, y }, end: { x: W - M - 200, y }, thickness: 1, color: COR_LINHA });
  y -= 12;
  line(req.auth.name + ' — Psicólogo(a) Responsável', 10, bold, COR_TEXTO, 13);
  line('SISUMEPE Juazeiro — ' + now.toLocaleDateString('pt-BR'), 9, font, COR_SUAVE, 12);

  await logBreakglass(req, 'relatório grupo ' + (dd.nome || g.id), g);
  const bytes = await pdf.save();
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="grupo-' + g.id + '-frequencia-' + today + '.pdf"');
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
