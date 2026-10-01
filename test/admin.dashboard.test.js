// =====================================================================
//  Testes do payload do Dashboard gerencial (GET /api/dashboard).
//  Somente leitura — não escreve no banco. Garante as chaves que o
//  frontend consome (KPIs, funil, rankings, produtividade por criador).
// =====================================================================
let passed = 0, failed = 0;
const assert = (cond, msg) => {
  if (cond) { console.log('  ✅', msg); passed++; }
  else { console.log('  ❌', msg); failed++; }
};

process.env.SUPABASE_URL = '';
process.env.SUPABASE_KEY = '';

const express = require('express');
const shared = require('../src/lib/shared');
shared.auth = (roles) => (req, res, next) => {
  if (!req.auth) return res.status(401).json({ error: 'sem auth (teste)' });
  if (roles && roles.length && !roles.includes(req.auth.role)) return res.status(403).json({ error: 'Acesso restrito.' });
  next();
};
const adminRouter = require('../src/routes/admin');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use((req, res, next) => {
  const raw = req.headers['x-test-auth'] || '';
  const [role, user, name] = raw.split('|');
  req.auth = { role: role || 'admin', user: user || 'admin', name: name || 'Admin', sistema: null, token: 't' };
  next();
});
app.use(adminRouter);

const server = app.listen(0);
const BASE = 'http://127.0.0.1:' + server.address().port;

(async () => {
  console.log('\n=== DASHBOARD — payload gerencial ===');
  const res = await fetch(BASE + '/api/dashboard', { headers: { 'X-Test-Auth': 'admin|admin|Admin' } });
  assert(res.status === 200, 'dashboard: 200 p/ admin');
  const d = await res.json();

  for (const k of ['total', 'aguardando', 'emAtendimento', 'finalizados', 'hoje', 'hojeFinalizados', 'esperaMediaMin', 'atendimentoMedioMin', 'esperaAlta', 'cancelados', 'prioridade']) {
    assert(typeof d[k] === 'number', 'dashboard: KPI numérico ' + k);
  }
  for (const k of ['byMotivo', 'byModelo', 'bySetor', 'bySetorDetalhado', 'byMotivoDetalhado', 'byMotivoFinalizados', 'byDay']) {
    assert(d[k] && typeof d[k] === 'object', 'dashboard: mapa ' + k);
  }
  assert(Array.isArray(d.byTec), 'dashboard: byTec é lista');
  assert(Array.isArray(d.byCriador), 'dashboard: byCriador é lista');
  if (d.byCriador.length) {
    const c = d.byCriador[0];
    assert(typeof c.nome === 'string' && typeof c.criados === 'number', 'dashboard: criador tem nome+criados');
    const ordenado = d.byCriador.every((x, i, a) => i === 0 || a[i - 1].criados >= x.criados);
    assert(ordenado, 'dashboard: byCriador ordenado por criados desc');
  }
  if (d.byTec.length) {
    const t0 = d.byTec[0];
    assert(typeof t0.iniciados === 'number' && typeof t0.finalizados === 'number', 'dashboard: técnico tem iniciados+finalizados');
    assert(t0.tempoMedioMin === null || typeof t0.tempoMedioMin === 'number', 'dashboard: técnico tem tempoMedioMin');
  }
  const taxa = d.total ? d.finalizados / d.total : 0;
  assert(taxa >= 0 && taxa <= 1, 'dashboard: taxa de conclusão válida');

  const res403 = await fetch(BASE + '/api/dashboard', { headers: { 'X-Test-Auth': 'recepcao|rec|Rec' } });
  assert(res403.status === 403, 'dashboard: recepção bloqueada (403)');

  server.close();
  console.log(`\n=== RESULTADO: ${passed} passed, ${failed} failed ===`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FALHA:', e); server.close(); process.exit(1); });
