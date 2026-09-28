const BaseHandler = require('./BaseHandler');
const { getOrFetch } = require('../cache');
const { UNIDADES, MATERIAIS, LIMITES, matsProntos, labelContrato } = require('../helpers');

class TransferenciaSugeridaHandler extends BaseHandler {
  match(query, ctx) {
    return /transferencia sugerida|transferência sugerida|balancear|balanceamento|redistribuir/.test(query);
  }

  async handle(query, ctx) {
    const { store, helpers, contrato, material, sistema } = ctx;
    const c = contrato || 'CE01';
    const cLabel = labelContrato(c, store);
    const sis = sistema;
    const mat = material || (sis === 'infinity' ? 'TZPR' : 'TZPR04');

    const all = await getOrFetch('estoque', { sistema: sis }, () => store.estoque.all(sis));
    const filtrados = all.filter(e => String(e.contrato).toUpperCase() === c && String(e.material).toUpperCase() === mat);

    if (filtrados.length < 2) {
      return {
        intent: 'transferencia_sugerida',
        text: `⚠️ Necessário pelo menos 2 unidades com ${mat} para sugerir transferência.`,
        data: { contrato: c, material: mat },
        suggestions: ['saldo ' + mat + ' ' + c, 'ranking ' + mat + ' ' + c]
      };
    }

    // Calcular média por unidade
    const total = filtrados.reduce((s, e) => s + Number(e.saldo || 0), 0);
    const media = total / filtrados.length;
    const minimo = LIMITES[mat] || 5;

    // Unidades com excesso (> média + 20%) e deficit (< mínimo)
    const excesso = filtrados.filter(e => Number(e.saldo || 0) > media * 1.2);
    const deficit = filtrados.filter(e => Number(e.saldo || 0) < minimo);

    if (!excesso.length || !deficit.length) {
      return {
        intent: 'transferencia_sugerida',
        text: `✅ **Balanceamento ${mat} ${cLabel}**\nDistribuição equilibrada entre unidades (média: ${media.toFixed(1)}). Nenhuma transferência necessária.`,
        data: { contrato: c, material: mat, unidades: filtrados.map(e => ({ unidade: e.unidade, saldo: e.saldo })) },
        suggestions: ['saldo ' + mat + ' ' + c, 'comparar ' + filtrados[0].unidade + ' vs ' + filtrados[1].unidade + ' ' + c]
      };
    }

    // Algoritmo guloso: mover do maior excesso para o maior deficit
    const sugestoes = [];
    const excessoSorted = [...excesso].sort((a, b) => Number(b.saldo) - Number(a.saldo));
    const deficitSorted = [...deficit].sort((a, b) => Number(a.saldo) - Number(b.saldo));

    for (const dest of deficitSorted) {
      const falta = minimo - Number(dest.saldo);
      for (const orig of excessoSorted) {
        const disponivel = Number(orig.saldo) - Math.max(minimo, media * 1.2);
        if (disponivel <= 0) continue;
        const qtd = Math.min(falta, disponivel);
        if (qtd > 0) {
          sugestoes.push({
            de: orig.unidade,
            para: dest.unidade,
            qtd,
            saldoOrigem: orig.saldo,
            saldoDestino: dest.saldo,
            aposOrigem: Number(orig.saldo) - qtd,
            aposDestino: Number(dest.saldo) + qtd
          });
          orig.saldo = Number(orig.saldo) - qtd;
          dest.saldo = Number(dest.saldo) + qtd;
          break;
        }
      }
    }

    const txt = `⚖️ **Transferência Sugerida — ${mat} ${cLabel}**\n` +
      `Objetivo: todas unidades ≥ ${minimo} (mín) e próximas da média ${media.toFixed(1)}\n\n` +
      sugestoes.map(s =>
        `• ${s.de} (${s.saldoOrigem} → ${s.aposOrigem}) → ${s.para} (${s.saldoDestino} → ${s.aposDestino}): **${s.qtd} un**`
      ).join('\n') +
      `\n\n💡 Execute via: "transferir ${mat} ${sugestoes[0]?.qtd} ${sugestoes[0]?.de} ${sugestoes[0]?.para} ${c}"`;

    return {
      intent: 'transferencia_sugerida',
      text: txt,
      data: { contrato: c, material: mat, sistema: sis, sugestoes, media, minimo },
      suggestions: ['saldo ' + mat + ' ' + c, 'reposição ' + c, 'alertas ' + c]
    };
  }
}

module.exports = TransferenciaSugeridaHandler;