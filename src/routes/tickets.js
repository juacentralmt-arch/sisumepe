const express = require('express');
const shared = require('../lib/shared');
const { store, ah, auth, broadcast, issueToken, loginRateLimit, isHash, upload, mapFiles, consolidateTicketFiles, pdfPrefixForMotivo, sortQueue, enrich, enrichAll, invalidatePersonsCache, ticketOwnerOf, infinityBlocked, PERSON_LABELS, MOTIVOS_OK, getGoogleConfig, makeOAuthClient, getAuthedClientForUser, syncAgendaToGoogle, pendingGoogleStates, ROOT, PORT } = shared;
const router = express.Router();

// Tickets
router.get('/api/tickets', auth(), ah(async (req, res) => {
  const status = req.query.status;
  let list = await enrichAll(await store.tickets.all());
  if (status && status !== 'todos') list = list.filter(t => t.status === status);
  const active = list.filter(t => t.status !== 'finalizado');
  const done = list.filter(t => t.status === 'finalizado').sort((a, b) => new Date(b.finishedAt || b.createdAt) - new Date(a.finishedAt || a.createdAt));
  res.json([...sortQueue(active), ...done]);
}));

router.get('/api/stats', auth(), ah(async (req, res) => {
  const all = await store.tickets.all();
  const persons = await store.persons.all();
  res.json({
    aguardando: all.filter(t => t.status === 'aguardando').length,
    em_atendimento: all.filter(t => t.status === 'em_atendimento').length,
    finalizados: all.filter(t => t.status === 'finalizado').length,
    totalPessoas: persons.length
  });
}));

router.post('/api/tickets', auth(), upload.array('anexos', 20), ah(async (req, res) => {
  const { personId, motivo, descricao, prioridadeLegal, tecnicoRecepcao, modeloTornozeleira, setor, visitante } = req.body || {};
  const person = await store.persons.byId(personId);
  if (!person) return res.status(400).json({ error: 'Atendido inválido. Selecione ou cadastre a pessoa.' });
  const setorNorm = String(setor||'').toLowerCase();
  const isVisitante = String(visitante)==='true' || visitante===true || setorNorm==='visitante';
  const setorOk = ['tecnico','tecnico_tornozeleira','administrativo','psicossocial','visitante'];
  // normaliza setor
  let setorFinal = 'tecnico';
  if(setorOk.includes(setorNorm)) setorFinal = setorNorm;
  else if(setorNorm.includes('tecnico')) setorFinal='tecnico';
  else if(setorNorm.includes('admin')) setorFinal='administrativo';
  else if(setorNorm.includes('psico')) setorFinal='psicossocial';
  else if(isVisitante) setorFinal='visitante';
  if(isVisitante){
    // Visitante: controle de entrada, não exige motivo/modelo
  } else {
    if (!setorFinal) return res.status(400).json({ error: 'Selecione o setor de destino' });
    if (!motivo) return res.status(400).json({ error: 'Motivo é obrigatório' });
    if (setorFinal==='tecnico' && !modeloTornozeleira) return res.status(400).json({ error: 'Selecione o modelo da tornozeleira (Spacecom ou Infinity)' });
  }
  // Anti-duplicidade: mesmo atendido + motivo + criador nos últimos 20s = duplo clique
  try{
    const recent = (await store.tickets.all()).filter(x =>
      String(x.personId) === String(person.id) && x.motivo === motivo &&
      (x.createdBy || '') === req.auth.user && (Date.now() - new Date(x.createdAt).getTime()) < 20000
    ).sort((a,b)=> new Date(b.createdAt) - new Date(a.createdAt))[0];
    if(recent){
      const persons = await store.persons.all();
      return res.json(Object.assign(enrich(recent, persons), { duplicated: true }));
    }
  }catch(e){}
  const pdfPrefix = pdfPrefixForMotivo(motivo);
  const consolidated = await consolidateTicketFiles(req.files, pdfPrefix);
  const files = await mapFiles(consolidated.files);
  const creator = await store.users.byName(req.auth.user);
  const motivoFinal = isVisitante ? (motivo || 'Visitante - Controle de entrada') : motivo;
  const modeloFinal = isVisitante ? '' : (modeloTornozeleira || '');
  let ticket = await store.tickets.insert({
    personId: person.id,
    motivo: motivoFinal, descricao: descricao || '',
    prioridadeLegal: String(prioridadeLegal) === 'true' || prioridadeLegal === true || prioridadeLegal === '1',
    modeloTornozeleira: modeloFinal,
    status: 'aguardando',
    anexos: files,
    tecnicoRecepcao: tecnicoRecepcao || '',
    tecnico: '', tecnicoUser: '', relatorio: '',
    createdBy: creator ? creator.user : req.auth.user,
    createdByName: creator ? creator.name : req.auth.name,
    called: false, calledAt: null, calledBy: '',
    setor: setorFinal, visitante: !!isVisitante,
    createdAt: new Date().toISOString(), startedAt: null, finishedAt: null
  });
  // Renomeia o PDF unificado com o código do ticket (ex.: pdfinstalacao-TK-0007.pdf)
  if (consolidated.merged && files.length && Array.isArray(ticket.anexos)) {
    const mergedName = files[0].name;
    const upd = await store.tickets.patch(ticket.id, {
      anexos: ticket.anexos.map(a =>
        (a.name === mergedName) ? { ...a, name: pdfPrefix + '-' + ticket.code + '.pdf' } : a
      )
    });
    if (upd) ticket = upd;
  }
  if (modeloTornozeleira && person.modeloTornozeleira !== modeloTornozeleira) {
    const fromMod = person.modeloTornozeleira || '';
    await store.persons.patch(person.id, { modeloTornozeleira });
    invalidatePersonsCache();
    await store.audit.insert({
      kind: 'cadastro', personId: person.id, personName: person.nome,
      byUser: ticket.createdBy, byName: ticket.createdByName,
    byRole: creator ? creator.role : req.auth.role,
      changes: [{ field: 'modeloTornozeleira', label: 'Modelo da tornozeleira', from: fromMod, to: modeloTornozeleira }]
    });
  }
  await store.audit.insert({
    action: 'criado', personId: person.id, personName: person.nome,
    ticketId: ticket.id, ref: ticket.code,
    byUser: ticket.createdBy, byName: ticket.createdByName,
    byRole: creator ? creator.role : req.auth.role,
    summary: motivo + (ticket.prioridadeLegal ? ' (prioridade legal)' : '')
  });
  broadcast();
  const persons = await store.persons.all();
  res.status(201).json(enrich(ticket, persons));
}));

