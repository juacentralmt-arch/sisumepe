'use strict';

// =====================================================================
//  Domínio do módulo Assistidos — fonte única de verdade.
//  A rota (src/routes/assistidos.js) e o store consumem estas regras;
//  nada aqui duplica regra de negócio.
// =====================================================================

const LOCAIS_ASSINATURA = Object.freeze(['COMEP Cariri', 'Albergado Cariri', 'COAP Cariri']);
const PERIODOS_COMPARECIMENTO = Object.freeze(['semanal', 'quinzenal', 'mensal', 'bimestral', 'trimestral']);
const ETIQUETAS = Object.freeze(['sem', 'verde', 'laranja', 'vermelho']);
// 'arquivado' existe na base herdada da Planilha Geral e precisa continuar
// editável — registros com esse status não podem ficar invisíveis na UI.
const STATUS_ASSISTIDO = Object.freeze(['ativo', 'concluido', 'arquivado']);
// Status que encerram o acompanhamento (aba "Concluídos").
const STATUS_ENCERRADOS = Object.freeze(['concluido', 'arquivado']);

// ---------------------------------------------------------------------
//  Datas
// ---------------------------------------------------------------------
// Valida calendário real (rejeita 31/02, 30/04 etc.) em horário local.
function ehDataValida(value) {
  const s = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

// Normaliza para AAAA-MM-DD. Devolve '' quando o valor não é uma data.
function normalizaData(value) {
  const s = String(value || '').trim();
  return ehDataValida(s) ? s : '';
}

function ehDataFutura(value) {
  if (!ehDataValida(value)) return false;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const dt = new Date(value);
  dt.setHours(0, 0, 0, 0);
  return dt > hoje;
}

// ---------------------------------------------------------------------
//  Processo CNJ — 20 dígitos (7 N + 2 J + 4 A + 1 T + 2 U + 4 F).
//  Registros legados com 21 dígitos continuam gravados, mas não são
//  aceitos em novas escritas (ver validações parciais da rota).
// ---------------------------------------------------------------------
function validarCNJ(value) {
  return /^\d{20}$/.test(String(value || '').replace(/[.\-/]/g, ''));
}

// ---------------------------------------------------------------------
//  Comparecimentos
// ---------------------------------------------------------------------
// "Protocolado" é o único conceito do fluxo: existe quando a juntada
// foi registrada. O campo `protocolado` é a flag; `juntada` guarda o
// número do protocolo. Bases herdadas têm a flag desligada mas o
// número preenchido — por isso as duas condições contam.
function comparecimentoProtocolado(comparecimento) {
  if (!comparecimento) return false;
  if (comparecimento.protocolado === true) return true;
  return !!String(comparecimento.juntada || '').trim();
}

// Compatibilidade: bases antigas gravavam `deleted_at`, o app usa `deletedAt`.
function estaExcluido(registro) {
  if (!registro) return true;
  return !!(registro.deletedAt || registro.deleted_at);
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

// Normaliza texto para comparação (sem acento, minúsculo, pt-BR).
function nomeKey(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('pt-BR');
}

// ---------------------------------------------------------------------
//  Validação por campo — base do PATCH parcial.
//  Cada regra devolve null (ok) ou a mensagem de erro.
// ---------------------------------------------------------------------
const REGRAS = {
  vinculo(v) {
    const s = String(v || '').trim();
    if (!s) return 'Vínculo é obrigatório';
    if (s.length > 60) return 'Vínculo muito longo (máx. 60)';
    return null;
  },
  nome(v) {
    const s = String(v || '').trim();
    if (!s) return 'Nome é obrigatório';
    if (s.length > 200) return 'Nome muito longo (máx. 200)';
    return null;
  },
  processo(v) {
    const s = String(v || '').trim();
    if (!s) return 'Processo é obrigatório';
    if (!validarCNJ(s)) return 'Processo inválido (deve ter 20 dígitos no formato CNJ)';
    return null;
  },
  vara(v) {
    const s = String(v || '').trim();
    if (!s) return 'Vara é obrigatória';
    if (s.length > 120) return 'Vara muito longa (máx. 120)';
    return null;
  },
  localAssinatura(v) {
    const s = String(v || '').trim();
    if (!LOCAIS_ASSINATURA.includes(s)) return 'Local de assinatura inválido';
    return null;
  },
  dataInicio(v) {
    const s = normalizaData(v);
    if (!s) return 'Data de início inválida (use AAAA-MM-DD)';
    if (ehDataFutura(s)) return 'Data de início não pode ser futura';
    return null;
  },
  frequencia(v) {
    const s = String(v || '').trim();
    if (!PERIODOS_COMPARECIMENTO.includes(s)) return 'Frequência inválida';
    return null;
  },
  etiqueta(v) {
    const s = String(v || '').trim();
    if (!ETIQUETAS.includes(s)) return 'Etiqueta inválida. Use: sem, verde, laranja ou vermelho.';
    return null;
  },
  status(v) {
    const s = String(v || '').trim();
    if (!STATUS_ASSISTIDO.includes(s)) return 'Status inválido';
    return null;
  },
  responsavelTecnico(v) {
    const s = String(v || '').trim();
    if (s.length > 120) return 'Responsável técnico muito longo (máx. 120)';
    return null;
  },
  dataFim(v) {
    const s = String(v || '').trim();
    if (s && !ehDataValida(s)) return 'Data de fim inválida (use AAAA-MM-DD)';
    return null;
  },
  situacaoJuridica(v) {
    const s = String(v || '').trim();
    if (s.length > 120) return 'Situação jurídica muito longa (máx. 120)';
    return null;
  },
  cpf(v) {
    const s = String(v || '').trim();
    if (s && !/^\d{11}$/.test(s.replace(/\D/g, ''))) return 'CPF inválido (deve ter 11 dígitos)';
    return null;
  },
  telefone(v) {
    const s = String(v || '').trim();
    if (s && !/^[\d\s()+.-]{8,20}$/.test(s)) return 'Telefone inválido';
    return null;
  },
  endereco(v) {
    const s = String(v || '').trim();
    if (s.length > 300) return 'Endereço muito longo (máx. 300)';
    return null;
  },
};

// Campos que o cliente pode editar via PATCH.
const CAMPOS_EDITAVEIS = Object.freeze(Object.keys(REGRAS));

// Valida apenas os campos presentes em `campos`.
// `opcoes.limpaveis` lista campos que podem ser esvaziados (dataInicio, dataFim).
function validarCampos(campos, valores, opcoes = {}) {
  const limpaveis = opcoes.limpaveis || [];
  for (const campo of campos) {
    const regra = REGRAS[campo];
    if (!regra) return `Campo não editável: ${campo}`;
    const valor = valores[campo];
    if (limpaveis.includes(campo) && !String(valor == null ? '' : valor).trim()) continue;
    const erro = regra(valor);
    if (erro) return erro;
  }
  return null;
}

module.exports = {
  LOCAIS_ASSINATURA,
  PERIODOS_COMPARECIMENTO,
  ETIQUETAS,
  STATUS_ASSISTIDO,
  STATUS_ENCERRADOS,
  CAMPOS_EDITAVEIS,
  ehDataValida,
  normalizaData,
  ehDataFutura,
  validarCNJ,
  comparecimentoProtocolado,
  estaExcluido,
  agruparComparecimentos,
  nomeKey,
  validarCampos,
};
