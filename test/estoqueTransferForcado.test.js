// =====================================================================
//  Testes da transferência forçada ("disponível para uso").
//  Sem forçar: serial fora de disponibilidade na origem barra (400).
//  Forçando: viaja mesmo assim e chega DISPONÍVEL no destino.
//  Caminho normal preservado. Banco local com backup/restore no processo.
//  Script puro (sem framework), no estilo das demais suítes do projeto.
// =====================================================================
let passed = 0, failed = 0;
const assert = (cond, msg) => {
  if (cond) { console.log('  ✅', msg); passed++; }
  else { console.log('  ❌', msg); failed++; }
};

process.env.SUPABASE_URL = '';
process.env.SUPABASE_KEY = '';

const fs = require('fs');
const path = require('path');
const express = require('express');
const shared = require('../src/lib/shared');
shared.auth = (roles) => (req, res, next) => {
  if (!req.auth) return res.status(401).json({ error: 'sem auth (teste)' });
  if (roles && roles.length && !roles.includes(req.auth.role)) return res.status(403).json({ error: 'Acesso restrito ao seu perfil.' });
  next();
};
const estoqueRouter = require('../src/routes/estoque');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use((req, res, next) => {
  req.auth = { role: 'tecnico', user: 'tec1', name: 'Tec Um', sistema: 'spacecom', token: 't' };
  next();
});
app.use(estoqueRouter);

const server = app.listen(0);
const BASE = 'http://127.0.0.1:' + server.address().port;
const post = async (p, body) => {
  const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
const get = async (p) => {
  const r = await fetch(BASE + p);
  return { status: r.status, body: await r.json().catch(() => null) };
};

const DB = path.join(__dirname, '..', 'db.json');
const backup = fs.readFileSync(DB, 'utf8');
function restore() { try { fs.writeFileSync(DB, backup); } catch (e) { console.log('  ⚠️ restore:', e.message); } }

const S1 = '4319870001', S2 = '4319870002', S3 = '4319870003';
const serialInfo = async (s) => {
  const r = await get('/api/estoque/seriais?q=' + s + '&limit=all');
  return (r.body || []).find(x => String(x.serial) === s);
};

(async () => {
  try {
    console.log('\n=== TRANSFERÊNCIA — modo disponível para uso ===');
    const e1 = await post('/api/estoque/movimentar', { contrato: 'CE01', material: 'TZPR04', unidade: 'UMEPE Juazeiro', qtd: 2, motivo: 'teste setup', seriais: [S1, S2] });
    assert(e1.status === 200, 'setup: entrada 2x TZPR04 UMEPE');
    const s1 = await post('/api/estoque/movimentar', { contrato: 'CE01', material: 'TZPR04', unidade: 'UMEPE Juazeiro', qtd: -1, motivo: 'teste baixa', seriais: [S1] });
    assert(s1.status === 200, 'setup: saída 1x (serial em_uso)');

    const t1 = await post('/api/estoque/transferir', { contrato: 'CE01', material: 'TZPR04', qtd: 1, unidadeOrigem: 'UMEPE Juazeiro', unidadeDestino: 'UP-Cariri', motivo: 'teste normal bloqueado', seriais: [S1] });
    assert(t1.status === 400, 'sem forçar: serial fora de disponibilidade barra (400)');

    const t2 = await post('/api/estoque/transferir', { contrato: 'CE01', material: 'TZPR04', qtd: 1, unidadeOrigem: 'UMEPE Juazeiro', unidadeDestino: 'UP-Cariri', motivo: 'teste forcado', seriais: [S1], forcarDisponivel: true });
    assert(t2.status === 200, 'forçando: transferência 200');
    const info = await serialInfo(S1);
    assert(info && info.status === 'disponivel' && info.unidade === 'UP-Cariri', 'forçando: serial chega DISPONÍVEL em UP-Cariri');

    console.log('\n=== TRANSFERÊNCIA — caminho normal preservado ===');
    const e3 = await post('/api/estoque/movimentar', { contrato: 'CE01', material: 'TZPR04', unidade: 'UMEPE Juazeiro', qtd: 1, motivo: 'teste setup 2', seriais: [S3] });
    assert(e3.status === 200, 'setup: entrada 1x');
    const t3 = await post('/api/estoque/transferir', { contrato: 'CE01', material: 'TZPR04', qtd: 1, unidadeOrigem: 'UMEPE Juazeiro', unidadeDestino: 'UP-Cariri', motivo: 'teste normal', seriais: [S3] });
    assert(t3.status === 200, 'normal: serial disponível transfere sem forçar');
    const info3 = await serialInfo(S3);
    assert(info3 && info3.status === 'disponivel' && info3.unidade === 'UP-Cariri', 'normal: destino recebe disponível');
  } finally {
    restore();
    server.close();
  }
  console.log(`\n=== RESULTADO: ${passed} passed, ${failed} failed ===`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FALHA:', e); try { restore(); } catch (_) {} server.close(); process.exit(1); });
