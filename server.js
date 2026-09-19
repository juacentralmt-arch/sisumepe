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
app.use(shared.requestId);
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self)');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  // HSTS só faz sentido atrás de HTTPS (Render define FORCE_HTTPS=1)
  if (process.env.FORCE_HTTPS === '1')
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
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

app.use(express.json({ limit: '2mb' }));
app.use('/api', shared.apiRateLimit);
// Compressão gzip para respostas HTTP (o SSE fica de fora: buffer interferiria no stream)
const { compression } = (() => { try { return { compression: require('compression') }; } catch { return { compression: null }; } })();
if (compression) app.use((req, res, next) => {
  if (req.path === '/api/events') return next();
  compression({ filter: (rq, rs) => (rs.getHeader('Content-Type') || '').toString().startsWith('text/event-stream') ? false : require('compression').filter(rq, rs) })(req, res, next);
});
app.use(express.static(path.join(ROOT, 'public'), { maxAge: '1h', etag: true }));
app.use('/uploads', express.static(path.join(ROOT, 'uploads'), {
  maxAge: '1h',
  setHeaders: (res) => { res.setHeader('X-Content-Type-Options', 'nosniff'); }
}));

app.get('/api/health', (req, res) => res.json({
  ok: true, store: store.mode,
  version: require('./package.json').version || '1.0.0',
  uptime_s: Math.round(process.uptime()),
  sse_clients: shared.sseClients.length,
  now: new Date().toISOString()
}));

app.get('/api/events', shared.auth(), (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
  const client = shared.addSseClient(res, req.auth.user);
  req.on('close', () => shared.removeSseClient(client));
  // Heartbeat: evita que proxies (Render) encerrem conexões ociosas
  const hb = setInterval(() => { try { res.write(': hb\n\n'); } catch {} }, 25000);
  req.on('close', () => clearInterval(hb));
});

app.use(require('./src/routes/auth'));
app.use(require('./src/routes/chat'));
app.use(require('./src/routes/persons'));
app.use(require('./src/routes/tickets'));
app.use(require('./src/routes/admin'));
app.use(require('./src/routes/google'));
app.use(require('./src/routes/agenda'));
app.use(require('./src/routes/termos'));
app.use(require('./src/routes/psico'));
app.use(require('./src/routes/scanner'));

// Painel TV público (sem login): só o mínimo necessário à chamada.
// Nome exibido em primeiro nome + inicial (LGPD: menos exposição em tela pública).
app.get('/api/tv', shared.ah(async (req, res) => {
  const all = await store.tickets.all();
  const persons = await store.persons.all();
  const queue = shared.sortQueue(all.filter(t => t.status === 'aguardando')).map(t => {
    const p = persons.find(x => String(x.id) === String(t.personId));
    return {
      id: t.id, code: t.code, nome: shared.shortName(p ? p.nome : '-'),
      motivo: t.motivo || '', modelo: t.modeloTornozeleira || '',
      prioridade: !!t.prioridadeLegal,
      called: !!t.called, calledAt: t.calledAt || null, createdAt: t.createdAt
    };
  });
  res.json({ queue, now: new Date().toISOString() });
}));

app.get('/tv', (req, res) => res.sendFile(path.join(ROOT, 'public', 'tv.html')));

// Rotas de API desconhecidas: 404 JSON (não cair no catch-all da SPA)
app.use('/api', (req, res) => res.status(404).json({ error: 'Rota de API não encontrada' }));

app.get('*', (req, res) => res.sendFile(path.join(ROOT, 'public', 'index.html')));

// Erros de upload e JSON inválido viram 400 JSON (nunca HTML)
app.use((err, req, res, next) => {
  if (err && (err.code === 'LIMIT_FILE_SIZE' || err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE'))
    return res.status(400).json({ error: 'Arquivo muito grande ou em excesso (máx. 15MB cada, 20 por vez).' });
  if (err && (err.type === 'entity.parse.failed' || err.type === 'entity.too.large'))
    return res.status(400).json({ error: 'Corpo da requisição inválido ou grande demais.' });
  next(err);
});

const server = app.listen(PORT, '0.0.0.0', () => console.log(`SISUMEPE Juazeiro [${store.mode}] rodando em http://localhost:${PORT}`));

// Auto-seed na nuvem: garante as contas padrão (psicologo, recepcao, admin...)
// sem tocar em quem já existe. É o que recria o psicólogo se a linha sumir.
store.users.ensureSeeded()
  .then(r => { if (r && r.created && r.created.length) console.log('Seed: usuários criados no banco:', r.created.join(', ')); })
  .catch(() => {});

// Expiração de anexos de tickets fechados (padrão 24h, via FILES_TTL_HOURS)
setTimeout(() => { store.cleanupExpiredFiles().catch(() => {}); }, 60e3).unref();
setInterval(() => { store.cleanupExpiredFiles().catch(() => {}); }, 3600e3).unref();

// Encerramento limpo (Render envia SIGTERM ao redeploys): para de aceitar
// conexões, responde o que está em voo e sai — sem cortar requests ativos.
let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} recebido: encerrando com elegância...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 8000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
