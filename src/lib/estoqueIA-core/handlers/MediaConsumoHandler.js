const BaseHandler = require('./BaseHandler');
const { getOrFetch } = require('../cache');
const { matsProntos, matsTodos, labelContrato } = require('../helpers');

class MediaConsumoHandler extends BaseHandler {
  match(query, ctx) {
    return /media(\s|-)de(\s|-)consumo|consumo(\s|-)medio|consumo(\s|-)mensal|previsao de demanda|previsão de demanda|quanto consome/.test(query);
  }

  async handle(query, ctx) {
    const { store, helpers, sistema, contrato, unidade, material, periodo, qRaw } = ctx;
    const sis = sistema;
    const cNorm = contrato || (sis === 'infinity' ? 'INF' : 'CE01');
    const cLabel = labelContrato(cNorm, store);
    // dias: período extraído ("últimos 15 dias"), "em N dias" ou 30 padrão
    let dias = periodo || 30;
    const mDias = String(qRaw || '').match(/em\s*(\d{1,3})\s*dias?/i) || String(qRaw || '').match(/(\d{1,3})\s*dias?/i);
    if (!periodo && mDias) dias = Math.min(90, Math.max(1, Number(mDias[1])));
    // materiais: específico > "materiais/todos" (todos do sistema) > prontos (padrão)
    const q = String(qRaw || '').toLowerCase();
    const mats = (material && helpers.MATERIAIS.includes(material)) ? [material]
      : (/\bmateriais\b|\btodos\b|\bgeral\b/.test(q) ? matsTodos(sis) : matsProntos(sis));
    // unidade: específica ou todas somadas
    const uni = unidade || null;
    const uniLabel = uni || 'todas as unidades';
    const fim = new Date();
    const ini = new Date(Date.now() - dias * 86400000);

    let linhas = [];
    let totSaidas = 0;
    for (const mat of mats) {
      const movs = await getOrFetch('estoqueMov', { limit: 'all', contrato: cNorm, material: mat, unidade: uni, sistema: sis, dias }, () => store.estoqueMov.all({ limit: 'all', contrato: cNorm, material: mat, unidade: uni, sistema: sis }));
      const saidas = movs.filter(m => m.tipo === 'saida' && new Date(m.createdAt) >= ini);
      const totalSaidas = saidas.reduce((s, m) => s + Number(m.qtd || 0), 0);
      totSaidas += totalSaidas;
      const mediaDiaria = totalSaidas / dias;
      const allEstoque = await getOrFetch('estoque', { sistema: sis }, () => store.estoque.all(sis));
      const saldo = allEstoque
        .filter(e => String(e.contrato).toUpperCase() === cNorm && String(e.material).toUpperCase() === mat && (!uni || String(e.unidade) === uni))
        .reduce((s, e) => s + Number(e.saldo || 0), 0);
      linhas.push({ material: mat, totalSaidas, mediaDiaria, saldo });
    }

    const fmtD = d => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    const txt = `📊 Consumo médio — últimos ${dias} dias • ${cLabel}${sis ? ' • ' + (sis === 'infinity' ? 'Infinity' : 'Spacecom') : ''} • ${uniLabel} (total ${totSaidas} un)\n` +
      linhas.map(l => `• ${l.material}: **${l.totalSaidas}** un (${l.mediaDiaria.toFixed(2)}/dia) — saldo **${l.saldo}** → dura ~${l.mediaDiaria > 0 ? Math.floor(l.saldo / l.mediaDiaria) + ' dias' : '∞'}`).join('\n') +
      `\n\n💡 Base: saídas de ${fmtD(ini)} a ${fmtD(fim)}${uni ? ' em ' + uni : ', somando todas as unidades'}.`;

    return {
      intent: 'media_consumo',
      text: txt,
      data: { contrato: cNorm, sistema: sis, unidade: uni, dias, linhas },
      suggestions: ['necessidade de reposição ' + (uni || '') + ' ' + (sis === 'infinity' ? 'Infinity' : cLabel), 'previsão ruptura ' + mats[0] + ' ' + (uni || '') + ' 30 dias', 'consumo médio ' + mats[0] + ' 15 dias']
    };
  }
}

module.exports = MediaConsumoHandler;
