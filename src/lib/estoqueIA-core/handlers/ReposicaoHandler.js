const BaseHandler = require('./BaseHandler');
const { getOrFetch } = require('../cache');
const { MATERIAIS, LIMITES, labelContrato, matsProntos } = require('../helpers');

class ReposicaoHandler extends BaseHandler {
  match(query, ctx) {
    return /reposic|repor|comprar|o que falta|precisa comprar|lista de compra|pedido/.test(query);
  }

  async handle(query, ctx) {
    const { store, helpers, contrato, unidade, material } = ctx;
    const res = await store.estoque.alertas({ contrato, unidade, limite: undefined });
    let itens = res.itens;
    if (material) itens = itens.filter(e => String(e.material).toUpperCase() === material);
    if (unidade) itens = itens.filter(e => String(e.unidade) === unidade);

    if (!itens.length) {
      return {
        intent: 'reposicao',
        text: `✅ Nenhuma reposição necessária${contrato ? ' em ' + contrato : ''}${unidade ? ' • ' + unidade : ''}. Tudo acima do mínimo.`,
        data: { itens: [] },
        suggestions: ['saldo total ' + (contrato || 'CE01'), 'ranking TZPR04']
      };
    }

    const sug = itens.map(r => {
      const alvo = Math.ceil(r.limite * 1.5);
      const qtd = Math.max(0, alvo - Number(r.saldo || 0));
      return { ...r, alvo, qtdSugerida: qtd };
    }).sort((a, b) => b.qtdSugerida - a.qtdSugerida);

    const totalPecas = sug.reduce((s, x) => s + x.qtdSugerida, 0);
    const txt = `🛒 **Reposição sugerida${contrato ? ' ' + contrato : ''}${unidade ? ' • ' + unidade : ''}** — ${sug.length} itens abaixo do mínimo (total ${totalPecas} peças para atingir 150% do mínimo)\n` +
      sug.map(r => `• ${r.contrato} ${r.material} em ${r.unidade}: ${r.saldo}/${r.limite} → comprar **${r.qtdSugerida}** (alvo ${r.alvo})${r.saldo === 0 ? ' 🔴 ZERADO' : ''}`).join('\n') +
      `\n\n💡 Mínimos: TZPR04/TZPR=5, UPR04=5, FONTE04=5, CINTA=10, TRAVAS=20`;

    return {
      intent: 'reposicao',
      text: txt,
      data: { itens: sug, totalPecas },
      suggestions: ['alertas ' + (contrato || 'CE01'), 'comparar UMEPE vs UP-Cariri', 'saldo total ' + (contrato || 'CE01')]
    };
  }
}

module.exports = ReposicaoHandler;