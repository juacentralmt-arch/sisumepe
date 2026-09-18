require('dotenv').config();
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const store = require('../../store');
const { google } = require('googleapis');

const ROOT = path.join(__dirname, '..', '..');
const PORT = process.env.PORT || 3000;

// Anti força-bruta no login, em dois níveis:
//  - por IP:    30 tentativas / 5 min (escritório inteiro atrás de um NAT não trava)
//  - por IP+usuário: 10 tentativas / 5 min (um atacante focado em uma conta trava só nela)
const loginHits = new Map();
const LOGIN_WINDOW_MS = 5 * 60e3;
function loginRateLimit(req, res, next) {
  const ip = req.ip || '?';
  const user = String((req.body && req.body.user) || '').toLowerCase().trim();
  const now = Date.now();
  const bucket = (key, max) => {
    const h = loginHits.get(key) || { n: 0, reset: now + LOGIN_WINDOW_MS };
    if (now > h.reset) { h.n = 0; h.reset = now + LOGIN_WINDOW_MS; }
    h.n++;
    loginHits.set(key, h);
    return h.n > max;
  };
  if (bucket('ip:' + ip, 30)) return res.status(429).json({ error: 'Muitas tentativas. Aguarde 5 minutos.' });
  if (user && bucket('u:' + ip + '|' + user, 10)) return res.status(429).json({ error: 'Muitas tentativas para este usuário. Aguarde 5 minutos.' });
  // limpeza ocasional de chaves velhas (sem timer dedicado)
  if (loginHits.size > 5000) {
    for (const [k, v] of loginHits) if (now > v.reset) loginHits.delete(k);
  }
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

// SSE clients: cada conexão guarda quem está logado nela,
// permitindo entregar eventos direcionados (chat privado, chamadas) só ao destinatário.
let sseClients = [];
function addSseClient(res, user) {
  const client = { res, user: String(user || '').toLowerCase() };
  sseClients.push(client);
  return client;
}
function removeSseClient(client) {
  const i = sseClients.indexOf(client);
  if (i >= 0) sseClients.splice(i, 1);
}
function writeSse(client, payload) {
  try { client.res.write(`data: ${payload}\n\n`); } catch {}
}
// Broadcast para todos (eventos públicos, ex. atualização de fila)
function broadcast(event) {
  const payload = JSON.stringify(event || { type: 'update', at: Date.now() });
  sseClients.forEach(c => writeSse(c, payload));
}
// Evento direcionado: só chega ao(s) destinatário(s). Fallback 'todos' vai para todos.
function broadcastTo(targets, event) {
  const list = Array.isArray(targets) ? targets : [targets];
  const norm = list.filter(Boolean).map(t => String(t).toLowerCase());
  const everyone = !norm.length || norm.includes('todos');
  const payload = JSON.stringify(event || { type: 'update', at: Date.now() });
  sseClients.forEach(c => { if (everyone || norm.includes(c.user)) writeSse(c, payload); });
}

// Uploads em memória -> disco local (file) ou Supabase Storage (supabase)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 20 } });
async function mapFiles(files) {
  const out = [];
  for (const f of (files || [])) out.push(await store.saveFileUpload(f));
  return out;
}

// Toda foto/imagem anexada ao ticket é convertida em PDF e tudo o que for
// conversível (imagens JPG/PNG, PDFs e textos) é unido em UM único arquivo.
// Tipos não-conversíveis (áudio, Office etc.) são mantidos avulsos para não
// perder nenhum dado.
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
function addFittedImagePage(pdf, img) {
  const W = 595.28, H = 841.89, M = 36;
  const page = pdf.addPage([W, H]);
  const s = Math.min((W - 2 * M) / img.width, (H - 2 * M) / img.height);
  const w = img.width * s, h = img.height * s;
  page.drawImage(img, { x: (W - w) / 2, y: (H - h) / 2, width: w, height: h });
}
function addTextPages(pdf, font, title, text) {
  const W = 595.28, H = 841.89, M = 36, size = 10, lh = 14;
  const maxW = W - 2 * M;
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (font.widthOfTextAtSize(t, size) > maxW && cur) { lines.push(cur); cur = w; }
    else cur = t;
  }
  if (cur) lines.push(cur);
  if (!lines.length) lines.push('(arquivo vazio)');
  let page = pdf.addPage([W, H]);
  page.drawText(String(title || 'texto').slice(0, 80), { x: M, y: H - M, size: 12, font, color: rgb(0.2, 0.2, 0.6) });
  let y = H - M - 24;
  for (const ln of lines) {
    if (y < M + 10) {
      page = pdf.addPage([W, H]);
      y = H - M;
    }
    page.drawText(ln, { x: M, y, size, font, color: rgb(0, 0, 0) });
    y -= lh;
  }
}
async function consolidateTicketFiles(files, prefix) {
  files = files || [];
  if (!files.length) return { files, merged: false };
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const kept = [];
  const mergedNames = [];
  for (const f of files) {
    const mime = String(f.mimetype || '');
    const ext = (String(f.originalname || '').split('.').pop() || '').toLowerCase();
    try {
      if (mime === 'application/pdf' || ext === 'pdf') {
        const src = await PDFDocument.load(f.buffer);
        const pages = await pdf.copyPages(src, src.getPageIndices());
        pages.forEach(p => pdf.addPage(p));
        mergedNames.push(f.originalname);
      } else if (mime === 'image/jpeg' || ext === 'jpg' || ext === 'jpeg') {
        addFittedImagePage(pdf, await pdf.embedJpg(f.buffer));
        mergedNames.push(f.originalname);
      } else if (mime === 'image/png' || ext === 'png') {
        addFittedImagePage(pdf, await pdf.embedPng(f.buffer));
        mergedNames.push(f.originalname);
      } else if (mime.startsWith('text/') || ext === 'txt' || ext === 'csv') {
        addTextPages(pdf, font, f.originalname, f.buffer.toString('utf8').slice(0, 20000));
        mergedNames.push(f.originalname);
      } else {
        kept.push(f);
      }
    } catch {
      kept.push(f);
    }
  }
  if (!mergedNames.length) return { files, merged: false };
  const bytes = await pdf.save();
  const buf = Buffer.from(bytes);
  return {
    files: [
      { originalname: (prefix || 'anexos-unificados') + '-' + Date.now() + '.pdf', mimetype: 'application/pdf', buffer: buf, size: buf.length },
      ...kept
    ],
    merged: true
  };
}
// Nome do PDF unificado conforme o motivo do atendimento
// (sem acentos para não quebrar URLs/storage).
function pdfPrefixForMotivo(motivo, fallback) {
  const m = String(motivo || '').toLowerCase();
  if (m.includes('instala')) return 'pdfinstalacao';
  if (m.includes('retirada')) return 'pdfretirada';
  if (m.includes('manuten')) return 'pdfmanutencao';
  return fallback || 'anexos-unificados';
}

