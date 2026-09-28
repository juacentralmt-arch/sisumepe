const BaseHandler = require('./BaseHandler');
const { getOrFetch } = require('../cache');
const { matTZPR, matsProntos, LIMITES, labelContrato, fmtSaldo } = require('../helpers');

class EstoqueAtualHandler extends BaseHandler {
  match(query, ctx) {
    return /estoque atual|prontos para uso|pronto para uso/.test(query);
  }

  async handle(query, ctx) {
    const { store, helpers, sistema, contrato, unidade, material } = ctx;
    const sis = sistema;
    const cNorm = contrato || (sis === 'infinity' ? 'INF' : 'CE01');
    const uni = unidade || 'UMEPE Juazeiro';
    const cLabel = labelContrato(cNorm, store);

    const all = await getOrFetch('estoque', { sistema: sis }, () => store.estoque.all(sis));
    const matT = matTZPR(sis);
    const tzpr = all.find(e => String(e.contrato).toUpperCase() === cNorm && String(e.material).toUpperCase() === matT && String(e.unidade) === uni);
    const upr = sis === 'infinity' ? null : all.find(e => String(e.contrato).toUpperCase() === cNorm && String(e.material).toUpperCase() === 'UPR04' && String(e.unidade) === uni);
    const tzprSaldo = tzpr ? Number(tzpr.saldo || 0) : 0;
    const uprSaldo = upr ? Number(upr.saldo || 0) : 0;
    const tzprStatus = tzprSaldo < (LIMITES[matT] || 5) ? '⚠️ ABAIXO DO MÍNIMO' : '✅ OK';
    const uprStatus = uprSaldo < LIMITES.UPR04 ? '⚠️ ABAIXO DO MÍNIMO' : '✅ OK';
    const siglaSys = sis ? ` • ${sis === 'infinity' ? 'Infinity' : 'Spacecom'}` : '';

    if (material === matT) {
      return {
        intent: 'estoque_atual',
        text: `📦 **Estoque Atual — ${uni} (${cLabel}${siglaSys}) — Prontos para uso**\n• ${matT}: **${tzprSaldo}** un ${tzprStatus} (mín ${LIMITES[matT] || 5})`,
        data: { contrato: cNorm, sistema: sis, unidade: uni, tzpr: tzprSaldo, upr: uprSaldo },
        suggestions: ['média de consumo mensal ' + uni, 'necessidade de reposição ' + uni, 'ficha ' + matT + ' ' + uni]
      };
    }

    if (material === 'UPR04') {
      return {
        intent: 'estoque_atual',
        text: `📦 **Estoque Atual — ${uni} (${cLabel}${siglaSys}) — Prontos para uso**\n• UPR04: **${uprSaldo}** un ${uprStatus} (mín ${LIMITES.UPR04})`,
        data: { contrato: cNorm, sistema: sis, unidade: uni, tzpr: tzprSaldo, upr: uprSaldo },
        suggestions: ['média de consumo mensal ' + uni, 'necessidade de reposição ' + uni]
      };
    }

    const linhasT = `• ${matT}: **${tzprSaldo}** un ${tzprStatus} (mín ${LIMITES[matT] || 5})`;
    const txt = sis === 'infinity'
      ? `📦 **Estoque Atual — ${uni} (${cLabel}${siglaSys}) — Prontos para uso**\n${linhasT}`
      : `📦 **Estoque Atual — ${uni} (${cLabel}${siglaSys}) — Prontos para uso**\n${linhasT}\n• UPR04: **${uprSaldo}** un ${uprStatus} (mín ${LIMITES.UPR04})\n• **Total TZPR+UPR: ${tzprSaldo + uprSaldo}** un`;

    return {
      intent: 'estoque_atual',
      text: txt,
      data: { contrato: cNorm, sistema: sis, unidade: uni, tzpr: tzprSaldo, upr: uprSaldo, total: tzprSaldo + uprSaldo },
      suggestions: ['média de consumo mensal ' + uni + ' ' + (sis === 'infinity' ? 'Infinity' : cLabel), 'necessidade de reposição ' + uni + ' ' + (sis === 'infinity' ? 'Infinity' : cLabel), 'ficha ' + matT + ' ' + uni]
    };
  }
}

module.exports = EstoqueAtualHandler;