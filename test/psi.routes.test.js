// =====================================================================
//  Testes de integração do módulo Psicossocial — sigilo e LGPD
//  Foco no que protege dado sensível de saúde e que não tinha cobertura:
//   - perfil errado nunca acessa (tecnico/recepcao = 403 sempre);
//   - admin só entra em modo emergencial justificado (motivo >= 10) e
//     cada acesso gera trilha kind=psi/action=breakglass;
//   - DELETE arquiva (exclusão lógica) — o registro continua no banco;
//   - prontuário é upsert por pessoa (não duplica) e mescla os campos;
//   - só o autor edita/arquiva/restaura.
//  Script puro (sem framework), no estilo das demais suítes. Sessão
//  simulada via stub de shared.auth; banco em arquivo no DB_FILE do runner.
// =====================================================================
let passed = 0, failed = 0;
const assert = (cond, msg) => {
  if (cond) { console.log('  ✅', msg); passed++; }
  else { console.log('  ❌', msg); failed++; }
};

process.env.SUPABASE_URL = '';
process.env.SUPABASE_KEY = '';

const express = require('express');
// Stub do middleware de sessão ANTES de carregar o router (o router captura
// auth por desestruturação no require). A checagem de papéis continua sendo a
// do router; a identidade vem do header X-Test-Auth.
const shared = require('../src/lib/shared');
shared.auth = (roles) => (req, res, next) => {
  if (!req.auth) return res.status(401).json({ error: 'sem auth (teste)' });
  if (roles && roles.length && !roles.includes(req.auth.role)) return res.status(403).json({ error: 'Acesso restrito ao seu perfil.' });
  next();
};
const store = shared.store;
const psiRouter = require('../src/routes/psico');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use((req, res, next) => {
  const raw = req.headers['x-test-auth'] || '';
  const [role, user, name] = raw.split('|');
  req.auth = { role: role || 'psico', user: user || 'psi1', name: name || 'Psic. Ana', sistema: null, token: 't' };
  next();
});
app.use(psiRouter);

const server = app.listen(0);
const BASE = 'http://127.0.0.1:' + server.address().port;

async function json(method, path, body, auth) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Test-Auth': auth || 'psico|psi1|Psic. Ana' },
    body: body ? JSON.stringify(body) : undefined
  });
  let j = null;
  try { j = await res.json(); } catch (e) { /* corpo não-JSON */ }
  return { status: res.status, body: j };
}

const PSI1 = 'psico|psi1|Psic. Ana';
const PSI2 = 'psico|psi2|Psic. Bruno';
const TEC = 'tecnico|tec1|Tec Um';
const REC = 'recepcao|rec|Recepcao';
const ADMIN = 'admin|admin|Administrador';
const MOTIVO = 'auditoria interna solicitada pela corregedoria';
const PERSON = 990001;

