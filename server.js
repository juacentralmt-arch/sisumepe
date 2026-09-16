require('dotenv').config();
const express = require('express');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const store = require('./store');

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

app.disable('x-powered-by');
app.set('trust proxy', 1);

// Cabeçalhos de segurança
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=()');
  next();
});
// HTTPS em produção (Render)
if (process.env.FORCE_HTTPS === '1') {
  app.use((req, res, next) => {
    if (req.headers['x-forwarded-proto'] && req.headers['x-forwarded-proto'] !== 'https')
      return res.redirect('https://' + req.headers.host + req.url);
    next();
  });
}

// Anti força-bruta no login: 10 tentativas / 5 min por IP
const loginHits = new Map();
function loginRateLimit(req, res, next) {
  const ip = req.ip || '?';
  const now = Date.now();
  const h = loginHits.get(ip) || { n: 0, reset: now + 5 * 60e3 };
  if (now > h.reset) { h.n = 0; h.reset = now + 5 * 60e3; }
  h.n++;
  loginHits.set(ip, h);
  if (h.n > 10) return res.status(429).json({ error: 'Muitas tentativas. Aguarde 5 minutos.' });
  next();
}

// Sessões por token (12h, persistentes no banco). O servidor NUNCA confia no usuário vindo do app.
async function issueToken(u) {
  const token = crypto.randomBytes(32).toString('hex');
  await store.sessions.insert(token, { user: u.user, role: u.role, name: u.name, exp: Date.now() + 12 * 3600e3 });
  return token;
}
setInterval(() => { store.sessions.cleanup().catch(() => {}); }, 3600e3).unref();
function auth(roles) {
  return (req, res, next) => {
    const t = req.headers['x-session'] || req.query.token;
    if (!t) return res.status(401).json({ error: 'Sessão expirada. Entre novamente.' });
    store.sessions.get(t).then(s => {
      if (!s || s.exp < Date.now()) { store.sessions.del(t).catch(() => {}); return res.status(401).json({ error: 'Sessão expirada. Entre novamente.' }); }
      req.auth = s;
      if (roles && roles.length && !roles.includes(s.role)) return res.status(403).json({ error: 'Acesso restrito ao seu perfil.' });
      next();
    }).catch(() => res.status(401).json({ error: 'Sessão expirada. Entre novamente.' }));
  };
}
const isHash = p => typeof p === 'string' && /^\$2[aby]\$/.test(p);

const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(e => {
  console.error(e);
  const code = e.status || 500;
  res.status(code).json({ error: code === 500 ? 'Erro interno. Tente de novo.' : (e.message || 'Erro') });
});

// SSE clients
let sseClients = [];
function broadcast() {
  const payload = JSON.stringify({ type: 'update', at: Date.now() });
  sseClients.forEach(res => { try { res.write(`data: ${payload}\n\n`); } catch {} });
}

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(ROOT, 'public')));
app.use('/uploads', express.static(path.join(ROOT, 'uploads')));

// Uploads em memória -> disco local (file) ou Supabase Storage (supabase)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 5 } });
async function mapFiles(files) {
  const out = [];
  for (const f of (files || [])) out.push(await store.saveFileUpload(f));
  return out;
}

