const BaseHandler = require('./BaseHandler');
const { UNIDADES } = require('../helpers');

class UnidadesHandler extends BaseHandler {
  match(query, ctx) {
    return /unidades|localidades/.test(query);
  }

  async handle(query, ctx) {
    return {
      intent: 'unidades',
      text: `📍 Unidades cadastradas (${UNIDADES.length}):\n${UNIDADES.join('\n')}`,
      data: { unidades: UNIDADES }
    };
  }
}

module.exports = UnidadesHandler;