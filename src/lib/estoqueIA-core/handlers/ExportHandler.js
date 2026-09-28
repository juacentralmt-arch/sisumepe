const BaseHandler = require('./BaseHandler');
const { getOrFetch } = require('../cache');
const { MATERIAIS, labelContrato } = require('../helpers');

class ExportHandler extends BaseHandler {
  match(query, ctx) {
    return /export|csv|planilha|relatorio|relatório/.test(query) && !/historico/.test(query);
  }

  async handle(query, ctx) {
    const { helpers, contrato } = ctx;
    const c = contrato || 'CE01';
    return {
      intent: 'export',
      text: `📤 Para exportar, use os botões **⬇ CSV** / **⬇ PDF** na aba Estoque ou digite:\n• "histórico ${new Date().toISOString().slice(0,10)} ${c}" para ver e exportar por data\n• "seriais ${c}" para lista de seriais\n\nDica: O relatório completo está em **Estoque > 📊 Relatório**.`,
      data: { contrato: c },
      suggestions: ['histórico hoje ' + c, 'seriais ' + c, 'relatório']
    };
  }
}

module.exports = ExportHandler;