function sortQueue(list) {
  return [...list].sort((a, b) => {
    if (!!a.prioridadeLegal !== !!b.prioridadeLegal) return a.prioridadeLegal ? -1 : 1;
    return new Date(a.createdAt) - new Date(b.createdAt);
  });
}
function enrich(t, persons) {
  const p = (persons || []).find(x => String(x.id) === String(t.personId));
  return { ...t, person: p || null };
}
async function enrichAll(list) {
  const persons = await store.persons.all();
  return list.map(t => enrich(t, persons));
}
function ticketOwnerOf(t) {
  if (t.tecnicoUser) return String(t.tecnicoUser);
  const m = String(t.tecnico || '').match(/\(\s*([^)]+?)\s*\)\s*$/);
  return m ? m[1] : '';
}
// Regra Infinity: só o Júlio (ou admin) assume tickets de tornozeleira Infinity
function infinityBlocked(ticket, actor) {
  if (!ticket || ticket.modeloTornozeleira !== 'Infinity') return null;
  const u = actor && actor.user ? actor.user : '';
  const role = actor && actor.role ? actor.role : '';
  if (u === 'julio' || role === 'admin') return null;
  return 'Ticket de tornozeleira Infinity: somente o técnico Júlio Cesar pode assumir.';
}
const PERSON_LABELS = { nome: 'Nome', cpf: 'CPF', rg: 'RG', nomeMae: 'Nome da mãe', dataNascimento: 'Data de nascimento', modeloTornozeleira: 'Modelo da tornozeleira' };
const MOTIVOS_OK = ['Botão do Pânico', 'Instalação de Tornozeleira', 'Retirada de Tornozeleira', 'Manutenção', 'Outros'];

// --- API ---
app.get('/api/health', (req, res) => res.json({ ok: true, store: store.mode }));

app.get('/api/events', auth(), (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
  sseClients.push(res);
  req.on('close', () => { sseClients = sseClients.filter(c => c !== res); });
});

