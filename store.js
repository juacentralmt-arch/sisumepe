// =====================================================================
//  SISUMEPE — camada de persistência (arquivo local OU Supabase)
//  Modo Supabase ativa com: SUPABASE_URL + SUPABASE_KEY no ambiente.
//  Sem elas, usa db.json local (comportamento original).
// =====================================================================
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const MODE = (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) ? 'supabase' : 'file';
const ROOT = path.join(__dirname);
const DB_FILE = path.join(ROOT, 'db.json');
const UPLOAD_DIR = path.join(ROOT, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function seedUsers() {
  return [
    { user: 'recepcao', name: 'Recepção', role: 'recepcao', pass: 'recepcao123', active: true },
    { user: 'joanderson', name: 'Joanderson', role: 'tecnico', pass: 'joanderson123', active: true },
    { user: 'adailton', name: 'Adailton', role: 'tecnico', pass: 'adailton123', active: true },
    { user: 'admin', name: 'Administrador', role: 'admin', pass: 'admin123', active: true }
  ];
}

// ----------------------------- FILE ---------------------------------
let mem = null;
function loadFile() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      mem = { persons: [], tickets: [], chat: [], audit: [], users: seedUsers(), sessions: {}, seqPerson: 1, seqTicket: 1, seqChat: 1, seqAudit: 1 };
      fs.writeFileSync(DB_FILE, JSON.stringify(mem, null, 2));
      return mem;
    }
    mem = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    if (!Array.isArray(mem.chat)) mem.chat = [];
    if (!mem.seqChat) mem.seqChat = mem.chat.length + 1;
    if (!Array.isArray(mem.audit)) mem.audit = [];
    if (!mem.seqAudit) mem.seqAudit = mem.audit.length + 1;
    if (!Array.isArray(mem.users) || !mem.users.length) mem.users = seedUsers();
    mem.users.forEach(u => { if (u.active === undefined) u.active = true; });
    if (!mem.sessions || typeof mem.sessions !== 'object') mem.sessions = {};
    return mem;
  } catch {
    mem = { persons: [], tickets: [], chat: [], audit: [], users: seedUsers(), sessions: {}, seqPerson: 1, seqTicket: 1, seqChat: 1, seqAudit: 1 };
    return mem;
  }
}
function saveFile() { fs.writeFileSync(DB_FILE, JSON.stringify(mem, null, 2)); }
if (MODE === 'file') loadFile();

// ---------------------------- SUPABASE -------------------------------
let supa = null;
if (MODE === 'supabase') {
  const { createClient } = require('@supabase/supabase-js');
  supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
}
function must(res, what) {
  if (res.error) { const e = new Error(what + ': ' + res.error.message); e.status = 500; throw e; }
  return res.data;
}
const P = {
  id: 'id', nome: 'nome', cpf: 'cpf', cpfn: 'cpfn', rg: 'rg', nomeMae: 'nomemae',
  dataNascimento: 'datanascimento', modeloTornozeleira: 'modelotornozeleira', createdAt: 'createdat'
};
const T = {
  id: 'id', code: 'code', personId: 'personid', motivo: 'motivo', descricao: 'descricao',
  modeloTornozeleira: 'modelotornozeleira', prioridadeLegal: 'prioridadelegal', status: 'status',
  anexos: 'anexos', tecnicoRecepcao: 'tecnicorecepcao', tecnico: 'tecnico', tecnicoUser: 'tecnicouser',
  relatorio: 'relatorio', checklist: 'checklist', fotosPos: 'fotospos', createdBy: 'createdby',
  createdByName: 'createdbyname', called: 'called', calledAt: 'calledat', calledBy: 'calledby',
  createdAt: 'createdat', startedAt: 'startedat', finishedAt: 'finishedat', reopenedAt: 'reopenedat',
  cancelledAt: 'cancelledat', cancelledBy: 'cancelledby',
  transferredAt: 'transferredat', transferredBy: 'transferredby', transferredFrom: 'transferredfrom',
  returnedAt: 'returnedat', returnedBy: 'returnedby'
};
const A = {
  id: 'id', kind: 'kind', action: 'action', personId: 'personid', personName: 'personname',
  ticketId: 'ticketid', ref: 'ref', byUser: 'byuser', byName: 'byname', byRole: 'byrole',
  changes: 'changes', summary: 'summary', at: 'at'
};
function toApp(row, map) {
  if (!row) return null;
  const o = {};
  for (const k of Object.keys(map)) o[k] = row[map[k]];
  return o;
}
function toRow(obj, map) {
  const o = {};
  for (const k of Object.keys(map)) if (obj[k] !== undefined) o[map[k]] = obj[k];
  return o;
}
const appP = r => toApp(r, P);
const appT = r => toApp(r, T);
const appA = r => toApp(r, A);
const appC = r => ({ id: r.id, user: r.user, name: r.name, role: r.role, to: r.to, text: r.text, anexos: r.anexos || [], at: r.at });

