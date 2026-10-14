// =====================================================================
//  Termos — histórico permanente de versões + regressão anti-expiração
//  - PATCH com mudança real empilha a versão anterior (sem TTL);
//  - PATCH sem mudança NÃO cria versão (sem ruído);
//  - GET /:id/historico lista metadados; GET /:id/pdf?v=N gera o PDF fiel;
//  - POST /:id/restaurar aplica a versão guardando o estado atual;
//  - cleanupExpiredFiles (24h anexos) NUNCA toca em termos.
//  Script puro (sem framework), no estilo das demais suítes.
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
  if (roles && roles.length && !roles.includes(req.auth.role)) return res.status(403).json({ error: 'Acesso restrito ao seu perfil.' });
  next();
};
const termosRouter = require('../src/routes/termos');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use((req, res, next) => {
  const raw = req.headers['x-test-auth'] || '';
  const [role, user, name] = raw.split('|');
  req.auth = { role: role || 'tecnico', user: user || 'tec1', name: name || 'Tec Um', sistema: 'spacecom', token: 't' };
  next();
});
app.use(termosRouter);

const server = app.listen(0);
const BASE = 'http://127.0.0.1:' + server.address().port;
const AUTH = 'tecnico|tec1|Tec Um';

async function call(method, path, body, auth) {
  return fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Test-Auth': auth || AUTH },
    body: body ? JSON.stringify(body) : undefined
  });
}
async function json(method, path, body, auth) {
  const res = await call(method, path, body, auth);
  let j = null;
  try { j = await res.json(); } catch (e) {}
  return { status: res.status, body: j };
}
async function pdfText(path) {
  const res = await call('GET', path);
  const buf = Buffer.from(await res.arrayBuffer());
  const pdfParse = require('pdf-parse');
  const data = await pdfParse(buf);
  return { status: res.status, text: String(data.text || '').replace(/\s+/g, ' ') };
}

const MARK = 'HISTVER-' + Date.now();
const recBody = (descricao) => ({
  tipo: 'recolhimento',
  dados: {
    itensRecebidos: '1 tornozeleira ' + MARK,
    dataHora: '2026-09-28T14:33:00.000Z',
    equipamentos: [{ numero: '4315023610', danificado: true, checks: {} }],
    descricao, policialNome: 'Carlos Nunes', policialMat: '12345',
    tecnicoNome: 'Tec Um', tecnicoMat: '999'
  }
});

async function main() {
  console.log('\n=== TERMOS — versões permanentes ===');
  const criado = await json('POST', '/api/termos', recBody('descricao-original-' + MARK));
  assert(criado.status === 201 && criado.body && criado.body.id, 'termo criado (id=' + (criado.body && criado.body.id) + ')');
  const id = criado.body.id;

  const lista1 = await json('GET', '/api/termos');
  const naLista = (lista1.body || []).find(t => String(t.id) === String(id));
  assert(naLista && naLista.versoes === 0, 'lista expõe versoes=0 após criação');

  // 1ª edição real -> v1 guarda o original
  const p1 = await json('PATCH', '/api/termos/' + id, { dados: recBody('descricao-editada-' + MARK).dados });
  assert(p1.status === 200, 'PATCH 1: 200');
  const h1 = await json('GET', '/api/termos/' + id + '/historico');
  assert(h1.status === 200 && h1.body.total === 1, 'historico total=1 após 1ª edição');
  assert(h1.body.versoes[0] && h1.body.versoes[0].v === 1 && h1.body.versoes[0].byUser === 'tec1', 'v1 com autor/data');

  // PDF da v1 contém o texto ORIGINAL (fidelidade do snapshot)
  const pdfV1 = await pdfText('/api/termos/' + id + '/pdf?v=1');
  assert(pdfV1.status === 200 && pdfV1.text.includes('descricao-original-' + MARK), 'PDF ?v=1 fiel ao original');
  const pdfNow = await pdfText('/api/termos/' + id + '/pdf');
  assert(pdfNow.status === 200 && pdfNow.text.includes('descricao-editada-' + MARK), 'PDF atual com a edição');

  // PATCH sem mudança -> sem nova versão
  const atual = await json('GET', '/api/termos/' + id);
  const noOp = await json('PATCH', '/api/termos/' + id, { dados: atual.body.dados, dataEnvio: atual.body.dataEnvio });
  assert(noOp.status === 200, 'PATCH sem mudança: 200');
  const hNoOp = await json('GET', '/api/termos/' + id + '/historico');
  assert(hNoOp.body.total === 1, 'PATCH sem mudança não cria versão');

  // 2ª edição real -> total 2
  const p2 = await json('PATCH', '/api/termos/' + id, { dados: Object.assign({}, recBody('descricao-editada-' + MARK).dados, { descricao: 'descricao-v2-' + MARK }) });
  assert(p2.status === 200, 'PATCH 2: 200');
  const h2 = await json('GET', '/api/termos/' + id + '/historico');
  assert(h2.body.total === 2, 'historico total=2 após 2ª edição (' + h2.body.total + ')');

  // Restaurar v1 -> volta ao original e empilha o estado pré-restore
  const rst = await json('POST', '/api/termos/' + id + '/restaurar', { v: 1 });
  assert(rst.status === 200, 'restaurar v1: 200');
  const apos = await json('GET', '/api/termos/' + id);
  assert(apos.body.dados && apos.body.dados.descricao === 'descricao-original-' + MARK, 'registro voltou ao original');
  const h3 = await json('GET', '/api/termos/' + id + '/historico');
  assert(h3.body.total === 3, 'restore empilha versão (total=3)');

  // Versão inexistente / outro dono
  const v404 = await json('GET', '/api/termos/' + id + '/pdf?v=99');
  assert(v404.status === 404, 'PDF ?v=99: 404');
  const r404 = await json('POST', '/api/termos/' + id + '/restaurar', { v: 99 });
  assert(r404.status === 404, 'restaurar v99: 404');
  const alheio = await json('GET', '/api/termos/' + id + '/historico', null, 'tecnico|outro|Outro');
  assert(alheio.status === 403, 'outro dono não vê historico (403)');

  console.log('\n=== TERMOS — cleanup 24h não apaga termos (regressão) ===');
  const store = require('../store');
  const antesN = (await store.termos.all()).length;
  const ttlEnorme = 100 * 365 * 24 * 3600e3; // 100 anos: nada pode expirar
  const rel = await store.cleanupExpiredFiles(ttlEnorme);
  const depoisN = (await store.termos.all()).length;
  assert(depoisN === antesN, `termos intactos após cleanup (${antesN} -> ${depoisN})`);
  assert(rel.filesRemoved === 0 && rel.ticketsTouched === 0 && rel.chatsTouched === 0, 'cleanup com TTL enorme não toca nada');

  // limpeza: remove o termo de teste (dono pode excluir)
  const del = await json('DELETE', '/api/termos/' + id);
  assert(del.status === 200, 'termo de teste excluído');
}

main().then(() => {
  console.log(`\n=== RESULTADO: ${passed} passed, ${failed} failed ===`);
  server.close();
  process.exitCode = failed > 0 ? 1 : 0;
}).catch(e => {
  console.error(e);
  try { server.close(); } catch (_) {}
  process.exit(1);
});