// Nome curto para exibição pública (painel TV): "João S." em vez do nome completo.
function shortName(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return parts[0] || '-';
  return parts[0] + ' ' + parts[parts.length - 1][0].toUpperCase() + '.';
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
// Cache de persons com TTL curto: evita baixar a tabela inteira do Supabase
// a cada request que enriquece tickets. Invalidado por qualquer mutação de cadastro.
let personsCache = null, personsCacheAt = 0;
const PERSONS_CACHE_TTL_MS = 10e3;
function servePersonsCache() {
  if (!personsCache || Date.now() - personsCacheAt > PERSONS_CACHE_TTL_MS) {
    personsCache = store.persons.all().then(rows => { personsCacheAt = Date.now(); return rows; })
      .catch(e => { personsCache = null; throw e; });
  }
  return personsCache;
}
function invalidatePersonsCache() { personsCache = null; }
async function enrichAll(list) {
  const persons = await servePersonsCache();
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

const pendingGoogleStates = new Map();

module.exports = {
  ROOT, PORT, store,
  ah, broadcast, broadcastTo, addSseClient, removeSseClient, sseClients,
  loginRateLimit, issueToken, auth, isHash,
  upload, mapFiles, consolidateTicketFiles, pdfPrefixForMotivo,
  sortQueue, shortName, enrich, enrichAll, servePersonsCache, invalidatePersonsCache, ticketOwnerOf, infinityBlocked,
  PERSON_LABELS, MOTIVOS_OK,
  getGoogleConfig, makeOAuthClient, getAuthedClientForUser, syncAgendaToGoogle,
  pendingGoogleStates
};
