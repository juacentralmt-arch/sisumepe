const BaseHandler = require('./BaseHandler');
const { getOrFetch } = require('../cache');
const { MATERIAIS, extractPeriodo } = require('../helpers');

class TendenciaHandler extends BaseHandler {
  match(query, ctx) {
    return /tendencia|evolucao|evolução|variacao/.test(query) || ctx.periodo;
  }

  async handle(query, ctx) {
    const { store, helpers, contrato, material, unidade, periodo } = ctx;
    const c = contrato || 'CE01';
    const mat = material || 'TZPR04';
    const dias = periodo || 7;

    const hoje = new Date();
    const pontos = [];
    for (let i = dias - 1; i >= 0; i--) {
      const d = new Date(hoje);
      d.setDate(d.getDate() - i);
      const ds = d.toISOString().slice(0, 10);
      try {
        const list = unidade ? await store.estoque.atDate(c, ds, unidade) : await store.estoque.atDate(c, ds);
        const tot = list.filter(x => x.material === mat).reduce((s, x) => s + Number(x.saldo || 0), 0);
        pontos.push({ data: ds, saldo: tot });
      } catch (e) {
        pontos.push({ data: ds.slice(5), saldo: 0 });
      }
    }

    const primeiro = pontos[0]?.saldo || 0;
    const ultimo = pontos[pontos.length - 1]?.saldo || 0;
    const variacao = ultimo - primeiro;

    const txt = `📈 **Evolução ${mat} ${c}${unidade ? ' • ' + unidade : ''} — últimos ${dias} dias**\n` +
      pontos.map(p => `${p.data.slice(5)}: ${p.saldo}`).join(' → ') +
      `\nVariação: ${variacao > 0 ? '+' : ''}${variacao} (${primeiro} → ${ultimo})${variacao > 0 ? ' 📈' : variacao < 0 ? ' 📉' : ' ➡️'}`;

    return {
      intent: 'tendencia',
      text: txt,
      data: { contrato: c, material: mat, unidade: unidade || null, dias, pontos, variacao },
      suggestions: ['histórico hoje ' + c, 'movimentações ' + c, 'alertas ' + c]
    };
  }
}

module.exports = TendenciaHandler;