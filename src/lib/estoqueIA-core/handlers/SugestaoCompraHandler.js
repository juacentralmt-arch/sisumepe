const BaseHandler = require('./BaseHandler');
const { getOrFetch } = require('../cache');
const { MATERIAIS, LIMITES, labelContrato } = require('../helpers');

class SugestaoCompraHandler extends BaseHandler {
  match(query, ctx) {
    return /sugest.*pedido compra|sugestao pedido|pedido de compra|o que comprar.*mes|compra.*proxim.*mes/.test(query);
  }

  async handle(query, ctx) {
    const { store, helpers, contrato, unidade } = ctx;
    const c = contrato || 'CE01';
    const cLabel = labelContrato(c, store);
    const uni = unidade;

    // Lead times estimados por material (dias)
    const LEAD_TIME = { TZPR04: 14, TZPR: 14, UPR04: 14, FONTE04: 21, CINTA: 7, TRAVAS: 7 };

    const mats = helpers.matsProntos ? helpers.matsProntos(null) : MATERIAIS;
    let sugestoes = [];

    for (const mat of mats) {
      // Consumo médio 30d
      const movs = await getOrFetch('estoqueMov', { limit: 'all', contrato: c, material: mat, unidade: uni }, () => store.estoqueMov.all({ limit: 'all', contrato: c, material: mat, unidade: uni }));
      const saidas30 = movs.filter(m => m.tipo === 'saida' && new Date(m.createdAt) >= new Date(Date.now() - 30 * 86400000));
      const mediaDiaria = saidas30.reduce((s, m) => s + Number(m.qtd || 0), 0) / 30;

      // Saldo atual
      const allEstoque = await getOrFetch('estoque', {}, () => store.estoque.all());
      const saldoAtual = allEstoque
        .filter(e => String(e.contrato).toUpperCase() === c && String(e.material).toUpperCase() === mat && (!uni || String(e.unidade) === uni))
        .reduce((s, e) => s + Number(e.saldo || 0), 0);

      const leadTime = LEAD_TIME[mat] || 14;
      const consumoLeadTime = mediaDiaria * leadTime;
      const estoqueSeguranca = (LIMITES[mat] || 5) * 1.5; // 150% do mínimo
      const necessidade = Math.ceil(consumoLeadTime + estoqueSeguranca - saldoAtual);
      const qtdSugerida = Math.max(0, necessidade);

      if (qtdSugerida > 0 || saldoAtual < (LIMITES[mat] || 5)) {
        sugestoes.push({
          material: mat,
          saldoAtual,
          mediaDiaria: mediaDiaria.toFixed(2),
          leadTime,
          consumoLeadTime: consumoLeadTime.toFixed(1),
          estoqueSeguranca: estoqueSeguranca.toFixed(1),
          qtdSugerida,
          prioridade: saldoAtual === 0 ? '🔴 CRÍTICO' : saldoAtual < (LIMITES[mat] || 5) ? '🟡 BAIXO' : '🟢 PREVENTIVO'
        });
      }
    }

    if (!sugestoes.length) {
      return {
        intent: 'sugestao_compra',
        text: `✅ **Sugestão de Pedido de Compra — ${cLabel}${uni ? ' • ' + uni : ''}**\nNenhuma compra necessária no momento. Estoques acima do ponto de pedido.`,
        data: { contrato: c, unidade: uni, sugestoes: [] },
        suggestions: ['alertas ' + c, 'ranking TZPR04 ' + c]
      };
    }

    sugestoes.sort((a, b) => {
      const p = { '🔴 CRÍTICO': 0, '🟡 BAIXO': 1, '🟢 PREVENTIVO': 2 };
      return p[a.prioridade] - p[b.prioridade];
    });

    const totalPecas = sugestoes.reduce((s, x) => s + x.qtdSugerida, 0);
    const txt = `🛒 **Sugestão de Pedido de Compra — ${cLabel}${uni ? ' • ' + uni : ''} (Próximo Mês)**\n` +
      `Lead time considerado + estoque de segurança (150% mín):\n\n` +
      sugestoes.map(s =>
        `• ${s.material}: saldo **${s.saldoAtual}** | consumo/dia **${s.mediaDiaria}** | lead ${s.leadTime}d (${s.consumoLeadTime}) + seg ${s.estoqueSeguranca} → **comprar ${s.qtdSugerida}** ${s.prioridade}`
      ).join('\n') +
      `\n\n**Total: ${totalPecas} peças**\n\n💡 Ajuste quantidades conforme negociação com fornecedor.`;

    return {
      intent: 'sugestao_compra',
      text: txt,
      data: { contrato: c, unidade: uni, sugestoes, totalPecas },
      suggestions: ['reposição ' + c, 'previsão ruptura TZPR04 ' + c, 'alertas ' + c]
    };
  }
}

module.exports = SugestaoCompraHandler;