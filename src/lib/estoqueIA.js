const { handlers } = require('./estoqueIA-core/registry');
const { getContext, setContext } = require('./estoqueIA-core/context');
const { getOrFetch, invalidate } = require('./estoqueIA-core/cache');
const {
  extractContrato, extractSistema, extractMaterial, extractUnidade,
  extractData, extractPeriodo, extractSerial, extractThreshold,
  normContrato, labelContrato, matTZPR, matsProntos, norm, findUsuario,
  MATERIAIS, MATERIAIS_SERIAL, LIMITES, UNIDADES, CONTRATO_INFINITY
} = require('./estoqueIA-core/helpers');

async function answer(query, store, opts = {}) {
  const qRaw = String(query || '').trim();
  if (!qRaw) {
    return {
      intent: 'vazio',
      text: 'Digite um comando. Ex: "saldo TZPR04 em UMEPE Juazeiro CE01" ou "estoque atual Infinity"',
      suggestions: ['saldo TZPR04 UMEPE Juazeiro CE01', 'movimentações por usuário ontem CE01', 'consumo médio 30 dias', 'histórico ontem', 'seriais disponíveis', 'reposição CE01']
    };
  }

  const q = norm(qRaw);
  const user = opts.user || 'global';

  // 1. Extrair entidades
  let contratoRaw = extractContrato(qRaw);
  let material = extractMaterial(qRaw);
  let unidade = extractUnidade(qRaw);
  const data = extractData(qRaw);
  const periodo = extractPeriodo(qRaw);
  const serial = extractSerial(qRaw);
  // usuário mencionado ("movimentações de joanderson") — lista cacheada, tolera store sem users
  let usuarios = [];
  try { if (store.users && typeof store.users.all === 'function') usuarios = await getOrFetch('usuarios', {}, () => store.users.all()) || []; } catch (e) {}
  let usuario = findUsuario(qRaw, usuarios);

  // 2. Sistema: opts (perfil) > menção explícita > contexto
  let sistema = opts.sistema || extractSistema(qRaw) || null;

  // 3. Carregar contexto persistido
  const last = await getContext(store, user);

  // 4. Normalizar sistema via store
  if (sistema && store.normalizeSistema) {
    try { sistema = store.normalizeSistema(sistema) || sistema; } catch (e) {}
  }

  // 5. Infinity: TZPR04 vira TZPR; UPR04 não existe
  if (sistema === 'infinity' && material === 'TZPR04') material = 'TZPR';
  if (sistema === 'infinity' && material === 'UPR04') {
    return {
      intent: 'erro',
      text: '❌ UPR04 não existe no Infinity — materiais: TZPR, FONTE04, CINTA, TRAVAS.',
      suggestions: ['estoque atual Infinity', 'saldo TZPR Infinity', 'seriais Infinity']
    };
  }

  // 6. Contrato respeita sistema: infinity sempre INF
  let contrato;
  if (sistema === 'infinity') {
    contrato = 'INF';
  } else if (sistema === 'spacecom') {
    contrato = contratoRaw || last.contrato || null;
    if (contrato === 'INF') contrato = last.contrato && last.contrato !== 'INF' ? last.contrato : null;
  } else {
    contrato = contratoRaw || last.contrato || null;
  }

  // Follow-up: "e UPR?", "e UMEPE?"
  if (!contrato && last.contrato && /^(e |e\?|para |com |e o |e a )?/.test(q) && (material || unidade || /saldo|estoque|quanto/.test(q))) {
    contrato = sistema === 'infinity' ? 'INF' : last.contrato;
  }
  if (!material && last.material && /^(e |e\?)/.test(q)) material = last.material;
  if (!unidade && last.unidade && /^(e |e\?)/.test(q)) unidade = last.unidade;
  if (!usuario && last.usuario && /^(e |e\?)/.test(q)) usuario = { user: last.usuario, name: last.usuario };

  // 7. Contexto para handlers
  const ctx = {
    store,
    helpers: { MATERIAIS, MATERIAIS_SERIAL, LIMITES, UNIDADES, CONTRATO_INFINITY, matTZPR, matsProntos, labelContrato, normContrato, extractUnidade },
    qRaw,
    q,
    contrato,
    material,
    unidade,
    data,
    periodo,
    serial,
    usuario,
    sistema,
    user,
    last
  };

  // 8. Tentar cada handler em ordem
  for (const handler of handlers) {
    if (handler.match(q, ctx)) {
      try {
        const start = Date.now();
        const result = await handler.handle(q, ctx);
        const latency = Date.now() - start;

        // Auditoria
        try {
          await store.audit.insert({
            kind: 'ia_consulta',
            action: 'query',
            summary: `${result.intent}: ${qRaw.slice(0, 150)}`,
            byUser: user,
            byName: opts.userName,
            byRole: opts.role,
            ref: `intent:${result.intent}|latency:${latency}ms`
          });
        } catch (e) {}

        // Persistir contexto se houver entidades
        if (contrato || material || unidade || sistema || usuario) {
          await setContext(store, user, {
            contrato: contrato || last.contrato,
            material: material || last.material,
            unidade: unidade || last.unidade,
            sistema: sistema || last.sistema,
            usuario: usuario ? usuario.user : last.usuario
          });
        }

        return result;
      } catch (e) {
        console.error(`Handler ${handler.constructor.name} error:`, e);
        return { intent: 'erro', text: 'Erro interno: ' + e.message };
      }
    }
  }

  // 9. Fallback
  return {
    intent: 'nao_entendi',
    text: `🤔 Não entendi: "${qRaw}".\nTente:\n• "saldo TZPR04 UMEPE Juazeiro CE01"\n• "movimentações de joanderson ontem CE01" — por usuário/data\n• "consumo médio 30 dias" — todos os materiais\n• "reposição CE01" — o que comprar\n• "comparar UMEPE vs UP-Cariri"\n• "consumo TZPR04" — média e ruptura\n• "ficha UPR04 UMEPE" — detalhe\n• "histórico ontem" / "evolução 7 dias TZPR04"\n• "seriais disponíveis" / "buscar serial 1234"\n• "previsão ruptura TZPR04 UMEPE 30 dias"\n• "sugestão pedido compra CE01 próximo mês"\n• "transferência sugerida UMEPE → UP-Cariri"`,
    suggestions: ['saldo total CE01', 'movimentações por usuário ontem CE01', 'consumo médio 30 dias', 'reposição CE01', 'consumo TZPR04', 'ficha TZPR04 UMEPE', 'comparar UMEPE vs UP-Cariri', 'histórico ontem', 'seriais UPR04', 'previsão ruptura TZPR04 UMEPE 30 dias', 'sugestão pedido compra CE01 próximo mês', 'transferência sugerida UMEPE → UP-Cariri']
  };
}

// Exportar para testes
module.exports = {
  answer,
  handlers,
  // Extractors para testes unitários
  extractContrato, extractSistema, extractMaterial, extractUnidade,
  extractData, extractPeriodo, extractSerial, extractThreshold,
  normContrato, labelContrato, matTZPR, matsProntos, norm, findUsuario,
  // Cache controls
  invalidateCache: () => invalidate('estoque'),
  clearCache: () => require('./cache').clear()
};