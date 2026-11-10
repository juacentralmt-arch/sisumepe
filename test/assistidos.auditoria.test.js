// Testes das funcionalidades novas do modulo Assistidos:
// aba de Auditoria (com diff campo a campo), alertas de periodicidade,
// contexto do monitorado, protocolar em lote e restaurar arquivados.
process.env.SUPABASE_URL = '';
process.env.SUPABASE_KEY = '';
const os = require('os');
const fs = require('fs');
const path = require('path');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sisumepe-assistidos-aud-'));
process.env.DB_FILE = path.join(tmpDir, 'test-db.json');
fs.writeFileSync(process.env.DB_FILE, '{}');

const store = require('../store');
const shared = require('../src/lib/shared');
shared.auth = (roles) => (req, res, next) => {
  if (!req.auth) return res.status(401).json({ error: 'sem auth (teste)' });
  if (roles && roles.length && !roles.includes(req.auth.role)) return res.status(403).json({ error: 'Acesso restrito.' });
  next();
};
const router = require('../src/routes/assistidos');

const express = require('express');
const app = express();
app.use(express.json({ limit: '2mb' }));
app.use((req, res, next) => {
  const raw = req.headers['x-test-auth'] || '';
  const [role, user, name] = raw.split('|');
  req.auth = { role: role || 'admin', user: user || 'admin', name: name || 'Admin', sistema: null, token: 't' };
  next();
});
app.use(router);
const server = app.listen(0);
const BASE = 'http://127.0.0.1:' + server.address().port;

const auth = (role, user, name) => ({ 'X-Test-Auth': `${role}|${user}|${name}`, 'Content-Type': 'application/json' });
const H = auth('admin', 'admin', 'Administrador');
const HT = auth('tecnico', 'joanderson', 'Joanderson');

