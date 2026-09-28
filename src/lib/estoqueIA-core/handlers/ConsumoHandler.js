const BaseHandler = require('./BaseHandler');
const { getOrFetch } = require('../cache');
const { MATERIAIS, extractPeriodo, labelContrato } = require('../helpers');

class ConsumoHandler extends BaseHandler {
  match(query, ctx) {
    return /consumo|media|giro|quanto consome|ruptura|quando acaba|dias ate acabar|duracao/.test(query);
  }

  async handle(query, ctx) {
    const { store, helpers, contrato, material, unidade, periodo, qRaw } = ctx;
    const c = contrato || 'CE01';
    const mat = material || 'TZPR04';
    const uni = unidade;
    const dias = periodo || 30;

    const movs = await getOrFetch('estoqueMov', { limit: 'all', contrato: c, material: mat, unidade: uni }, () => store.estoqueMov.all({ limit: 'all', contrato: c, material: mat, unidade: uni }));
    const saidas = movs.filter(m => m.tipo === 'saida' && new Date(m.createdAt) >= new Date(Date.now() - dias * 86400000));
    const totalSaidas = saidas.reduce((s, m) => s + Number(m.qtd || 0), 0);
    const media = totalSaidas / dias;
    const allEstoque = await getOrFetch('estoque', {}, () => store.estoque.all());
    const saldoAtual = allEstoque
      .filter(e => String(e.contrato).toUpperCase() === c && String(e.material).toUpperCase() === mat && (!uni || String(e.unidade) === uni))
      .reduce((s, e) => s + Number(e.saldo || 0), 0);
    const diasAteAcabar = media > 0 ? Math.floor(saldoAtual / media) : Infinity;

    let rupturaTxt;
    if (diasAteAcabar === Infinity) rupturaTxt = '✅ Sem consumo recente';
    else if (diasAteAcabar <= 3) rupturaTxt = `🔴 Ruptura em ~${diasAteAcabar} dias!`;
    else rupturaTxt = `⏳ Dura ~${diasAteAcabar} dias (em ritmo atual)`;

    const cLabel = labelContrato(c, store);
    const txt = `📊 **Consumo ${mat} ${c}${uni ? ' • ' + uni : ''} — últimos ${dias} dias**\nSaídas: **${totalSaidas}** un (${media.toFixed(2)}/dia)\nSaldo atual: **${saldoAtual}**\n${rupturaTxt}\n\n💡 Dica: "reposição ${c}" para o que comprar.`;

    return {
      intent: 'consumo',
      text: txt,
      data: { contrato: c, material: mat, unidade: uni, dias, totalSaidas, media, saldoAtual, diasAteAcabar },
      suggestions: ['reposição ' + c, 'evolução 7 dias ' + mat, 'alertas ' + c]
    };
  }
}

module.exports = ConsumoHandler;