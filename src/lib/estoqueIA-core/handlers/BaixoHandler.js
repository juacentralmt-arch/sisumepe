const BaseHandler = require('./BaseHandler');
const { extractThreshold } = require('../helpers');

class BaixoHandler extends BaseHandler {
  match(query, ctx) {
    return /baixo|critico|alerta|abaixo|zerado/.test(query);
  }

  async handle(query, ctx) {
    const { store, helpers, contrato, unidade, material, qRaw } = ctx;
    const thrOverride = extractThreshold(qRaw, material);
    const res = await store.estoque.alertas({ contrato, unidade, limite: thrOverride || undefined });
    let baixos = res.itens;
    if (material) baixos = baixos.filter(e => String(e.material).toUpperCase() === material);

    if (!baixos.length) {
      return {
        intent: 'baixo',
        text: `✅ Nenhum item abaixo do mínimo${contrato ? ' em ' + contrato : ''}${unidade ? ' em ' + unidade : ''}${material ? ' (' + material + ')' : ''}.`,
        data: { threshold: thrOverride, baixos: [], ...res },
        suggestions: ['reposição ' + (contrato || 'CE01'), 'ranking TZPR04']
      };
    }

    const txt = baixos.map(r => `${r.contrato} ${r.material} em ${r.unidade}: ${r.saldo}/${r.limite} (faltam ${r.deficit})${r.saldo === 0 ? ' 🔴 ZERADO' : ''}`).join('\n');
    const thrInfo = thrOverride ? `abaixo de ${thrOverride}` : 'abaixo do mínimo configurado';

    return {
      intent: 'baixo',
      text: `⚠️ Itens ${thrInfo} (${baixos.length}${res.criticos ? `, ${res.criticos} zerados` : ''}):\n${txt}\n\n💡 Dica: digite "reposição ${contrato || 'CE01'}" para ver o que comprar.`,
      data: { threshold: thrOverride, baixos, ...res },
      suggestions: ['reposição ' + (contrato || 'CE01'), 'ranking TZPR04']
    };
  }
}

module.exports = BaixoHandler;