router.patch('/api/tickets/:id/start', auth(['tecnico']), ah(async (req, res) => {
  const t = await store.tickets.byId(req.params.id);
  if (!t) return res.status(404).json({ error: 'Ticket não encontrado' });
  const starter = await store.users.byName(req.auth.user);
  const blockStart = infinityBlocked(t, starter);
  if (blockStart) return res.status(403).json({ error: blockStart });
  if (starter && starter.role === 'admin') return res.status(403).json({ error: 'Painel Técnico restrito ao Setor Técnico.' });
  if (t.status !== 'aguardando') return res.status(400).json({ error: 'Ticket já saiu da fila.' });
  const upd = await store.tickets.patch(t.id, {
    status: 'em_atendimento',
    tecnico: starter.name + ' (' + starter.user + ')',
    tecnicoUser: starter.user,
    startedAt: new Date().toISOString()
  });
  const person = await store.persons.byId(t.personId);
  await store.audit.insert({
    action: 'iniciado', personId: t.personId, personName: person ? person.nome : '',
    ticketId: t.id, ref: t.code, byUser: upd.tecnicoUser, byName: upd.tecnico, byRole: 'tecnico',
    summary: 'Atendimento iniciado'
  });
  broadcast();
  const persons = await store.persons.all();
  res.json(enrich(upd, persons));
}));

