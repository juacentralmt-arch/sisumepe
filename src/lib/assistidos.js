'use strict';

const LOCAIS_ASSINATURA = Object.freeze(['COMEP Cariri', 'Albergado Cariri', 'COAP Cariri']);
const PERIODOS_COMPARECIMENTO = Object.freeze(['semanal', 'quinzenal', 'mensal', 'bimestral', 'trimestral']);
const FREQ_DAYS = Object.freeze({ semanal: 7, quinzenal: 15, mensal: 30, bimestral: 60, trimestral: 90 });
const STATUS_ASSISTIDO = Object.freeze(['ativo', 'concluido', 'arquivado']);

function isoDate(value) {
  const s = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function cpfValido(value) {
  const raw = String(value || '').trim();
  if (!/^[\d.\-\s]+$/.test(raw)) return false;
  const cpf = raw.replace(/\D/g, '');
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  const digito = (base, pesoInicial) => {
    let soma = 0;
    for (let i = 0; i < base.length; i++) soma += Number(base[i]) * (pesoInicial - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return digito(cpf.slice(0, 9), 10) === Number(cpf[9]) && digito(cpf.slice(0, 10), 11) === Number(cpf[10]);
}

function agruparComparecimentos(comps) {
  const byId = new Map();
  for (const c of comps) {
    const key = String(c.assistidoId);
    if (!byId.has(key)) byId.set(key, []);
    byId.get(key).push(c);
  }
  for (const rows of byId.values()) {
    rows.sort((a, b) => String(b.dataComparecimento || '').localeCompare(String(a.dataComparecimento || '')) || Number(b.id) - Number(a.id));
  }
  return byId;
}

function comparecimentoProtocolado(c) {
  return !!(c && (c.protocolado || String(c.juntada || '').trim()));
}

function nomeKey(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('pt-BR');
}

function filtrarAssistidosBase(list, query = {}) {
  const contains = (a, field, value) => String(a[field] || '').toLocaleLowerCase('pt-BR').includes(String(value).toLocaleLowerCase('pt-BR'));
  for (const [param, field] of [['q', null], ['nome', 'nome'], ['vinculo', 'vinculo'], ['processo', 'processo']]) {
    const value = String(query[param] || '').trim();
    if (!value) continue;
    list = list.filter(a => field ? contains(a, field, value) : ['nome', 'processo', 'vinculo'].some(k => contains(a, k, value)));
  }
  for (const [param, field] of [['vara', 'vara'], ['local', 'localAssinatura'], ['status', 'status'], ['frequencia', 'frequencia'], ['etiqueta', 'etiqueta']]) {
    if (query[param] !== undefined && String(query[param]).trim() !== '') list = list.filter(a => String(a[field] || '') === String(query[param]).trim());
  }
  return list;
}

function proximoEsperadoAssistido(a, comparecimentos) {
  const last = comparecimentos[0];
  const base = last ? last.dataComparecimento : a.dataInicio || null;
  if (!isoDate(base)) return null;
  const [y, m, d] = String(base).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + (FREQ_DAYS[a.frequencia] || 30))).toISOString().slice(0, 10);
}

module.exports = {
  LOCAIS_ASSINATURA,
  PERIODOS_COMPARECIMENTO,
  FREQ_DAYS,
  STATUS_ASSISTIDO,
  isoDate,
  cpfValido,
  agruparComparecimentos,
  comparecimentoProtocolado,
  nomeKey,
  filtrarAssistidosBase,
  proximoEsperadoAssistido
};
