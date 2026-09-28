const BaseHandler = require('./BaseHandler');
const { getOrFetch } = require('../cache');
const { MATERIAIS, extractUnidade } = require('../helpers');

class CompararHandler extends BaseHandler {
  match(query, ctx) {
    return /comparar| vs | versus |comparativo/.test(query);
  }

  async handle(query, ctx) {
    const { store, helpers, contrato, material, unidade, qRaw } = ctx;
    const c = contrato || 'CE01';
    const mats = material ? [material] : MATERIAIS;
    const todas = await getOrFetch('estoque', {}, () => store.estoque.all());
    const filtradas = todas.filter(e => String(e.contrato).toUpperCase() === c);

    const partes = qRaw.split(/vs|versus|comparar/i).map(s => s.trim()).filter(Boolean);
    let u1 = null, u2 = null;
    if (partes.length >= 2) {
      u1 = extractUnidade(partes[0]) || extractUnidade(qRaw);
      const aposVs = qRaw.split(/vs|versus/i)[1] || '';
      u2 = extractUnidade(aposVs);
    }
    if (!u1) u1 = unidade || 'UMEPE Juazeiro';
    if (!u2) u2 = helpers.UNIDADES.find(u => u !== u1) || 'UP-Cariri';

    const getSaldo = (u, mat) => {
      const r = filtradas.find(e => e.unidade === u && e.material === mat);
      return r ? Number(r.saldo || 0) : 0;
    };

    const linhas = mats.map(m => {
      const a = getSaldo(u1, m), b = getSaldo(u2, m);
      const diff = a - b;
      return { material: m, u1: a, u2: b, diff, vencedor: diff > 0 ? u1 : diff < 0 ? u2 : 'empate' };
    });

    const txt = `⚖️ **Comparativo ${c}: ${u1} vs ${u2}**\n` +
      linhas.map(l => `• ${l.material}: ${u1} **${l.u1}** vs ${u2} **${l.u2}** ${l.diff !== 0 ? `(${l.diff > 0 ? '+' : ''}${l.diff})` : ''} → ${l.vencedor}`).join('\n');

    return {
      intent: 'comparar',
      text: txt,
      data: { contrato: c, u1, u2, linhas },
      suggestions: [`saldo ${u1} ${c}`, `saldo ${u2} ${c}`, 'ranking TZPR04 ' + c]
    };
  }
}

module.exports = CompararHandler;