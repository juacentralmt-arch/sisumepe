const BaseHandler = require('./BaseHandler');
const { getOrFetch } = require('../cache');
const { MATERIAIS_SERIAL, extractData } = require('../helpers');

class HistoricoHandler extends BaseHandler {
  match(query, ctx) {
    return /historico|como estava|em\s+\d{4}-\d{2}-\d{2}|em\s+\d{2}\/\d{2}\/\d{4}/.test(query) || ctx.data;
  }

  async handle(query, ctx) {
    const { store, helpers, contrato, unidade, data, qRaw } = ctx;
    const c = contrato || 'CE01';
    const d = data || new Date().toISOString().slice(0, 10);

    try {
      let list;
      if (unidade) list = await store.estoque.atDate(c, d, unidade);
      else if (/detalhado|por unidade/.test(qRaw)) list = await store.estoque.atDateDetailed(c, d);
      else list = await store.estoque.atDate(c, d);

      const total = list.reduce((s, x) => s + Number(x.saldo || 0), 0);
      const detalhe = list.map(r => `${r.material}${r.unidade && r.unidade !== 'TOTAL' ? ' (' + r.unidade + ')' : ''}: ${r.saldo}${MATERIAIS_SERIAL.includes(r.material) && r.seriais && r.seriais.length ? ' [' + r.seriais.length + ' seriais]' : ''}`).join('\n');
      const titulo = unidade ? `Histórico ${c} em ${d} — ${unidade}` : `Histórico ${c} em ${d} — total geral` + (/detalhado/.test(qRaw) ? ' (detalhado por unidade)' : '');

      return {
        intent: 'historico',
        text: `📅 ${titulo} — Total: **${total}** unidades\n${detalhe}`,
        data: { contrato: c, data: d, unidade: unidade || null, total, itens: list },
        suggestions: ['saldo atual ' + c, 'movimentações ' + c, 'evolução 7 dias ' + c]
      };
    } catch (e) {
      return { intent: 'erro', text: 'Erro ao buscar histórico: ' + e.message };
    }
  }
}

module.exports = HistoricoHandler;