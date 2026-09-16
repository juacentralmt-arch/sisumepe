require('dotenv').config();
const express = require('express');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const store = require('./store');
const { google } = require('googleapis');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

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

// Google Agenda helpers
function getGoogleConfig(){
  const cid = process.env.GOOGLE_CLIENT_ID;
  const csec = process.env.GOOGLE_CLIENT_SECRET;
  let redir = process.env.GOOGLE_REDIRECT_URI;
  if(!redir){
    const base = process.env.RENDER_EXTERNAL_URL || (process.env.RENDER_EXTERNAL_HOSTNAME ? 'https://' + process.env.RENDER_EXTERNAL_HOSTNAME : null);
    if(base) redir = base.replace(/\/$/,'') + '/api/auth/google/callback';
    else redir = 'http://localhost:' + PORT + '/api/auth/google/callback';
  }
  if(!cid || !csec) return null;
  return { cid, csec, redir };
}
function makeOAuthClient(){
  const cfg = getGoogleConfig();
  if(!cfg) return null;
  return new google.auth.OAuth2(cfg.cid, cfg.csec, cfg.redir);
}
async function getAuthedClientForUser(user){
  const tokens = await store.googleTokens.get(user);
  if(!tokens) return null;
  const cfg = getGoogleConfig();
  if(!cfg) return null;
  const o = new google.auth.OAuth2(cfg.cid, cfg.csec, cfg.redir);
  o.setCredentials({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expiry_date: tokens.expiry_date ? Number(tokens.expiry_date) : null,
    scope: tokens.scope,
    token_type: tokens.token_type
  });
  o.on('tokens', async (t)=>{
    try{
      const upd = {
        access_token: t.access_token || tokens.access_token,
        refresh_token: t.refresh_token || tokens.refresh_token,
        expiry_date: t.expiry_date || tokens.expiry_date,
        scope: t.scope || tokens.scope,
        token_type: t.token_type || tokens.token_type
      };
      await store.googleTokens.set(user, upd);
    }catch(e){}
  });
  return o;
}
async function syncAgendaToGoogle(user, ev, opts){
  // opts: { isDelete, isUpdate }
  const client = await getAuthedClientForUser(user);
  if(!client) return null;
  const cal = google.calendar({ version: 'v3', auth: client });
  try{
    if(opts && opts.isDelete){
      if(!ev.googleEventId) return null;
      await cal.events.delete({ calendarId: 'primary', eventId: ev.googleEventId });
      return null;
    }
    const body = {
      summary: ev.title || 'Atendimento SISUMEPE',
      description: (ev.description||'') + (ev.personId ? '\nAtendido ID: '+ev.personId : '') + (ev.ticketId ? '\nTicket: '+ev.ticketId : ''),
      start: { dateTime: new Date(ev.start).toISOString() },
      end: { dateTime: new Date(ev.end).toISOString() }
    };
    if(opts && opts.isUpdate && ev.googleEventId){
      const r = await cal.events.update({ calendarId: 'primary', eventId: ev.googleEventId, requestBody: body });
      return r.data.id;
    } else {
      const r = await cal.events.insert({ calendarId: 'primary', requestBody: body });
      return r.data.id;
    }
  }catch(e){
    console.warn('Google sync failed', e.message);
    return null;
  }
}

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

// PDF Termos

