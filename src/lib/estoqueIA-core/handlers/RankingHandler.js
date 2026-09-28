const BaseHandler = require('./BaseHandler');
const { getOrFetch } = require('../cache');

class RankingHandler extends BaseHandler {
  match(query, ctx) {
    return /ranking|qual unidade.*mais|maior estoque|onde tem mais|top/.test(query);
  }

  async handle(query, ctx) {
    const { store, helpers, material, contrato } = ctx;
    const mat = material || 'TZPR04';
    const c = contrato || 'CE01';

    const all = await getOrFetch('estoque', {}, () => store.estoque.all());
    const rows = all.filter(e => String(e.contrato).toUpperCase() === c && String(e.material).toUpperCase() === mat);

    if (!rows.length) return { intent: 'ranking', text: `Sem dados para ${mat} ${c}` };

    const sorted = [...rows].sort((a, b) => Number(b.saldo) - Number(a.saldo));
    const top = sorted[0];

    const txt = sorted.map((r, i) =>
      `${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '•'} ${r.unidade}: ${r.saldo}`
    ).join('\n');

    return {
      intent: 'ranking',
      text: `🏆 Ranking ${mat} ${c} — maior: **${top.unidade}** com ${top.saldo} unidades\n\n${txt}`,
      data: { material: mat, contrato: c, ranking: sorted },
      suggestions: ['comparar UMEPE vs UP-Cariri', 'alertas ' + c]
    };
  }
}

module.exports = RankingHandler;