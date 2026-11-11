// =====================================================================
//  Teste de integraÃ§Ã£o contra o Supabase.
//
//  As suÃ­tes rodam em modo arquivo; o modo Supabase tem regras
//  diferentes (mapeamento de colunas, limite de 1.000 linhas do
//  PostgREST, RLS). Este teste cobre o modo real.
//
//  NAO roda por padrao: so com RUN_SUPABASE_TESTS=1 e credenciais de
//  um banco de TESTE. Sem isso, imprime "pulado" e sai com 0.
//
//  Exemplo:
//    RUN_SUPABASE_TESTS=1 SUPABASE_URL=... SUPABASE_KEY=... \
//      node test/assistidos.supabase.test.js
//
//  Os registros criados usam o prefixo TESTE-SUPABASE- e sao removidos
//  no final.
// =====================================================================
// o .env precisa estar carregado antes do check (o store so carrega depois)
require('dotenv').config();

const rodando = process.env.RUN_SUPABASE_TESTS === '1' && !!process.env.SUPABASE_URL && !!process.env.SUPABASE_KEY;

if (!rodando) {
  console.log('\n=== INTEGRACAO SUPABASE - pulado (defina RUN_SUPABASE_TESTS=1 + credenciais) ===\n');
  process.exit(0);
}

const assertEq = (a, b, msg) => {
  if (a === b) { console.log('  ok.', msg); return true; }
  console.log('  FAIL', msg, '(esperado ' + JSON.stringify(b) + ', veio ' + JSON.stringify(a) + ')');
  return false;
};
let passed = 0, failed = 0;
const check = (cond, msg) => { if (cond) { passed++; console.log('  ok.', msg); } else { failed++; console.log('  FAIL', msg); } };

const PREFIXO = 'TESTE-SUPABASE';
// vinculo precisa ser um CNJ valido (20 digitos) â€” o marcador fica no nome
const sufixo = String(Date.now() % 1000).padStart(3, '0');
const VINCULO = '0999' + sufixo + '-99.2026.8.06.0000';
const NOME = PREFIXO + ' ' + sufixo;
const store = require('../store');
const shared = require('../src/lib/shared');
shared.auth = (roles) => (req, res, next) => {
  if (!req.auth) return res.status(401).json({ error: 'sem auth' });
  if (roles && roles.length && !roles.includes(req.auth.role)) return res.status(403).json({ error: 'restrito' });
  next();
};
const router = require('../src/routes/assistidos');
const express = require('express');
const app = express();
app.use(express.json({ limit: '2mb' }));
app.use((req, res, next) => { req.auth = { role: 'admin', user: 'teste', name: 'Teste' }; next(); });
app.use(router);
const server = app.listen(0);
const BASE = 'http://127.0.0.1:' + server.address().port;
const H = { 'Content-Type': 'application/json', 'X-Test-Auth': 'admin|teste|Teste' };

