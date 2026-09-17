require('dotenv').config();
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const store = require('../../store');
const { google } = require('googleapis');

const ROOT = path.join(__dirname, '..', '..');
const PORT = process.env.PORT || 3000;

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
function broadcast(event) {
  const payload = JSON.stringify(event || { type: 'update', at: Date.now() });
  sseClients.forEach(res => { try { res.write(`data: ${payload}\n\n`); } catch {} });
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
  if (!files.length) return files;
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
  if (!mergedNames.length) return files;
  const bytes = await pdf.save();
  const buf = Buffer.from(bytes);
  return [
    { originalname: (prefix || 'anexos-unificados') + '-' + Date.now() + '.pdf', mimetype: 'application/pdf', buffer: buf, size: buf.length },
    ...kept
  ];
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

const pendingGoogleStates = new Map();

module.exports = {
  ROOT, PORT, store,
  ah, broadcast, sseClients,
  loginRateLimit, issueToken, auth, isHash,
  upload, mapFiles, consolidateTicketFiles,
  sortQueue, enrich, enrichAll, ticketOwnerOf, infinityBlocked,
  PERSON_LABELS, MOTIVOS_OK,
  getGoogleConfig, makeOAuthClient, getAuthedClientForUser, syncAgendaToGoogle,
  pendingGoogleStates
};
