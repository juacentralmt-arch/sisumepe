const BaseHandler = require('./BaseHandler');
const { getOrFetch } = require('../cache');
const { MATERIAIS, labelContrato } = require('../helpers');

class PrevisaoRupturaHandler extends BaseHandler {
  match(query, ctx) {
    return /previsao ruptura|previsão ruptura|ruptura prevista|quando vai acabar/.test(query);
  }

  async handle(query, ctx) {
    const { store, helpers, contrato, material, unidade } = ctx;
    const c = contrato || 'CE01';
    const mat = material || 'TZPR04';
    const uni = unidade;

    // Buscar últimos 90 dias de saídas
    const movs = await getOrFetch('estoqueMov', { limit: 'all', contrato: c, material: mat, unidade: uni }, () => store.estoqueMov.all({ limit: 'all', contrato: c, material: mat, unidade: uni }));
    const corte = new Date(Date.now() - 90 * 86400000);
    const saidas = movs.filter(m => m.tipo === 'saida' && new Date(m.createdAt) >= corte);

    if (saidas.length < 5) {
      return {
        intent: 'previsao_ruptura',
        text: `⚠️ Dados insuficientes para previsão (${saidas.length} saídas em 90d). Mínimo recomendado: 5+ movimentos.`,
        data: { contrato: c, material: mat, unidade: uni, saidas: saidas.length },
        suggestions: ['consumo ' + mat + ' ' + c, 'evolução 30 dias ' + mat]
      };
    }

    // Regressão linear simples: y = a + bx
    const dias = saidas.map(m => {
      const diff = Math.floor((new Date(m.createdAt) - corte) / 86400000);
      return { x: diff, y: Number(m.qtd) };
    });

    const n = dias.length;
    const sumX = dias.reduce((s, d) => s + d.x, 0);
    const sumY = dias.reduce((s, d) => s + d.y, 0);
    const sumXY = dias.reduce((s, d) => s + d.x * d.y, 0);
    const sumX2 = dias.reduce((s, d) => s + d.x * d.x, 0);

    const b = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const a = (sumY - b * sumX) / n;

    // Projeção 30 dias à frente
    const ultimoDia = dias[dias.length - 1].x;
    const projecao30d = [];
    let consumoProjetado = 0;
    for (let i = 1; i <= 30; i++) {
      const dia = ultimoDia + i;
      const consumoDia = Math.max(0, a + b * dia);
      consumoProjetado += consumoDia;
      projecao30d.push({ dia: i, consumo: consumoDia.toFixed(2) });
    }

    const allEstoque = await getOrFetch('estoque', {}, () => store.estoque.all());
    const saldoAtual = allEstoque
      .filter(e => String(e.contrato).toUpperCase() === c && String(e.material).toUpperCase() === mat && (!uni || String(e.unidade) === uni))
      .reduce((s, e) => s + Number(e.saldo || 0), 0);

    const diasAteRuptura = consumoProjetado > 0 ? Math.floor(saldoAtual / (consumoProjetado / 30)) : Infinity;
    const cLabel = labelContrato(c, store);

    let status;
    if (diasAteRuptura === Infinity) status = '✅ Sem tendência de ruptura';
    else if (diasAteRuptura <= 7) status = `🔴 **Ruptura provável em ${diasAteRuptura} dias**`;
    else if (diasAteRuptura <= 15) status = `🟡 Atenção: ruptura em ~${diasAteRuptura} dias`;
    else status = `🟢 Estável: ruptura em ~${diasAteRuptura} dias (tendência atual)`;

    const txt = `🔮 **Previsão de Ruptura — ${mat} ${cLabel}${uni ? ' • ' + uni : ''}**\n` +
      `Base: ${saidas.length} saídas nos últimos 90 dias (regressão linear)\n` +
      `Tendência diária: **${b >= 0 ? '+' : ''}${b.toFixed(3)}** un/dia (${b > 0 ? 'crescente' : b < 0 ? 'decrescente' : 'estável'})\n` +
      `Consumo projetado 30d: **${consumoProjetado.toFixed(1)}** un\n` +
      `Saldo atual: **${saldoAtual}** un\n` +
      `${status}\n\n` +
      `📊 Próximos 7 dias: ${projecao30d.slice(0, 7).map(p => `${p.dia}º: ${p.consumo}`).join(' • ')}...`;

    return {
      intent: 'previsao_ruptura',
      text: txt,
      data: { contrato: c, material: mat, unidade: uni, saidas: saidas.length, a, b, consumoProjetado, saldoAtual, diasAteRuptura, projecao30d },
      suggestions: ['reposição ' + c, 'sugestão pedido compra ' + c + ' próximo mês', 'evolução 30 dias ' + mat]
    };
  }
}

module.exports = PrevisaoRupturaHandler;