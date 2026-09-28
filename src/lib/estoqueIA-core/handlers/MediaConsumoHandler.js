const BaseHandler = require('./BaseHandler');
const { getOrFetch } = require('../cache');
const { matsProntos, labelContrato } = require('../helpers');

class MediaConsumoHandler extends BaseHandler {
  match(query, ctx) {
    return /media de consumo|consumo mensal|previsao de demanda|previsão de demanda/.test(query);
  }

  async handle(query, ctx) {
    const { store, helpers, sistema, contrato, unidade, material } = ctx;
    const sis = sistema;
    const cNorm = contrato || (sis === 'infinity' ? 'INF' : 'CE01');
    const uni = unidade || 'UMEPE Juazeiro';
    const cLabel = labelContrato(cNorm, store);
    const mats = (material && helpers.MATERIAIS.includes(material)) ? [material] : matsProntos(sis);
    const dias = 30;

    let linhas = [];
    for (const mat of mats) {
      const movs = await getOrFetch('estoqueMov', { limit: 'all', contrato: cNorm, material: mat, unidade: uni, sistema: sis }, () => store.estoqueMov.all({ limit: 'all', contrato: cNorm, material: mat, unidade: uni, sistema: sis }));
      const saidas = movs.filter(m => m.tipo === 'saida' && new Date(m.createdAt) >= new Date(Date.now() - dias * 86400000));
      const totalSaidas = saidas.reduce((s, m) => s + Number(m.qtd || 0), 0);
      const mediaDiaria = totalSaidas / dias;
      const allEstoque = await getOrFetch('estoque', { sistema: sis }, () => store.estoque.all(sis));
      const saldoAtual = allEstoque.find(e => String(e.contrato).toUpperCase() === cNorm && String(e.material).toUpperCase() === mat && String(e.unidade) === uni);
      const saldo = saldoAtual ? Number(saldoAtual.saldo || 0) : 0;
      linhas.push({ material: mat, totalSaidas, mediaDiaria, mediaMensal: totalSaidas, saldo });
    }

    const txt = `📊 **Média de Consumo Mensal — ${uni} (${cLabel}${sis ? ' • ' + (sis === 'infinity' ? 'Infinity' : 'Spacecom') : ''}) — Previsão de Demanda (últimos 30 dias)**\n` +
      linhas.map(l => `• ${l.material}: **${l.totalSaidas}** un/mês (${l.mediaDiaria.toFixed(2)}/dia) — saldo atual **${l.saldo}** → dura ~${l.mediaDiaria > 0 ? Math.floor(l.saldo / l.mediaDiaria) + ' dias' : '∞'}`).join('\n') +
      `\n\n💡 Base: saídas dos últimos 30 dias em ${uni}.`;

    return {
      intent: 'media_consumo',
      text: txt,
      data: { contrato: cNorm, sistema: sis, unidade: uni, dias, linhas },
      suggestions: ['necessidade de reposição ' + uni + ' ' + (sis === 'infinity' ? 'Infinity' : cLabel), 'evolução 30 dias ' + (mats[0] || 'TZPR04') + ' ' + (sis === 'infinity' ? 'Infinity' : cLabel), 'estoque atual ' + uni]
    };
  }
}

module.exports = MediaConsumoHandler;