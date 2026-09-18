const express = require('express');
const fs = require('fs');
const path = require('path');
const shared = require('../lib/shared');
const { store, ah, auth, broadcast, issueToken, loginRateLimit, isHash, upload, mapFiles, sortQueue, enrich, enrichAll, ticketOwnerOf, infinityBlocked, PERSON_LABELS, MOTIVOS_OK, getGoogleConfig, makeOAuthClient, getAuthedClientForUser, syncAgendaToGoogle, pendingGoogleStates, ROOT, PORT } = shared;
const router = express.Router();

// Auditoria / dashboard / backup
router.get('/api/audit', auth(['tecnico', 'admin']), ah(async (req, res) => {
  res.json(await store.audit.recent(req.query.limit));
}));

router.get('/api/dashboard', auth(['tecnico', 'admin']), ah(async (req, res) => {
  const all = (await store.tickets.all()).filter(x => x.status !== 'cancelado');
  const t = all;
  const today = new Date().toISOString().slice(0, 10);
  const byMotivo = {}, byModelo = {}, byTec = {}, byDay = {};
  const byMotivoDetalhado = {};
  MOTIVOS_OK.forEach(m => { byMotivoDetalhado[m] = { total: 0, finalizados: 0, aguardando: 0, em_atendimento: 0, hoje: 0, hojeFinalizados: 0 }; });
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
    byDay[d] = 0;
  }
  let waitSum = 0, waitN = 0, svcSum = 0, svcN = 0, todayN = 0, todayFin = 0;
  t.forEach(x => {
    const mot = MOTIVOS_OK.includes(x.motivo) ? x.motivo : 'Outros';
    byMotivo[mot] = (byMotivo[mot] || 0) + 1;
    byModelo[x.modeloTornozeleira || 'Não informado'] = (byModelo[x.modeloTornozeleira || 'Não informado'] || 0) + 1;
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
  res.json({
    total: t.length,
    aguardando: t.filter(x => x.status === 'aguardando').length,
    emAtendimento: t.filter(x => x.status === 'em_atendimento').length,
    finalizados: t.filter(x => x.status === 'finalizado').length,
    hoje: todayN, hojeFinalizados: todayFin,
    esperaMediaMin: waitN ? mins(waitSum / waitN) : 0,
    atendimentoMedioMin: svcN ? mins(svcSum / svcN) : 0,
    esperaAlta: t.filter(x => x.status === 'aguardando' && (Date.now() - new Date(x.createdAt)) > 30 * 60000).length,
    cancelados: (await store.tickets.all()).filter(x => x.status === 'cancelado').length,
    prioridade: t.filter(x => x.prioridadeLegal && x.status !== 'finalizado').length,
    byMotivo, byModelo,
    byMotivoDetalhado, byMotivoFinalizados,
    byTec: Object.values(byTec).sort((a, b) => b.finalizados - a.finalizados),
    byDay
  });
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
    broadcast();
    res.json({ ok: true, ...out });
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message || 'Arquivo inválido ou sem administrador ativo' });
  }
}));

module.exports = router;
