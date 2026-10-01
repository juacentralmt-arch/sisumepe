const BaseHandler = require('./BaseHandler');
const { getOrFetch } = require('../cache');
const { norm } = require('../helpers');

class MovsHandler extends BaseHandler {
  match(query, ctx) {
    // Não matchar se for claramente histórico
    if (/historico|como estava/.test(query)) return false;
    if (/movimentac|movimentacoes|ultimas|recentes|^hoje$|^ontem$|esta semana/.test(query)) return true;
    // "o que joanderson fez ontem", "o que X fizeram"
    if (ctx && ctx.usuario && (/o que.*(fez|fizeram)|(fez|fizeram).*(ontem|hoje|essa semana|semana)/.test(query))) return true;
    return false;
  }

  async handle(query, ctx) {
    const { store, contrato, unidade, material, qRaw, usuario, data, periodo } = ctx;
    const q = norm(qRaw);
    // "do CE" genérico (sem 01/02): não filtra contrato (vale CE01+CE02)
    const ceGeral = !contrato && /\bce\b/.test(q);
    const cFat = ceGeral ? null : contrato;
    const completo = usuario || data;
    const lim = completo ? 'all' : 50;
    let movs = await getOrFetch('estoqueMov', { limit: lim, contrato: cFat, unidade, material, usuario: usuario && usuario.user, data, periodo }, () => store.estoqueMov.all({ limit: lim, contrato: cFat, unidade, material }));

    if (usuario) {
      const alvo = norm(`${usuario.user} ${usuario.name || ''}`);
      const toks = alvo.split(/\s+/).filter(t => t.length >= 4);
      movs = movs.filter(m => {
        const mu = norm(`${m.userName || ''} ${m.user || ''}`);
        return mu.includes(norm(usuario.user)) || toks.some(t => mu.includes(t));
      });
    }
    let rotuloData = '';
    if (data) {
      movs = movs.filter(m => String(m.createdAt).slice(0, 10) === data);
      const [a, me, d] = data.split('-');
      rotuloData = ` em ${d}/${me}/${a}`;
    } else if (/hoje/.test(qRaw)) {
      const hoje = new Date().toISOString().slice(0, 10);
      movs = movs.filter(m => String(m.createdAt).slice(0, 10) === hoje);
      rotuloData = ' de hoje';
    } else if (/ontem/.test(qRaw)) {
      const dd = new Date(); dd.setDate(dd.getDate() - 1); const ds = dd.toISOString().slice(0, 10);
      movs = movs.filter(m => String(m.createdAt).slice(0, 10) === ds);
      rotuloData = ' de ontem';
    } else if (/esta semana|ultimos 7/.test(qRaw)) {
      const l = new Date(); l.setDate(l.getDate() - 7);
      movs = movs.filter(m => new Date(m.createdAt) >= l);
      rotuloData = ' dos últimos 7 dias';
    } else if (periodo) {
      const l = new Date(); l.setDate(l.getDate() - periodo);
      movs = movs.filter(m => new Date(m.createdAt) >= l);
      rotuloData = ` dos últimos ${periodo} dias`;
    }

    const total = movs.length;
    movs = movs.slice(0, 20);
    const quem = usuario ? ` de ${usuario.name || usuario.user}` : '';
    const onde = `${contrato ? ' ' + contrato : ceGeral ? ' (CE01+CE02)' : ''}${unidade ? ' em ' + unidade : ''}${material ? ' ' + material : ''}`;
    if (!movs.length) {
      return {
        intent: 'movs',
        text: `Nenhuma movimentação encontrada${quem}${rotuloData}${onde}.`,
        data: { movs: [], usuario: usuario || null, total: 0 },
        suggestions: ['histórico ' + (contrato || 'CE01'), 'movimentações últimos 7 dias ' + (contrato || 'CE01'), 'consumo ' + (material || 'TZPR04')]
      };
    }

    const ent = movs.filter(m => m.tipo !== 'saida').length;
    const sai = movs.length - ent;
    const txt = movs.map(m =>
      `${new Date(m.createdAt).toLocaleString('pt-BR')} — ${m.tipo.toUpperCase()} ${m.qtd}x ${m.material} em ${m.unidade}${m.unidadeDestino ? ' → ' + m.unidadeDestino : ''} (${m.contrato}) | ${m.motivo || ''} | ${m.userName || m.user} [${m.saldoAntes}→${m.saldoDepois}]${m.seriais && m.seriais.length ? ' | seriais: ' + m.seriais.slice(0, 2).join(', ') + (m.seriais.length > 2 ? ' +' + (m.seriais.length - 2) : '') : ''}${m.estornado ? ' (ESTORNADO)' : ''}`
    ).join('\n');

    const sugUser = usuario ? `movimentações de ${usuario.user} ontem ${contrato || 'CE01'}` : `movimentações por usuário ontem ${contrato || 'CE01'}`;
    return {
      intent: 'movs',
      text: `📋 ${total} movimentação${total > 1 ? 'ões' : ''}${quem}${rotuloData}${onde} — ${ent} entrada${ent === 1 ? '' : 's'} • ${sai} saída${sai === 1 ? '' : 's'}${total > 20 ? ` (mostrando 20 de ${total})` : ''}:\n${txt}`,
      data: { movs, usuario: usuario || null, total },
      suggestions: [sugUser, 'consumo ' + (material || 'TZPR04'), 'histórico ' + (contrato || 'CE01')]
    };
  }
}

module.exports = MovsHandler;