router.patch('/api/tickets/:id/finish', auth(['tecnico']), upload.array('fotos', 20), ah(async (req, res) => {
  const t = await store.tickets.byId(req.params.id);
  if (!t) return res.status(404).json({ error: 'Ticket não encontrado' });
  const { relatorio } = req.body || {};
  if (!relatorio || !relatorio.trim() || relatorio.trim().length < 10)
    return res.status(400).json({ error: 'Relatório da ação realizada é obrigatório (mín. 10 caracteres).' });
  let cl = req.body.checklist;
  if (typeof cl === 'string') { try { cl = JSON.parse(cl); } catch { cl = null; } }
  if (cl && (typeof cl !== 'object' || Array.isArray(cl))) cl = null;
  const owner = (t.tecnicoUser || (((t.tecnico || '').match(/\(\s*([^)]+?)\s*\)\s*$/) || [])[1] || '')).toLowerCase().trim();
  const by = req.auth.user;
  if (owner && by !== owner)
    return res.status(403).json({ error: 'Somente o técnico vinculado (' + (t.tecnico || owner) + ') pode finalizar este atendimento.' });
  const finisher = await store.users.byName(req.auth.user);
  const blockFin = infinityBlocked(t, finisher);
  if (blockFin) return res.status(403).json({ error: blockFin });
  if (finisher && finisher.role === 'admin') return res.status(403).json({ error: 'Painel Técnico restrito ao Setor Técnico.' });
  if (t.status !== 'em_atendimento') return res.status(400).json({ error: 'Só é possível finalizar tickets em atendimento.' });
  const finishPrefix = pdfPrefixForMotivo(t.motivo, 'fotos-servico');
  const consolidatedPos = await consolidateTicketFiles(req.files, finishPrefix);
  const mergedPosName = consolidatedPos.merged && consolidatedPos.files[0] ? consolidatedPos.files[0].originalname : null;
  const pos = (await mapFiles(consolidatedPos.files)).map(a =>
    (mergedPosName && a.name === mergedPosName) ? { ...a, name: finishPrefix + '-' + t.code + '.pdf' } : a
  );
  const upd = await store.tickets.patch(t.id, {
    status: 'finalizado',
    relatorio: relatorio.trim(),
    tecnico: t.tecnico,
    ...(cl ? { checklist: { sinal: !!cl.sinal, bateria: !!cl.bateria, pulseira: !!cl.pulseira, orientacao: !!cl.orientacao } } : {}),
    fotosPos: (t.fotosPos || []).concat(pos).slice(-20),
    finishedAt: new Date().toISOString()
  });
  const person = await store.persons.byId(t.personId);
  await store.audit.insert({
    action: 'finalizado', personId: t.personId, personName: person ? person.nome : '',
    ticketId: t.id, ref: t.code, byUser: by, byName: upd.tecnico, byRole: 'tecnico',
    summary: 'Atendimento finalizado'
  });
  broadcast();
  const persons = await store.persons.all();
  res.json(enrich(upd, persons));
}));

router.patch('/api/tickets/:id/call', auth(['tecnico']), ah(async (req, res) => {
  const t = await store.tickets.byId(req.params.id);
  if (!t) return res.status(404).json({ error: 'Ticket não encontrado' });
  if (t.status !== 'aguardando') return res.status(400).json({ error: 'Ticket já saiu da fila' });
  const caller = await store.users.byName(req.auth.user);
  const blockCall = infinityBlocked(t, caller);
  if (blockCall) return res.status(403).json({ error: blockCall });
  if (caller && caller.role === 'admin') return res.status(403).json({ error: 'Painel Técnico restrito ao Setor Técnico.' });
  const upd = await store.tickets.patch(t.id, { called: true, calledAt: new Date().toISOString(), calledBy: caller ? caller.user : '' });
  broadcast();
  const persons = await store.persons.all();
  res.json(enrich(upd, persons));
}));

router.patch('/api/tickets/:id/edit', auth(['recepcao', 'admin']), ah(async (req, res) => {
  const t = await store.tickets.byId(req.params.id);
  if (!t) return res.status(404).json({ error: 'Ticket não encontrado' });
  if (t.status !== 'aguardando') return res.status(400).json({ error: 'Só é possível corrigir tickets aguardando na fila' });
  const editor = await store.users.byName(req.auth.user);
  const { motivo, modeloTornozeleira, descricao, prioridadeLegal } = req.body || {};
  const changes = [];
  const patch = {};
  if (motivo && MOTIVOS_OK.includes(motivo) && motivo !== t.motivo) { changes.push({ field: 'motivo', label: 'Motivo', from: t.motivo, to: motivo }); patch.motivo = motivo; }
  if (modeloTornozeleira && ['Spacecom', 'Infinity'].includes(modeloTornozeleira) && modeloTornozeleira !== t.modeloTornozeleira) {
    changes.push({ field: 'modeloTornozeleira', label: 'Modelo', from: t.modeloTornozeleira || '', to: modeloTornozeleira });
    patch.modeloTornozeleira = modeloTornozeleira;
    const person = await store.persons.byId(t.personId);
    if (person && person.modeloTornozeleira !== modeloTornozeleira) {
      const fromMod = person.modeloTornozeleira || '';
      await store.persons.patch(person.id, { modeloTornozeleira });
      invalidatePersonsCache();
      changes.push({ field: 'cadastro', label: 'Modelo no cadastro', from: fromMod, to: modeloTornozeleira });
    }
  }
  const nd = String(descricao == null ? t.descricao : descricao);
  if (nd !== (t.descricao || '')) { changes.push({ field: 'descricao', label: 'Descrição', from: t.descricao || '', to: nd }); patch.descricao = nd; }
  const np = String(prioridadeLegal) === 'true' || prioridadeLegal === true;
  if (np !== !!t.prioridadeLegal) { changes.push({ field: 'prioridadeLegal', label: 'Prioridade legal', from: t.prioridadeLegal ? 'SIM' : 'NÃO', to: np ? 'SIM' : 'NÃO' }); patch.prioridadeLegal = np; }
  if (!changes.length) return res.status(400).json({ error: 'Nenhuma alteração detectada' });
  const upd = await store.tickets.patch(t.id, patch);
  const person = await store.persons.byId(t.personId);
  await store.audit.insert({
    action: 'editado', personId: t.personId, personName: person ? person.nome : '',
    ticketId: t.id, ref: t.code, byUser: editor.user, byName: editor.name, byRole: editor.role,
    summary: changes.map(c => c.label).join(', ')
  });
  broadcast();
  const persons = await store.persons.all();
  res.json(enrich(upd, persons));
}));

