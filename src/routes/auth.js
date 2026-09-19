const express = require('express');
const bcrypt = require('bcryptjs');
const shared = require('../lib/shared');
const { store, ah, auth, broadcast, issueToken, loginRateLimit, isHash, upload, mapFiles, sortQueue, enrich, enrichAll, ticketOwnerOf, infinityBlocked, PERSON_LABELS, MOTIVOS_OK, getGoogleConfig, makeOAuthClient, getAuthedClientForUser, syncAgendaToGoogle, pendingGoogleStates, ROOT, PORT } = shared;
const router = express.Router();

// Login / usuários
router.post('/api/login', loginRateLimit, ah(async (req, res) => {
  const { user, pass } = req.body || {};
  const u = await store.users.byName(user);
  if (!u) return res.status(401).json({ error: 'Usuário ou senha inválidos' });
  let ok = false;
  if (isHash(u.pass)) ok = await bcrypt.compare(String(pass || ''), u.pass);
  else if (u.pass === String(pass || '')) {
    ok = true;
    await store.users.patch(u.user, { pass: await bcrypt.hash(String(pass || ''), 10) }); // migra p/ hash
  }
  if (!ok) return res.status(401).json({ error: 'Usuário ou senha inválidos' });
  if (u.active === false) return res.status(403).json({ error: 'Usuário desativado. Fale com o administrador.' });
  res.json({ user: u.user, role: u.role, name: u.name, token: await issueToken(u) });
}));

router.post('/api/logout', auth(), ah(async (req, res) => {
  const t = req.headers['x-session'] || req.query.token;
  await store.sessions.del(t);
  res.json({ ok: true });
}));

router.get('/api/users', auth(), ah(async (req, res) => {
  const list = await store.users.all();
  res.json(list.map(u => ({ user: u.user, name: u.name, role: u.role, active: u.active !== false })));
}));

router.patch('/api/users/me/password', auth(), ah(async (req, res) => {
  const { current, next } = req.body || {};
  const u = await store.users.byName(req.auth.user);
  if (!u) return res.status(401).json({ error: 'Sessão inválida' });
  let ok = false;
  if (isHash(u.pass)) ok = await bcrypt.compare(String(current || ''), u.pass);
  else ok = u.pass === String(current || '');
  if (!ok) return res.status(401).json({ error: 'Senha atual incorreta' });
  if (!next || String(next).length < 4) return res.status(400).json({ error: 'Nova senha deve ter ao menos 4 caracteres' });
  await store.users.patch(u.user, { pass: await bcrypt.hash(String(next), 10) });
  const currentToken = req.headers['x-session'] || req.query.token;
  await store.sessions.delByUser(u.user, currentToken); // mantém a sessão atual, mata as demais
  res.json({ ok: true });
}));

router.post('/api/users', auth(['admin']), ah(async (req, res) => {
  const admin = req.auth;
  const { user, name, role, pass } = req.body || {};
  const id = String(user || '').toLowerCase().trim().replace(/\s+/g, '');
  if (!id || !name || !pass) return res.status(400).json({ error: 'Usuário, nome e senha são obrigatórios' });
  if (!['recepcao', 'tecnico', 'psico', 'admin'].includes(role)) return res.status(400).json({ error: 'Perfil inválido' });
  if (await store.users.byName(id)) return res.status(409).json({ error: 'Usuário já existe' });
  await store.users.insert({ user: id, name: String(name).trim(), role, pass: await bcrypt.hash(String(pass), 10), active: true });
  broadcast();
  res.status(201).json({ user: id, name: String(name).trim(), role });
}));

router.delete('/api/users/:user', auth(['admin']), ah(async (req, res) => {
  const admin = req.auth;
  const target = String(req.params.user).toLowerCase().trim();
  if (target === admin.user) return res.status(400).json({ error: 'Você não pode remover seu próprio usuário' });
  const u = await store.users.byName(target);
  if (!u) return res.status(404).json({ error: 'Usuário não encontrado' });
  const all = await store.users.all();
  if (u.role === 'admin' && all.filter(x => x.role === 'admin' && x.active !== false && x.user !== u.user).length < 1)
    return res.status(400).json({ error: 'Não é possível remover o último administrador' });
  await store.users.remove(target);
  await store.sessions.delByUser(target); // usuário removido: desconecta
  broadcast();
  res.json({ ok: true });
}));

router.patch('/api/users/:user/password', auth(['admin']), ah(async (req, res) => {
  const u = await store.users.byName(req.params.user);
  if (!u) return res.status(404).json({ error: 'Usuário não encontrado' });
  const { pass } = req.body || {};
  if (!pass || String(pass).length < 4) return res.status(400).json({ error: 'Nova senha deve ter ao menos 4 caracteres' });
  await store.users.patch(u.user, { pass: await bcrypt.hash(String(pass), 10) });
  await store.sessions.delByUser(u.user); // senha trocada pelo admin: desconecta o usuário
  res.json({ ok: true });
}));

router.patch('/api/users/:user', auth(['admin']), ah(async (req, res) => {
  const admin = req.auth;
  const u = await store.users.byName(req.params.user);
  if (!u) return res.status(404).json({ error: 'Usuário não encontrado' });
  const { name, role, active } = req.body || {};
  const all = await store.users.all();
  const stayingAdmin = (role || u.role) === 'admin' && active !== false;
  if (u.role === 'admin' && !stayingAdmin && all.filter(x => x.role === 'admin' && x.active !== false && x.user !== u.user).length < 1)
    return res.status(400).json({ error: 'Deve existir ao menos um administrador ativo' });
  if (u.user === admin.user && active === false)
    return res.status(400).json({ error: 'Você não pode desativar seu próprio usuário' });
  const fields = {};
  if (name && String(name).trim()) fields.name = String(name).trim();
  if (['recepcao', 'tecnico', 'psico', 'admin'].includes(role)) fields.role = role;
  if (active !== undefined) fields.active = active !== false;
  const upd = await store.users.patch(u.user, fields);
  // Desativação ou mudança de perfil: derruba sessões (permissões antigas morrem junto)
  if (fields.active === false || fields.role) await store.sessions.delByUser(u.user);
  broadcast();
  res.json({ user: upd.user, name: upd.name, role: upd.role, active: upd.active !== false });
}));

module.exports = router;
