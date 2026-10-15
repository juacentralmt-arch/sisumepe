// Ativações por destino ([ATIVACAO] Réu Solto / Núcleo de Custódia / ...).
// Ex.: "quantas ativações tiveram de réu solto?", "ativações núcleo de
// custódia últimos 7 dias", "ativações ontem". Usa ctx.store.estoqueMov,
// logo vale para o Estoque 1 e o Estoque 2 (store com escopo).
const BaseHandler = require('./BaseHandler');
const { getOrFetch } = require('../cache');

const DESTINOS = ['Réu Solto', 'Núcleo de Custódia', 'Réu Preso Unidade'];

function normTxt(t) {
  return String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function extrairDestino(t) {
  return extrairDestinos(t)[0] || null;
}

// Todos os destinos mencionados ("réu solto, núcleo de custódia" filtra os
// dois; nenhum mencionado = sem filtro, mostra o breakdown completo).
function extrairDestinos(t) {
  const n = normTxt(t);
  const out = [];
  if (/nucleo de custodia/.test(n)) out.push('Núcleo de Custódia');
  if (/reu solto/.test(n)) out.push('Réu Solto');
  if (/reu preso/.test(n)) out.push('Réu Preso Unidade');
  return out;
}

// Destino gravado no motivo ("[ATIVACAO] <destino>") -> rótulo canônico;
// desconhecidos viram o próprio texto (limitado), nunca somem da conta.
function destinoDoMotivo(motivo) {
  const t = String(motivo || '').replace(/^\[ativacao\]\s*/i, '').trim();
  return extrairDestino(t) || (t ? t.slice(0, 40) : 'Não informado');
}

class AtivacoesHandler extends BaseHandler {
  match(query) {
    return /\bativa[cç][aã]o|\bativa[cç][oõ]es/i.test(String(query || ''));
  }

  async handle(query, ctx) {
    const { store, sistema, contrato, unidade, periodo, ns, qRaw } = ctx;
    const sis = sistema || null;
    const cNorm = contrato || (sis === 'infinity' ? 'INF' : 'CE01');
    const dias = Math.min(Math.max(Number(periodo) || 30, 1), 365);
    const desde = new Date(Date.now() - dias * 864e5);
    const filtroDestinos = extrairDestinos(qRaw);
    const movs = await getOrFetch('ativacoes', { c: cNorm, sis: sis || 'all', u: unidade || 'all', d: dias }, async () => {
      const all = await store.estoqueMov.all({ limit: 'all' });
      return all.filter(m => /^\[ativacao\]/i.test(String((m && m.motivo) || '').trim()));
    }, ns);
    const list = movs.filter(m => {
      if (String(m.contrato).toUpperCase() !== String(cNorm).toUpperCase()) return false;
      if (sis && String(m.sistema || 'spacecom').toLowerCase() !== String(sis).toLowerCase()) return false;
      if (unidade && String(m.unidade) !== String(unidade)) return false;
      if (new Date(m.createdAt) < desde) return false;
      if (filtroDestinos.length && !filtroDestinos.includes(destinoDoMotivo(m.motivo))) return false;
      return true;
    });
    const porDestino = new Map();
    for (const m of list) {
      const d = destinoDoMotivo(m.motivo);
      const e = porDestino.get(d) || { destino: d, ativacoes: 0, equipamentos: 0 };
      e.ativacoes++;
      e.equipamentos += Math.abs(Number(m.qtd) || 0);
      porDestino.set(d, e);
    }
    const linhas = [...porDestino.values()].sort((a, b) => b.ativacoes - a.ativacoes);
    const totalAtivacoes = linhas.reduce((s, x) => s + x.ativacoes, 0);
    const totalEquip = linhas.reduce((s, x) => s + x.equipamentos, 0);
    const onde = `${cNorm}${unidade ? ' • ' + unidade : ' • todas as unidades'}`;
    if (!linhas.length) {
      const soUm = filtroDestinos.length === 1 ? ' (' + filtroDestinos[0] + ')' : '';
      return {
        intent: 'ativacoes',
        text: `⚡ Nenhuma ativação${soUm} nos últimos ${dias} dias • ${onde}.`,
        data: { porDestino: [], totalAtivacoes: 0, totalEquipamentos: 0, dias, contrato: cNorm },
        suggestions: ['ativações últimos 7 dias', 'consumo médio TZPR04', 'saldo TZPR04']
      };
    }
    const detalhe = linhas.map(x => `• ${x.destino}: **${x.ativacoes}** ativação${x.ativacoes === 1 ? '' : 'ões'} (${x.equipamentos} equip.)`).join('\n');
    return {
      intent: 'ativacoes',
      text: `⚡ Ativações — últimos ${dias} dias • ${onde}: **${totalAtivacoes}** ativação${totalAtivacoes === 1 ? '' : 'ões'} (${totalEquip} equipamentos)\n${detalhe}`,
      data: { porDestino: linhas, totalAtivacoes, totalEquipamentos: totalEquip, dias, contrato: cNorm },
      suggestions: ['ativações réu solto 30 dias', 'ativações núcleo de custódia 30 dias', 'consumo médio TZPR04']
    };
  }
}

module.exports = AtivacoesHandler;
