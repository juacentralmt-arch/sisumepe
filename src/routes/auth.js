const express = require('express');
const bcrypt = require('bcryptjs');
const shared = require('../lib/shared');
const { validate, loginSchema, passwordChangeSchema, userCreateSchema } = require('../lib/validation');
const { store, ah, auth, broadcast, issueToken, loginRateLimit, isHash, upload, mapFiles, sortQueue, enrich, enrichAll, ticketOwnerOf, infinityBlocked, PERSON_LABELS, MOTIVOS_OK, getGoogleConfig, makeOAuthClient, getAuthedClientForUser, syncAgendaToGoogle, pendingGoogleStates, ROOT, PORT, horarioComercialInfo, RECP_MSG, sessionCookie, clearSessionCookie } = shared;
const router = express.Router();

// Login / usuários
router.post('/api/login', loginRateLimit, validate(loginSchema), ah(async (req, res) => {
  const { user, pass } = req.body || {};
  const u = await store.users.byName(user);
  if (!u) {
    try { await store.audit.insert({ kind: 'auth', action: 'login_failed', byUser: String(user||'').toLowerCase().trim(), byName: String(user||''), byRole: 'desconhecido', summary: 'Usuário inexistente' }); } catch (e) {}
    return res.status(401).json({ error: 'Usuário ou senha inválidos' });
  }
  let ok = false;
  let mustChange = !!u.mustChangePassword;
  if (isHash(u.pass)) ok = await bcrypt.compare(String(pass || ''), u.pass);
  else if (u.pass === String(pass || '')) {
    ok = true;
    mustChange = true; // senha em texto puro = senha inicial conhecida
    await store.users.patch(u.user, { pass: await bcrypt.hash(String(pass || ''), 12), mustChangePassword: true }); // migra p/ hash
  }
  if (!ok) {
    try { await store.audit.insert({ kind: 'auth', action: 'login_failed', byUser: u.user, byName: u.name, byRole: u.role, summary: 'Senha incorreta' }); } catch (e) {}
    return res.status(401).json({ error: 'Usuário ou senha inválidos' });
  }
  if (u.active === false) return res.status(403).json({ error: 'Usuário desativado. Fale com o administrador.' });
  // Recepção só entra em horário comercial (seg–sex, 8h–12h e 13h–17h, America/Fortaleza)
  if (u.role === 'recepcao' && !horarioComercialInfo().emHorario)
    return res.status(403).json({ error: RECP_MSG });
  const token = await issueToken({ ...u, mustChangePassword: mustChange });
  // Sessão via cookie httpOnly (SameSite=Strict). O token continua na
  // resposta apenas para clientes legados; o SPA não o persiste mais.
  res.setHeader('Set-Cookie', sessionCookie(token));
  try {
    await store.users.patch(u.user, { lastLoginAt: new Date().toISOString() });
    await store.audit.insert({ kind: 'auth', action: 'login', byUser: u.user, byName: u.name, byRole: u.role, summary: 'Login bem-sucedido' });
  } catch (e) {}
  const sistema = u.sistema || (u.user && require('../../store').getUserSistema ? require('../../store').getUserSistema(u) : null);
  res.json({ user: u.user, role: u.role, name: u.name, sistema: u.role==='admin' ? null : sistema, token, mustChangePassword: mustChange });
}));

router.post('/api/logout', auth(), ah(async (req, res) => {
  const t = req.auth && req.auth.token ? req.auth.token : (req.headers['x-session'] || '');
  if(t) await store.sessions.del(t);
  try { await store.audit.insert({ kind: 'auth', action: 'logout', byUser: req.auth.user, byName: req.auth.name, byRole: req.auth.role, summary: 'Logout' }); } catch (e) {}
  res.setHeader('Set-Cookie', clearSessionCookie());
  res.json({ ok: true });
}));

router.get('/api/users', auth(), ah(async (req, res) => {
  // Chat precisa listar usuários para todos autenticados (apenas user/name/role, sem PII sensível)
  const list = await store.users.all();
  res.json(list.map(u => ({ user: u.user, name: u.name, role: u.role, active: u.active !== false })));
}));

router.patch('/api/users/me/password', auth(), validate(passwordChangeSchema), ah(async (req, res) => {
  const { current, next } = req.body || {};
  const u = await store.users.byName(req.auth.user);
  if (!u) return res.status(401).json({ error: 'Sessão inválida' });
  let ok = false;
  if (isHash(u.pass)) ok = await bcrypt.compare(String(current || ''), u.pass);
  else ok = u.pass === String(current || '');
  if (!ok) return res.status(401).json({ error: 'Senha atual incorreta' });
  if (!next || String(next).length < 8) return res.status(400).json({ error: 'Nova senha deve ter ao menos 8 caracteres' });
  if (String(next).length > 128) return res.status(400).json({ error: 'Nova senha muito longa' });
  if (!/(?=.*[A-Za-z])(?=.*\d)/.test(String(next))) return res.status(400).json({ error: 'Senha deve conter letras e números' });
  await store.users.patch(u.user, { pass: await bcrypt.hash(String(next), 12), mustChangePassword: false });
  // Invalida todas as sessões (inclusive a atual) e emite uma nova já liberada.
  await store.sessions.delByUser(u.user);
  const token = await issueToken({ ...u, mustChangePassword: false });
  res.setHeader('Set-Cookie', sessionCookie(token));
  res.json({ ok: true, token, mustChangePassword: false });
}));

router.post('/api/users', auth(['admin']), validate(userCreateSchema), ah(async (req, res) => {
  const admin = req.auth;
  const { user, name, role, pass } = req.body || {};
  const id = String(user || '').toLowerCase().trim().replace(/\s+/g, '');
  if (!id || !name || !pass) return res.status(400).json({ error: 'Usuário, nome e senha são obrigatórios' });
  if (String(pass).length < 8) return res.status(400).json({ error: 'Senha deve ter ao menos 8 caracteres' });
  if (!['recepcao', 'tecnico', 'psico', 'admin'].includes(role)) return res.status(400).json({ error: 'Perfil inválido' });
  if (await store.users.byName(id)) return res.status(409).json({ error: 'Usuário já existe' });
  await store.users.insert({ user: id, name: String(name).trim(), role, pass: await bcrypt.hash(String(pass), 12), active: true, mustChangePassword: true });
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
  if (!pass || String(pass).length < 8) return res.status(400).json({ error: 'Nova senha deve ter ao menos 8 caracteres' });
  if (!/(?=.*[A-Za-z])(?=.*\d)/.test(String(pass))) return res.status(400).json({ error: 'Senha deve conter letras e números' });
  await store.users.patch(u.user, { pass: await bcrypt.hash(String(pass), 12), mustChangePassword: true });
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
