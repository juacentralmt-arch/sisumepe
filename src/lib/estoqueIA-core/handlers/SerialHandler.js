const BaseHandler = require('./BaseHandler');
const { getOrFetch } = require('../cache');
const { MATERIAIS_SERIAL } = require('../helpers');

class SerialHandler extends BaseHandler {
  match(query, ctx) {
    return !!ctx.serial;
  }

  async handle(query, ctx) {
    const { store, helpers, contrato, serial } = ctx;
    const qSer = String(serial).replace(/\D/g, '');
    const isExata = qSer.length === 10;

    const allSer = await getOrFetch('estoqueSerial', { contrato }, () => store.estoqueSerial.all(contrato ? { contrato } : undefined));

    if (isExata) {
      const found = allSer.find(s => String(s.serial) === qSer);
      if (!found) {
        const aprox = allSer.filter(s => String(s.serial).includes(qSer)).slice(0, 5);
        if (aprox.length) {
          return {
            intent: 'serial',
            text: `Serial ${qSer} não encontrado exato. Aproximados:\n` + aprox.map(s => `• ${s.serial} — ${s.unidade} (${s.contrato}) ${s.status}`).join('\n'),
            data: { serial: qSer, found: false, aprox },
            suggestions: ['seriais ' + (contrato || 'CE01'), 'saldo TZPR04']
          };
        }
        return {
          intent: 'serial',
          text: `Serial ${qSer} não encontrado em estoque${contrato ? ' em ' + contrato : ''}.`,
          data: { serial: qSer, found: false },
          suggestions: ['seriais TZPR04 CE01', 'saldo TZPR04']
        };
      }
      const statusTxt = found.status === 'disponivel'
        ? `✅ disponível em **${found.unidade}** (${found.contrato})`
        : `📦 em uso (baixa) — último registro **${found.unidade}** (${found.contrato})`;
      return {
        intent: 'serial',
        text: `Serial ${qSer}: ${statusTxt}.`,
        data: { serial: qSer, found: true, row: found },
        suggestions: ['saldo TZPR04 ' + found.unidade, 'histórico ' + found.unidade]
      };
    } else {
      const matches = allSer.filter(s => String(s.serial).includes(qSer)).slice(0, 20);
      if (!matches.length) {
        return {
          intent: 'serial',
          text: `Nenhum serial contém "${qSer}"${contrato ? ' em ' + contrato : ''}. Tente 10 dígitos completos.`,
          data: { serial: qSer, found: false },
          suggestions: ['seriais UPR04 CE01']
        };
      }
      const txt = `🔍 Seriais contendo "${qSer}" — ${matches.length} encontrados (mostrando 20):\n` +
        matches.map(s => `• ${s.serial} — ${s.unidade} (${s.contrato}) ${s.status === 'disponivel' ? '✅' : '📦'}`).join('\n');
      return {
        intent: 'serial',
        text: txt,
        data: { serial: qSer, found: false, matches },
        suggestions: ['buscar serial 1234567890']
      };
    }
  }
}

module.exports = SerialHandler;