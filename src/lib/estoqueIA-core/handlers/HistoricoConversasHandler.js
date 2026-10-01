const BaseHandler = require('./BaseHandler');

class HistoricoConversasHandler extends BaseHandler {
  match(query, ctx) {
    return /o que (eu |você )?(perguntei|consultei)|(minhas )?últimas consultas|histórico de perguntas|histórico de consultas|minhas perguntas|o que perguntei/.test(query);
  }

  async handle(query, ctx) {
    const { store, user } = ctx;
    
    try {
      const rows = await store.audit.search({
        kind: 'ia_consulta',
        byUser: user,
        limit: 15
      });
      
      if (!rows.items || rows.items.length === 0) {
        return {
          intent: 'historico_conversas',
          text: '📝 **Histórico vazio**\nVocê ainda não fez nenhuma consulta.',
          data: { consultas: [] },
          suggestions: ['saldo TZPR04 CE01', 'consumo médio 30 dias', 'alertas CE01']
        };
      }
      
      const consultas = rows.items
        .map((r, i) => {
          const intent = r.summary.split(':')[0];
          const pergunta = r.summary.split(':').slice(1).join(':').trim().slice(0, 80);
          const latency = r.ref?.match(/latency:(\d+)ms/);
          const latencyMs = latency ? latency[1] : '?';
          return `${i + 1}. **${intent}** — "${pergunta}" (${latencyMs}ms)`;
        })
        .join('\n');
      
      return {
        intent: 'historico_conversas',
        text: `📝 **Suas últimas ${rows.items.length} consultas:**\n\n${consultas}`,
        data: { consultas: rows.items },
        suggestions: ['saldo TZPR04 CE01', 'consumo médio 30 dias', 'alertas CE01']
      };
    } catch (e) {
      console.error('HistoricoConversasHandler error:', e);
      return {
        intent: 'historico_conversas',
        text: '❌ Erro ao buscar histórico de consultas.',
        data: { consultas: [] },
        suggestions: []
      };
    }
  }
}

module.exports = HistoricoConversasHandler;