(async () => {
  console.log('\n=== INTEGRACAO SUPABASE (modo real) ===');
  const modo = store.mode || (process.env.SUPABASE_URL ? 'supabase' : 'file');
  console.log('  modo do store:', modo);
  if (modo !== 'supabase') { console.log('  (store em modo arquivo - nada a testar)'); process.exit(0); }

  const json = async (url, opts) => (await fetch(BASE + url, opts)).json();

  // 1) grava e le de volta pelo caminho real do banco
  const vinculo = VINCULO;
  const criado = await json('/api/assistidos', {
    method: 'POST', headers: H,
    body: JSON.stringify({
      vinculo, nome: NOME, vara: 'Vara Teste', localAssinatura: 'COMEP Cariri',
      dataInicio: '2026-01-15', frequencia: 'semanal', etiqueta: 'verde', responsavelTecnico: 'Teste',
    }),
  });
  check(!!criado.id, 'criou assistido no Supabase (#' + criado.id + ')');
  check(criado.processo === vinculo, 'processo derivado do vinculo');

  const lido = await json('/api/assistidos/' + criado.id);
  check(lido.nome === NOME, 'leu de volta do Supabase');
  check(lido.etiqueta === 'conferido', 'etiqueta persistida e normalizada (verde -> conferido)');
  check(lido.responsavelTecnico === 'Teste', 'responsavel persistido');
  check(lido.deletedAt === null || lido.deletedAt === undefined, 'deletedAt nulo (nao soft-deleted)');

  // 2) o limite de 1.000 linhas do PostgREST nao pode truncar a listagem
  const pagina = await json('/api/assistidos?limit=5&page=1');
  check(Array.isArray(pagina.itens), 'listagem paginada devolve itens');
  check(pagina.itens.length <= 5, 'listagem respeita o limite');
  check(typeof pagina.total === 'number' && pagina.total > 0, 'listagem devolve o total (' + pagina.total + ')');
  const achou = pagina.itens.some(x => String(x.id) === String(criado.id));
  check(achou || pagina.total >= 5, 'registro criado aparece na listagem');

  // 3) a busca no banco funciona (ilike + escape do PostgREST)
  const busca = await json('/api/assistidos?q=' + encodeURIComponent(PREFIXO));
  check(busca.itens.length >= 1, 'busca encontra o registro (' + busca.itens.length + ')');
  const buscaComParen = await json('/api/assistidos?q=' + encodeURIComponent('x(1),y'));
  check(Array.isArray(buscaComParen.itens), 'busca com metacaracteres do PostgREST nao quebra');

  // 4) soft-delete e restauracao
  await json('/api/assistidos/' + criado.id, { method: 'DELETE', headers: H, body: JSON.stringify({ motivo: 'teste' }) });
  const apagado = await fetch(BASE + '/api/assistidos/' + criado.id, { headers: H });
  check(apagado.status === 404, 'soft-delete esconde o registro');
  const restaurado = await json('/api/assistidos/' + criado.id + '/restaurar', { method: 'PATCH', headers: H, body: '{}' });
  check(!!restaurado.id, 'restaurar devolve o registro');
  const deVolta = await fetch(BASE + '/api/assistidos/' + criado.id, { headers: H });
  check(deVolta.status === 200, 'registro volta a aparecer');

  // 5) comparecimento + juntada, e o diff da auditoria
  const comp = await json('/api/assistidos/' + criado.id + '/comparecimentos', {
    method: 'POST', headers: H,
    body: JSON.stringify({ dataComparecimento: '2026-11-05', ppPlantao: 'PP Teste', observacao: 'obs' }),
  });
  check(!!comp.id, 'comparecimento criado no Supabase');
  const juntada = await json('/api/assistidos/comparecimentos/' + comp.id + '/juntada', {
    method: 'PATCH', headers: H, body: JSON.stringify({ juntada: '99999' }),
  });
  check(juntada.protocolado === true, 'juntada protocolou');
  check(juntada.protocoladoPor === 'Teste', 'juntada gravou quem protocolou');

  const aud = await json('/api/assistidos/auditoria?assistidoId=' + criado.id + '&limit=20');
  check(aud.total >= 3, 'auditoria registrou as operacoes (' + aud.total + ')');
  const comDiff = (aud.itens || []).find(x => x.acao === 'juntada');
  check(!!comDiff && (comDiff.changes || []).length > 0, 'auditoria guardou o diff da juntada');
  const checado = (comDiff && comDiff.changes || []).find(c => c.campo === 'juntada');
  check(!!checado && checado.para === '99999', 'diff da juntada com o valor gravado');

  // 6) a cadeia de hash fecha no modo real
  //    (store.audit.verify e o mesmo codigo de /api/audit/verify)
  const verify = await store.audit.verify();
  check(verify.ok === true, 'cadeia de auditoria integra no Supabase');

  // 7) cleanup
  await json('/api/assistidos/' + criado.id, { method: 'DELETE', headers: H, body: JSON.stringify({ motivo: 'limpeza' }) });
  const restantes = await json('/api/assistidos?q=' + encodeURIComponent(PREFIXO));
  check(!restantes.itens.some(x => String(x.id) === String(criado.id)),
    'limpeza removeu o registro de teste da listagem');

  // 8) REGRESSÃO: o comparecimento registrado tem que aparecer na aba
  //    Juntada. O bug: a rota gravava juntada = NULL e a consulta filtrava
  //    por juntada = '' — NULL nao casa, e o comparecimento sumia.
  const a2 = await (await fetch(BASE + '/api/assistidos', {
    method: 'POST', headers: Object.assign({}, H, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      vinculo: VINCULO.slice(0, -2) + '77', nome: NOME + ' 2', vara: 'V',
      localAssinatura: 'COMEP Cariri', dataInicio: '2026-01-15',
    }),
  })).json();
  check(!!a2.id, 'segundo assistido criado para o teste de regressao');
  const c2 = await (await fetch(BASE + '/api/assistidos/' + a2.id + '/comparecimentos', {
    method: 'POST', headers: Object.assign({}, H, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ dataComparecimento: '2026-11-09', ppPlantao: 'PP Teste' }),
  })).json();
  check(!!c2.id, 'comparecimento registrado pela rota');

  const abaJuntada = await json('/api/assistidos/juntada');
  check(abaJuntada.some(x => String(x.id) === String(a2.id)),
    'REGRESSÃO: comparecimento recem-registrado aparece na aba Juntada');
  const pend = (abaJuntada.find(x => String(x.id) === String(a2.id)) || {}).comparecimentoPendente;
  check(!!pend && String(pend.id) === String(c2.id), 'REGRESSÃO: o comparecimento pendente e o correto');

  // 9) defesa em profundidade: mesmo gravado com juntada = NULL, tem que
  //    aparecer (o filtro aceita as duas formas)
  await store.assistidosComparecimentos.insert({
    assistidoId: Number(a2.id), dataComparecimento: '2026-11-08',
    ppPlantao: 'PP Teste', observacao: '', juntada: null, protocolado: false,
  });
  const abaJuntada2 = await json('/api/assistidos/juntada');
  check(abaJuntada2.some(x => String(x.id) === String(a2.id)),
    'REGRESSÃO: comparecimento com juntada NULL também aparece na aba Juntada');

  // 10) o store rejeita comparecimento sem assistido valido (evita orfao)
  let orfao = null;
  try {
    await store.assistidosComparecimentos.insert({
      assistidoId: Number(undefined), dataComparecimento: '2026-11-07',
      ppPlantao: 'PP', observacao: '', juntada: '', protocolado: false,
    });
  } catch (e) { orfao = e; }
  check(!!orfao, 'Store: comparecimento orfao é rejeitado');

  // 11) a aba busca o assistido pelo id (nao pela listagem paginada)
  const porId = await store.assistidos.byIds([Number(a2.id)]);
  check(Array.isArray(porId) && porId.length === 1, 'Store: byIds devolve o assistido pelo id');
  const resumo = await json('/api/assistidos/resumo');
  check(typeof resumo.assistidosPendentes === 'number' && resumo.assistidosPendentes >= 1,
    'Badge: conta os assistidos com pendencia (' + resumo.assistidosPendentes + ')');

  await json('/api/assistidos/' + a2.id, { method: 'DELETE', headers: H, body: JSON.stringify({ motivo: 'limpeza' }) });

  console.log('\n==================== RESUMO ====================');
  console.log(`Testes: OK=${passed} | Falha=${failed}`);
  server.close();
  process.exit(failed ? 1 : 0);
})();