function gerarTermoHTML(termo){
  const dataFmt = (()=>{ if(!termo.dataEnvio) return '_______/_______/________'; try{ const d=new Date(termo.dataEnvio); if(!isNaN(d)) return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`; }catch(e){} return String(termo.dataEnvio); })();
  const dest = termo.destinatario ? termo.destinatario : '_____________________________';
  const eq = Array.isArray(termo.equipamentos) ? termo.equipamentos : [];
  while(eq.length<5) eq.push({tzpr04:'',fonte04:'',cinta:'',trava:''});
  const rows = eq.slice(0,5).map(r=>`
      <tr>
        <td>${(r.tzpr04||'').toString().substring(0,20)}</td>
        <td>${(r.fonte04||'').toString().substring(0,20)}</td>
        <td>${(r.cinta||'').toString().substring(0,20)}</td>
        <td>${(r.trava||'').toString().substring(0,20)}</td>
      </tr>`).join('');
  const brasaoSvg = `PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj48Y2lyY2xlIGN4PSI1MCIgY3k9IjUwIiByPSI0NSIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjMDAwIiBzdHJva2Utd2lkdGg9IjIiLz48dGV4dCB4PSI1MCIgeT0iNTUiIGZvbnQtZmFtaWx5PSJTZXJpZiIgZm9udC1zaXplPSIxMCIgZmlsbD0iIzAwMCIgdGV4dC1hbmNob3I9Im1pZGRsZSI+QlJBU8ODTzwvdGV4dD48L3N2Zz4=`;
  // Brasão base64 simples (placeholder) - será substituído se logo_0.png existir, senão usa SVG
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<style>
  @page { size: A4; margin: 18mm 18mm 18mm 18mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Times New Roman', Times, serif; font-size: 12pt; color: #000; line-height: 1.25; margin: 0; padding: 0; }
  .header { text-align: center; margin-bottom: 10px; }
  .header img { width: 58px; height: 62px; display: block; margin: 0 auto 6px auto; }
  .header .gov1 { font-size: 11pt; font-weight: bold; margin: 0; line-height: 1.1; }
  .header .gov2 { font-size: 13pt; font-weight: bold; margin: 0; line-height: 1.1; }
  .header .sec { font-size: 9pt; font-weight: bold; margin-top: 4px; }
  .data-envio { text-align: left; font-size: 9pt; margin: 18px 0 14px 0; }
  .title { text-align: center; font-weight: bold; text-decoration: underline; font-size: 13pt; margin: 14px 0 14px 0; }
  .subtitle { text-align: center; font-weight: bold; font-size: 9pt; line-height: 1.3; }
  .subtitle span { font-weight: normal; }
  .destinatario { text-align: left; font-size: 11pt; margin: 14px 0 18px 0; padding-left: 40px; }
  .destinatario b { font-weight: bold; }
  .destinatario .linha { border-bottom: 1px solid #000; display: inline-block; min-width: 280px; margin-left: 4px; text-align: center; padding-bottom: 1px; }
  table { width: 100%; max-width: 440px; margin: 0 auto; border-collapse: collapse; }
  th { background-color: #FFE4CC; border: 1px solid #000; padding: 6px 4px; text-align: center; font-weight: bold; font-size: 10pt; }
  td { border: 1px solid #000; padding: 7px 4px; text-align: center; font-size: 9pt; height: 18px; }
  .assinatura { margin-top: 42px; text-align: center; }
  .assinatura hr { border: none; border-top: 2px solid #000; margin: 0 auto; width: 88%; }
  .assinatura .label { font-weight: bold; font-size: 10pt; margin-top: 6px; }
  .assinatura .sub { font-size: 9pt; margin-top: 2px; }
  .assinatura .nome { font-size: 9pt; margin-bottom: 6px; min-height: 14px; }
  .spacer { height: 18px; }
</style>
</head>
<body>
  <div class="header">
    <img src="data:image/svg+xml;base64,${brasaoSvg}" alt="Brasão">
    <div class="gov1">GOVERNO DO</div>
    <div class="gov2">ESTADO DO CEARÁ</div>
    <div class="sec">Secretaria Administração Penitenciária</div>
  </div>
  <div class="data-envio">Data de envio: ${hasData(termo) ? dataFmt : '_______/_______/________'}</div>
  <div class="title">LISTAGEM DE EQUIPAMENTOS</div>
  <div class="subtitle">
    <div>SECRETARIA DE ADMINISTRAÇÃO PENITENCIÁRIA/SAP – CE</div>
    <div><b>Remetente:</b> Rua das Flores, s/n, Bairro Santa Tereza, Juazeiro do Norte-CE</div>
    <div>CÉLULA DE MONITORAÇÃO ELETRÔNICA -<i>SECÇÃO CARIRI</i></div>
  </div>
  <div class="destinatario"><b>Destinatário:</b> <span class="linha">${dest}</span></div>
  <table>
    <thead><tr><th>TZPR04</th><th>FONTE04</th><th>CINTA</th><th>TRAVA</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="assinatura">
    <div class="nome">${termo.respEntrega ? termo.respEntrega : '&nbsp;'}</div>
    <hr>
    <div class="label">RESPONSÁVEL PELA ENTREGA</div>
    <div class="sub">(RG/CPF/MATRICULA)</div>
  </div>
  <div class="assinatura">
    <div class="nome">${termo.respRecebimento ? termo.respRecebimento : '&nbsp;'}</div>
    <hr>
    <div class="label">RESPONSÁVEL PELA RECEBIMENTO</div>
    <div class="sub">(RG/CPF/MATRICULA)</div>
  </div>
</body>
</html>`;
  function hasData(t){ return t.dataEnvio && String(t.dataEnvio).trim() && !String(t.dataEnvio).includes('_'); }
}

async function gerarTermoPDF(termo){
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.32, 841.92]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontTimes = await pdfDoc.embedFont(StandardFonts.TimesRoman);
  const fontTimesBold = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);
  // Logo oficial Governo do Ceará (brasão + texto) - arquivo local, sem depender de internet
  let logoImage = null;
  try{
    const logoPath = path.join(ROOT, 'public', 'logo-governo-ce.png');
    if(fs.existsSync(logoPath)){
      logoImage = await pdfDoc.embedPng(fs.readFileSync(logoPath));
    }
  }catch(e){}
  if(!logoImage){
    try{
      if(typeof fetch !== 'undefined'){
        const res = await fetch('https://upload.wikimedia.org/wikipedia/commons/thumb/9/9e/Bras%C3%A3o_do_Cear%C3%A1.svg/200px-Bras%C3%A3o_do_Cear%C3%A1.png').catch(()=>null);
        if(res && res.ok){
          const buf = await res.arrayBuffer();
          logoImage = await pdfDoc.embedPng(Buffer.from(buf));
        }
      }
    }catch(e){}
  }
  if(logoImage){
    // Logo 680x426 -> 130pt de largura, centralizada no topo
    const logoW = 130;
    const logoH = logoW * (logoImage.height / logoImage.width);
    page.drawImage(logoImage, { x: (595.32 - logoW)/2, y: 810 - logoH, width: logoW, height: logoH });
  }
  const secTxt = 'Secretaria Administração Penitenciária';
  const secW = fontTimes.widthOfTextAtSize(secTxt, 9);
  page.drawText(secTxt, { x: (595.32 - secW)/2, y: 712, size: 9, font: fontTimes, color: rgb(0,0,0) });
  // Data de envio - exato x=90.26, y=689.98
  let dataFmt = '_______/_______/________';
  let hasData = false;
  if(termo.dataEnvio){
    try{
      const d = new Date(termo.dataEnvio);
      if(!isNaN(d)){
        const dd = String(d.getDate()).padStart(2,'0');
        const mm = String(d.getMonth()+1).padStart(2,'0');
        const yyyy = String(d.getFullYear());
        dataFmt = `${dd}/${mm}/${yyyy}`;
        hasData = true;
      } else if(String(termo.dataEnvio).trim()){
        dataFmt = String(termo.dataEnvio).trim();
        hasData = true;
      }
    }catch(e){ dataFmt = String(termo.dataEnvio); hasData = true; }
  }
  page.drawText('Data de envio', { x: 90.26, y: 689.98, size: 9, font: fontTimes, color: rgb(0,0,0) });
  page.drawText(':', { x: 145.94, y: 689.98, size: 9, font: fontTimes, color: rgb(0,0,0) });
  page.drawText(hasData ? dataFmt : '_______/_______/________', { x: 150.86, y: 689.98, size: 9, font: fontTimes, color: rgb(0,0,0) });
  // Título - x=224.09, y=641.98, 12pt
  const title = 'LISTAGEM DE EQUIPAMENTOS';
  page.drawText(title, { x: 224.09, y: 641.98, size: 12, font: fontTimesBold, color: rgb(0,0,0) });
  const titleW = fontTimesBold.widthOfTextAtSize(title, 12);
  page.drawLine({ start: {x: 224.09, y: 639.5}, end: {x: 224.09 + titleW, y: 639.5}, thickness: 0.9, color: rgb(0,0,0) });
  // Subtítulos - exatos
  const sub1Full = 'SECRETARIA DE ADMINISTRAÇÃO PENITENCIÁRIA/SAP – CE';
  const sub1W = fontTimesBold.widthOfTextAtSize(sub1Full, 11);
  page.drawText(sub1Full, { x: (595.32 - sub1W)/2, y: 614.14, size: 11, font: fontTimesBold, color: rgb(0,0,0) });
  const remL = 'Remetente: ';
  const remR = 'Rua das Flores, s/n, Bairro Santa Tereza, Juazeiro do Norte-CE';
  const remW = fontTimesBold.widthOfTextAtSize(remL, 11) + fontTimes.widthOfTextAtSize(remR, 10.5);
  let remX = (595.32 - remW)/2;
  page.drawText(remL, { x: remX, y: 600.34, size: 11, font: fontTimesBold, color: rgb(0,0,0) });
  remX += fontTimesBold.widthOfTextAtSize(remL, 11);
  page.drawText(remR, { x: remX, y: 600.34, size: 10.5, font: fontTimes, color: rgb(0,0,0) });
  let fontItalic = fontTimesBold;
  try{ fontItalic = await pdfDoc.embedFont(StandardFonts.TimesRomanBoldItalic); }catch(e){}
  const celA = 'CÉLULA DE MONITORAÇÃO ELETRÔNICA ';
  const celB = '- ';
  const celC = 'SECÇÃO CARIRI';
  const celW = fontTimesBold.widthOfTextAtSize(celA, 11) + fontTimesBold.widthOfTextAtSize(celB, 11) + fontItalic.widthOfTextAtSize(celC, 11);
  let celX = (595.32 - celW)/2;
  page.drawText(celA, { x: celX, y: 586.54, size: 11, font: fontTimesBold, color: rgb(0,0,0) });
  celX += fontTimesBold.widthOfTextAtSize(celA, 11);
  page.drawText(celB, { x: celX, y: 586.54, size: 11, font: fontTimesBold, color: rgb(0,0,0) });
  celX += fontTimesBold.widthOfTextAtSize(celB, 11);
  page.drawText(celC, { x: celX, y: 586.54, size: 11, font: fontItalic, color: rgb(0,0,0) });
  // Destinatário - x=170.09, y=558.91 (com quebra de linha para textos longos)
  page.drawText('Destinatário', { x: 170.09, y: 558.91, size: 12, font: fontTimesBold, color: rgb(0,0,0) });
  const destVal = (termo.destinatario || '').trim();
  if(destVal){
    const maxW = 595.32 - 235.25 - 40;
    let dSize = 12;
    let dTxt = ': ' + destVal;
    while(dSize > 8 && fontTimes.widthOfTextAtSize(dTxt, dSize) > maxW){ dSize -= 0.5; }
    if(fontTimes.widthOfTextAtSize(dTxt, dSize) <= maxW){
      page.drawText(dTxt, { x: 235.25, y: 558.91, size: dSize, font: fontTimes, color: rgb(0,0,0) });
      const fullW = fontTimes.widthOfTextAtSize(dTxt, dSize);
      page.drawLine({ start: {x: 235.25, y: 556.5}, end: {x: 235.25 + fullW + 10, y: 556.5}, thickness: 0.6, color: rgb(0,0,0) });
    } else {
      // quebra em 2 linhas
      const words = destVal.split(/\s+/);
      let l1 = ': ', l2 = '';
      for(const w of words){
        if(fontTimes.widthOfTextAtSize(l1 === ': ' ? ': '+w : l1 + ' ' + w, 10) <= maxW) l1 = l1 === ': ' ? ': '+w : l1 + ' ' + w;
        else l2 += (l2 ? ' ' : '') + w;
      }
      page.drawText(l1, { x: 235.25, y: 558.91, size: 10, font: fontTimes, color: rgb(0,0,0) });
      page.drawLine({ start: {x: 235.25, y: 556.5}, end: {x: 235.25 + fontTimes.widthOfTextAtSize(l1, 10) + 10, y: 556.5}, thickness: 0.6, color: rgb(0,0,0) });
      if(l2){
        page.drawText(l2, { x: 235.25, y: 545.5, size: 10, font: fontTimes, color: rgb(0,0,0) });
        page.drawLine({ start: {x: 235.25, y: 543.5}, end: {x: 235.25 + fontTimes.widthOfTextAtSize(l2, 10) + 10, y: 543.5}, thickness: 0.6, color: rgb(0,0,0) });
      }
    }
  } else {
    page.drawText(': _____________________________', { x: 235.25, y: 558.91, size: 12, font: fontTimes, color: rgb(0,0,0) });
  }
  // Tabela - coordenadas exatas
  const tableLeft = 110.42;
  const tableRight = 484.90;
  const colBounds = [110.42, 220.76, 310.42, 370.42, 484.90];
  const colCenters = [(110.42+220.76)/2, (220.76+310.42)/2, (310.42+370.42)/2, (370.42+484.90)/2];
  // Header y=490.39, row tops 496.39,478.39,458.39,438.39,418.39,398.39, bottom 378.39
  // Header background
  page.drawRectangle({ x: tableLeft, y: 478.39, width: tableRight-tableLeft, height: 18, color: rgb(0.996, 0.89, 0.78), borderColor: rgb(0,0,0), borderWidth: 0.6 });
  const hdrCols = ['TZPR04', 'FONTE04', 'CINTA', 'TRAVA'];
  const hdrBounds = [[110.42, 220.76], [220.76, 310.42], [310.42, 370.42], [370.42, 484.90]];
  hdrCols.forEach((h, i) => {
    const hw = fontTimesBold.widthOfTextAtSize(h, 11);
    const hx = (hdrBounds[i][0] + hdrBounds[i][1]) / 2 - hw / 2;
    page.drawText(h, { x: hx, y: 484.5, size: 11, font: fontTimesBold, color: rgb(0,0,0) });
  });
  // Grid vertical
  for(let i=0;i<colBounds.length;i++){
    const x = colBounds[i];
    page.drawLine({ start: {x, y: 496.39}, end: {x, y: 378.39}, thickness: 0.6, color: rgb(0,0,0) });
  }
  // Grid horizontal
  const hLines = [496.39, 478.39, 458.39, 438.39, 418.39, 398.39, 378.39];
  for(const y of hLines){
    page.drawLine({ start: {x: tableLeft, y}, end: {x: tableRight, y}, thickness: 0.6, color: rgb(0,0,0) });
  }
  // Dados - 5 linhas, y central 468.39,448.39,428.39,408.39,388.39
  const rowYs = [468.39, 448.39, 428.39, 408.39, 388.39];
  for(let r=0;r<5;r++){
    const row = termo.equipamentos && termo.equipamentos[r] ? termo.equipamentos[r] : {};
    const vals = [row.tzpr04||'', row.fonte04||'', row.cinta||'', row.trava||''];
    for(let c=0;c<4;c++){
      const txt = String(vals[c]).trim().substring(0,18);
      if(txt){
        const tw = fontTimes.widthOfTextAtSize(txt, 9);
        page.drawText(txt, { x: colCenters[c] - tw/2, y: rowYs[r], size: 9, font: fontTimes, color: rgb(0,0,0) });
      }
    }
  }
  // Rodapé - linhas y=310 e y=238, textos em y=295.37,281.57,223.94,210.14
  page.drawLine({ start: {x: 60, y: 310}, end: {x: 535.32, y: 310}, thickness: 0.9, color: rgb(0,0,0) });
  page.drawText('RESPONSÁVEL PELA ENTREGA', { x: 207.89, y: 295.37, size: 12, font: fontTimesBold, color: rgb(0,0,0) });
  page.drawText('(', { x: 236.81, y: 281.57, size: 12, font: fontTimes, color: rgb(0,0,0) });
  page.drawText('RG/CPF/MATRICULA', { x: 240.41, y: 281.57, size: 12, font: fontTimes, color: rgb(0,0,0) });
  page.drawText(')', { x: 354.79, y: 281.57, size: 12, font: fontTimes, color: rgb(0,0,0) });
  if(termo.respEntrega){
    const rw = fontTimes.widthOfTextAtSize(String(termo.respEntrega), 9);
    page.drawText(String(termo.respEntrega), { x: (595.32 - rw)/2, y: 320, size: 9, font: fontTimes, color: rgb(0,0,0) });
  }
  page.drawLine({ start: {x: 60, y: 238}, end: {x: 535.32, y: 238}, thickness: 0.9, color: rgb(0,0,0) });
  page.drawText('RESPONSÁVEL PELA RECEBIMENTO', { x: 193.49, y: 223.94, size: 12, font: fontTimesBold, color: rgb(0,0,0) });
  page.drawText('(', { x: 236.81, y: 210.14, size: 12, font: fontTimes, color: rgb(0,0,0) });
  page.drawText('RG/CPF/MATRICULA', { x: 240.41, y: 210.14, size: 12, font: fontTimes, color: rgb(0,0,0) });
  page.drawText(')', { x: 354.79, y: 210.14, size: 12, font: fontTimes, color: rgb(0,0,0) });
  if(termo.respRecebimento){
    const rw = fontTimes.widthOfTextAtSize(String(termo.respRecebimento), 9);
    page.drawText(String(termo.respRecebimento), { x: (595.32 - rw)/2, y: 248, size: 9, font: fontTimes, color: rgb(0,0,0) });
  }
  const pdfBytes = await pdfDoc.save();
  return pdfBytes;
}

// PDF Termo de Recolhimento (unidades penais) - grade de cartoes 3 colunas
async function gerarTermoRecolhimentoPDF(termo){
  const d = (termo.dados && typeof termo.dados === 'object') ? termo.dados : {};
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const PW = 595.32, PH = 841.92;
  const M = 32;
  let logoPng = null;
  try{
    const logoPath = path.join(ROOT, 'public', 'logo-governo-ce.png');
    if(fs.existsSync(logoPath)) logoPng = await pdfDoc.embedPng(fs.readFileSync(logoPath));
  }catch(e){}
  const eqList = Array.isArray(d.equipamentos) ? d.equipamentos : [];
  const CHECKS = [
    ['ladoExterno', 'LADO EXTERNO'], ['cinta', 'CINTA'], ['travas', 'TRAVAS'],
    ['ladoInterno', 'LADO INTERNO'], ['abaDireita', 'ABA DIREITA'], ['abaEsquerda', 'ABA ESQUERDA']
  ];
  function drawCheckbox(pg, x, y, marked){
    const s = 8;
    pg.drawRectangle({ x, y: y - s, width: s, height: s, borderColor: rgb(0,0,0), borderWidth: 0.8, color: rgb(1,1,1) });
    if(marked){
      pg.drawLine({ start: {x: x+1.2, y: y-1.5}, end: {x: x+s-1.2, y: y-s+1.2}, thickness: 1.1, color: rgb(0,0,0) });
      pg.drawLine({ start: {x: x+1.2, y: y-s+1.2}, end: {x: x+s-1.2, y: y-1.5}, thickness: 1.1, color: rgb(0,0,0) });
    }
  }
  function drawCheckRow(pg, x, y, w, label, val){
    pg.drawText(label, { x, y: y - 7.5, size: 7, font: fontBold, color: rgb(0,0,0) });
    const simX = x + w - 62, naoX = x + w - 31;
    pg.drawText('SIM', { x: simX, y: y - 7.5, size: 6.5, font, color: rgb(0,0,0) });
    drawCheckbox(pg, simX + 15, y, val === true);
    pg.drawText('NÃO', { x: naoX, y: y - 7.5, size: 6.5, font, color: rgb(0,0,0) });
    drawCheckbox(pg, naoX + 16, y, val === false);
    const labelW = fontBold.widthOfTextAtSize(label, 7);
    const dotsW = simX - 3 - (x + labelW + 2);
    if(dotsW > 4){
      const dotW = font.widthOfTextAtSize('.', 7);
      const n = Math.floor(dotsW / dotW);
      pg.drawText('.'.repeat(n), { x: x + labelW + 2, y: y - 7.5, size: 7, font, color: rgb(0,0,0) });
    }
  }
  function drawCard(pg, x, yTop, w, ev){
    const h = 108;
    const yBot = yTop - h;
    pg.drawRectangle({ x, y: yBot, width: w, height: h, borderColor: rgb(0,0,0), borderWidth: 1, color: rgb(1,1,1) });
    const headTxt = 'N°:' + (ev.numero || '') + (ev.danificado ? ' DANIFICADO' : '');
    const headW = fontBold.widthOfTextAtSize(headTxt, 8);
    pg.drawText(headTxt, { x: x + (w - headW)/2, y: yTop - 13, size: 8, font: fontBold, color: rgb(0,0,0) });
    let ry = yTop - 24;
    CHECKS.forEach(([k, label])=>{
      const v = ev.checks ? ev.checks[k] : null;
      const vv = (v === true || v === 'sim') ? true : (v === false || v === 'nao') ? false : null;
      drawCheckRow(pg, x + 7, ry, w - 14, label, vv);
      ry -= 13.2;
    });
    return h;
  }
  function drawHeader(pg){
    let y = PH - 34;
    pg.drawText('POLÍCIA PENAL', { x: M, y, size: 13, font: fontBold, color: rgb(0,0,0) });
    pg.drawText('Coordenadoria de Monitoração', { x: M, y: y - 11, size: 7.5, font: fontBold, color: rgb(0,0,0) });
    pg.drawText('Eletrônica de Pessoas - COMEP', { x: M, y: y - 20, size: 7.5, font: fontBold, color: rgb(0,0,0) });
    if(logoPng){
      const lw = 58, lh = lw * (logoPng.height / logoPng.width);
      pg.drawImage(logoPng, { x: PW - M - 168, y: y - 4 - lh + 14, width: lw, height: lh });
    }
    const ceara = 'CEARÁ';
    const cearaW = fontBold.widthOfTextAtSize(ceara, 20);
    pg.drawText(ceara, { x: PW - M - cearaW, y, size: 20, font: fontBold, color: rgb(0.18,0.28,0.36) });
    const g1 = 'GOVERNO DO ESTADO';
    pg.drawText(g1, { x: PW - M - fontBold.widthOfTextAtSize(g1, 7.5), y: y - 11, size: 7.5, font: fontBold, color: rgb(0,0,0) });
    const g2 = 'SECRETARIA DA ADMINISTRAÇÃO';
    pg.drawText(g2, { x: PW - M - font.widthOfTextAtSize(g2, 6), y: y - 19, size: 6, font, color: rgb(0,0,0) });
    const g3 = 'PENITENCIÁRIA E RESSOCIALIZAÇÃO';
    pg.drawText(g3, { x: PW - M - font.widthOfTextAtSize(g3, 6), y: y - 26, size: 6, font, color: rgb(0,0,0) });
    y -= 44;
    const t1 = 'TERMO DE RECOLHIMENTO ENTREGUES PELAS UNIDADES PENAIS';
    pg.drawText(t1, { x: (PW - fontBold.widthOfTextAtSize(t1, 10.5))/2, y, size: 10.5, font: fontBold, color: rgb(0,0,0) });
    y -= 12;
    const t2 = 'UNIDADE DE MONITORAMENTO ELETRONICO DE PESSOAS – NUCLEO JUAZEIRO';
    pg.drawText(t2, { x: (PW - fontBold.widthOfTextAtSize(t2, 8))/2, y, size: 8, font: fontBold, color: rgb(0,0,0) });
    return y - 14;
  }
  const perFirst = 12, perNext = 15;
  const pages = [];
  let rest = eqList.slice();
  pages.push(rest.slice(0, perFirst)); rest = rest.slice(perFirst);
  while(rest.length){ pages.push(rest.slice(0, perNext)); rest = rest.slice(perNext); }
  if(!pages[0].length) pages[0] = [];
  const dh = d.dataHora ? new Date(d.dataHora) : new Date();
  const dhTxt = isNaN(dh) ? '' : dh.toLocaleDateString('pt-BR') + ' ' + String(dh.getHours()).padStart(2,'0') + ':' + String(dh.getMinutes()).padStart(2,'0') + 'h';
  for(let pi=0; pi<pages.length; pi++){
    const pg = pdfDoc.addPage([PW, PH]);
    const isLast = pi === pages.length - 1;
    let y = drawHeader(pg);
    if(pi === 0){
      const boxH = 26;
      const leftW = PW - 2*M - 150;
      pg.drawRectangle({ x: M, y: y - boxH, width: leftW, height: boxH, borderColor: rgb(0,0,0), borderWidth: 1, color: rgb(1,1,1) });
      pg.drawText('Itens Rebidos: ' + (d.itensRecebidos || ''), { x: M + 6, y: y - 17, size: 8.5, font, color: rgb(0,0,0) });
      pg.drawRectangle({ x: M + leftW + 8, y: y - boxH, width: 142, height: boxH, borderColor: rgb(0,0,0), borderWidth: 1, color: rgb(1,1,1) });
      const dhW = font.widthOfTextAtSize(dhTxt, 8.5);
      pg.drawText(dhTxt, { x: M + leftW + 8 + (142 - dhW)/2, y: y - 17, size: 8.5, font, color: rgb(0,0,0) });
      y -= boxH + 8;
      const barH = 20;
      pg.drawRectangle({ x: M, y: y - barH, width: PW - 2*M, height: barH, color: rgb(0.82,0.82,0.82), borderColor: rgb(0,0,0), borderWidth: 1 });
      const barT = 'DESCRIÇÃO DO EQUIPAMENTOS';
      pg.drawText(barT, { x: (PW - fontBold.widthOfTextAtSize(barT, 9.5))/2, y: y - 14, size: 9.5, font: fontBold, color: rgb(0,0,0) });
      y -= barH + 10;
    } else {
      y -= 4;
    }
    const gap = 10, cols = 3;
    const cardW = (PW - 2*M - gap*(cols-1)) / cols;
    const cardH = 108, rowGap = 10;
    const list = pages[pi];
    for(let i=0;i<list.length;i++){
      const c = i % cols, r = Math.floor(i / cols);
      const cx = M + c * (cardW + gap);
      const cyTop = y - r * (cardH + rowGap);
      drawCard(pg, cx, cyTop, cardW, list[i]);
    }
    const rowsUsed = Math.ceil(list.length / cols);
    y = y - rowsUsed * (cardH + rowGap);
    if(isLast){
      y -= 2;
      const descLines = d.descricao ? String(d.descricao).split('\n').slice(0,6) : [];
      const descH = 52;
      pg.drawRectangle({ x: M, y: y - descH, width: PW - 2*M, height: descH, borderColor: rgb(0,0,0), borderWidth: 1, color: rgb(1,1,1) });
      pg.drawText('Descrição:', { x: M + 6, y: y - 14, size: 8.5, font, color: rgb(0,0,0) });
      descLines.forEach((ln, i)=>{ pg.drawText(String(ln).slice(0,110), { x: M + 6, y: y - 26 - i*10, size: 8, font, color: rgb(0,0,0) }); });
      y -= descH + 18;
      pg.drawText('Assinatura:', { x: M, y, size: 8.5, font: fontBold, color: rgb(0,0,0) });
      const assW = fontBold.widthOfTextAtSize('Assinatura: ', 8.5);
      pg.drawLine({ start: {x: M + assW, y: y - 2}, end: {x: M + 400, y: y - 2}, thickness: 0.7, color: rgb(0,0,0) });
      y -= 34;
      const midX = M + (PW - 2*M)/2;
      pg.drawLine({ start: {x: M + 10, y}, end: {x: midX - 10, y}, thickness: 0.8, color: rgb(0,0,0) });
      pg.drawLine({ start: {x: midX + 10, y}, end: {x: PW - M - 10, y}, thickness: 0.8, color: rgb(0,0,0) });
      const pol = 'Policial penal / Mat.';
      const tec = 'Técnico / Mat.';
      pg.drawText(pol, { x: M + 10 + ((midX-20) - font.widthOfTextAtSize(pol, 7.5))/2, y: y - 11, size: 7.5, font, color: rgb(0,0,0) });
      pg.drawText(tec, { x: midX + 10 + ((PW-M-10-(midX+10)) - font.widthOfTextAtSize(tec, 7.5))/2, y: y - 11, size: 7.5, font, color: rgb(0,0,0) });
      if(d.policialNome || d.policialMat){
        const pn = [d.policialNome, d.policialMat].filter(Boolean).join(' - ').slice(0,45);
        pg.drawText(pn, { x: M + 10 + ((midX-20) - font.widthOfTextAtSize(pn, 7))/2, y: y + 9, size: 7, font, color: rgb(0,0,0) });
      }
      if(d.tecnicoNome || d.tecnicoMat){
        const tn = [d.tecnicoNome, d.tecnicoMat].filter(Boolean).join(' - ').slice(0,45);
        pg.drawText(tn, { x: midX + 10 + ((PW-M-10-(midX+10)) - font.widthOfTextAtSize(tn, 7))/2, y: y + 9, size: 7, font, color: rgb(0,0,0) });
      }
      y -= 26;
      const foot = 'Unidade de Monitoração Eletrônica – UMEP Rua das Flores, S/N - Santa Tereza, Juazeiro do Norte - CE, 63050-325 Contatos: (88)35115726 Email: comep.cariri@sap.ce.gov.br';
      const footW = fontBold.widthOfTextAtSize(foot, 5.5);
      pg.drawText(foot, { x: Math.max(M, (PW - footW)/2), y: Math.max(28, y), size: 5.5, font: fontBold, color: rgb(0,0,0) });
    }
  }
  const pdfBytes = await pdfDoc.save();
  return pdfBytes;
}


// ============ GOOGLE AGENDA ============
const pendingGoogleStates = new Map();
app.get('/api/auth/google', auth(['tecnico','admin']), ah(async (req,res)=>{
  const cfg = getGoogleConfig();
  if(!cfg) return res.status(500).json({ error: 'Google Agenda não configurado. Defina GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI no servidor.' });
  const o = makeOAuthClient();
  const state = crypto.randomBytes(16).toString('hex');
  pendingGoogleStates.set(state, { user: req.auth.user, exp: Date.now()+10*60e3 });
  setTimeout(()=> pendingGoogleStates.delete(state), 10*60e3);
  const url = o.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: ['https://www.googleapis.com/auth/calendar'], state });
  res.json({ url });
}));
app.get('/api/auth/google/callback', ah(async (req,res)=>{
  const { code, state } = req.query;
  if(!code || !state) return res.status(400).send('Código ou estado ausente');
  const rec = pendingGoogleStates.get(String(state));
  if(!rec || rec.exp < Date.now()) return res.status(400).send('Estado expirado. Tente novamente no sistema.');
  pendingGoogleStates.delete(String(state));
  const cfg = getGoogleConfig();
  if(!cfg) return res.status(500).send('Google não configurado');
  const o = makeOAuthClient();
  try{
    const { tokens } = await o.getToken(String(code));
    await store.googleTokens.set(rec.user, tokens);
    // redireciona para o app com sucesso
    res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:40px"><h2>✅ Google Agenda vinculada!</h2><p>Conta <b>${rec.user}</b> conectada com sucesso.</p><p>Você pode fechar esta janela e voltar ao SISUMEPE.</p><script>setTimeout(()=>window.close(),1200); setTimeout(()=>location.href='/',1500);</script></body></html>`);
  }catch(e){
    console.error(e);
    res.status(500).send('Falha ao vincular Google: ' + (e.message||'erro'));
  }
}));
app.get('/api/auth/google/status', auth(), ah(async (req,res)=>{
  const cfg = getGoogleConfig();
  const tokens = await store.googleTokens.get(req.auth.user);
  res.json({ configured: !!cfg, connected: !!tokens, hasRefresh: !!(tokens && tokens.refresh_token) });
}));
app.post('/api/auth/google/disconnect', auth(), ah(async (req,res)=>{
  await store.googleTokens.del(req.auth.user);
  res.json({ ok: true });
}));

