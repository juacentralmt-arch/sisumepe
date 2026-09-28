const BaseHandler = require('./BaseHandler');
const { getOrFetch } = require('../cache');
const { MATERIAIS_SERIAL } = require('../helpers');

class SeriaisHandler extends BaseHandler {
  match(query, ctx) {
    return /seriais|serial/.test(query) && !ctx.serial;
  }

  async handle(query, ctx) {
    const { store, helpers, contrato, unidade, material } = ctx;
    if (material && !MATERIAIS_SERIAL.includes(material)) {
      return {
        intent: 'erro',
        text: `Apenas ${MATERIAIS_SERIAL.join('/')} possuem seriais rastreados (10 dígitos).`
      };
    }

    let ser = await getOrFetch('estoqueSerial', { contrato, unidade }, () => store.estoqueSerial.all({ contrato, unidade }));
    const matSerial = material && MATERIAIS_SERIAL.includes(material) ? material : null;

    const disponiveis = ser.filter(s => s.status === 'disponivel');
    const emUso = ser.filter(s => s.status === 'em_uso');
    const porUnidade = {};
    disponiveis.forEach(s => { porUnidade[s.unidade] = (porUnidade[s.unidade] || 0) + 1; });
    const total = disponiveis.length;
    const detalhe = Object.entries(porUnidade).map(([u, c]) => `${u}: ${c}`).join('\n') || 'nenhum';
    const lista = disponiveis.slice(0, 30).map(s => `${s.serial} — ${s.unidade} (${s.contrato})`).join('\n');
    const label = matSerial || 'TZPR04/UPR04';

    return {
      intent: 'seriais',
      text: `🔢 Seriais ${label} disponíveis — Total **${total}** (em uso: ${emUso.length})\nPor unidade:\n${detalhe}${lista ? '\n\nExemplos:\n' + lista : ''}`,
      data: { total, emUso: emUso.length, porUnidade, seriais: disponiveis.slice(0, 100) },
      suggestions: ['buscar serial 1234567890', 'saldo ' + label]
    };
  }
}

module.exports = SeriaisHandler;