async function main() {
  console.log('\n=== PSI — bloqueio por perfil ===');
  assert((await json('GET', '/api/psi', null, TEC)).status === 403, 'técnico: GET /api/psi → 403');
  assert((await json('GET', '/api/psi', null, REC)).status === 403, 'recepção: GET /api/psi → 403');
  assert((await json('POST', '/api/psi', { kind: 'prontuario', personId: PERSON }, TEC)).status === 403, 'técnico: POST /api/psi → 403');
  assert((await json('GET', '/api/psi', null, ADMIN)).status === 403, 'admin sem emergência: 403');

  console.log('\n=== PSI — acesso emergencial do admin (quebra-vidro) ===');
  assert((await json('GET', '/api/psi?emergencia=1&motivo=curto', null, ADMIN)).status === 403,
    'admin: emergencia=1 com motivo < 10 caracteres → 403');
  {
    const r = await json('GET', '/api/psi?emergencia=1&motivo=' + encodeURIComponent(MOTIVO), null, ADMIN);
    assert(r.status === 200 && Array.isArray(r.body), 'admin: emergência justificada → 200 com lista');
    const trail = (await store.audit.all()) || [];
    const bg = trail.filter(e => e.kind === 'psi' && e.action === 'breakglass' && e.byRole === 'admin').pop();
    assert(!!bg, 'acesso emergencial gerou trilha kind=psi/action=breakglass');
    assert(!!bg && String(bg.summary || '').includes('emergencial'), 'trilha descreve o acesso emergencial');
  }
  assert((await json('POST', '/api/psi', { kind: 'evolucao', personId: PERSON, dados: {} }, ADMIN)).status === 403,
    'admin: escrita no prontuário continua proibida (somente leitura)');

  console.log('\n=== PSI — validação de entrada ===');
  assert((await json('POST', '/api/psi', { kind: 'inexistente', personId: PERSON }, PSI1)).status === 400, 'kind inválido → 400');
  assert((await json('POST', '/api/psi', { kind: 'atendimento', dados: { status: 'presente' } }, PSI1)).status === 400,
    'atendimento sem personId → 400');

  console.log('\n=== PSI — prontuário é upsert por pessoa ===');
  const pront = await json('POST', '/api/psi', {
    kind: 'prontuario', personId: PERSON, personName: 'Pessoa Teste Psi',
    dados: { queixa: 'ansiedade', status: 'ativo', tags: ['Biometria pendente'] }
  }, PSI1);
  assert(pront.status === 201 && pront.body && pront.body.id, 'prontuário criado (201, id=' + (pront.body && pront.body.id) + ')');
  const prontId = pront.body && pront.body.id;
  {
    const again = await json('POST', '/api/psi', { kind: 'prontuario', personId: PERSON, dados: { observacao: 'retorno em 30 dias' } }, PSI1);
    assert(again.status === 200 && again.body.id === prontId, 'segundo POST do prontuário atualiza o mesmo registro (200)');
    const dados = (again.body && again.body.dados) || {};
    assert(dados.queixa === 'ansiedade' && dados.observacao === 'retorno em 30 dias', 'campos antigos e novos mesclados');
  }

  console.log('\n=== PSI — exclusão é lógica (arquivamento) ===');
  {
    const evo = await json('POST', '/api/psi', {
      kind: 'evolucao', personId: PERSON, dados: { s: 'relato', o: 'observado', a: 'avaliado', p: 'plano' }
    }, PSI1);
    assert(evo.status === 201 && evo.body && evo.body.id, 'evolução criada (201)');
    const evoId = evo.body && evo.body.id;

    assert((await json('DELETE', '/api/psi/' + evoId, null, PSI2)).status === 403, 'outro psicólogo não arquiva registro alheio');
    const del = await json('DELETE', '/api/psi/' + evoId, null, PSI1);
    assert(del.status === 200 && del.body && del.body.arquivado === true, 'autor arquiva (200, arquivado=true)');

    const raw = await store.psi.byId(evoId);
    assert(!!raw, 'registro NÃO foi apagado do banco (soft-delete)');
    assert(!!raw && raw.dados && raw.dados._arquivado === true, 'flag _arquivado gravada com autor/data');
    assert(!!raw && !!raw.dados._arquivadoPor, '_arquivadoPor registra quem arquivou');

    const lista = await json('GET', '/api/psi?personId=' + PERSON, null, PSI1);
    const ids = (lista.body || []).map(x => x.id);
    assert(!ids.includes(evoId), 'lista padrão não mostra arquivado');
    const comArq = await json('GET', '/api/psi?personId=' + PERSON + '&arquivados=1', null, PSI1);
    assert(((comArq.body || []).map(x => x.id)).includes(evoId), '?arquivados=1 mostra o arquivado');

    assert((await json('PATCH', '/api/psi/' + evoId, { dados: { p: 'tentativa' } }, PSI1)).status === 400,
      'editar arquivado → 400 (precisa restaurar)');

    const rest = await json('PATCH', '/api/psi/' + evoId + '/restore', null, PSI1);
    assert(rest.status === 200 && rest.body && rest.body.dados && rest.body.dados._arquivado === undefined,
      'restauração limpa as flags de arquivamento');
    const volta = await json('GET', '/api/psi?personId=' + PERSON, null, PSI1);
    assert(((volta.body || []).map(x => x.id)).includes(evoId), 'registro restaurado volta à lista');
  }

  console.log('\n=== PSI — leitura individual e trilha de auditoria ===');
  assert((await json('GET', '/api/psi/' + prontId, null, ADMIN)).status === 403, 'admin sem emergência não lê registro individual');
  {
    const r = await json('GET', '/api/psi/' + prontId + '?emergencia=1&motivo=' + encodeURIComponent(MOTIVO), null, ADMIN);
    assert(r.status === 200 && r.body && r.body.id === prontId, 'admin com emergência lê o registro individual');
  }
  {
    const trail = (await store.audit.all()) || [];
    const psiTrail = trail.filter(e => e.kind === 'psi');
    const acoes = new Set(psiTrail.map(e => e.action));
    assert(acoes.has('prontuario_criado'), 'trilha registra prontuario_criado');
    assert(acoes.has('prontuario_atualizado'), 'trilha registra prontuario_atualizado');
    assert(acoes.has('evolucao_criado'), 'trilha registra evolucao_criado');
    assert(acoes.has('evolucao_arquivado'), 'trilha registra evolucao_arquivado');
    assert(acoes.has('evolucao_restaurado'), 'trilha registra evolucao_restaurado');
    // Cadeia tamper-evident: cada entrada criada aqui precisa carregar hash
    // SHA-256 e apontar (prevHash) para o hash do registro imediatamente
    // anterior. Verificamos só o trecho criado pelo teste — a base de
    // desenvolvimento pode ter registros legados anteriores à cadeia.
    const todas = [...trail].sort((a, b) => a.id - b.id);
    const psiComHash = psiTrail.filter(e => e.hash);
    assert(psiComHash.length === psiTrail.length, 'toda entrada psi carrega hash');
    assert(psiComHash.every(e => /^[0-9a-f]{64}$/.test(String(e.hash))), 'hash das entradas psi é SHA-256 (64 hex)');
    const encadeados = psiComHash.every(e => {
      const i = todas.findIndex(r => String(r.id) === String(e.id));
      const anterior = i > 0 ? todas[i - 1] : null;
      return String(e.prevHash || '') === String((anterior && anterior.hash) || '');
    });
    assert(encadeados, 'entradas psi encadeiam no registro anterior (prevHash correto)');
  }
}

main()
  .catch(e => { console.log('  ❌ erro inesperado:', e && e.message); failed++; })
  .finally(() => {
    server.close();
    console.log(`\n=== RESULTADO: ${passed} passed, ${failed} failed ===`);
    process.exit(failed ? 1 : 0);
  });
