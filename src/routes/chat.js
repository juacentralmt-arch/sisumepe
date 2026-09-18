const express = require('express');
const { store, ah, auth, broadcast, upload, mapFiles, MAX_ANEXOS_CHAT, MAX_TEXT_LEN } = require('../lib/shared');
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

// Sinalização de chamadas de voz (WebRTC 1:1) — retransmite via SSE
// + fila curta por usuário (fallback caso o SSE do destino esteja caído)
const CALL_KINDS = ['offer', 'answer', 'ice', 'reject', 'busy', 'end', 'ringing'];
const pendingCalls = new Map(); // user -> [{id, from, fromName, signal, at}]
const CALL_TTL = 60e3;
function queueCallSignal(to, item) {
  const q = pendingCalls.get(to) || [];
  q.push(item);
  while (q.length > 5) q.shift();
  pendingCalls.set(to, q);
  setTimeout(() => {
    const cur = pendingCalls.get(to) || [];
    const i = cur.indexOf(item);
    if (i >= 0) cur.splice(i, 1);
  }, CALL_TTL).unref();
}
router.get('/api/call/pending', auth(), (req, res) => {
  const q = pendingCalls.get(req.auth.user) || [];
  pendingCalls.set(req.auth.user, []);
  res.json(q.filter(i => Date.now() - i.at < CALL_TTL));
});
router.post('/api/call/signal', auth(), ah(async (req, res) => {
  const { to, kind, sdp, candidate } = req.body || {};
  if (!CALL_KINDS.includes(kind)) return res.status(400).json({ error: 'Sinal inválido' });
  const target = String(to || '').toLowerCase().trim();
  if (!target) return res.status(400).json({ error: 'Destinatário inválido' });
  if (target === req.auth.user) return res.status(400).json({ error: 'Não é possível ligar para você mesmo' });
  const u = await store.users.byName(target);
  if (!u || u.active === false) return res.status(404).json({ error: 'Usuário indisponível' });
  const me = await store.users.byName(req.auth.user);
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const signal = { kind, sdp: sdp || null, candidate: candidate || null };
  broadcast({ type: 'call_signal', id, from: req.auth.user, fromName: me ? me.name : req.auth.user, to: target, signal });
  queueCallSignal(target, { id, from: req.auth.user, fromName: me ? me.name : req.auth.user, signal, at: Date.now() });
  res.json({ ok: true });
}));

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
