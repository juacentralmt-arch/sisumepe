// =====================================================================
//  Regressão do FRONT-END do módulo ASSISTIDOS (public/js/app.js).
//
//  Bugs cobertos por esta suíte:
//
//  1) ETIQUETA — o <select> do editor só tem 'pendente'|'conferido',
//     mas a base herdada (e a Planilha Geral importada) traz etiqueta
//     '', 'sem', 'verde', 'laranja' ou 'vermelho'. O valor crudo era
//     jogado no select: o selectedIndex ficava -1, o value virava '' e
//     o front mandava etiqueta:'' no PATCH -> o back respondia 400 e
//     DESCARTAVA todos os campos editados da ficha.
//
//  2) MÚLTIPLOS PENDENTES — a aba Juntada listava só o primeiro
//     comparecimento pendente (comparecimentoPendente). Agora lista
//     TODOS (comparecimentosPendentes), cada um com checkbox próprio.
//
//  3) PAGINAÇÃO — Concluídos/Arquivados truncavam a lista sem aviso;
//     agora respeitam o total real e mostram "X–Y de Z".
//
//  4) ERRO VISÍVEL — as cargas quebravam em silêncio (só console.error)
//     e deixavam "Nenhum ..." na tela, indistinguível de lista vazia.
//
//  5) TEMPO REAL — um evento SSE 'update' recarrega a fila, mas não o
//     módulo Assistidos: a aba ficava desatualizada.
//
//  Os testes exercitam o código real do front-end extraído do app.js e
//  executado em sandbox (sem navegador), com as dependências injetadas.
//  Nenhum teste escreve em disco de produção: tudo em memória.
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
const appSrc = fs.readFileSync(APP, 'utf8');

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

// Elemento de DOM mínimo (o suficiente para o app.js).
function mkEl(id) {
  return {
    id: id,
    value: '',
    textContent: '',
    innerHTML: '',
    className: '',
    dataset: {},
    checked: false,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  };
}

// DOM mínimo: os ids registrados existem; os outros devolvem null
// (como no navegador de verdade).
function mkDom(ids) {
  const els = {};
  (ids || []).forEach(id => { els[id] = mkEl(id); });
  return {
    els,
    document: {
      hidden: false,
      getElementById: (id) => (Object.prototype.hasOwnProperty.call(els, id) ? els[id] : null),
    },
  };
}

// Sandbox genérico: roda um trecho do app.js com as dependências injetadas.
function sandbox(script, extra) {
  const ctx = {
    console: { log() {}, error() {}, warn() {} },
    JSON, Date, Math, Set, Map, Number, String, Object, Array, Promise, Boolean, RegExp,
    esc: (s) => String(s == null ? '' : s),
    fmtDataBR: (v) => String(v || ''),
    ...(extra || {}),
  };
  ctx.toasts = [];
  ctx.toast = (m) => { ctx.toasts.push(String(m)); };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(script, ctx);
  return ctx;
}

