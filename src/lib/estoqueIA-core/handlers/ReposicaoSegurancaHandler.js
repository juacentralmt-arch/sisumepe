const BaseHandler = require('./BaseHandler');
const { getOrFetch } = require('../cache');
const { matsProntos, labelContrato, LIMITES, matTZPR } = require('../helpers');

class ReposicaoSegurancaHandler extends BaseHandler {
  match(query, ctx) {
    return /necessidade de reposic|quantos.*faltam|faltam.*atingir|estoque de seguranca|estoque de segurança/.test(query);
  }

  async handle(query, ctx) {
    const { store, helpers, sistema, contrato, unidade, material } = ctx;
    const sis = sistema;
    const cNorm = contrato || (sis === 'infinity' ? 'INF' : 'CE01');
    const uni = unidade || 'UMEPE Juazeiro';
    const cLabel = labelContrato(cNorm, store);

    const res = await store.estoque.alertas({ contrato: cNorm, unidade: uni, sistema: sis });
    let itens = res.itens.filter(r => matsProntos(sis).includes(r.material));
    if (material && helpers.MATERIAIS.includes(material)) itens = res.itens.filter(r => r.material === material);

    if (!itens.length) {
      const all = await getOrFetch('estoque', { sistema: sis }, () => store.estoque.all(sis));
      const matT = matTZPR(sis);
      const tzpr = all.find(e => String(e.contrato).toUpperCase() === cNorm && e.material === matT && e.unidade === uni);
      const upr = sis === 'infinity' ? null : all.find(e => String(e.contrato).toUpperCase() === cNorm && e.material === 'UPR04' && e.unidade === uni);
      const linhaUpr = sis === 'infinity' ? '' : `\n• UPR04: ${upr ? upr.saldo : 0}/${LIMITES.UPR04}`;
      return {
        intent: 'reposicao_seguranca',
        text: `✅ **Necessidade de Reposição — ${uni} (${cLabel}${sis ? ' • ' + (sis === 'infinity' ? 'Infinity' : 'Spacecom') : ''})**\nNenhuma falta hoje. Estoque de segurança OK:\n• ${matT}: ${tzpr ? tzpr.saldo : 0}/${LIMITES[matT] || 5}${linhaUpr}`,
        data: { contrato: cNorm, sistema: sis, unidade: uni, itens: [] },
        suggestions: ['estoque atual ' + uni, 'média de consumo mensal ' + uni]
      };
    }

    const sug = itens.map(r => {
      const alvo = r.limite;
      const falta = Math.max(0, alvo - Number(r.saldo || 0));
      return { ...r, alvo, falta };
    }).sort((a, b) => b.falta - a.falta);

    const totalFalta = sug.reduce((s, x) => s + x.falta, 0);
    const txt = `🛒 **Necessidade de Reposição — ${uni} (${cLabel}${sis ? ' • ' + (sis === 'infinity' ? 'Infinity' : 'Spacecom') : ''}) — Hoje**\nPara atingir o **estoque de segurança** (mínimo):\n` +
      sug.map(r => `• ${r.material}: **${r.saldo}**/${r.limite} → **faltam ${r.falta}** ${r.saldo === 0 ? '🔴 ZERADO' : ''}`).join('\n') +
      `\n\n**Total a repor: ${totalFalta} un**\n💡 Segurança: TZPR04/TZPR=5, UPR04=5 em ${uni}. Dica: "reposição ${cLabel}" para lista completa com alvo 150%.`;

    return {
      intent: 'reposicao_seguranca',
      text: txt,
      data: { contrato: cNorm, sistema: sis, unidade: uni, itens: sug, totalFalta },
      suggestions: ['estoque atual ' + uni + ' ' + (sis === 'infinity' ? 'Infinity' : cLabel), 'média de consumo mensal ' + uni, 'reposição ' + (sis === 'infinity' ? 'Infinity' : cLabel)]
    };
  }
}

module.exports = ReposicaoSegurancaHandler;