// Login / usuários
app.post('/api/login', loginRateLimit, ah(async (req, res) => {
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

app.post('/api/logout', auth(), ah(async (req, res) => {
  const t = req.headers['x-session'] || req.query.token;
  await store.sessions.del(t);
  res.json({ ok: true });
}));

app.get('/api/users', auth(), ah(async (req, res) => {
  const list = await store.users.all();
  res.json(list.map(u => ({ user: u.user, name: u.name, role: u.role, active: u.active !== false })));
}));

app.patch('/api/users/me/password', auth(), ah(async (req, res) => {
  const { current, next } = req.body || {};
  const u = await store.users.byName(req.auth.user);
  if (!u) return res.status(401).json({ error: 'Sessão inválida' });
  let ok = false;
  if (isHash(u.pass)) ok = await bcrypt.compare(String(current || ''), u.pass);
  else ok = u.pass === String(current || '');
  if (!ok) return res.status(401).json({ error: 'Senha atual incorreta' });
  if (!next || String(next).length < 4) return res.status(400).json({ error: 'Nova senha deve ter ao menos 4 caracteres' });
  await store.users.patch(u.user, { pass: await bcrypt.hash(String(next), 10) });
  res.json({ ok: true });
}));

app.post('/api/users', auth(['admin']), ah(async (req, res) => {
  const admin = req.auth;
  const { user, name, role, pass } = req.body || {};
  const id = String(user || '').toLowerCase().trim().replace(/\s+/g, '');
  if (!id || !name || !pass) return res.status(400).json({ error: 'Usuário, nome e senha são obrigatórios' });
  if (!['recepcao', 'tecnico', 'admin'].includes(role)) return res.status(400).json({ error: 'Perfil inválido' });
  if (await store.users.byName(id)) return res.status(409).json({ error: 'Usuário já existe' });
  await store.users.insert({ user: id, name: String(name).trim(), role, pass: await bcrypt.hash(String(pass), 10), active: true });
  broadcast();
  res.status(201).json({ user: id, name: String(name).trim(), role });
}));

app.delete('/api/users/:user', auth(['admin']), ah(async (req, res) => {
  const admin = req.auth;
  const target = String(req.params.user).toLowerCase().trim();
  if (target === admin.user) return res.status(400).json({ error: 'Você não pode remover seu próprio usuário' });
  const u = await store.users.byName(target);
  if (!u) return res.status(404).json({ error: 'Usuário não encontrado' });
  const all = await store.users.all();
  if (u.role === 'admin' && all.filter(x => x.role === 'admin' && x.active !== false && x.user !== u.user).length < 1)
    return res.status(400).json({ error: 'Não é possível remover o último administrador' });
  await store.users.remove(target);
  broadcast();
  res.json({ ok: true });
}));

app.patch('/api/users/:user/password', auth(['admin']), ah(async (req, res) => {
  const u = await store.users.byName(req.params.user);
  if (!u) return res.status(404).json({ error: 'Usuário não encontrado' });
  const { pass } = req.body || {};
  if (!pass || String(pass).length < 4) return res.status(400).json({ error: 'Nova senha deve ter ao menos 4 caracteres' });
  await store.users.patch(u.user, { pass: await bcrypt.hash(String(pass), 10) });
  res.json({ ok: true });
}));

app.patch('/api/users/:user', auth(['admin']), ah(async (req, res) => {
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
  if (['recepcao', 'tecnico', 'admin'].includes(role)) fields.role = role;
  if (active !== undefined) fields.active = active !== false;
  const upd = await store.users.patch(u.user, fields);
  broadcast();
  res.json({ user: upd.user, name: upd.name, role: upd.role, active: upd.active !== false });
}));

// Chat
app.get('/api/chat', auth(), ah(async (req, res) => {
  const me = req.auth.user;
  const list = await store.chat.list();
  res.json(list.filter(m => {
    const to = String(m.to || 'todos').toLowerCase();
    if (to === 'todos') return true;
    return !!me && (m.user === me || to === me);
  }).slice(-100));
}));

app.post('/api/chat', auth(), upload.array('arquivos', 5), ah(async (req, res) => {
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
  broadcast();
  res.status(201).json(msg);
}));

// Persons
app.get('/api/persons', auth(), ah(async (req, res) => {
  res.json(await store.persons.search(req.query.q || ''));
}));

app.get('/api/persons/:id', auth(['tecnico', 'admin']), ah(async (req, res) => {
  const p = await store.persons.byId(req.params.id);
  if (!p) return res.status(404).json({ error: 'Não encontrado' });
  const all = await store.tickets.all();
  const persons = await store.persons.all();
  const tickets = all.filter(t => String(t.personId) === String(p.id)).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const audit = await store.audit.byPerson(p.id);
  res.json({ person: p, tickets: tickets.map(t => enrich(t, persons)), audit });
}));

app.post('/api/persons', auth(), ah(async (req, res) => {
  const { nome, cpf, rg, nomeMae, dataNascimento, modeloTornozeleira } = req.body || {};
  if (!nome || !nome.trim()) return res.status(400).json({ error: 'Nome é obrigatório' });
  if (!cpf && !rg) return res.status(400).json({ error: 'Informe CPF ou RG' });
  if (!['Spacecom', 'Infinity'].includes(modeloTornozeleira)) return res.status(400).json({ error: 'Selecione o modelo da tornozeleira (Spacecom ou Infinity)' });
  const cpfN = (cpf || '').replace(/\D/g, '');
  const all = await store.persons.all();
  const dup = all.find(p => (cpfN && p.cpfN === cpfN) || (rg && p.rg === rg));
  if (dup) return res.status(409).json({ error: 'CPF/RG já cadastrado', person: dup });
  const person = await store.persons.insert({
    nome: nome.trim(), cpf: (cpf || '').trim(), cpfN,
    rg: (rg || '').trim(), nomeMae: (nomeMae || '').trim(),
    dataNascimento: dataNascimento || '', modeloTornozeleira,
    createdAt: new Date().toISOString()
  });
  broadcast();
  res.status(201).json(person);
}));

app.patch('/api/persons/:id', auth(), ah(async (req, res) => {
  const p = await store.persons.byId(req.params.id);
  if (!p) return res.status(404).json({ error: 'Atendido não encontrado' });
  const editor = await store.users.byName(req.auth.user);
  if (!editor) return res.status(401).json({ error: 'Sessão inválida' });
  const fields = ['nome', 'cpf', 'rg', 'nomeMae', 'dataNascimento', 'modeloTornozeleira'];
  const next = {};
  fields.forEach(f => { next[f] = f === 'dataNascimento' ? String((req.body && req.body[f]) || '') : String((req.body && req.body[f]) || '').trim(); });
  if (!next.nome) return res.status(400).json({ error: 'Nome é obrigatório' });
  if (!next.cpf && !next.rg) return res.status(400).json({ error: 'Informe CPF ou RG' });
  if (!['Spacecom', 'Infinity'].includes(next.modeloTornozeleira)) return res.status(400).json({ error: 'Selecione o modelo da tornozeleira (Spacecom ou Infinity)' });
  const cpfN = next.cpf.replace(/\D/g, '');
  const all = await store.persons.all();
  const dup = all.find(x => String(x.id) !== String(p.id) && ((cpfN && x.cpfN === cpfN) || (next.rg && x.rg === next.rg)));
  if (dup) return res.status(409).json({ error: 'CPF/RG já usado por: ' + dup.nome });
  const changes = [];
  fields.forEach(f => {
    const from = p[f] || '', to = next[f] || '';
    if (from !== to) changes.push({ field: f, label: PERSON_LABELS[f], from, to });
  });
  if (!changes.length) return res.status(400).json({ error: 'Nenhuma alteração detectada' });
  const upd = await store.persons.patch(p.id, { ...next, cpfN });
  await store.audit.insert({
    kind: 'cadastro', personId: p.id, personName: upd.nome,
    byUser: editor.user, byName: editor.name, byRole: editor.role, changes
  });
  broadcast();
  res.json({ person: upd, changes });
}));

// Tickets
app.get('/api/tickets', auth(), ah(async (req, res) => {
  const status = req.query.status;
  let list = await enrichAll(await store.tickets.all());
  if (status && status !== 'todos') list = list.filter(t => t.status === status);
  const active = list.filter(t => t.status !== 'finalizado');
  const done = list.filter(t => t.status === 'finalizado').sort((a, b) => new Date(b.finishedAt || b.createdAt) - new Date(a.finishedAt || a.createdAt));
  res.json([...sortQueue(active), ...done]);
}));

app.get('/api/stats', auth(), ah(async (req, res) => {
  const all = await store.tickets.all();
  const persons = await store.persons.all();
  res.json({
    aguardando: all.filter(t => t.status === 'aguardando').length,
    em_atendimento: all.filter(t => t.status === 'em_atendimento').length,
    finalizados: all.filter(t => t.status === 'finalizado').length,
    totalPessoas: persons.length
  });
}));

app.post('/api/tickets', auth(), upload.array('anexos', 5), ah(async (req, res) => {
  const { personId, motivo, descricao, prioridadeLegal, tecnicoRecepcao, modeloTornozeleira } = req.body || {};
  const person = await store.persons.byId(personId);
  if (!person) return res.status(400).json({ error: 'Atendido inválido. Selecione ou cadastre a pessoa.' });
  if (!motivo) return res.status(400).json({ error: 'Motivo é obrigatório' });
  if (!modeloTornozeleira) return res.status(400).json({ error: 'Selecione o modelo da tornozeleira (Spacecom ou Infinity)' });
  const files = await mapFiles(req.files);
  const creator = await store.users.byName(req.auth.user);
  const ticket = await store.tickets.insert({
    personId: person.id,
    motivo, descricao: descricao || '',
    prioridadeLegal: String(prioridadeLegal) === 'true' || prioridadeLegal === true || prioridadeLegal === '1',
    modeloTornozeleira,
    status: 'aguardando',
    anexos: files,
    tecnicoRecepcao: tecnicoRecepcao || '',
    tecnico: '', tecnicoUser: '', relatorio: '',
    createdBy: creator ? creator.user : req.auth.user,
    createdByName: creator ? creator.name : req.auth.name,
    called: false, calledAt: null, calledBy: '',
    createdAt: new Date().toISOString(), startedAt: null, finishedAt: null
  });
  if (modeloTornozeleira && person.modeloTornozeleira !== modeloTornozeleira) {
    const fromMod = person.modeloTornozeleira || '';
    await store.persons.patch(person.id, { modeloTornozeleira });
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

app.patch('/api/tickets/:id/start', auth(['tecnico']), ah(async (req, res) => {
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

app.patch('/api/tickets/:id/finish', auth(['tecnico']), upload.array('fotos', 4), ah(async (req, res) => {
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
  const pos = await mapFiles(req.files);
  const upd = await store.tickets.patch(t.id, {
    status: 'finalizado',
    relatorio: relatorio.trim(),
    tecnico: t.tecnico,
    ...(cl ? { checklist: { sinal: !!cl.sinal, bateria: !!cl.bateria, pulseira: !!cl.pulseira, orientacao: !!cl.orientacao } } : {}),
    fotosPos: (t.fotosPos || []).concat(pos).slice(-8),
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

app.patch('/api/tickets/:id/call', auth(['tecnico']), ah(async (req, res) => {
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

app.patch('/api/tickets/:id/edit', auth(['recepcao', 'admin']), ah(async (req, res) => {
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

app.patch('/api/tickets/:id/cancel', auth(['recepcao', 'admin']), ah(async (req, res) => {
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

app.patch('/api/tickets/:id/reopen', auth(['tecnico']), ah(async (req, res) => {
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
app.patch('/api/tickets/:id/transfer', auth(['tecnico']), ah(async (req, res) => {
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

// Devolver atendimento para a fila de espera (somente o dono)
app.patch('/api/tickets/:id/return', auth(['tecnico']), ah(async (req, res) => {
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

// Auditoria / dashboard / backup
app.get('/api/audit', auth(['tecnico', 'admin']), ah(async (req, res) => {
  res.json(await store.audit.recent(req.query.limit));
}));

app.get('/api/dashboard', auth(['tecnico', 'admin']), ah(async (req, res) => {
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

app.get('/api/backup', auth(['admin']), ah(async (req, res) => {
  const fname = 'sisumepe-backup-' + new Date().toISOString().slice(0, 10) + '.json';
  res.setHeader('Content-Disposition', 'attachment; filename="' + fname + '"');
  res.setHeader('Content-Type', 'application/json');
  res.json(await store.backup());
}));

app.post('/api/restore', auth(['admin']), upload.single('backup'), ah(async (req, res) => {
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

// Painel TV público (sem login): só o mínimo necessário à chamada
app.get('/api/tv', ah(async (req, res) => {
  const all = await store.tickets.all();
  const persons = await store.persons.all();
  const queue = sortQueue(all.filter(t => t.status === 'aguardando')).map(t => {
    const p = persons.find(x => String(x.id) === String(t.personId));
    return {
      id: t.id, code: t.code, nome: p ? p.nome : '-',
      motivo: t.motivo || '', modelo: t.modeloTornozeleira || '',
      prioridade: !!t.prioridadeLegal,
      called: !!t.called, calledAt: t.calledAt || null, createdAt: t.createdAt
    };
  });
  res.json({ queue, now: new Date().toISOString() });
}));

app.get('/tv', (req, res) => res.sendFile(path.join(ROOT, 'public', 'tv.html')));

app.get('*', (req, res) => res.sendFile(path.join(ROOT, 'public', 'index.html')));

// Erros de upload viram 400 JSON (nunca HTML)
app.use((err, req, res, next) => {
  if (err && (err.code === 'LIMIT_FILE_SIZE' || err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE'))
    return res.status(400).json({ error: 'Arquivo muito grande ou em excesso (máx. 15MB cada, 5 por vez).' });
  next(err);
});

app.listen(PORT, '0.0.0.0', () => console.log(`SISUMEPE Juazeiro [${store.mode}] rodando em http://localhost:${PORT}`));
