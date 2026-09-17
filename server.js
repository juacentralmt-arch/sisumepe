require('dotenv').config();
const express = require('express');
const path = require('path');
const store = require('./store');
const shared = require('./src/lib/shared');

const app = express();
const PORT = shared.PORT;
const ROOT = shared.ROOT;

app.disable('x-powered-by');
app.set('trust proxy', 1);

// Cabeçalhos de segurança
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self)');
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

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(ROOT, 'public')));
app.use('/uploads', express.static(path.join(ROOT, 'uploads')));

app.get('/api/health', (req, res) => res.json({ ok: true, store: store.mode }));

app.get('/api/events', shared.auth(), (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
  shared.sseClients.push(res);
  req.on('close', () => { const i = shared.sseClients.indexOf(res); if (i >= 0) shared.sseClients.splice(i, 1); });
});

app.use(require('./src/routes/auth'));
app.use(require('./src/routes/chat'));
app.use(require('./src/routes/persons'));
app.use(require('./src/routes/tickets'));
app.use(require('./src/routes/admin'));
app.use(require('./src/routes/google'));
app.use(require('./src/routes/agenda'));
app.use(require('./src/routes/termos'));

// Painel TV público (sem login): só o mínimo necessário à chamada
app.get('/api/tv', shared.ah(async (req, res) => {
  const all = await store.tickets.all();
  const persons = await store.persons.all();
  const queue = shared.sortQueue(all.filter(t => t.status === 'aguardando')).map(t => {
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
    return res.status(400).json({ error: 'Arquivo muito grande ou em excesso (máx. 15MB cada, 20 por vez).' });
  next(err);
});

app.listen(PORT, '0.0.0.0', () => console.log(`SISUMEPE Juazeiro [${store.mode}] rodando em http://localhost:${PORT}`));

// Expiração de anexos de tickets fechados (padrão 24h, via FILES_TTL_HOURS)
setTimeout(() => { store.cleanupExpiredFiles().catch(() => {}); }, 60e3).unref();
setInterval(() => { store.cleanupExpiredFiles().catch(() => {}); }, 3600e3).unref();
