const BaseHandler = require('./BaseHandler');

class HelpHandler extends BaseHandler {
  match(query, ctx) {
    return /ajuda|help|como usar|comandos|o que voce faz/.test(query);
  }

  async handle(query, ctx) {
    return {
      intent: 'help',
      text: `🤖 **Chat IA Estoque — Comandos** (100% on-prem)

**1️⃣ Estoque Atual (Prontos para uso)**
• \`estoque atual [CE01] [UMEPE]\` / \`prontos para uso TZPR UPR\` — TZPR e UPR no local

**2️⃣ Média de Consumo**
• \`média de consumo mensal [CE01] [UMEPE]\` / \`consumo mensal\` — previsão 30 dias
• \`consumo médio [material] [N dias]\` — ex: "consumo médio de materiais em 30 dias", "consumo médio FONTE04 15 dias"

**3️⃣ Necessidade de Reposição (Segurança)**
• \`necessidade de reposição [CE01] [UMEPE]\` / \`quantos faltam para segurança\` — faltam hoje

**📦 Saldo**
• \`saldo [material] [unidade] [CE01/CE02]\` — ex: "saldo TZPR04 UMEPE Juazeiro CE01"
• \`saldo total CE01\` / \`saldo por unidade\`

**📊 Visão geral**
• \`resumo [CE01/CE02] [unidade]\` — consolidado com alertas
• \`alertas / estoque baixo / zerado\` — abaixo do mínimo (TZPR04=5, UPR04=5, FONTE04=5, CINTA=10, TRAVAS=20)
• \`reposição / comprar / o que falta [CE01]\` — lista de compra 150%
• \`comparar UMEPE vs UP-Cariri CE01\` — comparativo
• \`ranking [material] CE01\` — onde tem mais

**📈 Análise**
• \`consumo / giro / ruptura [material] [unidade]\` — média diária e dias até acabar
• \`ficha [material] [unidade]\` — detalhe + seriais + últimos movs
• \`evolução 7 dias TZPR04 CE01\` — tendência + gráfico
• \`previsão ruptura TZPR04 UMEPE 30 dias\` — regressão linear 90 dias
• \`sugestão pedido compra CE01 próximo mês\` — consumo + lead time + segurança

**📅 Histórico e movimentações**
• \`histórico [data] [unidade]\` — ex: "histórico ontem UMEPE" / "2026-09-24"
• \`movimentações [hoje|ontem|últimos 7 dias]\` — últimas 20
• \`movimentações de [usuário] [data] [CE01]\` — ex: "movimentações de joanderson ontem CE01"

**🔢 Seriais (TZPR04/UPR04)**
• \`seriais [CE01] [unidade]\` — disponíveis
• \`buscar serial 1234567890\` — exato ou parcial "buscar 4315"

**📍 Outros**
• \`unidades\` • \`exportar / csv / relatório\`
• \`transferência sugerida UMEPE → UP-Cariri\` — balanceamento`,

      data: null,
      suggestions: ['saldo total CE01', 'movimentações por usuário ontem CE01', 'consumo médio 30 dias', 'reposição CE01', 'consumo TZPR04', 'ficha TZPR04 UMEPE', 'comparar UMEPE vs UP-Cariri', 'histórico ontem', 'seriais UPR04', 'ranking CINTA', 'evolução 7 dias', 'estoque baixo', 'previsão ruptura TZPR04 UMEPE 30 dias', 'sugestão pedido compra CE01 próximo mês', 'transferência sugerida UMEPE → UP-Cariri']
    };
  }
}

module.exports = HelpHandler;