router.patch('/api/tickets/:id/cancel', auth(['recepcao', 'admin']), ah(async (req, res) => {
  const t = await store.tickets.byId(req.params.id);
  if (!t) return res.status(404).json({ error: 'Ticket não encontrado' });
  if (t.status !== 'aguardando') return res.status(400).json({ error: 'Só é possível cancelar tickets aguardando na fila' });
  const editor = await store.users.byName(req.auth.user);
  const upd = await store.tickets.patch(t.id, { status: 'cancelado', cancelledAt: new Date().toISOString(), cancelledBy: editor.user });
  const person = await store.persons.byId(t.personId);
  await store.audit.insert({
    action: 'cancelado', personId: t.personId, personName: person ? person.nome : '',
    ticketId: t.id, ref: t.code, byUser: editor.user, byName: editor.name, byRole: editor.role,
    summary: t.motivo
  });
  broadcast();
  const persons = await store.persons.all();
  res.json(enrich(upd, persons));
}));

router.patch('/api/tickets/:id/reopen', auth(['tecnico']), ah(async (req, res) => {
  const t = await store.tickets.byId(req.params.id);
  if (!t) return res.status(404).json({ error: 'Ticket não encontrado' });
  if (t.status !== 'finalizado') return res.status(400).json({ error: 'Só é possível reabrir tickets finalizados' });
  const by = req.auth.user;
  const owner = (ticketOwnerOf(t) || '').toLowerCase().trim();
  if (!owner || by !== owner) return res.status(403).json({ error: 'Somente o técnico vinculado pode reabrir este atendimento.' });
  const upd = await store.tickets.patch(t.id, { status: 'em_atendimento', finishedAt: null, reopenedAt: new Date().toISOString() });
  const person = await store.persons.byId(t.personId);
  await store.audit.insert({
    action: 'reaberto', personId: t.personId, personName: person ? person.nome : '',
    ticketId: t.id, ref: t.code, byUser: by, byName: t.tecnico, byRole: 'tecnico',
    summary: 'Atendimento reaberto'
  });
  broadcast();
  const persons = await store.persons.all();
  res.json(enrich(upd, persons));
}));

// Repassar atendimento para outro técnico (somente o dono do ticket)
router.patch('/api/tickets/:id/transfer', auth(['tecnico']), ah(async (req, res) => {
  const t = await store.tickets.byId(req.params.id);
  if (!t) return res.status(404).json({ error: 'Ticket não encontrado' });
  if (t.status !== 'em_atendimento') return res.status(400).json({ error: 'Só é possível repassar tickets em atendimento.' });
  const owner = (ticketOwnerOf(t) || '').toLowerCase().trim();
  const by = String(req.auth.user).toLowerCase().trim();
  if (!owner || by !== owner) return res.status(403).json({ error: 'Somente o técnico vinculado (' + (t.tecnico || owner) + ') pode repassar este atendimento.' });
  const actor = await store.users.byName(req.auth.user);
  if (actor && actor.role === 'admin') return res.status(403).json({ error: 'Painel Técnico restrito ao Setor Técnico.' });
  const { toUser } = req.body || {};
  const targetId = String(toUser || '').toLowerCase().trim();
  if (!targetId) return res.status(400).json({ error: 'Selecione o técnico de destino.' });
  if (targetId === by) return res.status(400).json({ error: 'Você já é o responsável por este ticket.' });
  const target = await store.users.byName(targetId);
  if (!target) return res.status(404).json({ error: 'Técnico de destino não encontrado.' });
  if (target.active === false) return res.status(400).json({ error: 'Técnico de destino está desativado.' });
  if (!['tecnico', 'admin'].includes(target.role)) return res.status(400).json({ error: 'O destino deve ser um técnico.' });
  const block = infinityBlocked(t, target);
  if (block) return res.status(403).json({ error: block });
  let upd;
  try {
    upd = await store.tickets.patch(t.id, {
      tecnico: target.name + ' (' + target.user + ')',
      tecnicoUser: target.user,
      transferredAt: new Date().toISOString(),
      transferredBy: by,
      transferredFrom: owner
    });
  } catch (e) {
    // Fallback se as colunas novas ainda não existem no Supabase (sem migração)
    if (e && e.message && /transferred/i.test(e.message)) {
      upd = await store.tickets.patch(t.id, {
        tecnico: target.name + ' (' + target.user + ')',
        tecnicoUser: target.user
      });
    } else throw e;
  }
  const person = await store.persons.byId(t.personId);
  await store.audit.insert({
    action: 'transferido', personId: t.personId, personName: person ? person.nome : '',
    ticketId: t.id, ref: t.code, byUser: by, byName: actor ? actor.name : by, byRole: 'tecnico',
    summary: 'Repassado de ' + owner + ' para ' + target.user
  });
  broadcast();
  const persons = await store.persons.all();
  res.json(enrich(upd, persons));
}));

