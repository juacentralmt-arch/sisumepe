const express = require('express');
const shared = require('../lib/shared');
const calendly = require('../lib/calendly');
const { store, ah, authAgenda } = shared;
const router = express.Router();

// ============ CALENDLY (parte do módulo Agenda: andre, daniel e admin) ============

// Situação da conexão + conta vinculada
router.get('/api/agenda/calendly/status', authAgenda(), ah(async (req, res) => {
  try {
    res.json(await calendly.getStatus());
  } catch (e) {
    res.json({ configured: calendly.isConfigured(), publicUrl: calendly.publicUrl() || null, error: String((e && e.message) || e) });
  }
}));

// Tipos de evento (links de agendamento) da conta vinculada
router.get('/api/agenda/calendly/tipos', authAgenda(), ah(async (req, res) => {
  res.json(await calendly.listEventTypes());
}));

// Próximos agendamentos no Calendly (?de=ISO & ?ate=ISO, padrão: agora → +60 dias)
router.get('/api/agenda/calendly/eventos', authAgenda(), ah(async (req, res) => {
  const { de, ate, convidados } = req.query;
  const list = await calendly.listUpcomingEvents({ from: de || undefined, to: ate || undefined, withInvitees: convidados !== '0' });
  // marca os já importados para a agenda local
  let known = new Set();
  try {
    const existing = await store.agenda.allByUser(req.auth.user);
    known = new Set(existing.map(e => e.calendlyUri).filter(Boolean));
  } catch {}
  res.json(list.map(e => ({ ...e, importado: known.has(e.calendlyUri) })));
}));

// Importa agendamentos do Calendly para a agenda local (idempotente).
// body: { uris?: string[] } — vazio = importa todos os próximos.
router.post('/api/agenda/calendly/importar', authAgenda(), ah(async (req, res) => {
  if(!calendly.isConfigured()) return res.status(503).json({ error: 'Calendly não configurado (CALENDLY_TOKEN no servidor).' });
  const { uris, de, ate } = req.body || {};
  const r = await calendly.importEvents(store, req.auth.user, { uris, from: de, to: ate });
  shared.broadcast();
  res.json({ ok: true, ...r });
}));

module.exports = router;
