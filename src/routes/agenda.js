const express = require('express');
const shared = require('../lib/shared');
const { store, ah, authAgenda, broadcast, syncAgendaToGoogle } = shared;
const router = express.Router();

const CATEGORIES = ['reuniao', 'atendimento', 'auditoria', 'treinamento', 'feriado', 'pessoal', 'outro'];
const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#6b7280', '#06b6d4', '#84cc16', '#f97316'];
const STATUSES = ['confirmado', 'tentativo', 'cancelado', 'concluido'];

// Helpers
function validateEvent(body, isUpdate = false) {
  const errors = [];
  if (!isUpdate) {
    if (!body.title || !String(body.title).trim()) errors.push('Título é obrigatório');
    if (!body.start || !body.end) errors.push('Início e fim são obrigatórios');
  }
  if (body.start && body.end) {
    const s = new Date(body.start), e = new Date(body.end);
    if (isNaN(s) || isNaN(e) || e <= s) errors.push('Datas inválidas: fim deve ser após início');
  }
  if (body.category && !CATEGORIES.includes(body.category)) errors.push(`Categoria inválida. Use: ${CATEGORIES.join(', ')}`);
  if (body.color && !COLORS.includes(body.color)) errors.push(`Cor inválida`);
  if (body.status && !STATUSES.includes(body.status)) errors.push(`Status inválido. Use: ${STATUSES.join(', ')}`);
  if (body.recurrence && !['daily', 'weekly', 'monthly', 'yearly', 'custom'].includes(body.recurrence)) errors.push('Recorrência inválida');
  if (body.reminderMinutes !== undefined && (body.reminderMinutes < 0 || body.reminderMinutes > 10080)) errors.push('Lembrete: 0 a 10080 min (1 semana)');
  return errors;
}

// Listar com filtros
router.get('/api/agenda', authAgenda(), ah(async (req,res)=>{
  const { from, to, category, status, q, limit, all } = req.query;
  const opts = {};
  if(from) opts.from = from;
  if(to) opts.to = to;
  if(category) opts.category = category;
  if(status) opts.status = status;
  if(q) opts.q = q;
  if(limit) opts.limit = Math.min(Number(limit), 1000);

  if(req.auth.role==='admin' && all==='1'){
    const list = await store.agenda.all(opts);
    return res.json(list);
  }
  const list = await store.agenda.allByUser(req.auth.user, opts);
  res.json(list);
}));

// Busca rápida (para autocomplete)
router.get('/api/agenda/search', authAgenda(), ah(async (req,res)=>{
  const { q, limit = 10 } = req.query;
  if(!q || String(q).trim().length < 2) return res.json([]);
  const list = await store.agenda.allByUser(req.auth.user, { q: String(q).trim(), limit: Number(limit) });
  res.json(list.map(ev => ({ id: ev.id, title: ev.title, start: ev.start, end: ev.end, category: ev.category, color: ev.color })));
}));

// Verificar conflitos
router.get('/api/agenda/check-conflict', authAgenda(), ah(async (req,res)=>{
  const { start, end, excludeId } = req.query;
  if(!start || !end) return res.status(400).json({ error: 'Início e fim obrigatórios' });
  const conflicts = await store.agenda.checkConflict(req.auth.user, start, end, excludeId);
  res.json({ hasConflict: conflicts.length > 0, conflicts: conflicts.map(c => ({ id: c.id, title: c.title, start: c.start, end: c.end })) });
}));

// Estatísticas da semana
router.get('/api/agenda/stats/week', authAgenda(), ah(async (req,res)=>{
  const { weekStart } = req.query;
  const ws = weekStart || new Date().toISOString().slice(0,10);
  const stats = await store.agenda.statsByWeek(req.auth.user, ws);
  res.json(stats);
}));

// Categorias e cores disponíveis
router.get('/api/agenda/meta', authAgenda(), ah(async (req,res)=>{
  res.json({ categories: CATEGORIES, colors: COLORS, statuses: STATUSES });
}));

// Criar evento
router.post('/api/agenda', authAgenda(), ah(async (req,res)=>{
  const errors = validateEvent(req.body);
  if(errors.length) return res.status(400).json({ error: errors.join('; ') });

  const { title, description, start, end, personId, ticketId, category, color, allDay, recurrence, recurrenceEnd, reminderMinutes, location, attendees, status } = req.body;

  // Verificar conflito
  const conflicts = await store.agenda.checkConflict(req.auth.user, start, end);
  if(conflicts.length) return res.status(409).json({ error: 'Conflito de horário', conflicts: conflicts.map(c => ({ id: c.id, title: c.title, start: c.start, end: c.end })) });

  const ev = await store.agenda.insert({
    user: req.auth.user,
    title: String(title).trim(),
    description: String(description||'').trim(),
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
    personId: personId||null,
    ticketId: ticketId||null,
    category: category || 'reuniao',
    color: color || '#3b82f6',
    allDay: !!allDay,
    recurrence: recurrence || null,
    recurrenceEnd: recurrenceEnd || null,
    reminderMinutes: Number(reminderMinutes) || 15,
    location: String(location||'').trim(),
    attendees: Array.isArray(attendees) ? attendees : (attendees ? [attendees] : []),
    status: status || 'confirmado',
    googleEventId: '',
    origem: 'manual'
  });

  syncAgendaToGoogle(req.auth.user, ev, {}).then(async (gid)=>{
    if(gid) await store.agenda.patch(ev.id, { googleEventId: gid }).catch(()=>{});
  }).catch(()=>{});

  broadcast();
  res.status(201).json(ev);
}));