(async function main() {

  // -------------------------------------------------------------------
  console.log('\n=== ASSISTIDOS — etiqueta legada vira valor válido (pendente/conferido) ===');
  {
    const ctx = sandbox(
      extract(appSrc, 'assNormalizaEtiqueta') + '\n;globalThis.__n = assNormalizaEtiqueta;'
    );
    assert(ctx.__n('') === 'pendente', "etiqueta '' (vazia) vira 'pendente'");
    assert(ctx.__n('sem') === 'pendente', "etiqueta legada 'sem' vira 'pendente'");
    assert(ctx.__n('verde') === 'pendente', "etiqueta legada 'verde' vira 'pendente'");
    assert(ctx.__n('conferido') === 'conferido', "etiqueta 'conferido' é preservada");
    assert(ctx.__n('laranja') === 'pendente', "etiqueta legada 'laranja' vira 'pendente'");
    assert(ctx.__n('vermelho') === 'pendente', "etiqueta legada 'vermelho' vira 'pendente'");
    assert(ctx.__n(null) === 'pendente' && ctx.__n(undefined) === 'pendente',
      'etiqueta nula/undefined vira \'pendente\'');
    assert(ctx.__n('  CONFERIDO ') === 'conferido', 'etiqueta é normalizada (espaços/maiúsculas)');
  }

  // -------------------------------------------------------------------
  console.log('\n=== ASSISTIDOS — abrir o editor já normaliza a etiqueta no select ===');
  {
    const dom = mkDom([
      'editAssId', 'editAssVinculo', 'editAssNome', 'editAssProcesso', 'editAssVara',
      'editAssLocal', 'editAssDataInicio', 'editAssFrequencia', 'editAssStatus',
      'editAssEtiqueta', 'editAssResponsavelTecnico', 'modalEditarAssistido',
    ]);
    const ctx = sandbox(`
      let assEditOriginal = null;
      ${extract(appSrc, 'assNormalizaEtiqueta')}
      ${extract(appSrc, 'abrirEditarAssistido')}
      globalThis.__abrir = abrirEditarAssistido;
    `, {
      document: dom.document,
      api: async () => ({
        id: 1, vinculo: 'V001', nome: 'Fulano', processo: '123', vara: 'Vara 1',
        localAssinatura: 'COMEP Cariri', dataInicio: '2024-01-01', frequencia: 'mensal',
        status: 'ativo', etiqueta: ctx.__etiqueta, responsavelTecnico: '',
      }),
    });

    // A etiqueta do registro muda a cada chamada (o stub lê ctx.__etiqueta).
    const casos = [['', 'pendente'], ['sem', 'pendente'], ['verde', 'pendente'],
                   ['laranja', 'pendente'], ['vermelho', 'pendente'], ['conferido', 'conferido']];
    for (const [entrada, esperado] of casos) {
      ctx.__etiqueta = entrada;
      await ctx.__abrir(1);
      const v = dom.els.editAssEtiqueta.value;
      assert(v === esperado,
        "ao abrir o editor, etiqueta '" + (entrada === '' ? '(vazia)' : entrada) +
        "' vira '" + esperado + "' no select");
      assert(v !== '' && (v === 'pendente' || v === 'conferido'),
        "o select nunca fica sem valor (etiqueta '" + (entrada === '' ? '(vazia)' : entrada) + "')");
    }
  }

  // -------------------------------------------------------------------
  console.log('\n=== ASSISTIDOS — editor: o PATCH nunca manda etiqueta vazia ===');
  {
    const dom = mkDom([
      'editAssId', 'editAssVinculo', 'editAssNome', 'editAssProcesso', 'editAssVara',
      'editAssLocal', 'editAssDataInicio', 'editAssFrequencia', 'editAssStatus',
      'editAssEtiqueta', 'editAssResponsavelTecnico', 'modalEditarAssistido',
    ]);
    const sent = [];
    const ctx = sandbox(`
      let assEditOriginal = null;
      ${extract(appSrc, 'assNormalizaEtiqueta')}
      ${extract(appSrc, 'fecharModalEditarAssistido')}
      ${extract(appSrc, 'salvarEditarAssistido')}
      globalThis.__salvar = salvarEditarAssistido;
      globalThis.__setOrig = (v) => { assEditOriginal = v; };
    `, {
      document: dom.document,
      api: async (p, opt) => {
        if (opt && opt.method === 'PATCH') { sent.push(JSON.parse(opt.body)); return { id: 1 }; }
        return {};
      },
      loadAssistidos: () => {},
      atualizarBadgesAssistidos: () => {},
    });

    const REG = {
      id: 1, vinculo: 'V001', nome: 'Fulano de Tal',
      processo: '0000000-00.0000.0.00.0000', vara: 'Vara 1',
      localAssinatura: 'COMEP Cariri', dataInicio: '2024-01-01',
      frequencia: 'mensal', status: 'ativo', etiqueta: 'sem', responsavelTecnico: '',
    };

    // (a) etiqueta legada 'sem' + outro campo editado
    dom.els.editAssId.value = '1';
    dom.els.editAssVinculo.value = REG.vinculo;
    dom.els.editAssNome.value = 'Nome Novo';
    dom.els.editAssProcesso.value = REG.processo;
    dom.els.editAssVara.value = REG.vara;
    dom.els.editAssLocal.value = REG.localAssinatura;
    dom.els.editAssDataInicio.value = REG.dataInicio;
    dom.els.editAssFrequencia.value = REG.frequencia;
    dom.els.editAssStatus.value = REG.status;
    dom.els.editAssEtiqueta.value = 'pendente';   // como abrirEditarAssistido normaliza
    dom.els.editAssResponsavelTecnico.value = '';
    ctx.__setOrig(REG);
    sent.length = 0;
    await ctx.__salvar();
    assert(sent.length === 1, 'salvarEditarAssistido faz o PATCH');
    assert(sent[0] && sent[0].etiqueta === 'pendente',
      "payload manda etiqueta válida 'pendente' (nunca '')");
    assert(sent[0] && sent[0].nome === 'Nome Novo',
      'os demais campos editados vão no MESMO payload (não são perdidos)');

    // (b) o select ficou vazio (bug antigo: selectedIndex -1) -> ainda
    //     precisa sair uma etiqueta válida, senão o back responde 400.
    dom.els.editAssEtiqueta.value = '';
    dom.els.editAssNome.value = 'Outro Nome';
    ctx.__setOrig(REG);
    sent.length = 0;
    await ctx.__salvar();
    assert(sent[0] && (sent[0].etiqueta === 'pendente' || sent[0].etiqueta === 'conferido'),
      'select vazio ainda produz etiqueta válida no payload (nunca \'\')');
    assert(sent[0] && sent[0].etiqueta !== '', 'payload nunca carrega etiqueta vazia');

    // (c) usuário marcou "conferido"
    dom.els.editAssEtiqueta.value = 'conferido';
    dom.els.editAssNome.value = REG.nome;
    ctx.__setOrig(REG);
    sent.length = 0;
    await ctx.__salvar();
    assert(sent[0] && sent[0].etiqueta === 'conferido',
      "payload manda etiqueta 'conferido' quando o usuário confere a ficha");
    assert(sent[0] && sent[0].nome === undefined,
      'campo não alterado não entra no payload (diff continua valendo)');
  }

  // -------------------------------------------------------------------
  console.log('\n=== ASSISTIDOS — múltiplos comparecimentos pendentes (aba Juntada) ===');
  {
    const ctx = sandbox(
      extract(appSrc, 'assPendentesDoAssistido') + '\n;globalThis.__p = assPendentesDoAssistido;'
    );
    const dois = ctx.__p({
      id: 7, totalPendentes: 2,
      comparecimentoPendente: { id: 11, dataComparecimento: '2024-01-01' },
      comparecimentosPendentes: [
        { id: 11, dataComparecimento: '2024-01-01' },
        { id: 12, dataComparecimento: '2024-02-01' },
      ],
    });
    assert(dois.length === 2, 'devolve TODOS os comparecimentos pendentes (2 de 2)');
    assert(dois[0].id === 11 && dois[1].id === 12, 'mantém a ordem/ids dos pendentes');

    const um = ctx.__p({ id: 7, comparecimentoPendente: { id: 11, dataComparecimento: '2024-01-01' } });
    assert(um.length === 1 && um[0].id === 11, 'fallback: sem o array, usa comparecimentoPendente');

    assert(ctx.__p({ id: 7 }).length === 0, 'sem pendência alguma, devolve lista vazia');
    assert(ctx.__p(null).length === 0, 'assistido nulo não quebra');
  }

  // -------------------------------------------------------------------
  console.log('\n=== ASSISTIDOS — render da aba Juntada: um item por pendência ===');
  {
    const dom = mkDom(['assContentJuntada', 'assJuntLoteBar', 'assJuntSelecionados']);
    const ctx = sandbox(`
      let assJuntadaSel = new Set();
      let assJuntadaLista = [];
      ${extract(appSrc, 'assPendentesDoAssistido')}
      ${extract(appSrc, 'assPPDoComparecimento')}
      ${extract(appSrc, 'atualizarBarraLoteJuntada')}
      ${extract(appSrc, 'alternarSelAssJuntada')}
      ${extract(appSrc, 'renderAssistidosJuntada')}
      globalThis.__render = renderAssistidosJuntada;
      globalThis.__alt = alternarSelAssJuntada;
      globalThis.__sel = () => [...assJuntadaSel];
    `, { document: dom.document });

    const lista = [{
      id: 7, nome: 'Fulano', vinculo: 'V001', processo: '123', vara: 'Vara 1',
      localAssinatura: 'COMEP Cariri', totalPendentes: 2,
      comparecimentoPendente: { id: 11, dataComparecimento: '2024-01-01', ppPlantao: 'PP A' },
      comparecimentosPendentes: [
        { id: 11, dataComparecimento: '2024-01-01', ppPlantao: 'PP A' },
        { id: 12, dataComparecimento: '2024-02-01', ppPlantao: 'PP B' },
      ],
    }];
    ctx.__render(lista);
    const html = dom.els.assContentJuntada.innerHTML;
    const checks = html.match(/type="checkbox"/g) || [];
    assert(checks.length === 2, 'renderiza um checkbox por comparecimento pendente (2 de 2)');
    assert(/alternarSelAssJuntada\(11, this\.checked\)/.test(html), 'checkbox do 1º pendente');
    assert(/alternarSelAssJuntada\(12, this\.checked\)/.test(html), 'checkbox do 2º pendente');
    assert(/PP B/.test(html), 'mostra o PP de cada pendência');

    // seleção por comparecimento (independente um do outro)
    ctx.__alt(12, true);
    assert(ctx.__sel().length === 1 && ctx.__sel()[0] === '12',
      'selecionar um pendência marca só ele');
    assert(dom.els.assJuntSelecionados.textContent === '1 selecionado(s)',
      'a barra do lote conta a seleção');
    ctx.__alt(11, true);
    assert(ctx.__sel().length === 2, 'os dois pendentes podem ser marcados juntos');
    ctx.__alt(12, false);
    assert(ctx.__sel().length === 1 && ctx.__sel()[0] === '11', 'desmarcar um pendência funciona');

    // fallback: sem o array, renderiza o comparecimentoPendente
    ctx.__render([{ id: 8, nome: 'Bela', vinculo: 'V002', comparecimentoPendente: { id: 21, dataComparecimento: '2024-03-01' } }]);
    const html2 = dom.els.assContentJuntada.innerHTML;
    assert((html2.match(/type="checkbox"/g) || []).length === 1,
      'fallback: renderiza 1 item quando só existe comparecimentoPendente');
    assert(/alternarSelAssJuntada\(21, this\.checked\)/.test(html2), 'fallback usa o id do comparecimentoPendente');
  }

  // -------------------------------------------------------------------
  console.log('\n=== ASSISTIDOS — paginação de Concluídos/Arquivados (X–Y de Z) ===');
  {
    const dom = mkDom(['assPaginacaoConcluidos']);
    const ctx = sandbox(
      extract(appSrc, 'renderAssPaginacaoLista') + '\n;globalThis.__r = renderAssPaginacaoLista;',
      { document: dom.document }
    );
    ctx.__r('assPaginacaoConcluidos', 2, 20, 95, 'assIrPaginaConcluidos');
    const html = dom.els.assPaginacaoConcluidos.innerHTML;
    assert(/21\s*[–—-]\s*40\s+de\s+95/.test(html), 'indicador "X–Y de Z" com o total real');
    assert(/Anterior/.test(html) && /Próxima/.test(html), 'botões Anterior e Próxima');
    assert(/assIrPaginaConcluidos\(1\)/.test(html) && /assIrPaginaConcluidos\(3\)/.test(html),
      'os botões apontam para a página certa');

    ctx.__r('assPaginacaoConcluidos', 1, 20, 12, 'assIrPaginaConcluidos');
    assert(dom.els.assPaginacaoConcluidos.innerHTML === '',
      'com total <= limite não há paginação (nada de ruído na tela)');
  }

  // -------------------------------------------------------------------
  console.log('\n=== ASSISTIDOS — erro visível (a falha não é engolida) ===');
  {
    const dom = mkDom(['assContentTodos']);
    const ctx = sandbox(
      extract(appSrc, 'renderAssErro') + '\n;globalThis.__e = renderAssErro;',
      { document: dom.document }
    );
    ctx.__e('assContentTodos', 'Não foi possível carregar os assistidos.', 'loadAssistidos()');
    const html = dom.els.assContentTodos.innerHTML;
    assert(/Não foi possível carregar/.test(html), 'a mensagem de erro aparece na área da lista');
    assert(/Tentar de novo/.test(html), 'oferece a opção de tentar de novo');
    assert(/loadAssistidos\(\)/.test(html), 'o botão de retry aponta para a carga que falhou');
    assert(/rose/.test(html), 'o erro é destacado visualmente (não é texto comum)');
  }

  // -------------------------------------------------------------------
  console.log('\n=== ASSISTIDOS — tempo real: SSE recarrega o módulo só quando ele está na tela ===');
  {
    const dom = mkDom(['tab-assistidos']);
    const calls = [];
    const ctx = sandbox(`
      let assTab = 'todos';
      let assUltimoRefresh = 0;
      ${extract(appSrc, 'assAbaVisivel')}
      ${extract(appSrc, 'refreshAssistidosSeVisivel')}
      globalThis.__r = refreshAssistidosSeVisivel;
      globalThis.__setTab = (t) => { assTab = t; };
      globalThis.__reset = () => { assUltimoRefresh = 0; };
    `, {
      document: dom.document,
      loadAssistidos: () => calls.push('todos'),
      loadAssistidosJuntada: () => calls.push('juntada'),
      loadAssistidosConcluidos: () => calls.push('concluidos'),
      loadAssistidosArquivados: () => calls.push('arquivados'),
      atualizarBadgesAssistidos: () => calls.push('badges'),
    });

    // aba do módulo escondida -> não carrega nada
    dom.els['tab-assistidos'].classList.contains = () => true;
    ctx.__r();
    assert(calls.length === 0, 'com o módulo escondido, não dispara requisição nenhuma');

    // aba visível -> carrega a lista e os badges
    dom.els['tab-assistidos'].classList.contains = () => false;
    ctx.__reset();
    ctx.__r();
    assert(calls.includes('todos'), 'com o módulo visível, recarrega a lista');
    assert(calls.includes('badges'), 'com o módulo visível, recarrega os badges');

    // aba interna "Juntada" -> recarrega a lista de juntada
    calls.length = 0;
    ctx.__setTab('juntada');
    ctx.__reset();
    ctx.__r();
    assert(calls.includes('juntada'), 'na aba Juntada recarrega os pendentes de juntada');
  }

  // -------------------------------------------------------------------
  console.log('\n=== ASSISTIDOS — o handler SSE "update" aciona o refresh do módulo ===');
  {
    const dom = mkDom(['liveDot', 'tab-assistidos']);
    const calls = [];
    const ctx = sandbox(`
      let es = null;
      ${extract(appSrc, 'connectSSE')}
      globalThis.__connect = connectSSE;
      globalThis.__getEs = () => es;
    `, {
      document: dom.document,
      session: { user: 'joanderson', role: 'tecnico' },
      EventSource: function (url, opts) {
        this.url = url; this.opts = opts; calls.push('open');
      },
      scheduleRefresh: () => calls.push('scheduleRefresh'),
      refreshAssistidosSeVisivel: () => calls.push('assistidos'),
      handleTypingEvent: () => {},
      handleReadEvent: () => {},
      handleCallSignal: () => {},
    });
    ctx.__connect();
    assert(calls.includes('open'), 'connectSSE abre o EventSource');
    const es = ctx.__getEs();
    assert(!!es && typeof es.onmessage === 'function', 'o handler de mensagem foi registrado');
    es.onmessage({ data: JSON.stringify({ type: 'update' }) });
    assert(calls.includes('scheduleRefresh'), 'evento "update" agenda o refresh geral (fila)');
    assert(calls.includes('assistidos'), 'evento "update" também agenda o refresh dos assistidos');
  }

  // -------------------------------------------------------------------
  console.log('\n=== ASSISTIDOS — ações de auditoria reconhecem a importação ===');
  {
    const ctx = sandbox(
      "const ASS_AÇÕES = " + JSON.stringify({
        criado: { rotulo: 'Cadastrado' },
        importacao: { rotulo: 'Importação' },
      }) + ';globalThis.__a = ASS_AÇÕES;'
    );
    assert(!!ctx.__a.importacao, 'ASS_AÇÕES tem a chave "importacao"');
    assert(ctx.__a.importacao.rotulo === 'Importação', 'o rótulo é "Importação"');
    assert(/importacao\s*:\s*\{\s*rotulo\s*:\s*'Importação'/.test(appSrc),
      'a chave "importacao" existe no app.js real');
  }

  console.log(`\n=== RESULTADO: ${passed} passed, ${failed} failed ===`);
  process.exit(failed ? 1 : 0);
})();
