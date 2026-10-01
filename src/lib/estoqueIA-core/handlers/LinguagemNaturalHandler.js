const BaseHandler = require('./BaseHandler');
const { getOrFetch } = require('../cache');
const { MATERIAIS, LIMITES, labelContrato, extractUnidade } = require('../helpers');

class LinguagemNaturalHandler extends BaseHandler {
  match(query, ctx) {
    return /quanto tempo (vai )?dura|quando (vai )?acaba|dura (mais )?quantos dias/i.test(query) ||
           /preciso pedir|devo (pedir|comprar)|está na hora de repor|hora de comprar/i.test(query) ||
           /o que (está |ta )?(faltando|em falta|zerado)|itens em falta|o que falta/i.test(query) ||
           /tem \w+ em|existe \w+ em|tem disponível em|voces tem/i.test(query) ||
           /quanto tempo (vai )?durar|vai durar quanto/i.test(query);
  }

  async handle(query, ctx) {
    const { store, helpers, contrato, material, unidade, sistema } = ctx;
    const n = query.toLowerCase();

    // "quanto tempo vai durar o estoque de X?"
    if (/quanto tempo|quando vai acaba|dura quantos|vai durar/.test(n)) {
      const mat = material || 'TZPR04';
      const c = contrato || 'CE01';
      const movs = await getOrFetch('estoqueMov', { limit: 'all', contrato: c, material: mat, unidade }, () => 
        store.estoqueMov.all({ limit: 'all', contrato: c, material: mat, unidade }));
      
      const saidas30 = movs.filter(m => m.tipo === 'saida' && new Date(m.createdAt) >= new Date(Date.now() - 30 * 86400000));
      const totalSaidas = saidas30.reduce((s, m) => s + Number(m.qtd || 0), 0);
      const mediaDiaria = totalSaidas / 30;
      
      const allEstoque = await getOrFetch('estoque', {}, () => store.estoque.all());
      const saldoAtual = allEstoque
        .filter(e => String(e.contrato).toUpperCase() === c && String(e.material).toUpperCase() === mat && (!unidade || String(e.unidade) === unidade))
        .reduce((s, e) => s + Number(e.saldo || 0), 0);

      if (mediaDiaria === 0) {
        return {
          intent: 'duracao',
          text: `📊 **${mat}** — Sem consumo nos últimos 30 dias.\nSaldo atual: **${saldoAtual}** unidades.\nNão é possível estimar duração sem histórico de consumo.`,
          data: { material: mat, saldoAtual, mediaDiaria: 0 },
          suggestions: ['consumo ' + mat + ' ' + c, 'saldo ' + mat + ' ' + c]
        };
      }

      const diasAteAcabar = Math.floor(saldoAtual / mediaDiaria);
      const status = diasAteAcabar <= 3 ? '🔴 CRÍTICO' : diasAteAcabar <= 7 ? '🟡 ATENÇÃO' : '🟢 ESTÁVEL';
      
      return {
        intent: 'duracao',
        text: `⏱️ **Quanto tempo vai durar?**\n\n${mat} ${labelContrato(c, store)}${unidade ? ' • ' + unidade : ''}\n\n` +
          `Saldo atual: **${saldoAtual}** unidades\n` +
          `Consumo médio: **${mediaDiaria.toFixed(2)}/dia** (últimos 30 dias)\n` +
          `Duração estimada: **${diasAteAcabar} dias** ${status}`,
        data: { material: mat, saldoAtual, mediaDiaria, diasAteAcabar },
        suggestions: ['reposição ' + c, 'previsão ruptura ' + mat + ' ' + c, 'alertas ' + c]
      };
    }

    // "preciso pedir mais X?" / "devo comprar?"
    if (/preciso pedir|devo (pedir|comprar)|hora de repor|na hora de comprar/.test(n)) {
      const mat = material || 'TZPR04';
      const c = contrato || 'CE01';
      const limite = LIMITES[mat] || 5;
      
      const allEstoque = await getOrFetch('estoque', {}, () => store.estoque.all());
      const saldoAtual = allEstoque
        .filter(e => String(e.contrato).toUpperCase() === c && String(e.material).toUpperCase() === mat)
        .reduce((s, e) => s + Number(e.saldo || 0), 0);

      const precisaComprar = saldoAtual < limite;
      
      return {
        intent: 'precisa_pedir',
        text: precisaComprar
          ? `✅ **SIM, está na hora de pedir ${mat}!**\n\nSaldo atual: **${saldoAtual}** unidades\nMínimo recomendado: **${limite}** unidades\n\n💡 Use "reposição ${c}" para ver o que comprar.`
          : `❌ **Ainda não.**\n\nSaldo atual de ${mat}: **${saldoAtual}** unidades\nMínimo recomendado: **${limite}** unidades\n\nEstoque OK por enquanto.`,
        data: { material: mat, saldoAtual, limite, precisaComprar },
        suggestions: precisaComprar 
          ? ['reposição ' + c, 'sugestão pedido compra ' + c + ' próximo mês', 'alertas ' + c]
          : ['saldo ' + mat + ' ' + c, 'consumo ' + mat]
      };
    }

    // "o que está faltando?" / "itens em falta"
    if (/faltando|em falta|zerado|o que falta/.test(n)) {
      const c = contrato || null;
      const allEstoque = await getOrFetch('estoque', {}, () => store.estoque.all());
      
      const faltantes = allEstoque
        .filter(e => !c || String(e.contrato).toUpperCase() === c)
        .filter(e => Number(e.saldo || 0) < (LIMITES[e.material] || 5))
        .sort((a, b) => Number(a.saldo || 0) - Number(b.saldo || 0));

      if (!faltantes.length) {
        return {
          intent: 'itens_em_falta',
          text: `✅ **Nenhum item em falta!**\nTodos os materiais estão acima do mínimo.`,
          data: { faltantes: [] },
          suggestions: ['alertas', 'saldo total']
        };
      }

      const txt = faltantes.map(e => 
        `${e.material} em ${e.unidade} (${e.contrato}): **${e.saldo}** ${Number(e.saldo || 0) === 0 ? '🔴 ZERADO' : '🟡 BAIXO'}`
      ).join('\n');

      return {
        intent: 'itens_em_falta',
        text: `⚠️ **Itens em falta ou críticos:**\n\n${txt}\n\n💡 Use "reposição ${c || 'CE01'}" para ver o que comprar.`,
        data: { faltantes },
        suggestions: ['reposição ' + (c || 'CE01'), 'alertas ' + (c || '')]
      };
    }

    // "tem TZPR04 em UMEPE?"
    if (/tem \w+ em|existe \w+ em|tem disponível em/.test(n)) {
      const mat = material;
      const uni = unidade;
      
      if (!mat || !uni) {
        return {
          intent: 'tem_em_ambiguo',
          text: '❓ Especifique material e unidade.\nEx: "tem TZPR04 em UMEPE Juazeiro"',
          suggestions: ['tem TZPR04 em UMEPE Juazeiro', 'tem CINTA em UP-Cariri']
        };
      }

      const c = contrato || 'CE01';
      const allEstoque = await getOrFetch('estoque', {}, () => store.estoque.all());
      const item = allEstoque.find(e => 
        String(e.contrato).toUpperCase() === c && 
        String(e.material).toUpperCase() === mat && 
        String(e.unidade) === uni
      );

      const tem = item && Number(item.saldo || 0) > 0;
      
      return {
        intent: 'tem_em',
        text: tem
          ? `✅ **SIM, tem ${mat} em ${uni}.**\n\nSaldo: **${item.saldo}** unidades`
          : `❌ **Não tem ${mat} em ${uni}** (saldo zerado ou não cadastrado).`,
        data: { material: mat, unidade: uni, saldo: item ? item.saldo : 0, tem },
        suggestions: tem ? ['saldo ' + mat + ' ' + c, 'seriais ' + mat] : ['reposição ' + c, 'saldo ' + mat + ' ' + c]
      };
    }

    return {
      intent: 'linguagem_natural_fallback',
      text: 'Não entendi sua pergunta. Tente reformular.',
      suggestions: ['saldo TZPR04 CE01', 'reposição CE01', 'alertas CE01']
    };
  }
}

module.exports = LinguagemNaturalHandler;
