const express = require('express');
const fs = require('fs');
const path = require('path');
const shared = require('../lib/shared');
const { store, ah, auth, broadcast, issueToken, loginRateLimit, isHash, upload, mapFiles, sortQueue, enrich, enrichAll, invalidatePersonsCache, ticketOwnerOf, infinityBlocked, PERSON_LABELS, MOTIVOS_OK, getGoogleConfig, makeOAuthClient, getAuthedClientForUser, syncAgendaToGoogle, pendingGoogleStates, ROOT, PORT } = shared;
const router = express.Router();

// Auditoria / dashboard / backup
// Cache curto do dashboard (15s): evita 2 full-scans de tickets por refresh.
let dashCache = null, dashCacheAt = 0;
const DASH_TTL_MS = 15e3;
router.get('/api/audit', auth(['admin']), ah(async (req, res) => {
  res.json(await store.audit.recent(req.query.limit));
}));
router.get('/api/audit/search', auth(['admin']), ah(async (req, res) => {
  const { q, user, action, kind, from, to, limit, offset } = req.query;
  res.json(await store.audit.search({ q, user, action, kind, from, to, limit, offset }));
}));
router.get('/api/audit/stats', auth(['admin']), ah(async (req, res) => {
  const all = await store.audit.recent(500);
  const byAction={}, byUser={}, byDay={};
  for(let i=6;i>=0;i--){ const d=new Date(Date.now()-i*864e5).toISOString().slice(0,10); byDay[d]=0; }
  all.forEach(a=>{
    const act=a.action||a.kind||'outro';
    byAction[act]=(byAction[act]||0)+1;
    const u=a.byUser||'sistema';
    byUser[u]=(byUser[u]||0)+1;
    const day=String(a.at||'').slice(0,10);
    if(day in byDay) byDay[day]++;
  });
  res.json({ total: all.length, byAction, byUser, byDay });
}));

