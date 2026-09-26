// =====================================================================
//  Integração Calendly (https://calendly.com) — somente leitura + importação.
//  Usa Personal Access Token do servidor (env CALENDLY_TOKEN, nunca exposto
//  ao frontend). Escopos mínimos no token: scheduled_events:read,
//  event_types:read (ou token legado full).
//  Docs: https://developer.calendly.com/api-docs
// =====================================================================

const BASE = 'https://api.calendly.com';

function token() { return String(process.env.CALENDLY_TOKEN || '').trim(); }
function isConfigured() { return !!token(); }
function publicUrl() { return String(process.env.CALENDLY_URL || '').trim(); }

async function cal(path, params = {}) {
  const t = token();
  if (!t) throw Object.assign(new Error('Calendly não configurado (CALENDLY_TOKEN)'), { status: 503 });
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  const url = BASE + path + (qs.toString() ? '?' + qs.toString() : '');
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = (j && (j.message || j.title)) || ('Calendly HTTP ' + r.status);
    throw Object.assign(new Error(msg), { status: r.status === 401 || r.status === 403 ? 502 : 502 });
  }
  return j;
}

async function paginate(path, params = {}) {
  const out = [];
  let pageToken = null;
  for (let i = 0; i < 20; i++) {
    const j = await cal(path, { ...params, ...(pageToken ? { page_token: pageToken } : {}) });
    if (Array.isArray(j.collection)) out.push(...j.collection);
    pageToken = j.pagination && j.pagination.next_page_token;
    if (!pageToken) break;
  }
  return out;
}

function uuid(uri) { return String(uri || '').split('/').pop(); }

async function getMe() {
  const j = await cal('/users/me');
  return j.resource || j;
}

async function getStatus() {
  if (!isConfigured()) return { configured: false, publicUrl: publicUrl() || null };
  const me = await getMe();
  return {
    configured: true,
    publicUrl: publicUrl() || null,
    user: { uri: me.uri, name: me.name, email: me.email, schedulingUrl: me.scheduling_url },
    organization: me.current_organization || null,
  };
}

async function resolveOrgUser() {
  const me = await getMe();
  return { org: me.current_organization, userUri: me.uri };
}

async function listEventTypes() {
  if (!isConfigured()) return [];
  const { org } = await resolveOrgUser();
  const types = await paginate('/event_types', { organization: org, active: 'true', count: 100 });
  return types.map(t => ({
    uri: t.uri, name: t.name, active: !!t.active,
    durationMin: t.duration, schedulingUrl: t.scheduling_url, kind: t.kind,
  }));
}

async function listInvitees(eventUri) {
  try {
    const j = await cal('/scheduled_events/' + uuid(eventUri) + '/invitees', { count: 50 });
    return Array.isArray(j.collection) ? j.collection : [];
  } catch { return []; }
}

function mapEvent(ev, invitees = []) {
  const inv = invitees[0] || {};
  return {
    calendlyUri: ev.uri,
    title: String(ev.name || 'Reunião Calendly'),
    description: [
      inv.name ? 'Convidado: ' + inv.name : null,
      inv.email ? 'E-mail: ' + inv.email : null,
      ev.event_type ? 'Tipo: ' + String(ev.event_type).split('/').pop() : null,
    ].filter(Boolean).join(' | '),
    start: ev.start_time,
    end: ev.end_time,
    status: ev.status,
    inviteeName: inv.name || null,
    inviteeEmail: inv.email || null,
    location: (ev.location && (ev.location.location || ev.location.join_url)) || null,
  };
}

async function listUpcomingEvents({ from, to, withInvitees = true } = {}) {
  if (!isConfigured()) return [];
  const { org, userUri } = await resolveOrgUser();
  const now = new Date();
  const minTime = from || now.toISOString();
  const maxDate = to ? new Date(to) : new Date(now.getTime() + 60 * 864e5);
  const events = await paginate('/scheduled_events', {
    organization: org, user: userUri, status: 'active',
    min_start_time: minTime, max_start_time: maxDate.toISOString(),
    count: 100, sort: 'start_time:asc',
  });
  const list = events.filter(e => e && e.start_time && e.end_time);
  if (!withInvitees) return list.map(e => mapEvent(e, []));
  const out = [];
  for (const e of list.slice(0, 50)) out.push(mapEvent(e, await listInvitees(e.uri)));
  return out;
}

// Importa eventos do Calendly para a agenda local (idempotente por calendlyUri).
async function importEvents(store, user, { uris, from, to } = {}) {
  const upcoming = await listUpcomingEvents({ from, to, withInvitees: true });
  const wanted = Array.isArray(uris) && uris.length ? upcoming.filter(e => uris.includes(e.calendlyUri)) : upcoming;
  const existing = await store.agenda.allByUser(user);
  const known = new Set(existing.map(e => e.calendlyUri).filter(Boolean));
  let importados = 0, ignorados = 0;
  const itens = [];
  for (const e of wanted) {
    if (known.has(e.calendlyUri)) { ignorados++; continue; }
    const row = await store.agenda.insert({
      user, title: e.title, description: e.description || '',
      start: e.start, end: e.end, personId: null, ticketId: null,
      googleEventId: '', calendlyUri: e.calendlyUri, origem: 'calendly',
    });
    known.add(e.calendlyUri);
    importados++;
    itens.push(row);
  }
  return { importados, ignorados, total: wanted.length, itens };
}

module.exports = {
  isConfigured, publicUrl, getStatus, listEventTypes,
  listUpcomingEvents, listInvitees, importEvents, mapEvent,
};