// Agenda do técnico
app.get('/api/agenda', auth(['tecnico','admin']), ah(async (req,res)=>{
  const list = await store.agenda.allByUser(req.auth.user);
  // admin vê a própria agenda; se quiser ver todas, use ?all=1
  if(req.auth.role==='admin' && req.query.all==='1'){
    const all = await store.agenda.all();
    return res.json(all);
  }
  res.json(list);
}));
app.post('/api/agenda', auth(['tecnico','admin']), ah(async (req,res)=>{
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
app.patch('/api/agenda/:id', auth(['tecnico','admin']), ah(async (req,res)=>{
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
app.delete('/api/agenda/:id', auth(['tecnico','admin']), ah(async (req,res)=>{
  const ev = await store.agenda.byId(req.params.id);
  if(!ev) return res.status(404).json({ error: 'Evento não encontrado' });
  if(ev.user !== req.auth.user && req.auth.role!=='admin') return res.status(403).json({ error: 'Sem permissão' });
  await store.agenda.remove(ev.id);
  syncAgendaToGoogle(req.auth.user, ev, { isDelete: true }).catch(()=>{});
  broadcast();
  res.json({ ok: true });
}));

// Termos - Listagem de Equipamentos
app.get('/api/termos', auth(['tecnico','admin']), ah(async (req,res)=>{
  const list = await store.termos.allByUser(req.auth.user);
  if(req.auth.role==='admin' && req.query.all==='1'){
    const all = await store.termos.all();
    return res.json(all);
  }
  res.json(list);
}));
app.post('/api/termos', auth(['tecnico','admin']), ah(async (req,res)=>{
  const { tipo, dataEnvio, destinatario, equipamentos, respEntrega, respRecebimento, dados } = req.body||{};
  const t = (tipo === 'recolhimento') ? 'recolhimento' : 'listagem';
  if(t === 'recolhimento'){
    const d = (dados && typeof dados === 'object') ? dados : {};
    const eq = Array.isArray(d.equipamentos) ? d.equipamentos.slice(0,60) : [];
    const normEq = eq.map(r=>{
      const checks = {};
      ['ladoExterno','cinta','travas','ladoInterno','abaDireita','abaEsquerda'].forEach(k=>{
        const v = r.checks ? r.checks[k] : null;
        checks[k] = (v === true || v === 'sim') ? true : (v === false || v === 'nao') ? false : null;
      });
      return { numero: String(r.numero||'').trim().slice(0,30), danificado: !!r.danificado, checks };
    }).filter(r=> r.numero);
    if(!normEq.length) return res.status(400).json({ error: 'Adicione ao menos um equipamento com número' });
    const termo = await store.termos.insert({
      user: req.auth.user, tipo: 'recolhimento',
      dataEnvio: dataEnvio ? new Date(dataEnvio).toISOString().slice(0,10) : new Date().toISOString().slice(0,10),
      destinatario: '', equipamentos: [],
      respEntrega: '', respRecebimento: '',
      dados: {
        itensRecebidos: String(d.itensRecebidos||'').trim().slice(0,200),
        dataHora: d.dataHora ? new Date(d.dataHora).toISOString() : new Date().toISOString(),
        equipamentos: normEq,
        descricao: String(d.descricao||'').trim().slice(0,2000),
        policialNome: String(d.policialNome||'').trim().slice(0,80),
        policialMat: String(d.policialMat||'').trim().slice(0,30),
        tecnicoNome: String(d.tecnicoNome||'').trim().slice(0,80),
        tecnicoMat: String(d.tecnicoMat||'').trim().slice(0,30)
      }
    });
    broadcast();
    return res.status(201).json(termo);
  }
  if(!destinatario || !String(destinatario).trim()) return res.status(400).json({ error: 'Destinatário é obrigatório' });
  let eq = Array.isArray(equipamentos) ? equipamentos.slice(0,5) : [];
  // normaliza 5 linhas
  const norm = [];
  for(let i=0;i<5;i++){
    const r = eq[i]||{};
    norm.push({ tzpr04: String(r.tzpr04||'').trim().slice(0,30), fonte04: String(r.fonte04||'').trim().slice(0,30), cinta: String(r.cinta||'').trim().slice(0,30), trava: String(r.trava||'').trim().slice(0,30) });
  }
  if(!norm.some(r=> r.tzpr04||r.fonte04||r.cinta||r.trava)) return res.status(400).json({ error: 'Preencha ao menos um equipamento (TZPR04/FONTE04/CINTA/TRAVA)' });
  const termo = await store.termos.insert({
    user: req.auth.user, tipo: 'listagem',
    dataEnvio: dataEnvio ? new Date(dataEnvio).toISOString().slice(0,10) : new Date().toISOString().slice(0,10),
    destinatario: String(destinatario).trim().slice(0,120),
    equipamentos: norm,
    respEntrega: String(respEntrega||'').trim().slice(0,80),
    respRecebimento: String(respRecebimento||'').trim().slice(0,80),
    dados: {}
  });
  broadcast();
  res.status(201).json(termo);
}));
app.get('/api/termos/:id', auth(['tecnico','admin']), ah(async (req,res)=>{
  const t = await store.termos.byId(req.params.id);
  if(!t) return res.status(404).json({ error: 'Termo não encontrado' });
  if(t.user !== req.auth.user && req.auth.role!=='admin') return res.status(403).json({ error: 'Sem permissão' });
  res.json(t);
}));
app.patch('/api/termos/:id', auth(['tecnico','admin']), ah(async (req,res)=>{
  const t = await store.termos.byId(req.params.id);
  if(!t) return res.status(404).json({ error: 'Termo não encontrado' });
  if(t.user !== req.auth.user && req.auth.role!=='admin') return res.status(403).json({ error: 'Sem permissão' });
  const { dataEnvio, destinatario, equipamentos, respEntrega, respRecebimento, dados } = req.body||{};
  const patch={};
  if(dataEnvio) patch.dataEnvio = new Date(dataEnvio).toISOString().slice(0,10);
  if(t.tipo === 'recolhimento' && dados && typeof dados === 'object'){
    const d = dados;
    const nd = Object.assign({}, t.dados||{});
    if(d.itensRecebidos!=null) nd.itensRecebidos = String(d.itensRecebidos).trim().slice(0,200);
    if(d.dataHora) nd.dataHora = new Date(d.dataHora).toISOString();
    if(Array.isArray(d.equipamentos)){
      nd.equipamentos = d.equipamentos.slice(0,60).map(r=>{
        const checks = {};
        ['ladoExterno','cinta','travas','ladoInterno','abaDireita','abaEsquerda'].forEach(k=>{
          const v = r.checks ? r.checks[k] : null;
          checks[k] = (v === true || v === 'sim') ? true : (v === false || v === 'nao') ? false : null;
        });
        return { numero: String(r.numero||'').trim().slice(0,30), danificado: !!r.danificado, checks };
      }).filter(r=> r.numero);
    }
    if(d.descricao!=null) nd.descricao = String(d.descricao).trim().slice(0,2000);
    if(d.policialNome!=null) nd.policialNome = String(d.policialNome).trim().slice(0,80);
    if(d.policialMat!=null) nd.policialMat = String(d.policialMat).trim().slice(0,30);
    if(d.tecnicoNome!=null) nd.tecnicoNome = String(d.tecnicoNome).trim().slice(0,80);
    if(d.tecnicoMat!=null) nd.tecnicoMat = String(d.tecnicoMat).trim().slice(0,30);
    patch.dados = nd;
  }
  if(destinatario!=null) patch.destinatario = String(destinatario).trim().slice(0,120);
  if(equipamentos!=null){
    let eq = Array.isArray(equipamentos) ? equipamentos.slice(0,5) : [];
    const norm=[]; for(let i=0;i<5;i++){ const r=eq[i]||{}; norm.push({ tzpr04: String(r.tzpr04||'').trim().slice(0,30), fonte04: String(r.fonte04||'').trim().slice(0,30), cinta: String(r.cinta||'').trim().slice(0,30), trava: String(r.trava||'').trim().slice(0,30) }); }
    patch.equipamentos = norm;
  }
  if(respEntrega!=null) patch.respEntrega = String(respEntrega).trim().slice(0,80);
  if(respRecebimento!=null) patch.respRecebimento = String(respRecebimento).trim().slice(0,80);
  const upd = await store.termos.patch(t.id, patch);
  broadcast();
  res.json(upd);
}));
app.delete('/api/termos/:id', auth(['tecnico','admin']), ah(async (req,res)=>{
  const t = await store.termos.byId(req.params.id);
  if(!t) return res.status(404).json({ error: 'Termo não encontrado' });
  if(t.user !== req.auth.user && req.auth.role!=='admin') return res.status(403).json({ error: 'Sem permissão' });
  await store.termos.remove(t.id);
  broadcast();
  res.json({ ok: true });
}));
app.get('/api/termos/:id/pdf', auth(['tecnico','admin']), ah(async (req,res)=>{
  const t = await store.termos.byId(req.params.id);
  if(!t) return res.status(404).json({ error: 'Termo não encontrado' });
  if(t.user !== req.auth.user && req.auth.role!=='admin') return res.status(403).json({ error: 'Sem permissão' });
  const pdf = (t.tipo === 'recolhimento') ? await gerarTermoRecolhimentoPDF(t) : await gerarTermoPDF(t);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="termo-${t.id}.pdf"`);
  res.send(Buffer.from(pdf));
}));
app.post('/api/termos/pdf-preview', auth(['tecnico','admin']), ah(async (req,res)=>{
  const { tipo, dataEnvio, destinatario, equipamentos, respEntrega, respRecebimento, dados } = req.body||{};
  if(tipo === 'recolhimento'){
    const d = (dados && typeof dados === 'object') ? dados : {};
    const termo = {
      tipo: 'recolhimento',
      dados: {
        itensRecebidos: String(d.itensRecebidos||'').trim(),
        dataHora: d.dataHora ? new Date(d.dataHora).toISOString() : new Date().toISOString(),
        equipamentos: (Array.isArray(d.equipamentos) ? d.equipamentos.slice(0,60) : []).map(r=>({ numero: String(r.numero||''), danificado: !!r.danificado, checks: (r.checks||{}) })),
        descricao: String(d.descricao||'').trim(),
        policialNome: String(d.policialNome||'').trim(), policialMat: String(d.policialMat||'').trim(),
        tecnicoNome: String(d.tecnicoNome||'').trim(), tecnicoMat: String(d.tecnicoMat||'').trim()
      }
    };
    const pdf = await gerarTermoRecolhimentoPDF(termo);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="termo-preview.pdf"');
    return res.send(Buffer.from(pdf));
  }
  const termo = {
    dataEnvio: dataEnvio ? new Date(dataEnvio).toISOString().slice(0,10) : new Date().toISOString().slice(0,10),
    destinatario: String(destinatario||'').trim() || '_________________________',
    equipamentos: Array.isArray(equipamentos) ? equipamentos.slice(0,5).map(r=>({ tzpr04: String(r.tzpr04||''), fonte04: String(r.fonte04||''), cinta: String(r.cinta||''), trava: String(r.trava||'') })) : [],
    respEntrega: String(respEntrega||'').trim(),
    respRecebimento: String(respRecebimento||'').trim()
  };
  while(termo.equipamentos.length<5) termo.equipamentos.push({ tzpr04:'', fonte04:'', cinta:'', trava:'' });
  const pdf = await gerarTermoPDF(termo);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline; filename="termo-preview.pdf"');
  res.send(Buffer.from(pdf));
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
