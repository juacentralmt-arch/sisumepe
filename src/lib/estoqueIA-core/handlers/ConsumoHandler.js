const BaseHandler = require('./BaseHandler');
const { getOrFetch } = require('../cache');
const { MATERIAIS, extractPeriodo, labelContrato } = require('../helpers');

class ConsumoHandler extends BaseHandler {
  match(query, ctx) {
    return /consumo|media|giro|quanto consome|ruptura|quando acaba|dias ate acabar|duracao/.test(query);
  }

  async handle(query, ctx) {
    const { store, helpers, contrato, material, unidade, periodo, qRaw } = ctx;
    const c = contrato || 'CE01';
    const mat = material || 'TZPR04';
    const uni = unidade;
    const dias = periodo || 30;

    const movs = await getOrFetch('estoqueMov', { limit: 'all', contrato: c, material: mat, unidade: uni }, () => store.estoqueMov.all({ limit: 'all', contrato: c, material: mat, unidade: uni }));
    
    const agora = Date.now();
    const inicioAtual = agora - dias * 86400000;
    const inicioAnterior = inicioAtual - dias * 86400000;
    
    const saidasAtual = movs.filter(m => m.tipo === 'saida' && new Date(m.createdAt) >= new Date(inicioAtual) && new Date(m.createdAt) <= new Date(agora));
    const saidasAnterior = movs.filter(m => m.tipo === 'saida' && new Date(m.createdAt) >= new Date(inicioAnterior) && new Date(m.createdAt) < new Date(inicioAtual));
    
    const totalSaidas = saidasAtual.reduce((s, m) => s + Number(m.qtd || 0), 0);
    const totalSaidasAnterior = saidasAnterior.reduce((s, m) => s + Number(m.qtd || 0), 0);
    const media = totalSaidas / dias;
    const mediaAnterior = totalSaidasAnterior / dias;
    
    const allEstoque = await getOrFetch('estoque', {}, () => store.estoque.all());
    const saldoAtual = allEstoque
      .filter(e => String(e.contrato).toUpperCase() === c && String(e.material).toUpperCase() === mat && (!uni || String(e.unidade) === uni))
      .reduce((s, e) => s + Number(e.saldo || 0), 0);
    const diasAteAcabar = media > 0 ? Math.floor(saldoAtual / media) : Infinity;

    let rupturaTxt;
    if (diasAteAcabar === Infinity) rupturaTxt = '✅ Sem consumo recente';
    else if (diasAteAcabar <= 3) rupturaTxt = `🔴 Ruptura em ~${diasAteAcabar} dias!`;
    else rupturaTxt = `⏳ Dura ~${diasAteAcabar} dias (em ritmo atual)`;

    // Comparação com período anterior
    let comparacaoTxt = '';
    if (totalSaidasAnterior > 0) {
      const variacao = ((totalSaidas - totalSaidasAnterior) / totalSaidasAnterior * 100);
      const emoji = variacao > 10 ? '📈' : variacao < -10 ? '📉' : '➡️';
      const texto = variacao > 10 ? 'Aumentou' : variacao < -10 ? 'Diminuiu' : 'Estável';
      comparacaoTxt = `\n${emoji} Vs período anterior: ${totalSaidasAnterior} un (${variacao > 0 ? '+' : ''}${variacao.toFixed(1)}% — ${texto})`;
    } else if (totalSaidas > 0) {
      comparacaoTxt = `\n📊 Período anterior: sem dados de consumo`;
    }

    const cLabel = labelContrato(c, store);
    const txt = `📊 **Consumo ${mat} ${cLabel}${uni ? ' • ' + uni : ''} — últimos ${dias} dias**\nSaídas: **${totalSaidas}** un (${media.toFixed(2)}/dia)${comparacaoTxt}\nSaldo atual: **${saldoAtual}**\n${rupturaTxt}\n\n💡 Dica: "reposição ${c}" para o que comprar.`;

    return {
      intent: 'consumo',
      text: txt,
      data: { contrato: c, material: mat, unidade: uni, dias, totalSaidas, totalSaidasAnterior, media, mediaAnterior, saldoAtual, diasAteAcabar },
      suggestions: ['reposição ' + c, 'evolução 7 dias ' + mat, 'alertas ' + c]
    };
  }
}

module.exports = ConsumoHandler;