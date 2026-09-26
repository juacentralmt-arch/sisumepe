const express = require('express');
const shared = require('../lib/shared');
const { store, ah, authAgenda, broadcast, issueToken, loginRateLimit, isHash, upload, mapFiles, sortQueue, enrich, enrichAll, ticketOwnerOf, infinityBlocked, PERSON_LABELS, MOTIVOS_OK, getGoogleConfig, makeOAuthClient, getAuthedClientForUser, syncAgendaToGoogle, pendingGoogleStates, ROOT, PORT } = shared;
const router = express.Router();

// Agenda restrita a andre, daniel e admin (authAgenda) + Calendly
router.get('/api/agenda', authAgenda(), ah(async (req,res)=>{
  const list = await store.agenda.allByUser(req.auth.user);
  // admin vê a própria agenda; se quiser ver todas, use ?all=1
  if(req.auth.role==='admin' && req.query.all==='1'){
    const all = await store.agenda.all();
    return res.json(all);
  }
  res.json(list);
}));
router.post('/api/agenda', authAgenda(), ah(async (req,res)=>{
  const { title, description, start, end, personId, ticketId } = req.body||{};
  if(!title || !String(title).trim()) return res.status(400).json({ error: 'Título é obrigatório' });
  if(!start || !end) return res.status(400).json({ error: 'Início e fim são obrigatórios' });
  const s = new Date(start), e = new Date(end);
  if(isNaN(s) || isNaN(e) || e <= s) return res.status(400).json({ error: 'Datas inválidas' });
  const ev = await store.agenda.insert({ user: req.auth.user, title: String(title).trim(), description: String(description||'').trim(), start: s.toISOString(), end: e.toISOString(), personId: personId||null, ticketId: ticketId||null, googleEventId: '' });
  // tenta sync Google em background
  syncAgendaToGoogle(req.auth.user, ev, {}).then(async (gid)=>{
    if(gid) await store.agenda.patch(ev.id, { googleEventId: gid }).catch(()=>{});
  }).catch(()=>{});
  broadcast();
  res.status(201).json(ev);
}));
router.patch('/api/agenda/:id', authAgenda(), ah(async (req,res)=>{
  const ev = await store.agenda.byId(req.params.id);
  if(!ev) return res.status(404).json({ error: 'Evento não encontrado' });
  if(ev.user !== req.auth.user && req.auth.role!=='admin') return res.status(403).json({ error: 'Sem permissão' });
  const { title, description, start, end, personId, ticketId } = req.body||{};
  const patch={};
  if(title!=null) patch.title=String(title).trim();
  if(description!=null) patch.description=String(description).trim();
  if(start) patch.start=new Date(start).toISOString();
  if(end) patch.end=new Date(end).toISOString();
  if(personId!==undefined) patch.personId=personId||null;
  if(ticketId!==undefined) patch.ticketId=ticketId||null;
  if(patch.start && patch.end && new Date(patch.end) <= new Date(patch.start)) return res.status(400).json({ error: 'Fim deve ser após início' });
  const upd = await store.agenda.patch(ev.id, patch);
  syncAgendaToGoogle(req.auth.user, upd, { isUpdate: true }).catch(()=>{});
  broadcast();
  res.json(upd);
}));
router.delete('/api/agenda/:id', authAgenda(), ah(async (req,res)=>{
  const ev = await store.agenda.byId(req.params.id);
  if(!ev) return res.status(404).json({ error: 'Evento não encontrado' });
  if(ev.user !== req.auth.user && req.auth.role!=='admin') return res.status(403).json({ error: 'Sem permissão' });
  await store.agenda.remove(ev.id);
  syncAgendaToGoogle(req.auth.user, ev, { isDelete: true }).catch(()=>{});
  broadcast();
  res.json({ ok: true });
}));

module.exports = router;
