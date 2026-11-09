'use strict';

const LOCAIS_ASSINATURA = Object.freeze(['COMEP Cariri', 'Albergado Cariri', 'COAP Cariri']);
const PERIODOS_COMPARECIMENTO = Object.freeze(['semanal', 'quinzenal', 'mensal', 'bimestral', 'trimestral']);
const FREQ_DAYS = Object.freeze({ semanal: 7, quinzenal: 15, mensal: 30, bimestral: 60, trimestral: 90 });
const STATUS_ASSISTIDO = Object.freeze(['ativo', 'concluido', 'arquivado']);

function isoDate(value) {
  const s = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [year, month, day] = s.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
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

  return digito(cpf.slice(0, 9), 10) === Number(cpf[9])
    && digito(cpf.slice(0, 10), 11) === Number(cpf[10]);
}

function agruparComparecimentos(comparecimentos) {
  const porAssistido = new Map();
  for (const comparecimento of comparecimentos) {
    const key = String(comparecimento.assistidoId);
    if (!porAssistido.has(key)) porAssistido.set(key, []);
    porAssistido.get(key).push(comparecimento);
  }
  for (const rows of porAssistido.values()) {
    rows.sort((a, b) => String(b.dataComparecimento || '').localeCompare(String(a.dataComparecimento || ''))
      || Number(b.id) - Number(a.id));
  }
  return porAssistido;
}

function comparecimentoProtocolado(comparecimento) {
  return !!(comparecimento && (comparecimento.protocolado || String(comparecimento.juntada || '').trim()));
}

function nomeKey(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('pt-BR');
}

function proximoEsperadoAssistido(assistido, comparecimentos) {
  const ultimo = comparecimentos[0];
  const base = ultimo ? ultimo.dataComparecimento : assistido.dataInicio || null;
  if (!isoDate(base)) return null;
  const [year, month, day] = String(base).split('-').map(Number);
  const dias = FREQ_DAYS[assistido.frequencia] || 30;
  return new Date(Date.UTC(year, month - 1, day + dias)).toISOString().slice(0, 10);
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
  proximoEsperadoAssistido,
};
