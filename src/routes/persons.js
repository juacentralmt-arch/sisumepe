const express = require('express');
const shared = require('../lib/shared');
const { store, ah, auth, broadcast, issueToken, loginRateLimit, isHash, upload, mapFiles, sortQueue, enrich, enrichAll, invalidatePersonsCache, ticketOwnerOf, infinityBlocked, PERSON_LABELS, MOTIVOS_OK, getGoogleConfig, makeOAuthClient, getAuthedClientForUser, syncAgendaToGoogle, pendingGoogleStates, ROOT, PORT } = shared;
const router = express.Router();

// Persons
router.get('/api/persons', auth(), ah(async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 0, 0), 50);
  res.json(await store.persons.search(req.query.q || '', limit || undefined));
}));

router.get('/api/persons/:id', auth(['tecnico', 'admin']), ah(async (req, res) => {
  const p = await store.persons.byId(req.params.id);
  if (!p) return res.status(404).json({ error: 'Não encontrado' });
  const all = await store.tickets.all();
  const persons = await store.persons.all();
  const tickets = all.filter(t => String(t.personId) === String(p.id)).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const audit = await store.audit.byPerson(p.id);
  res.json({ person: p, tickets: tickets.map(t => enrich(t, persons)), audit });
}));

router.post('/api/persons', auth(), ah(async (req, res) => {
  const { nome, cpf, rg, nomeMae, dataNascimento, modeloTornozeleira } = req.body || {};
  if (!nome || !nome.trim()) return res.status(400).json({ error: 'Nome é obrigatório' });
  if (!cpf && !rg) return res.status(400).json({ error: 'Informe CPF ou RG' });
  if (!['Spacecom', 'Infinity', 'Sem tornozeleira'].includes(modeloTornozeleira)) return res.status(400).json({ error: 'Selecione o modelo da tornozeleira (Spacecom, Infinity ou Sem tornozeleira)' });
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
  invalidatePersonsCache();
  broadcast();
  res.status(201).json(person);
}));

router.patch('/api/persons/:id', auth(), ah(async (req, res) => {
  const p = await store.persons.byId(req.params.id);
  if (!p) return res.status(404).json({ error: 'Atendido não encontrado' });
  const editor = await store.users.byName(req.auth.user);
  if (!editor) return res.status(401).json({ error: 'Sessão inválida' });
  const fields = ['nome', 'cpf', 'rg', 'nomeMae', 'dataNascimento', 'modeloTornozeleira'];
  const next = {};
  fields.forEach(f => { next[f] = f === 'dataNascimento' ? String((req.body && req.body[f]) || '') : String((req.body && req.body[f]) || '').trim(); });
  if (!next.nome) return res.status(400).json({ error: 'Nome é obrigatório' });
  if (!next.cpf && !next.rg) return res.status(400).json({ error: 'Informe CPF ou RG' });
  if (!['Spacecom', 'Infinity', 'Sem tornozeleira'].includes(next.modeloTornozeleira)) return res.status(400).json({ error: 'Selecione o modelo da tornozeleira (Spacecom, Infinity ou Sem tornozeleira)' });
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
  invalidatePersonsCache();
  broadcast();
  res.json({ person: upd, changes });
}));

module.exports = router;
