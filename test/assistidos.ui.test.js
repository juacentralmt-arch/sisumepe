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
    // Mapeamento CANÔNICO do back-end (src/lib/assistidos.js):
    // 'verde' significa CONFERIDO. O front mandava 'pendente' e o back
    // 'conferido' — a mesma ficha ficava com etiquetas diferentes.
    assert(ctx.__n('verde') === 'conferido', "etiqueta legada 'verde' vira 'conferido'");
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
    // 'verde' vira 'conferido' (mapeamento canônico do back-end).
    const casos = [['', 'pendente'], ['sem', 'pendente'], ['verde', 'conferido'],
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

  // =====================================================================
  //  MELHORIAS P2 — front-end do módulo Assistidos
  //
  //  Cobre: exclusão de comparecimento, filtro de PP/data por ITEM na
  //  aba Juntada, opção 'sem_historico', filtro de responsável técnico
  //  (resumo.responsaveis), campos novos nos modais e no payload,
  //  placeholder do PROCESSO, normalização canônica da etiqueta e a
  //  renderização de "Conferido por".
  // =====================================================================

  // -------------------------------------------------------------------
  console.log('\n=== ASSISTIDOS P2 — indicador de carregamento nas abas ===');
  {
    const dom = mkDom(['assContentTodos','assContentJuntada','assContentConcluidos','assContentArquivados']);
    const ctx = sandbox(`
      ${extract(appSrc, 'renderAssCarregando')}
      globalThis.__carregando = renderAssCarregando;
    `, { document: dom.document });
    ['assContentTodos','assContentJuntada','assContentConcluidos','assContentArquivados'].forEach(id => {
      ctx.__carregando(id, 'Carregando…');
      const html = dom.els[id].innerHTML;
      assert(/Carregando/.test(html), id + ': mostra o indicador de carregamento');
      assert(/animate-spin/.test(html), id + ': o indicador é discreto (spinner)');
    });
    // O indicador some quando a lista é desenhada por cima.
    dom.els.assContentTodos.innerHTML = '<div>lista</div>';
    assert(!/Carregando/.test(dom.els.assContentTodos.innerHTML),
      'o indicador some quando a lista é desenhada');
  }
  // Carregando + erro: o erro substitui o indicador (nada fica pendurado).
  {
    const dom = mkDom(['assContentTodos']);
    const ctx = sandbox(`
      ${extract(appSrc, 'renderAssCarregando')}
      ${extract(appSrc, 'renderAssErro')}
      globalThis.__c = renderAssCarregando;
      globalThis.__e = renderAssErro;
    `, { document: dom.document });
    ctx.__c('assContentTodos', 'Carregando…');
    assert(/Carregando/.test(dom.els.assContentTodos.innerHTML), 'indicador aparece');
    ctx.__e('assContentTodos', 'Falhou', 'loadAssistidos()');
    const html = dom.els.assContentTodos.innerHTML;
    assert(!/Carregando/.test(html), 'o indicador sai quando a carga falha');
    assert(/Tentar de novo/.test(html), 'a mensagem de erro fica no lugar do indicador');
  }

  // -------------------------------------------------------------------
  console.log('\n=== ASSISTIDOS P2 — badges: o de Arquivados atualiza junto dos outros ===');
  {
    const dom = mkDom(['assBadgeTodos','assBadgeJuntada','assBadgeConcluidos','assBadgeArquivados','assFiltroResponsavel']);
    const urls = [];
    const ctx = sandbox(`
      let assistidosResumo = { ativo: 0, concluido: 0, arquivado: 0, total: 0 };
      ${extract(appSrc, 'montarFiltroResponsavel')}
      ${extract(appSrc, 'atualizarBadgesAssistidos')}
      globalThis.__badges = atualizarBadgesAssistidos;
    `, {
      document: dom.document,
      api: async (u) => {
        urls.push(u);
        if(String(u).indexOf('/arquivados') >= 0) return { itens: [], total: 7 };
        return { ativo: 3, concluido: 2, arquivado: 1, total: 6, assistidosPendentes: 4, responsaveis: ['Maria Souza'] };
      },
    });
    await ctx.__badges();
    assert(String(dom.els.assBadgeArquivados.textContent) === '7',
      'o badge de Arquivados é atualizado junto com os demais');
    assert(String(dom.els.assBadgeTodos.textContent) === '6', 'o badge de Todos continua funcionando');
    assert(String(dom.els.assBadgeJuntada.textContent) === '4', 'o badge de Juntada continua funcionando');
    assert(urls.some(u => String(u).indexOf('/api/assistidos/resumo') >= 0),
      'o resumo é buscado (badge + filtro de responsável)');
    assert(/Maria Souza/.test(dom.els.assFiltroResponsavel.innerHTML),
      'o filtro de responsável é alimentado pelo resumo');
  }

  // -------------------------------------------------------------------
  console.log('\n=== ASSISTIDOS P2 — refresh automático não troca a lista por spinner ===');
  {
    const dom = mkDom(['assContentTodos','assFiltroResponsavel','assFiltroConferencia','assFiltroSituacao',
                       'assFiltroFrequencia','assFiltroStatus','assFiltroOrdem','assPaginacao']);
    const ctx = sandbox(`
      let assistidosPage = 1, assistidosLimit = 20, assistidosTotal = 0, assistidosBusca = '';
      let assistidosData = [];
      ${extract(appSrc, 'renderAssCarregando')}
      ${extract(appSrc, 'renderAssErro')}
      ${extract(appSrc, 'renderAssistidosTodos')}
      ${extract(appSrc, 'renderAssPaginacao')}
      ${extract(appSrc, 'loadAssistidos')}
      globalThis.__load = loadAssistidos;
    `, {
      document: dom.document,
      api: async () => ({ itens: [], total: 0 }),
      toast: (m) => { ctx.toasts.push(String(m)); },
    });
    // Refresh automático (silencioso): a lista na tela NÃO é apagada.
    dom.els.assContentTodos.innerHTML = '<div>lista antiga</div>';
    await ctx.__load(true);
    assert(dom.els.assContentTodos.innerHTML === '<div>lista antiga</div>' ||
           !/animate-spin/.test(dom.els.assContentTodos.innerHTML),
      'no refresh automático não fica spinner no lugar da lista');
    // Carga normal (usuário): mostra o indicador.
    dom.els.assContentTodos.innerHTML = '';
    const p = ctx.__load(false);
    assert(/animate-spin/.test(dom.els.assContentTodos.innerHTML),
      'na carga normal o indicador de carregamento aparece');
    await p;
    assert(!/animate-spin/.test(dom.els.assContentTodos.innerHTML),
      'o indicador some quando a carga termina');
  }

  // -------------------------------------------------------------------
  console.log('\n=== ASSISTIDOS P2 — excluir comparecimento chama DELETE /api/assistidos/comparecimentos/:id ===');
  {
    const dom = mkDom(['detTitulo','detAssInfo','detComparecimentos','detJuntadaForm','modalDetalheAssistido']);
    const calls = [];
    const ctx = sandbox(`
      ${extract(appSrc, 'excluirComparecimentoAssistido')}
      globalThis.__excluir = excluirComparecimentoAssistido;
    `, {
      document: dom.document,
      confirm: () => true,
      api: async (p, opt) => { calls.push({ p, method: opt && opt.method }); return { ok: true }; },
      toast: (m) => { ctx.toasts.push(String(m)); },
      abrirDetalheAssistido: async () => { calls.push({ detalhe: true }); },
      loadAssistidosJuntada: () => { calls.push({ juntada: true }); },
      loadAssistidos: () => { calls.push({ todos: true }); },
      atualizarBadgesAssistidos: () => { calls.push({ badges: true }); },
    });

    await ctx.__excluir(42, 7);
    const del = calls.find(c => c.p === '/api/assistidos/comparecimentos/42');
    assert(!!del, 'chama DELETE /api/assistidos/comparecimentos/:id');
    assert(del && del.method === 'DELETE', 'o método é DELETE');
    assert(ctx.toasts.some(t => /exclu/i.test(t)), 'mostra um aviso (toast) de sucesso');
    assert(calls.some(c => c.detalhe), 'recarrega o detalhe do assistido');
    assert(calls.some(c => c.todos), 'recarrega a lista de assistidos');
  }
  // 403 (técnico não responsável) — a mensagem do back aparece no aviso.
  {
    const dom = mkDom([]);
    const ctx = sandbox(`
      ${extract(appSrc, 'excluirComparecimentoAssistido')}
      globalThis.__excluir = excluirComparecimentoAssistido;
    `, {
      document: dom.document,
      confirm: () => true,
      api: async () => { throw new Error('Você só pode alterar assistidos sob sua responsabilidade.'); },
      toast: (m) => { ctx.toasts.push(String(m)); },
      abrirDetalheAssistido: async () => {},
      loadAssistidosJuntada: () => {}, loadAssistidos: () => {}, atualizarBadgesAssistidos: () => {},
    });
    await ctx.__excluir(43, 8);
    assert(ctx.toasts.some(t => /responsabilidade/i.test(t)),
      'erro 403 do back aparece no aviso (não some em silêncio)');
  }
  // Sem confirmação, nada é enviado.
  {
    const dom = mkDom([]);
    const calls = [];
    const ctx = sandbox(`
      ${extract(appSrc, 'excluirComparecimentoAssistido')}
      globalThis.__excluir = excluirComparecimentoAssistido;
    `, {
      document: dom.document,
      confirm: () => false,
      api: async (p) => { calls.push(p); return { ok: true }; },
      toast: (m) => { ctx.toasts.push(String(m)); },
      abrirDetalheAssistido: async () => {}, loadAssistidosJuntada: () => {},
      loadAssistidos: () => {}, atualizarBadgesAssistidos: () => {},
    });
    await ctx.__excluir(44, 9);
    assert(calls.length === 0, 'sem confirmação, nenhuma requisição é feita');
  }

  // -------------------------------------------------------------------
  console.log('\n=== ASSISTIDOS P2 — filtro de PP/data da aba Juntada age sobre os ITENS ===');
  {
    const dom = mkDom(['assJuntLocal','assJuntPP','assJuntDe','assJuntAte','assContentJuntada','assJuntLoteBar','assJuntSelecionados']);
    const ctx = sandbox(`
      let assJuntadaLista = [];
      let assJuntadaSel = new Set();
      ${extract(appSrc, 'assPendentesDoAssistido')}
      ${extract(appSrc, 'assPPDoComparecimento')}
      ${extract(appSrc, 'filtrarAssJuntada')}
      ${extract(appSrc, 'atualizarBarraLoteJuntada')}
      ${extract(appSrc, 'alternarSelAssJuntada')}
      ${extract(appSrc, 'renderAssistidosJuntada')}
      globalThis.__filtrar = filtrarAssJuntada;
      globalThis.__render = renderAssistidosJuntada;
      globalThis.__setLista = (l) => { assJuntadaLista = l; };
    `, { document: dom.document });

    const lista = [{
      id: 7, nome: 'Fulano', vinculo: 'V001', totalPendentes: 2,
      comparecimentosPendentes: [
        { id: 11, dataComparecimento: '2024-01-10', ppPlantao: 'PP A' },
        { id: 12, dataComparecimento: '2024-03-20', ppPlantao: 'PP B' },
      ],
    }];
    ctx.__setLista(lista);

    // Filtro por PP: só o item que casa deve sobrar.
    dom.els.assJuntPP.value = 'PP B';
    let out = ctx.__filtrar();
    assert(out.length === 1, 'o assistido continua na lista (tem um item que casa)');
    assert(out[0].comparecimentosPendentes.length === 1, 'só o pendente que casa com o PP é listado');
    assert(out[0].comparecimentosPendentes[0].id === 12, 'o pendente listado é o do PP B');

    // Render usa a lista filtrada: o item de outro PP NÃO aparece.
    ctx.__render(out);
    let html = dom.els.assContentJuntada.innerHTML;
    assert(/PP B/.test(html), 'a lista mostra o item do PP filtrado');
    assert(!/PP A/.test(html), 'a lista NÃO mostra o item de outro PP');

    // Filtro por data: o item fora da janela some.
    dom.els.assJuntPP.value = '';
    dom.els.assJuntDe.value = '2024-01-01';
    dom.els.assJuntAte.value = '2024-02-28';
    out = ctx.__filtrar();
    assert(out.length === 1, 'o assistido continua na lista (o item está na janela)');
    assert(out[0].comparecimentosPendentes.length === 1, 'só o pendente dentro da janela fica');
    assert(out[0].comparecimentosPendentes[0].id === 11, 'o pendente listado é o de janeiro');

    // Janela sem nenhum item: o assistido some inteiro.
    dom.els.assJuntDe.value = '2025-01-01';
    dom.els.assJuntAte.value = '2025-12-31';
    out = ctx.__filtrar();
    assert(out.length === 0, 'sem item na janela, o assistido não aparece');

    // Sem filtro: volta tudo.
    dom.els.assJuntDe.value = '';
    dom.els.assJuntAte.value = '';
    out = ctx.__filtrar();
    assert(out.length === 1 && out[0].comparecimentosPendentes.length === 2,
      'sem filtro, todos os pendentes voltam');
  }

  // -------------------------------------------------------------------
  console.log('\n=== ASSISTIDOS P2 — filtro de situação tem a opção "sem_historico" ===');
  {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    const m = /<select id="assFiltroSituacao"[\s\S]*?<\/select>/.exec(html);
    assert(!!m, 'o select #assFiltroSituacao existe no index.html');
    assert(m && /value="sem_historico"/.test(m[0]), 'a opção "sem_historico" está disponível');
    assert(m && /value="atrasado"/.test(m[0]) && /value="em_dia"/.test(m[0]),
      'as outras opções continuam lá');
  }

  // -------------------------------------------------------------------
  console.log('\n=== ASSISTIDOS P2 — filtro de responsável técnico usa resumo.responsaveis ===');
  {
    const dom = mkDom(['assFiltroResponsavel']);
    const ctx = sandbox(`
      ${extract(appSrc, 'montarFiltroResponsavel')}
      globalThis.__montar = montarFiltroResponsavel;
    `, { document: dom.document });

    ctx.__montar({ responsaveis: ['Maria Souza', 'João Lima'] });
    const html = dom.els.assFiltroResponsavel.innerHTML;
    assert(/Maria Souza/.test(html) && /João Lima/.test(html),
      'as opções do select vêm de resumo.responsaveis');
    assert(/value=""/.test(html), 'mantém a opção "Todos os responsáveis"');
    dom.els.assFiltroResponsavel.value = 'Maria Souza';
    ctx.__montar({ responsaveis: ['Maria Souza', 'João Lima'] });
    assert(dom.els.assFiltroResponsavel.value === 'Maria Souza',
      'a escolha atual é preservada ao redesenhar o select');

    // Resposta antiga (sem o campo): degrada sem erro e sem opções.
    const dom2 = mkDom(['assFiltroResponsavel']);
    const ctx2 = sandbox(`
      ${extract(appSrc, 'montarFiltroResponsavel')}
      globalThis.__montar = montarFiltroResponsavel;
    `, { document: dom2.document });
    ctx2.__montar({ total: 3 });
    assert(dom2.els.assFiltroResponsavel.innerHTML === '',
      'resumo sem responsaveis: o select fica intacto (sem erro)');
  }
  // A query leva ?responsavel= e a paginação zera.
  {
    const dom = mkDom(['assContentTodos','assFiltroResponsavel','assFiltroConferencia','assFiltroSituacao',
                       'assFiltroFrequencia','assFiltroStatus','assFiltroOrdem','assPaginacao']);
    const urls = [];
    const ctx = sandbox(`
      let assistidosPage = 1, assistidosLimit = 20, assistidosTotal = 0, assistidosBusca = '';
      let assistidosData = [];
      ${extract(appSrc, 'renderAssCarregando')}
      ${extract(appSrc, 'renderAssErro')}
      ${extract(appSrc, 'renderAssistidosTodos')}
      ${extract(appSrc, 'renderAssPaginacao')}
      ${extract(appSrc, 'loadAssistidos')}
      ${extract(appSrc, 'assFiltrosMudou')}
      globalThis.__load = loadAssistidos;
      globalThis.__mudou = assFiltrosMudou;
      globalThis.__getPage = () => assistidosPage;
      globalThis.__setPage = (p) => { assistidosPage = p; };
    `, {
      document: dom.document,
      api: async (u) => { urls.push(u); return { itens: [], total: 0 }; },
      toast: (m) => { ctx.toasts.push(String(m)); },
    });
    dom.els.assFiltroResponsavel.value = 'Maria Souza';
    await ctx.__load();
    assert(urls.some(u => /[?&]responsavel=Maria(\+|%20)Souza/.test(u)),
      'a query inclui ?responsavel=...');
    dom.els.assFiltroResponsavel.value = '';
    ctx.__setPage(3);
    ctx.__mudou();
    assert(ctx.__getPage() === 1, 'mudar o filtro reseta a paginação');
  }

  // -------------------------------------------------------------------
  console.log('\n=== ASSISTIDOS P2 — campos novos nos modais e no payload ===');
  {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    // Modal de NOVO
    ['assDataFim','assCpf','assTelefone','assEndereco','assSituacaoJuridica'].forEach(id => {
      assert(new RegExp('id="' + id + '"').test(html), 'modal NOVO tem o campo #' + id);
    });
    // Modal de EDITAR
    ['editAssDataFim','editAssSituacaoJuridica','editAssCpf','editAssTelefone','editAssEndereco'].forEach(id => {
      assert(new RegExp('id="' + id + '"').test(html), 'modal EDITAR tem o campo #' + id);
    });
  }
  // POST (novo assistido) leva os campos novos no payload.
  {
    const dom = mkDom(['assVinculo','assNome','assProcesso','assVara','assLocal','assDataInicio',
                       'assFrequencia','assResponsavelTecnico','assDataFim','assCpf','assTelefone',
                       'assEndereco','assSituacaoJuridica','modalNovoAssistido']);
    const sent = [];
    const ctx = sandbox(`
      ${extract(appSrc, 'assConfirmarProcessoInvalido')}
      ${extract(appSrc, 'salvarNovoAssistido')}
      globalThis.__salvar = salvarNovoAssistido;
    `, {
      document: dom.document,
      validarCNJ: () => true,
      confirm: () => true,
      api: async (p, opt) => { if(opt && opt.method === 'POST') sent.push(JSON.parse(opt.body)); return { id: 1 }; },
      toast: (m) => { ctx.toasts.push(String(m)); },
      fecharModalNovoAssistido: () => {},
      loadAssistidos: () => {}, atualizarBadgesAssistidos: () => {},
    });
    dom.els.assVinculo.value = 'V001';
    dom.els.assNome.value = 'Fulano';
    dom.els.assProcesso.value = '0001234-56.2024.8.06.0001';
    dom.els.assVara.value = 'Vara 1';
    dom.els.assLocal.value = 'COMEP Cariri';
    dom.els.assDataInicio.value = '2024-01-01';
    dom.els.assFrequencia.value = 'mensal';
    dom.els.assDataFim.value = '2025-01-01';
    dom.els.assCpf.value = '12345678900';
    dom.els.assTelefone.value = '(88) 99999-9999';
    dom.els.assEndereco.value = 'Rua A, 10';
    dom.els.assSituacaoJuridica.value = 'Comparecimento mensal';
    await ctx.__salvar();
    assert(sent.length === 1, 'salvarNovoAssistido faz o POST');
    const b = sent[0] || {};
    assert(b.dataFim === '2025-01-01', 'o payload leva dataFim');
    assert(b.cpf === '12345678900', 'o payload leva cpf');
    assert(b.telefone === '(88) 99999-9999', 'o payload leva telefone');
    assert(b.endereco === 'Rua A, 10', 'o payload leva endereco');
    assert(b.situacaoJuridica === 'Comparecimento mensal', 'o payload leva situacaoJuridica');
  }
  // PATCH (editar assistido) leva os campos novos quando mudam.
  {
    const dom = mkDom(['editAssId','editAssVinculo','editAssNome','editAssProcesso','editAssVara',
                       'editAssLocal','editAssDataInicio','editAssDataFim','editAssFrequencia',
                       'editAssStatus','editAssEtiqueta','editAssResponsavelTecnico','editAssCpf',
                       'editAssTelefone','editAssEndereco','editAssSituacaoJuridica','modalEditarAssistido']);
    const sent = [];
    const ctx = sandbox(`
      let assEditOriginal = null;
      ${extract(appSrc, 'assNormalizaEtiqueta')}
      ${extract(appSrc, 'assConfirmarProcessoInvalido')}
      ${extract(appSrc, 'fecharModalEditarAssistido')}
      ${extract(appSrc, 'salvarEditarAssistido')}
      globalThis.__salvar = salvarEditarAssistido;
      globalThis.__setOrig = (v) => { assEditOriginal = v; };
    `, {
      document: dom.document,
      validarCNJ: () => true,
      confirm: () => true,
      api: async (p, opt) => { if(opt && opt.method === 'PATCH') sent.push(JSON.parse(opt.body)); return { id: 1 }; },
      toast: (m) => { ctx.toasts.push(String(m)); },
      loadAssistidos: () => {}, atualizarBadgesAssistidos: () => {},
    });
    const REG = {
      id: 1, vinculo: 'V001', nome: 'Fulano', processo: '0001234-56.2024.8.06.0001',
      vara: 'Vara 1', localAssinatura: 'COMEP Cariri', dataInicio: '2024-01-01', dataFim: '',
      frequencia: 'mensal', status: 'ativo', etiqueta: 'pendente', responsavelTecnico: '',
      cpf: '', telefone: '', endereco: '', situacaoJuridica: '',
    };
    dom.els.editAssId.value = '1';
    dom.els.editAssVinculo.value = REG.vinculo;
    dom.els.editAssNome.value = REG.nome;
    dom.els.editAssProcesso.value = REG.processo;
    dom.els.editAssVara.value = REG.vara;
    dom.els.editAssLocal.value = REG.localAssinatura;
    dom.els.editAssDataInicio.value = REG.dataInicio;
    dom.els.editAssDataFim.value = '';
    dom.els.editAssFrequencia.value = REG.frequencia;
    dom.els.editAssStatus.value = REG.status;
    dom.els.editAssEtiqueta.value = 'pendente';
    dom.els.editAssResponsavelTecnico.value = '';
    dom.els.editAssCpf.value = '12345678900';
    dom.els.editAssTelefone.value = '(88) 99999-9999';
    dom.els.editAssEndereco.value = 'Rua B, 20';
    dom.els.editAssSituacaoJuridica.value = 'Em observação';
    ctx.__setOrig(REG);
    sent.length = 0;
    await ctx.__salvar();
    assert(sent.length === 1, 'salvarEditarAssistido faz o PATCH');
    const b = sent[0] || {};
    assert(b.cpf === '12345678900', 'o PATCH leva cpf');
    assert(b.telefone === '(88) 99999-9999', 'o PATCH leva telefone');
    assert(b.endereco === 'Rua B, 20', 'o PATCH leva endereco');
    assert(b.situacaoJuridica === 'Em observação', 'o PATCH leva situacaoJuridica');
    assert(b.dataFim === undefined, 'campo não alterado (dataFim) não entra no payload');
  }

  // -------------------------------------------------------------------
  console.log('\n=== ASSISTIDOS P2 — placeholder do PROCESSO é um CNJ válido ===');
  {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    // O placeholder precisa ter 20 dígitos (regra do back-end).
    const digitos = s => String(s || '').replace(/[.\-\/]/g, '');
    ['assProcesso','editAssProcesso'].forEach(id => {
      const re = new RegExp('id="' + id + '"[^>]*placeholder="([^"]+)"');
      const m = re.exec(html);
      assert(!!m, 'o campo #' + id + ' tem placeholder');
      assert(m && /^\d{20}$/.test(digitos(m[1])),
        'o placeholder de #' + id + ' tem 20 dígitos (CNJ aceito pelo back)');
    });
    // Confirma que o exemplo do placeholder passa na validação do back.
    const ctx = sandbox(extract(appSrc, 'validarCNJ') + '\n;globalThis.__v = validarCNJ;');
    const m = /id="assProcesso"[^>]*placeholder="([^"]+)"/.exec(html);
    assert(m && ctx.__v(m[1]), 'o placeholder do processo passa na validação de CNJ');
  }
  // Aviso amigável ANTES de enviar, sem bloquear se o usuário preferir.
  {
    const ctx = sandbox(`
      ${extract(appSrc, 'validarCNJ')}
      ${extract(appSrc, 'assConfirmarProcessoInvalido')}
      globalThis.__conf = assConfirmarProcessoInvalido;
    `, { confirm: () => true });
    assert(ctx.__conf('0001234-56.2024.8.06.0001') === true,
      'processo válido passa sem aviso');
    assert(ctx.__conf('') === true, 'processo vazio não gera aviso');
    assert(ctx.__conf('123') === true, 'processo inválido avisa mas não bloqueia (usuário preferiu)');
    assert(ctx.toasts.some(t => /CNJ/i.test(t)), 'o aviso explica o formato CNJ esperado');
  }

  // -------------------------------------------------------------------
  console.log('\n=== ASSISTIDOS P2 — card mostra "Conferido por" quando o registro tem ===');
  {
    const dom = mkDom(['assContentTodos']);
    const ctx = sandbox(`
      ${extract(appSrc, 'fmtDataBR')}
      ${extract(appSrc, 'assNormalizaEtiqueta')}
      ${extract(appSrc, 'etiquetaBadge')}
      ${extract(appSrc, 'situacaoBadge')}
      ${extract(appSrc, 'renderAssistidosTodos')}
      globalThis.__render = renderAssistidosTodos;
    `, { document: dom.document });

    ctx.__render([{
      id: 1, nome: 'Fulano', vinculo: 'V001', processo: '0001234-56.2024.8.06.0001',
      vara: 'Vara 1', localAssinatura: 'COMEP Cariri', dataInicio: '2024-01-01',
      frequencia: 'mensal', status: 'ativo', etiqueta: 'conferido',
      conferidoPor: 'Maria Souza', conferidoEm: '2024-05-02T10:00:00.000Z',
    }]);
    const html = dom.els.assContentTodos.innerHTML;
    assert(/Conferido por/.test(html), 'mostra "Conferido por" no card');
    assert(/Maria Souza/.test(html), 'mostra QUEM conferiu');
    assert(/02\/05\/2024/.test(html), 'mostra QUANDO conferiu');

    // Sem conferidoPor/conferidoEm: só o badge, sem a linha de conferência.
    ctx.__render([{
      id: 2, nome: 'Bela', vinculo: 'V002', processo: '0001234-56.2024.8.06.0001',
      vara: 'Vara 1', localAssinatura: 'COMEP Cariri', dataInicio: '2024-01-01',
      frequencia: 'mensal', status: 'ativo', etiqueta: 'pendente',
    }]);
    const html2 = dom.els.assContentTodos.innerHTML;
    assert(!/Conferido por/.test(html2), 'sem dados de conferência, a linha não aparece');
    assert(/Não conferido/.test(html2), 'o badge continua sendo mostrado');
  }

  console.log(`\n=== RESULTADO: ${passed} passed, ${failed} failed ===`);
  process.exit(failed ? 1 : 0);
})();
