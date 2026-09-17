const express = require('express');
const shared = require('../lib/shared');
const { store, ah, auth, broadcast, issueToken, loginRateLimit, isHash, upload, mapFiles, sortQueue, enrich, enrichAll, ticketOwnerOf, infinityBlocked, PERSON_LABELS, MOTIVOS_OK, getGoogleConfig, makeOAuthClient, getAuthedClientForUser, syncAgendaToGoogle, pendingGoogleStates, ROOT, PORT } = shared;
const router = express.Router();

// Chat
router.get('/api/chat', auth(), ah(async (req, res) => {
  const me = req.auth.user;
  const { beforeId, limit: reqLimit, q, to: convo, paginated } = req.query;
  const maxLimit = Math.min(Math.max(parseInt(reqLimit, 10) || 50, 1), 100);
  let list = await store.chat.list();

  list = list.filter(m => {
    const to = String(m.to || 'todos').toLowerCase();
    if (to === 'todos') return true;
    return !!me && (m.user === me || to === me);
  });

  if (convo) {
    const targetConvo = String(convo).toLowerCase();
    if (targetConvo === 'todos') {
      list = list.filter(m => String(m.to || 'todos').toLowerCase() === 'todos');
    } else {
      list = list.filter(m => {
        const to = String(m.to || 'todos').toLowerCase();
        return (m.user === me && to === targetConvo) || (m.user === targetConvo && to === me);
      });
    }
  }

  if (q && String(q).trim()) {
    const term = String(q).trim().toLowerCase();
    list = list.filter(m => (m.text && m.text.toLowerCase().includes(term)) || (m.name && m.name.toLowerCase().includes(term)));
  }

  if (beforeId) {
    const cutoff = Number(beforeId);
    if (!isNaN(cutoff) && cutoff > 0) {
      list = list.filter(m => m.id < cutoff);
    }
  }

  if (paginated === 'true' || beforeId || q) {
    const total = list.length;
    const result = list.slice(-maxLimit);
    return res.json({
      messages: result,
      hasMore: total > maxLimit,
      firstId: result.length ? result[0].id : null
    });
  }

  res.json(list.slice(-100));
}));

router.post('/api/chat/typing', auth(), (req, res) => {
  const { to, isTyping } = req.body || {};
  broadcast({ type: 'chat_typing', from: req.auth.user, to: to || 'todos', isTyping: !!isTyping });
  res.json({ ok: true });
});

router.post('/api/chat/read', auth(), (req, res) => {
  const { to, lastReadId } = req.body || {};
  broadcast({ type: 'chat_read', from: req.auth.user, to: to || 'todos', lastReadId: Number(lastReadId) || 0 });
  res.json({ ok: true });
});

router.post('/api/chat', auth(), upload.array('arquivos', 5), ah(async (req, res) => {
  const { text } = req.body || {};
  const u = await store.users.byName(req.auth.user);
  if (!u) return res.status(401).json({ error: 'Sessão inválida' });
  const files = await mapFiles(req.files);
  const cleanText = String(text || '').trim().slice(0, 1000);
  if (!cleanText && !files.length) return res.status(400).json({ error: 'Escreva uma mensagem ou anexe um arquivo' });
  let to = String((req.body && req.body.to) || 'todos').toLowerCase().trim();
  if (to !== 'todos' && !(await store.users.byName(to))) return res.status(400).json({ error: 'Destinatário inválido' });
  const msg = await store.chat.insert({
    user: u.user, name: u.name, role: u.role, to,
    text: cleanText, anexos: files, at: new Date().toISOString()
  });
  broadcast({ type: 'chat_msg', msg });
  broadcast({ type: 'update', at: Date.now() });
  res.status(201).json(msg);
}));

module.exports = router;
