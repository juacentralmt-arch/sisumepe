const BaseHandler = require('./BaseHandler');
const { getOrFetch } = require('../cache');

class MovsHandler extends BaseHandler {
  match(query, ctx) {
    // Não matchar se for claramente histórico
    if (/historico|como estava/.test(query)) return false;
    return /movimentac|movimentacoes|ultimas|recentes|^hoje$|^ontem$|esta semana/.test(query);
  }

  async handle(query, ctx) {
    const { store, helpers, contrato, unidade, material, qRaw } = ctx;
    let movs = await getOrFetch('estoqueMov', { limit: 50, contrato, unidade, material }, () => store.estoqueMov.all({ limit: 50, contrato, unidade, material }));

    if (/hoje/.test(qRaw)) {
      const hoje = new Date().toISOString().slice(0, 10);
      movs = movs.filter(m => String(m.createdAt).slice(0, 10) === hoje);
    } else if (/ontem/.test(qRaw)) {
      const d = new Date(); d.setDate(d.getDate() - 1); const ds = d.toISOString().slice(0, 10);
      movs = movs.filter(m => String(m.createdAt).slice(0, 10) === ds);
    } else if (/esta semana|ultimos 7/.test(qRaw)) {
      const lim = new Date(); lim.setDate(lim.getDate() - 7);
      movs = movs.filter(m => new Date(m.createdAt) >= lim);
    }

    movs = movs.slice(0, 20);
    if (!movs.length) {
      return {
        intent: 'movs',
        text: 'Nenhuma movimentação encontrada para o filtro.',
        data: { movs: [] },
        suggestions: ['histórico hoje', 'alertas']
      };
    }

    const txt = movs.map(m =>
      `${new Date(m.createdAt).toLocaleString('pt-BR')} — ${m.tipo.toUpperCase()} ${m.qtd}x ${m.material} em ${m.unidade}${m.unidadeDestino ? ' → ' + m.unidadeDestino : ''} (${m.contrato}) | ${m.motivo || ''} | ${m.userName || m.user} [${m.saldoAntes}→${m.saldoDepois}]${m.seriais && m.seriais.length ? ' | seriais: ' + m.seriais.slice(0, 2).join(', ') + (m.seriais.length > 2 ? ' +' + (m.seriais.length - 2) : '') : ''}${m.estornado ? ' (ESTORNADO)' : ''}`
    ).join('\n');

    return {
      intent: 'movs',
      text: `📋 Últimas ${movs.length} movimentações${contrato ? ' ' + contrato : ''}${unidade ? ' em ' + unidade : ''}${material ? ' ' + material : ''}:\n${txt}`,
      data: { movs },
      suggestions: ['histórico ' + (contrato || 'CE01'), 'reposição ' + (contrato || 'CE01')]
    };
  }
}

module.exports = MovsHandler;