router.get('/api/dashboard', auth(['tecnico', 'admin']), ah(async (req, res) => {
  if (dashCache && Date.now() - dashCacheAt < DASH_TTL_MS) return res.json(dashCache);
  const allTickets = await store.tickets.all();
  const all = allTickets.filter(x => x.status !== 'cancelado');
  const t = all;
  const today = new Date().toISOString().slice(0, 10);
  const byMotivo = {}, byModelo = {}, byTec = {}, byDay = {}, bySetor = {};
  const byMotivoDetalhado = {}, bySetorDetalhado = {};
  MOTIVOS_OK.forEach(m => { byMotivoDetalhado[m] = { total: 0, finalizados: 0, aguardando: 0, em_atendimento: 0, hoje: 0, hojeFinalizados: 0 }; });
  ['tecnico','administrativo','psicossocial','visitante','outros'].forEach(s=>{ bySetorDetalhado[s]={ total:0, finalizados:0, aguardando:0, em_atendimento:0, hoje:0, hojeFinalizados:0 }; });
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
    byDay[d] = 0;
  }
  let waitSum = 0, waitN = 0, svcSum = 0, svcN = 0, todayN = 0, todayFin = 0;
  t.forEach(x => {
    const mot = MOTIVOS_OK.includes(x.motivo) ? x.motivo : 'Outros';
    byMotivo[mot] = (byMotivo[mot] || 0) + 1;
    byModelo[x.modeloTornozeleira || 'Não informado'] = (byModelo[x.modeloTornozeleira || 'Não informado'] || 0) + 1;
    const setorKey = (x.visitante ? 'visitante' : String(x.setor||'outros').toLowerCase()) || 'outros';
    const sk = ['tecnico','administrativo','psicossocial','visitante'].includes(setorKey) ? setorKey : 'outros';
    bySetor[sk] = (bySetor[sk]||0)+1;
    bySetorDetalhado[sk].total++;
    if(x.status==='finalizado') bySetorDetalhado[sk].finalizados++;
    else if(x.status==='aguardando') bySetorDetalhado[sk].aguardando++;
    else if(x.status==='em_atendimento') bySetorDetalhado[sk].em_atendimento++;
    const day2 = String(x.createdAt||'').slice(0,10);
    if(day2===today){ bySetorDetalhado[sk].hoje++; if(x.status==='finalizado') bySetorDetalhado[sk].hojeFinalizados++; }
    const day = String(x.createdAt || '').slice(0, 10);
    if (day in byDay) byDay[day]++;
    if (day === today) { todayN++; if (x.status === 'finalizado') todayFin++; }
    // Detalhado por motivo
    if (!byMotivoDetalhado[mot]) byMotivoDetalhado[mot] = { total: 0, finalizados: 0, aguardando: 0, em_atendimento: 0, hoje: 0, hojeFinalizados: 0 };
    byMotivoDetalhado[mot].total++;
    if (x.status === 'finalizado') byMotivoDetalhado[mot].finalizados++;
    else if (x.status === 'aguardando') byMotivoDetalhado[mot].aguardando++;
    else if (x.status === 'em_atendimento') byMotivoDetalhado[mot].em_atendimento++;
    if (day === today) { byMotivoDetalhado[mot].hoje++; if (x.status === 'finalizado') byMotivoDetalhado[mot].hojeFinalizados++; }
    const key = x.tecnico || '—';
    byTec[key] = byTec[key] || { tecnico: key, iniciados: 0, finalizados: 0 };
    if (x.startedAt) {
      byTec[key].iniciados++;
      waitSum += new Date(x.startedAt) - new Date(x.createdAt); waitN++;
    }
    if (x.finishedAt) {
      byTec[key].finalizados++;
      if (x.startedAt) { svcSum += new Date(x.finishedAt) - new Date(x.startedAt); svcN++; }
    }
  });
  const mins = ms => Math.round(ms / 60000);
  const byMotivoFinalizados = {};
  Object.keys(byMotivoDetalhado).forEach(m => { byMotivoFinalizados[m] = byMotivoDetalhado[m].finalizados; });
  const payload = {
    total: t.length,
    aguardando: t.filter(x => x.status === 'aguardando').length,
    emAtendimento: t.filter(x => x.status === 'em_atendimento').length,
    finalizados: t.filter(x => x.status === 'finalizado').length,
    hoje: todayN, hojeFinalizados: todayFin,
    esperaMediaMin: waitN ? mins(waitSum / waitN) : 0,
    atendimentoMedioMin: svcN ? mins(svcSum / svcN) : 0,
    esperaAlta: t.filter(x => x.status === 'aguardando' && (Date.now() - new Date(x.createdAt)) > 30 * 60000).length,
    cancelados: allTickets.filter(x => x.status === 'cancelado').length,
    prioridade: t.filter(x => x.prioridadeLegal && x.status !== 'finalizado').length,
    byMotivo, byModelo, bySetor, bySetorDetalhado,
    byMotivoDetalhado, byMotivoFinalizados,
    byTec: Object.values(byTec).sort((a, b) => b.finalizados - a.finalizados),
    byDay
  };
  dashCache = payload; dashCacheAt = Date.now();
  res.json(payload);
}));

router.get('/api/backup', auth(['admin']), ah(async (req, res) => {
  const fname = 'sisumepe-backup-' + new Date().toISOString().slice(0, 10) + '.json';
  res.setHeader('Content-Disposition', 'attachment; filename="' + fname + '"');
  res.setHeader('Content-Type', 'application/json');
  res.json(await store.backup());
}));

router.post('/api/restore', auth(['admin']), upload.single('backup'), ah(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Envie o arquivo de backup (.json)' });
  let data;
  try {
    data = JSON.parse(req.file.buffer.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Arquivo inválido' });
  }
  if (store.mode === 'file') {
    try {
      fs.writeFileSync(path.join(ROOT, 'db.json') + '.bak-' + Date.now(), JSON.stringify(await store.backup()));
    } catch {}
  }
  try {
    const out = await store.restore(data);
    invalidatePersonsCache();
    broadcast();
    res.json({ ok: true, ...out });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message || 'Arquivo inválido ou sem administrador ativo' });
  }
}));

module.exports = router;
