const BaseHandler = require('./BaseHandler');
const { getOrFetch } = require('../cache');
const { MATERIAIS, MATERIAIS_SERIAL, LIMITES } = require('../helpers');

class FichaHandler extends BaseHandler {
  match(query, ctx) {
    return /ficha|detalhe|detalhar|mostra.*detalhe/.test(query);
  }

  async handle(query, ctx) {
    const { store, helpers, contrato, material, unidade } = ctx;
    const c = contrato || 'CE01';
    const mat = material || 'TZPR04';
    const uni = unidade || 'UMEPE Juazeiro';

    const allEstoque = await getOrFetch('estoque', {}, () => store.estoque.all());
    const row = allEstoque.find(e => String(e.contrato).toUpperCase() === c && String(e.material).toUpperCase() === mat && String(e.unidade) === uni);

    if (!row) {
      return {
        intent: 'ficha',
        text: `Sem registro para ${mat} em ${uni} (${c})`,
        data: { contrato: c, material: mat, unidade: uni }
      };
    }

    const movs = (await store.estoqueMov.all({ limit: 20, contrato: c, material: mat, unidade: uni })).slice(0, 5);
    const seriais = MATERIAIS_SERIAL.includes(mat)
      ? (await store.estoqueSerial.all({ contrato: c, unidade: uni })).filter(s => s.status === 'disponivel').slice(0, 8)
      : [];

    let txt = `📋 **Ficha ${mat} — ${uni} (${c})**\nSaldo: **${row.saldo}** / mínimo ${LIMITES[mat] || 5} ${Number(row.saldo || 0) < (LIMITES[mat] || 5) ? '⚠️ ABAIXO' : ''}\n`;

    if (seriais.length) txt += `Seriais disp.: ${seriais.map(s => s.serial).join(', ')}${seriais.length >= 8 ? '…' : ''}\n`;

    if (movs.length) {
      txt += `Últimos movs:\n` + movs.map(m =>
        `• ${new Date(m.createdAt).toLocaleDateString('pt-BR')} ${m.tipo} ${m.qtd} — ${m.motivo || ''} [${m.saldoAntes}→${m.saldoDepois}]`
      ).join('\n');
    }

    return {
      intent: 'ficha',
      text: txt,
      data: { row, movs, seriais },
      suggestions: ['saldo ' + mat + ' ' + uni, 'histórico ' + uni, 'reposição ' + c]
    };
  }
}

module.exports = FichaHandler;