// Admin: forçar devolução à fila (destrava ticket “preso” em atendimento)
router.patch('/api/tickets/:id/force-return', auth(['admin']), ah(async (req, res) => {
  const t = await store.tickets.byId(req.params.id);
  if (!t) return res.status(404).json({ error: 'Ticket não encontrado' });
  if (t.status !== 'em_atendimento') return res.status(400).json({ error: 'Só é possível destravar tickets em atendimento.' });
  const prevOwner = String(t.tecnico || t.tecnicoUser || '').trim() || '—'; // captura antes do patch (file mode muta o objeto)
  const upd = await store.tickets.patch(t.id, {
    status: 'aguardando',
    tecnico: '', tecnicoUser: '', startedAt: null,
    called: false, calledAt: null, calledBy: ''
  });
  const person = await store.persons.byId(t.personId);
  await store.audit.insert({
    action: 'destravado', personId: t.personId, personName: person ? person.nome : '',
    ticketId: t.id, ref: t.code, byUser: req.auth.user, byName: req.auth.name, byRole: 'admin',
    summary: 'Admin devolveu à fila (estava com ' + prevOwner + ')'
  });
  broadcast();
  const persons = await store.persons.all();
  res.json(enrich(upd, persons));
}));

// Devolver atendimento para a fila de espera (somente o dono)
router.patch('/api/tickets/:id/return', auth(['tecnico']), ah(async (req, res) => {
  const t = await store.tickets.byId(req.params.id);
  if (!t) return res.status(404).json({ error: 'Ticket não encontrado' });
  if (t.status !== 'em_atendimento') return res.status(400).json({ error: 'Só é possível devolver tickets em atendimento.' });
  const owner = (ticketOwnerOf(t) || '').toLowerCase().trim();
  const by = String(req.auth.user).toLowerCase().trim();
  if (!owner || by !== owner) return res.status(403).json({ error: 'Somente o técnico vinculado (' + (t.tecnico || owner) + ') pode devolver este atendimento.' });
  const actor = await store.users.byName(req.auth.user);
  if (actor && actor.role === 'admin') return res.status(403).json({ error: 'Painel Técnico restrito ao Setor Técnico.' });
  let upd;
  try {
    upd = await store.tickets.patch(t.id, {
      status: 'aguardando',
      tecnico: '',
      tecnicoUser: '',
      startedAt: null,
      called: false,
      calledAt: null,
      calledBy: '',
      returnedAt: new Date().toISOString(),
      returnedBy: by
    });
  } catch (e) {
    if (e && e.message && /returned/i.test(e.message)) {
      upd = await store.tickets.patch(t.id, {
        status: 'aguardando',
        tecnico: '',
        tecnicoUser: '',
        startedAt: null,
        called: false,
        calledAt: null,
        calledBy: ''
      });
    } else throw e;
  }
  const person = await store.persons.byId(t.personId);
  await store.audit.insert({
    action: 'devolvido', personId: t.personId, personName: person ? person.nome : '',
    ticketId: t.id, ref: t.code, byUser: by, byName: actor ? actor.name : by, byRole: 'tecnico',
    summary: 'Devolvido à fila por ' + by
  });
  broadcast();
  const persons = await store.persons.all();
  res.json(enrich(upd, persons));
}));

module.exports = router;
