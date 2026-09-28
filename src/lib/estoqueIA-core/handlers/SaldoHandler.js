const BaseHandler = require('./BaseHandler');
const { getOrFetch } = require('../cache');
const { MATERIAIS, MATERIAIS_SERIAL, LIMITES, fmtSaldo } = require('../helpers');

class SaldoHandler extends BaseHandler {
  match(query, ctx) {
    const explicit = /saldo|estoque|quantos|quanto tem|qtd\b|total|tem quantos|quantidade/.test(query);
    const hasContext = ctx.contrato || ctx.material || ctx.unidade;
    const isFollowUp = /^(e |e\?)/.test(query) && hasContext;
    return explicit || isFollowUp;
  }

  async handle(query, ctx) {
    const { store, helpers, contrato, unidade, material } = ctx;
    let all = await getOrFetch('estoque', {}, () => store.estoque.all());
    let filtroDesc = [];

    if (contrato) { all = all.filter(e => String(e.contrato).toUpperCase() === contrato); filtroDesc.push(contrato); }
    if (unidade) { all = all.filter(e => String(e.unidade) === unidade); filtroDesc.push(unidade); }
    if (material) { all = all.filter(e => String(e.material).toUpperCase() === material); filtroDesc.push(material); }

    if (!contrato && !unidade && !material) {
      const porContrato = {};
      all.forEach(e => { porContrato[e.contrato] = (porContrato[e.contrato] || 0) + Number(e.saldo || 0); });
      const total = all.reduce((s, x) => s + Number(x.saldo || 0), 0);
      const txt = Object.entries(porContrato).map(([c, v]) => `${c}: ${v}`).join('\n');
      const porUnidade = {};
      all.forEach(e => { porUnidade[e.unidade] = (porUnidade[e.unidade] || 0) + Number(e.saldo || 0); });
      const txtU = Object.entries(porUnidade).map(([u, v]) => `${u}: ${v}`).join('\n');
      return {
        intent: 'saldo',
        text: `📦 Saldo total geral: **${fmtSaldo(total)}** unidades\nPor contrato:\n${txt}\n\nPor unidade:\n${txtU}`,
        data: { total, porContrato, porUnidade, itens: all }
      };
    }

    const total = all.reduce((s, x) => s + Number(x.saldo || 0), 0);
    let detalhe = '';

    if (unidade && contrato && !material) {
      detalhe = all.map(e => `${e.material}: ${e.saldo} ${Number(e.saldo || 0) < (LIMITES[e.material] || 5) ? '⚠️' : ''}`).join('\n');
    } else if (material && unidade) {
      const row = all[0];
      detalhe = row ? `${row.material} em ${row.unidade} (${row.contrato}): **${row.saldo}** unidades` : `Sem registro para ${material} em ${unidade}`;
      if (row && MATERIAIS_SERIAL.includes(material)) {
        const serAll = await store.estoqueSerial.byContratoUnidade(row.contrato, row.unidade);
        const disp = serAll.filter(s => s.status === 'disponivel');
        detalhe += `\nSeriais ${material} disponíveis: ${disp.length}${disp.length ? '\n' + disp.slice(0, 10).map(s => s.serial).join(', ') + (disp.length > 10 ? ' +' + (disp.length - 10) : '') : ''}`;
      }
    } else {
      detalhe = all.map(e => `${e.contrato} ${e.material} em ${e.unidade}: ${e.saldo} ${Number(e.saldo || 0) < (LIMITES[e.material] || 5) ? '⚠️' : ''}`).join('\n');
    }

    const titulo = filtroDesc.length ? `Saldo ${filtroDesc.join(' ')}` : 'Saldo';
    return {
      intent: 'saldo',
      text: `📦 ${titulo} — Total: **${fmtSaldo(total)}** unidades\n${detalhe}`,
      data: { total, itens: all, contrato, unidade, material },
      suggestions: ['alertas ' + (contrato || 'CE01'), 'ranking ' + (material || 'TZPR04')]
    };
  }
}

module.exports = SaldoHandler;