// =====================================================================
//  Regressão do render da FILA e da VISÃO 360 (public/js/app.js).
//
//  Bug corrigido: loadAll() exigia `session.token` para rodar. Como o token
//  NUNCA é persistido no navegador (a sessão vive no cookie httpOnly),
//  `session.token` era sempre undefined -> loadAll() retornava antes de
//  renderFila() -> a fila, as estatísticas (stAguard/stAtend/stFin/stPes) e
//  a atualização em tempo real (SSE) NUNCA apareciam na tela.
//
//  Os testes exercitam o código real do front-end extraído do app.js e
//  executado em sandbox (sem navegador), com as dependências injetadas.
// =====================================================================
let passed = 0, failed = 0;
const assert = (cond, msg) => {
  if (cond) { console.log('  ✅', msg); passed++; }
  else { console.log('  ❌', msg); failed++; }
};

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = path.join(__dirname, '..', 'public', 'js', 'app.js');
const SHARED = path.join(__dirname, '..', 'src', 'lib', 'shared.js');
const appSrc = fs.readFileSync(APP, 'utf8');
const sharedSrc = fs.readFileSync(SHARED, 'utf8');

// Extrai o corpo de uma função do código-fonte (sem executá-la ainda).
function extract(src, name) {
  const re = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\(');
  const m = re.exec(src);
  if (!m) throw new Error('função não encontrada no fonte: ' + name);
  let i = src.indexOf('{', m.index);
  let depth = 0;
  const start = i;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(m.index, i);
}

// Monta o sandbox do app.js com o necessário para rodar loadAll().
function sandboxLoadAll(opts) {
  const el = () => ({ textContent: '', innerHTML: '', className: '', classList: { add(){}, remove(){}, toggle(){} } });
  const calls = { api: [], renderFila: 0, renderTec: 0, toast: [] };
  const ctx = {
    console: { log(){}, error(){}, warn(){} },
    JSON, Date, Math, Set, Map, Number, String, Object, Array, Promise, Boolean,
    session: opts.session,
    tickets: [],
    lastTicketsHash: null,
    lastFullRenderAt: 0,
    seenInit: false,
    seenMaxTicket: 0,
    esc: (s) => String(s == null ? '' : s),
    chime() {},
    toast: (m) => { calls.toast.push(m); },
    deveAlertar: () => false,
    renderFila: () => { calls.renderFila++; },
    renderTec: () => { calls.renderTec++; },
    api: async (p) => { calls.api.push(p); return opts.api(p); },
    document: {
      getElementById: (id) => {
        if (id === 'filaList') { calls.filaList = el(); return calls.filaList; }
        return el();
      },
    },
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(extract(appSrc, 'loadAll') + '\n;globalThis.__loadAll = loadAll;', ctx);
  return { loadAll: ctx.__loadAll, calls };
}

(async function main(){
// ---------------------------------------------------------------------
console.log('\n=== FILA — loadAll renderiza mesmo sem token em memória ===');
{
  const r = sandboxLoadAll({
    // Sessão real do app: o token NÃO é persistido (cookie httpOnly).
    session: { user: 'joanderson', role: 'tecnico', name: 'Joanderson', sistema: 'spacecom' },
    api: async (p) => (p === '/api/tickets'
      ? [{ id: 1, code: 'TK-0001', status: 'aguardando', createdAt: new Date().toISOString() }]
      : { aguardando: 1, em_atendimento: 0, finalizados: 0, totalPessoas: 1 }),
  });
  await r.loadAll();
  assert(r.calls.api.includes('/api/tickets'), 'loadAll busca /api/tickets sem token');
  assert(r.calls.renderFila === 1, 'loadAll chama renderFila() sem token (fila aparece)');
  assert(r.calls.renderTec === 1, 'loadAll chama renderTec() sem token');
}
{
  const r = sandboxLoadAll({
    session: { user: 'joanderson', role: 'tecnico', name: 'Joanderson', token: 'abc' },
    api: async (p) => (p === '/api/tickets' ? [] : { aguardando: 0, em_atendimento: 0, finalizados: 0, totalPessoas: 0 }),
  });
  await r.loadAll();
  assert(r.calls.renderFila === 1, 'loadAll chama renderFila() com token em memória');
}
{
  // Sessão encerrada: não deve renderizar nada.
  const r = sandboxLoadAll({
    session: null,
    api: async () => { throw new Error('não deve ser chamado'); },
  });
  await r.loadAll();
  assert(r.calls.renderFila === 0, 'sem sessão, loadAll não renderiza');
}

// ---------------------------------------------------------------------
console.log('\n=== FILA — erro na API aparece na tela (não some em silêncio) ===');
{
  const r = sandboxLoadAll({
    session: { user: 'joanderson', role: 'tecnico', name: 'Joanderson' },
    api: async () => { throw new Error('Sessão expirada. Entre novamente.'); },
  });
  await r.loadAll();
  assert(r.calls.renderFila === 0, 'com erro na fila, renderFila não roda');
  assert(!!r.calls.filaList && /Falha ao carregar a fila/.test(r.calls.filaList.innerHTML),
    'erro da fila aparece dentro de #filaList');
  assert(r.calls.toast.some(t => /Falha ao carregar a fila/.test(t)), 'erro da fila gera aviso (toast)');
}
{
  // Só /api/stats falha: a lista da fila DEVE continuar aparecendo.
  const r = sandboxLoadAll({
    session: { user: 'joanderson', role: 'tecnico', name: 'Joanderson' },
    api: async (p) => {
      if (p === '/api/stats') throw new Error('estatísticas indisponíveis');
      return [];
    },
  });
  await r.loadAll();
  assert(r.calls.renderFila === 1, 'falha só nas estatísticas não impede a fila de renderizar');
  assert(r.calls.toast.some(t => /Estatísticas indisponíveis/.test(t)), 'falha nas estatísticas gera aviso');
}

// ---------------------------------------------------------------------
console.log('\n=== APP — nenhum bloqueio por session.token no fluxo da fila ===');
{
  assert(!/if\(!session \|\| !session\.token\)/.test(appSrc),
    'loadAll não exige session.token (causa raiz da fila vazia)');
  assert(!/session\.token\) *return/.test(appSrc),
    'nenhuma função de carga da fila aborta por falta de token');
  // O token é persistido? Não deve ser (a sessão vive no cookie httpOnly).
  assert(/function saveSession\(\)/.test(appSrc), 'existe saveSession() que grava a sessão sem o token');
  const saveBody = extract(appSrc, 'saveSession');
  assert(!/token/.test(saveBody), 'saveSession() não persiste o token no localStorage');
  assert(/token: s\.token/.test(appSrc), 'o login guarda o token em memória');
  assert(/if \(r && r\.token\) session\.token = r\.token/.test(appSrc),
    'troca de senha atualiza o token em memória');
}

// ---------------------------------------------------------------------
console.log('\n=== VISÃO 360 — guards de DOM (aba não pode ficar em branco) ===');
{
  const gate = extract(appSrc, 'renderVisaoGate');
  assert(/if\(l\)/.test(gate) && /if\(b\)/.test(gate), 'renderVisaoGate protege visaoLock/visaoBody');
  const busca = extract(appSrc, 'buscarVisao');
  assert(/if\(!inp \|\| !res\) return;/.test(busca), 'buscarVisao sai com segurança se a seção não existir');
  const go = extract(appSrc, 'go');
  assert(/if\(tabEl\) tabEl\.classList\.remove\('hidden'\)/.test(go), 'go() protege aba inexistente');
  assert(go.includes("'visao'"), 'go() conhece a aba visao');
}

// ---------------------------------------------------------------------
console.log('\n=== RATE LIMIT — SSE/health/TV isentos (path relativo no app.use) ===');
{
  const fn = extract(sharedSrc, 'apiRateLimit');
  const sandbox = { console, apiHits: new Map(), API_WINDOW_MS: 60e3, API_MAX: 300 };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fn + '\n;globalThis.__f = apiRateLimit;', sandbox);
  const call = (p, ip) => {
    let nexted = false;
    const res = { status() { return { json() { return { blocked: true }; } }; } };
    sandbox.__f({ path: p, ip: ip || '1.1.1.1' }, res, () => { nexted = true; });
    return nexted;
  };
  // 400 conexões SSE não podem gastar a cota da API (o app.use monta o
  // middleware com o prefixo '/api', então req.path é relativo).
  let sseOk = 0;
  for (let i = 0; i < 400; i++) if (call('/events')) sseOk++;
  assert(sseOk === 400, 'SSE (path relativo /events) não consome cota');
  assert(call('/health') === true, '/health não consome cota');
  assert(call('/tv') === true, '/tv não consome cota');
  assert(call('/api/events') === true, 'SSE (path absoluto) não consome cota');
  // Rotas normais continuam limitadas: 300 passes OK, o 301º leva 429.
  let ok = 0, blocked = 0;
  for (let i = 0; i < 305; i++) {
    try { if (call('/tickets', '2.2.2.2')) ok++; else blocked++; }
    catch (e) { blocked++; }
  }
  assert(ok === 300, 'rotas normais seguem limitadas em 300/min (ok=' + ok + ')');
  assert(blocked === 5, 'excedente da cota é bloqueado com 429 (bloq=' + blocked + ')');
}

  console.log(`\n=== RESULTADO: ${passed} passed, ${failed} failed ===`);
  process.exit(failed ? 1 : 0);
})();