let passed = 0, failed = 0;
const assert = (cond, msg) => {
  if (cond) { console.log('  ok.', msg); passed++; }
  else { console.log('  FAIL', msg); failed++; }
};
const get = async (url, headers) => (await fetch(BASE + url, { headers: headers || H })).json();
const patch = async (url, body, headers) => {
  const r = await fetch(BASE + url, { method: 'PATCH', headers: headers || H, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};
const post = async (url, body, headers) => {
  const r = await fetch(BASE + url, { method: 'POST', headers: headers || H, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};

(async () => {
  // ------------------------------------------------------------------
  console.log('\n=== ASSISTIDOS - auditoria com diff campo a campo ===');

  const cri = await post('/api/assistidos', {
    vinculo: '9100000-00.2026.8.06.0000', nome: 'AUDITORIA TESTE',
    processo: '9100000-00.2026.8.06.0000', vara: 'Vara Teste',
    localAssinatura: 'COMEP Cariri', dataInicio: '2026-01-15',
    frequencia: 'mensal', responsavelTecnico: 'Joanderson',
  });
  assert(cri.status === 201, 'POST: assistido criado para o teste');
  const aid = cri.json.id;

  // 1. A criação já aparece na trilha com os valores iniciais
  let aud = await get('/api/assistidos/auditoria?assistidoId=' + aid + '&limit=50');
  assert(aud.total >= 1, 'Auditoria: criação registrada');
  assert(aud.itens[0].acao === 'criado', 'Auditoria: ação = criado');
  assert(aud.itens[0].usuario === 'Administrador', 'Auditoria: registra o usuário');
  assert(aud.itens[0].login === 'admin', 'Auditoria: registra o login');
  assert(aud.itens[0].papel === 'admin', 'Auditoria: registra o papel');
  assert(!!aud.itens[0].at, 'Auditoria: registra data/hora');
  assert(aud.itens[0].changes.length > 0, 'Auditoria: criação traz os valores');

  // 2. Edição registra o antes/depois de cada campo
  await patch('/api/assistidos/' + aid, { nome: 'AUDITORIA TESTE 2', frequencia: 'quinzenal' });
  aud = await get('/api/assistidos/auditoria?assistidoId=' + aid + '&limit=50');
  const ed = aud.itens.find(x => x.acao === 'editado');
  assert(!!ed, 'Auditoria: edição registrada');
  const chNome = (ed.changes || []).find(c => c.campo === 'nome');
  const chFreq = (ed.changes || []).find(c => c.campo === 'frequencia');
  assert(!!chNome && chNome.de === 'AUDITORIA TESTE' && chNome.para === 'AUDITORIA TESTE 2', 'Auditoria: diff do nome (antes → depois)');
  assert(!!chFreq && chFreq.de === 'mensal' && chFreq.para === 'quinzenal', 'Auditoria: diff da frequência');
  assert(!!chNome.rotulo, 'Auditoria: campo tem rótulo legível');

  // 3. Etiqueta exige motivo e registra a troca
  const semMotivo = await patch('/api/assistidos/' + aid + '/etiqueta', { etiqueta: 'verde' });
  assert(semMotivo.status === 400, 'Etiqueta sem motivo: 400');
  const motivoCurto = await patch('/api/assistidos/' + aid + '/etiqueta', { etiqueta: 'verde', motivo: 'x' });
  assert(motivoCurto.status === 400, 'Etiqueta com motivo curto: 400');
  const comMotivo = await patch('/api/assistidos/' + aid + '/etiqueta', { etiqueta: 'verde', motivo: 'risco elevado de descumprimento' });
  assert(comMotivo.status === 200, 'Etiqueta com motivo: 200');
  aud = await get('/api/assistidos/auditoria?assistidoId=' + aid + '&limit=50');
  const et = aud.itens.find(x => x.acao === 'etiqueta');
  assert(!!et, 'Auditoria: etiqueta registrada');
  assert(/risco elevado/.test(et.resumo || ''), 'Auditoria: o motivo vai para o resumo');
  assert((et.changes || []).some(c => c.campo === 'etiqueta' && c.para === 'verde'), 'Auditoria: diff da etiqueta');

  // 4. Comparecimento e juntada também entram na trilha
  const comp = await post('/api/assistidos/' + aid + '/comparecimentos', {
    dataComparecimento: '2026-11-05', ppPlantao: 'PP Teste', observacao: 'obs de teste',
  });
  assert(comp.status === 201, 'Comparecimento criado');
  const cid = comp.json.id;
  await patch('/api/assistidos/comparecimentos/' + cid + '/juntada', { juntada: '99999' }, HT);
  aud = await get('/api/assistidos/auditoria?assistidoId=' + aid + '&limit=50');
  const ju = aud.itens.find(x => x.acao === 'juntada');
  assert(!!ju, 'Auditoria: juntada registrada');
  assert((ju.changes || []).some(c => c.campo === 'juntada' && c.para === '99999'), 'Auditoria: diff da juntada');
  assert((ju.changes || []).some(c => c.campo === 'protocolado' && c.para === 'true'), 'Auditoria: diff do protocolado');
  assert((ju.changes || []).some(c => c.campo === 'protocoladoPor' && c.para === 'Joanderson'), 'Auditoria: registra quem protocolou');
  const acc = aud.itens.find(x => x.acao === 'comparecimento');
  assert(!!acc && (acc.changes || []).some(c => c.campo === 'dataComparecimento'), 'Auditoria: comparecimento com a data');

  // 5. Filtros da aba
  const porAcao = await get('/api/assistidos/auditoria?acao=juntada&limit=50');
  assert(porAcao.itens.every(x => x.acao === 'juntada'), 'Auditoria: filtro por ação');
  const porUsuario = await get('/api/assistidos/auditoria?usuario=joanderson&limit=50');
  assert(porUsuario.itens.every(x => x.login === 'joanderson'), 'Auditoria: filtro por usuário');
  assert(porUsuario.total >= 1, 'Auditoria: filtro por usuário encontra o registro');
  const porAss = await get('/api/assistidos/auditoria?assistidoId=' + aid + '&limit=50');
  assert(porAss.itens.every(x => String(x.assistidoId) === String(aid)), 'Auditoria: filtro por assistido');
  assert(Array.isArray(aud.acoes) && aud.acoes.includes('editado'), 'Auditoria: lista as ações para o filtro');
  const porBusca = await get('/api/assistidos/auditoria?q=AUDITORIA%20TESTE&limit=50');
  assert(porBusca.total >= 1, 'Auditoria: busca por texto');

  // ------------------------------------------------------------------
  console.log('\n=== ASSISTIDOS - alertas de periodicidade ===');
  const alertas = await get('/api/assistidos/alertas');
  assert(typeof alertas.total === 'number', 'Alertas: total numérico');
  assert(Array.isArray(alertas.alertas), 'Alertas: lista');
  assert(!!alertas.porTipo, 'Alertas: contagem por tipo');
  const semCmp = alertas.alertas.find(a => a.tipo === 'sem_comparecimento');
  if (semCmp) {
    assert(!!semCmp.assistidoId && !!semCmp.texto, 'Alertas: registro tem assistido e texto');
  } else {
    assert(true, 'Alertas: sem registro de "nunca compareceu" (base completa)');
  }

  // ------------------------------------------------------------------
  console.log('\n=== ASSISTIDOS - contexto do monitorado ===');
  const ctx = await get('/api/assistidos/' + aid + '/contexto');
  assert(ctx.assistido && String(ctx.assistido.id) === String(aid), 'Contexto: dados do assistido');
  assert(ctx.totalComparecimentos === 1, 'Contexto: total de comparecimentos');
  assert(!!ctx.ultimoComparecimento, 'Contexto: último comparecimento');
  assert(!!ctx.proximoEsperado, 'Contexto: próximo esperado');
  assert(typeof ctx.diasDesdeUltimo === 'number', 'Contexto: dias desde o último');
  assert(typeof ctx.faltasConsecutivas === 'number', 'Contexto: faltas consecutivas');
  const ctx404 = await fetch(BASE + '/api/assistidos/999999/contexto', { headers: H });
  assert(ctx404.status === 404, 'Contexto: assistido inexistente → 404');

  // ------------------------------------------------------------------
  console.log('\n=== ASSISTIDOS - protocolar em lote ===');
  const c2 = await post('/api/assistidos/' + aid + '/comparecimentos', { dataComparecimento: '2026-11-06', ppPlantao: 'PP Lote' });
  const c3 = await post('/api/assistidos/' + aid + '/comparecimentos', { dataComparecimento: '2026-11-07', ppPlantao: 'PP Lote' });
  const c2id = c2.json.id, c3id = c3.json.id;

  const loteVazio = await post('/api/assistidos/comparecimentos/juntada-lote', { juntada: '1' });
  assert(loteVazio.status === 400, 'Lote sem ids: 400');
  const loteSemJuntada = await post('/api/assistidos/comparecimentos/juntada-lote', { ids: [c2id] });
  assert(loteSemJuntada.status === 400, 'Lote sem número de juntada: 400');

  const lote = await post('/api/assistidos/comparecimentos/juntada-lote', { ids: [c2id, c3id], juntada: '77777' }, HT);
  assert(lote.status === 200, 'Lote: 200');
  assert(lote.json.protocolados === 2, 'Lote: 2 comparecimentos protocolados');
  assert(lote.json.erros.length === 0, 'Lote: sem erros');

  const c2depois = await get('/api/assistidos/' + aid + '/detalhe');
  const comp2 = (c2depois.comparecimentos || []).find(x => String(x.id) === String(c2id));
  assert(comp2 && comp2.protocolado === true, 'Lote: comparecimento marcado como protocolado');
  assert(comp2 && comp2.juntada === '77777', 'Lote: número da juntada gravado');
  assert(comp2 && comp2.protocoladoPor === 'Joanderson', 'Lote: registra quem protocolou');

  // Reexecutar o mesmo lote não duplica
  const lote2 = await post('/api/assistidos/comparecimentos/juntada-lote', { ids: [c2id, c3id], juntada: '88888' }, HT);
  assert(lote2.json.protocolados === 0, 'Lote: não reprotocola o que já estava protocolado');
  assert(lote2.json.erros.length === 2, 'Lote: reporta os já protocolados');

  aud = await get('/api/assistidos/auditoria?limit=50');
  const loteAud = aud.itens.find(x => x.acao === 'juntada_lote');
  assert(!!loteAud, 'Auditoria: lote registrado');
  assert(/2 comparecimento/.test(loteAud.resumo || ''), 'Auditoria: resumo do lote com a contagem');

  // ------------------------------------------------------------------
  console.log('\n=== ASSISTIDOS - arquivar e restaurar ===');
  const arq = await fetch(BASE + '/api/assistidos/' + aid, { method: 'DELETE', headers: H, body: JSON.stringify({ motivo: 'teste de restauração' }) });
  assert(arq.status === 200, 'DELETE: arquivado');
  const arqList = await get('/api/assistidos/arquivados');
  assert(arqList.total >= 1, 'Arquivados: lista o arquivado');
  assert(arqList.itens.some(x => String(x.id) === String(aid)), 'Arquivados: contém o registro');
  const getArq = await fetch(BASE + '/api/assistidos/' + aid, { headers: H });
  assert(getArq.status === 404, 'Arquivado: GET por id → 404');

  const rest = await patch('/api/assistidos/' + aid + '/restaurar', {});
  assert(rest.status === 200, 'Restaurar: 200');
  const getRest = await fetch(BASE + '/api/assistidos/' + aid, { headers: H });
  assert(getRest.status === 200, 'Restaurar: volta a aparecer');
  aud = await get('/api/assistidos/auditoria?limit=50');
  assert(aud.itens.some(x => x.acao === 'restaurado'), 'Auditoria: restauração registrada');

  // ------------------------------------------------------------------
  console.log('\n==================== RESUMO ====================');
  console.log(`Testes: OK=${passed} | Falha=${failed}`);
  process.exit(failed ? 1 : 0);
})();