// Atualizar evento
router.patch('/api/agenda/:id', authAgenda(), ah(async (req,res)=>{
  const ev = await store.agenda.byId(req.params.id);
  if(!ev) return res.status(404).json({ error: 'Evento não encontrado' });
  if(ev.user !== req.auth.user && req.auth.role!=='admin') return res.status(403).json({ error: 'Sem permissão' });

  const errors = validateEvent(req.body, true);
  if(errors.length) return res.status(400).json({ error: errors.join('; ') });

  const { title, description, start, end, personId, ticketId, category, color, allDay, recurrence, recurrenceEnd, reminderMinutes, location, attendees, status } = req.body;
  const patch = {};

  if(title!=null) patch.title = String(title).trim();
  if(description!=null) patch.description = String(description).trim();
  if(start) patch.start = new Date(start).toISOString();
  if(end) patch.end = new Date(end).toISOString();
  if(personId!==undefined) patch.personId = personId||null;
  if(ticketId!==undefined) patch.ticketId = ticketId||null;
  if(category!=null) patch.category = category;
  if(color!=null) patch.color = color;
  if(allDay!==undefined) patch.allDay = !!allDay;
  if(recurrence!=null) patch.recurrence = recurrence;
  if(recurrenceEnd!=null) patch.recurrenceEnd = recurrenceEnd;
  if(reminderMinutes!==undefined) patch.reminderMinutes = Number(reminderMinutes) || 0;
  if(location!==undefined) patch.location = String(location||'').trim();
  if(attendees!==undefined) patch.attendees = Array.isArray(attendees) ? attendees : (attendees ? [attendees] : []);
  if(status!=null) patch.status = status;

  if(patch.start && patch.end && new Date(patch.end) <= new Date(patch.start)) return res.status(400).json({ error: 'Fim deve ser após início' });

  // Verificar conflito se mudou horário
  if(patch.start || patch.end){
    const conflicts = await store.agenda.checkConflict(req.auth.user, patch.start || ev.start, patch.end || ev.end, ev.id);
    if(conflicts.length) return res.status(409).json({ error: 'Conflito de horário', conflicts: conflicts.map(c => ({ id: c.id, title: c.title, start: c.start, end: c.end })) });
  }

  const upd = await store.agenda.patch(ev.id, patch);
  syncAgendaToGoogle(req.auth.user, upd, { isUpdate: true }).catch(()=>{});
  broadcast();
  res.json(upd);
}));

// Deletar evento
router.delete('/api/agenda/:id', authAgenda(), ah(async (req,res)=>{
  const ev = await store.agenda.byId(req.params.id);
  if(!ev) return res.status(404).json({ error: 'Evento não encontrado' });
  if(ev.user !== req.auth.user && req.auth.role!=='admin') return res.status(403).json({ error: 'Sem permissão' });
  await store.agenda.remove(ev.id);
  syncAgendaToGoogle(req.auth.user, ev, { isDelete: true }).catch(()=>{});
  broadcast();
  res.json({ ok: true });
}));

// Duplicar evento (para criar recorrência manual)
router.post('/api/agenda/:id/duplicate', authAgenda(), ah(async (req,res)=>{
  const ev = await store.agenda.byId(req.params.id);
  if(!ev) return res.status(404).json({ error: 'Evento não encontrado' });
  if(ev.user !== req.auth.user && req.auth.role!=='admin') return res.status(403).json({ error: 'Sem permissão' });

  const { start, end } = req.body;
  if(!start || !end) return res.status(400).json({ error: 'Novo início e fim obrigatórios' });

  const newEv = await store.agenda.insert({
    user: req.auth.user,
    title: ev.title,
    description: ev.description,
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
    personId: ev.personId,
    ticketId: ev.ticketId,
    category: ev.category,
    color: ev.color,
    allDay: ev.allDay,
    recurrence: null, // duplicata não recorrente
    recurrenceEnd: null,
    reminderMinutes: ev.reminderMinutes,
    location: ev.location,
    attendees: ev.attendees,
    status: 'confirmado',
    googleEventId: '',
    origem: 'manual'
  });
  broadcast();
  res.status(201).json(newEv);
}));

module.exports = router;