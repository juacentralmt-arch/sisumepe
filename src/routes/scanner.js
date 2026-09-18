const express = require('express');
const { store, ah, auth, broadcast, upload, consolidateTicketFiles, pdfPrefixForMotivo, infinityBlocked } = require('../lib/shared');
const router = express.Router();

// Scanner do técnico: une as páginas (imagens) em UM único PDF.
// Com ticketId: anexa o PDF ao ticket (somente o técnico vinculado, em atendimento).
router.post('/api/scanner/pdf', auth(['tecnico', 'admin']), upload.array('pages', 20), ah(async (req, res) => {
  const pages = (req.files || []).filter(f => String(f.mimetype || '').startsWith('image/'));
  if (!pages.length) return res.status(400).json({ error: 'Adicione ao menos 1 página (imagem)' });
  const { ticketId } = req.body || {};
  let ticket = null;
  let prefix = 'scanner';
  if (ticketId) {
    ticket = await store.tickets.byId(ticketId);
    if (!ticket) return res.status(404).json({ error: 'Ticket não encontrado' });
    if (ticket.status !== 'em_atendimento') return res.status(400).json({ error: 'Só é possível anexar em tickets em atendimento' });
    const owner = String(ticket.tecnicoUser || '').toLowerCase().trim();
    if (!owner || owner !== String(req.auth.user).toLowerCase().trim())
      return res.status(403).json({ error: 'Somente o técnico vinculado pode anexar neste ticket' });
    const actor = await store.users.byName(req.auth.user);
    if (actor && actor.role === 'admin') return res.status(403).json({ error: 'Painel Técnico restrito ao Setor Técnico.' });
    const block = infinityBlocked(ticket, actor);
    if (block) return res.status(403).json({ error: block });
    prefix = pdfPrefixForMotivo(ticket.motivo, 'scanner');
  }
  const consolidated = await consolidateTicketFiles(pages, prefix);
  const up = await store.saveFileUpload(consolidated.files[0]);
  let record = up;
  let attachedTo = null;
  if (ticket) {
    record = { ...up, name: prefix + '-' + ticket.code + '.pdf' };
    await store.tickets.patch(ticket.id, { fotosPos: (ticket.fotosPos || []).concat([record]).slice(-20) });
    const person = await store.persons.byId(ticket.personId);
    await store.audit.insert({
      action: 'scanner', personId: ticket.personId, personName: person ? person.nome : '',
      ticketId: ticket.id, ref: ticket.code, byUser: req.auth.user, byName: ticket.tecnico, byRole: 'tecnico',
      summary: 'Documento digitalizado anexado (' + pages.length + (pages.length > 1 ? ' páginas)' : ' página)')
    });
    attachedTo = ticket.code;
    broadcast();
  }
  res.status(201).json({ pdf: record, attachedTo });
}));

module.exports = router;