// Fallback em memória (se a tabela sessions ainda não existir no Supabase)
const memSessions = new Map();
let warnedSessions = false;
function warnSessions(e) {
  if (!warnedSessions) {
    warnedSessions = true;
    console.warn('sessions: usando memória volátil — rode o SQL da tabela sessions no Supabase.', e && e.message);
  }
}

// ------------------------------ API ----------------------------------
const eqi = (a, b) => String(a) === String(b);

const store = {
  mode: MODE,

  persons: {
    async all() {
      if (MODE === 'file') return mem.persons;
      return must(await supa.from('persons').select('*').order('id'), 'persons.all').map(appP);
    },
    async search(q) {
      const list = await store.persons.all();
      q = (q || '').toLowerCase().trim();
      if (!q) return [...list].reverse();
      return list.filter(p =>
        (p.nome || '').toLowerCase().includes(q) ||
        (p.cpf || '').toLowerCase().includes(q) ||
        (p.rg || '').toLowerCase().includes(q)
      ).reverse();
    },
    async byId(id) {
      if (MODE === 'file') return mem.persons.find(x => eqi(x.id, id)) || null;
      const r = must(await supa.from('persons').select('*').eq('id', Number(id)).limit(1), 'persons.byId');
      return r.length ? appP(r[0]) : null;
    },
    async insert(p) {
      if (MODE === 'file') {
        const row = { id: mem.seqPerson++, ...p };
        mem.persons.push(row); saveFile();
        return row;
      }
      const r = must(await supa.from('persons').insert(toRow(p, P)).select().single(), 'persons.insert');
      return appP(r);
    },
    async patch(id, fields) {
      if (MODE === 'file') {
        const p = mem.persons.find(x => eqi(x.id, id));
        if (!p) return null;
        Object.assign(p, fields); saveFile();
        return p;
      }
      const r = must(await supa.from('persons').update(toRow(fields, P)).eq('id', Number(id)).select(), 'persons.patch');
      return r.length ? appP(r[0]) : null;
    },
    async remove(id) {
      if (MODE === 'file') {
        mem.persons = mem.persons.filter(x => !eqi(x.id, id)); saveFile();
        return;
      }
      must(await supa.from('persons').delete().eq('id', Number(id)), 'persons.remove');
    }
  },

  tickets: {
    async all() {
      if (MODE === 'file') return mem.tickets;
      return must(await supa.from('tickets').select('*').order('id'), 'tickets.all').map(appT);
    },
    async byId(id) {
      if (MODE === 'file') return mem.tickets.find(x => eqi(x.id, id)) || null;
      const r = must(await supa.from('tickets').select('*').eq('id', Number(id)).limit(1), 'tickets.byId');
      return r.length ? appT(r[0]) : null;
    },
    async insert(t) {
      if (MODE === 'file') {
        const row = { id: mem.seqTicket++, ...t };
        row.code = 'TK-' + String(row.id).padStart(4, '0');
        mem.tickets.push(row); saveFile();
        return row;
      }
      const row = must(await supa.from('tickets').insert(toRow({ ...t, code: '' }, T)).select().single(), 'tickets.insert');
      const code = 'TK-' + String(row.id).padStart(4, '0');
      const upd = must(await supa.from('tickets').update({ code }).eq('id', row.id).select().single(), 'tickets.code');
      return appT(upd);
    },
    async patch(id, fields) {
      if (MODE === 'file') {
        const t = mem.tickets.find(x => eqi(x.id, id));
        if (!t) return null;
        Object.assign(t, fields); saveFile();
        return t;
      }
      const r = must(await supa.from('tickets').update(toRow(fields, T)).eq('id', Number(id)).select(), 'tickets.patch');
      return r.length ? appT(r[0]) : null;
    },
    async remove(id) {
      if (MODE === 'file') {
        mem.tickets = mem.tickets.filter(x => !eqi(x.id, id)); saveFile();
        return;
      }
      must(await supa.from('tickets').delete().eq('id', Number(id)), 'tickets.remove');
    }
  },

  chat: {
    async list() {
      if (MODE === 'file') return mem.chat;
      return must(await supa.from('chat').select('*').order('id').limit(500), 'chat.list').map(appC);
    },
    async insert(m) {
      if (MODE === 'file') {
        const row = { id: mem.seqChat++, ...m };
        mem.chat.push(row);
        if (mem.chat.length > 200) mem.chat = mem.chat.slice(-200);
        saveFile();
        return row;
      }
      const r = must(await supa.from('chat').insert({ user: m.user, name: m.name, role: m.role, to: m.to, text: m.text, anexos: m.anexos || [] }).select().single(), 'chat.insert');
      const old = must(await supa.from('chat').select('id').order('id', { ascending: false }).range(200, 5000), 'chat.trim');
      if (old.length) must(await supa.from('chat').delete().in('id', old.map(x => x.id)), 'chat.trimdel');
      return appC(r);
    }
  },

  audit: {
    async insert(e) {
      if (MODE === 'file') {
        const row = { id: mem.seqAudit++, kind: 'ticket', changes: [], ...e, at: new Date().toISOString() };
        mem.audit.push(row);
        if (mem.audit.length > 500) mem.audit = mem.audit.slice(-500);
        saveFile();
        return row;
      }
      const body = { kind: 'cadastro', changes: [], ...e };
      const r = must(await supa.from('audit').insert({
        kind: body.kind, action: body.action || '', personid: body.personId ?? null,
        personname: body.personName || '', ticketid: body.ticketId ?? null, ref: body.ref || '',
        byuser: body.byUser || '', byname: body.byName || '', byrole: body.byRole || '',
        changes: body.changes || [], summary: body.summary || ''
      }).select().single(), 'audit.insert');
      const old = must(await supa.from('audit').select('id').order('id', { ascending: false }).range(500, 5000), 'audit.trim');
      if (old.length) must(await supa.from('audit').delete().in('id', old.map(x => x.id)), 'audit.trimdel');
      return appA(r);
    },
    async byPerson(pid) {
      if (MODE === 'file') return mem.audit.filter(a => eqi(a.personId, pid)).sort((a, b) => new Date(b.at) - new Date(a.at));
      return must(await supa.from('audit').select('*').eq('personid', Number(pid)).order('at', { ascending: false }).limit(200), 'audit.byPerson').map(appA);
    },
    async recent(limit) {
      const n = Math.min(Number(limit) || 50, 200);
      if (MODE === 'file') return [...mem.audit].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, n);
      return must(await supa.from('audit').select('*').order('at', { ascending: false }).limit(n), 'audit.recent').map(appA);
    }
  },

  users: {
    async all() {
      if (MODE === 'file') return mem.users;
      return must(await supa.from('users').select('*').order('user'), 'users.all');
    },
    async byName(u) {
      const id = String(u || '').toLowerCase().trim();
      if (MODE === 'file') return mem.users.find(x => x.user === id) || null;
      const r = must(await supa.from('users').select('*').eq('user', id).limit(1), 'users.byName');
      return r.length ? r[0] : null;
    },
    async insert(u) {
      if (MODE === 'file') { mem.users.push(u); saveFile(); return u; }
      return must(await supa.from('users').insert(u).select().single(), 'users.insert');
    },
    async patch(user, fields) {
      if (MODE === 'file') {
        const u = mem.users.find(x => x.user === user);
        if (!u) return null;
        Object.assign(u, fields); saveFile();
        return u;
      }
      const r = must(await supa.from('users').update(fields).eq('user', user).select(), 'users.patch');
      return r.length ? r[0] : null;
    },
    async remove(user) {
      if (MODE === 'file') { mem.users = mem.users.filter(x => x.user !== user); saveFile(); return; }
      must(await supa.from('users').delete().eq('user', user), 'users.remove');
    }
  },

  // Sessões persistentes (sobrevivem a restart do servidor)
  sessions: {
    async insert(token, row) {
      if (MODE === 'file') { mem.sessions[token] = row; saveFile(); return; }
      try {
        const r = await supa.from('sessions').upsert({ token, user: row.user, role: row.role, name: row.name, exp: new Date(row.exp).toISOString() }, { onConflict: 'token' });
        if (r.error) throw r.error;
      } catch (e) { warnSessions(e); memSessions.set(token, row); }
    },
    async get(token) {
      if (!token) return null;
      if (MODE === 'file') return mem.sessions[token] || null;
      try {
        const r = await supa.from('sessions').select('*').eq('token', token).limit(1);
        if (r.error) throw r.error;
        if (!r.data.length) return memSessions.get(token) || null;
        const s = r.data[0];
        return { user: s.user, role: s.role, name: s.name, exp: new Date(s.exp).getTime() };
      } catch (e) { warnSessions(e); return memSessions.get(token) || null; }
    },
    async del(token) {
      if (!token) return;
      if (MODE === 'file') { delete mem.sessions[token]; saveFile(); return; }
      try {
        const r = await supa.from('sessions').delete().eq('token', token);
        if (r.error) throw r.error;
      } catch (e) { warnSessions(e); }
      memSessions.delete(token);
    },
    async cleanup() {
      const now = Date.now();
      if (MODE === 'file') {
        let ch = false;
        for (const k of Object.keys(mem.sessions)) if (mem.sessions[k].exp < now) { delete mem.sessions[k]; ch = true; }
        if (ch) saveFile();
        return;
      }
      try {
        const r = await supa.from('sessions').delete().lt('exp', new Date(now).toISOString());
        if (r.error) throw r.error;
      } catch (e) { warnSessions(e); }
      for (const [k, s] of memSessions) if (s.exp < now) memSessions.delete(k);
    }
  },

  async backup() {
    const [persons, tickets, chat, audit, users] = await Promise.all([
      store.persons.all(), store.tickets.all(), store.chat.list(),
      store.audit.recent(500), store.users.all()
    ]);
    const mx = a => a.reduce((m, x) => Math.max(m, Number(x.id) || 0), 0);
    return {
      persons, tickets, chat: chat.slice(-200), audit: audit.slice(-500), users,
      seqPerson: mx(persons) + 1, seqTicket: mx(tickets) + 1,
      seqChat: mx(chat) + 1, seqAudit: mx(audit) + 1
    };
  },

  async restore(dump) {
    if (!dump || !Array.isArray(dump.persons) || !Array.isArray(dump.tickets) || !Array.isArray(dump.users))
      throw Object.assign(new Error('Arquivo inválido'), { status: 400 });
    if (!dump.users.some(u => u.role === 'admin' && u.active !== false))
      throw Object.assign(new Error('Arquivo inválido ou sem administrador ativo'), { status: 400 });
    dump.users.forEach(u => { if (u.active === undefined) u.active = true; });
    if (MODE === 'file') {
      const keepSessions = (mem && mem.sessions) || {};
      mem = {
        persons: dump.persons, tickets: dump.tickets,
        chat: Array.isArray(dump.chat) ? dump.chat.slice(-200) : [],
        audit: Array.isArray(dump.audit) ? dump.audit.slice(-500) : [],
        users: dump.users, sessions: keepSessions,
        seqPerson: dump.seqPerson || 1, seqTicket: dump.seqTicket || 1,
        seqChat: dump.seqChat || 1, seqAudit: dump.seqAudit || 1
      };
      saveFile();
      return { persons: mem.persons.length, tickets: mem.tickets.length, users: mem.users.length };
    }
    for (const t of ['audit', 'chat', 'tickets', 'persons']) {
      const all = must(await supa.from(t).select('id').limit(10000), 'restore.list');
      for (let i = 0; i < all.length; i += 200) {
        must(await supa.from(t).delete().in('id', all.slice(i, i + 200).map(x => x.id)), 'restore.del');
      }
    }
    const cur = await supa.from('users').select('user');
    if (!cur.error && cur.data.length) must(await supa.from('users').delete().neq('user', '__impossivel__'), 'restore.usersdel');
    const chunk = async (table, rows, map) => {
      for (let i = 0; i < rows.length; i += 100) {
        must(await supa.from(table).insert(rows.slice(i, i + 100).map(r => toRow(r, map))), 'restore.' + table);
      }
    };
    await chunk('persons', dump.persons, P);
    await chunk('tickets', dump.tickets, T);
    await chunk('chat', (dump.chat || []).slice(-200).map(m => ({ id: m.id, user: m.user, name: m.name, role: m.role, to: m.to, text: m.text, anexos: m.anexos || [] })), { id: 'id', user: 'user', name: 'name', role: 'role', to: 'to', text: 'text', anexos: 'anexos' });
    await chunk('audit', (dump.audit || []).slice(-500), A);
    await chunk('users', dump.users, { user: 'user', name: 'name', role: 'role', pass: 'pass', active: 'active' });
    must(await supa.rpc('reset_sequences'), 'restore.seq');
    return { persons: dump.persons.length, tickets: dump.tickets.length, users: dump.users.length };
  },

  // Arquivos: disco local (file) ou Supabase Storage (supabase)
  // Só tipos seguros (nada de .svg/.html que executam código no navegador)
  async saveFileUpload(file) {
    const orig = String(file.originalname || 'arquivo');
    const ext = (orig.split('.').pop() || '').toLowerCase();
    const okExt = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'txt', 'csv'];
    const okMime = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf',
      'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain', 'text/csv'];
    if (!okExt.includes(ext) || !okMime.includes(file.mimetype)) {
      const e = new Error('Tipo de arquivo não permitido: ' + orig);
      e.status = 400;
      throw e;
    }
    const safe = Date.now() + '-' + Math.round(Math.random() * 1e9) + '-' + orig.replace(/[^a-zA-Z0-9._-]/g, '_');
    if (MODE === 'file') {
      fs.writeFileSync(path.join(UPLOAD_DIR, safe), file.buffer);
      return { url: '/uploads/' + safe, name: file.originalname, size: file.size, mimetype: file.mimetype };
    }
    const up = await supa.storage.from('anexos').upload(safe, file.buffer, { contentType: file.mimetype || 'application/octet-stream', upsert: false });
    if (up.error) throw new Error('upload: ' + up.error.message);
    const pub = supa.storage.from('anexos').getPublicUrl(safe);
    return { url: pub.data.publicUrl, name: file.originalname, size: file.size, mimetype: file.mimetype };
  }
};

module.exports = store;
