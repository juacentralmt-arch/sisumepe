'use strict';

// =====================================================================
//  Domínio do módulo Assistidos — fonte única de verdade.
//  A rota (src/routes/assistidos.js) e o store consumem estas regras;
//  nada aqui duplica regra de negócio.
// =====================================================================

const LOCAIS_ASSINATURA = Object.freeze(['COMEP Cariri', 'Albergado Cariri', 'COAP Cariri']);
const PERIODOS_COMPARECIMENTO = Object.freeze(['semanal', 'quinzenal', 'mensal', 'bimestral', 'trimestral']);
// A etiqueta marca o card como CONFERIDO (a conferência da ficha pela
// equipe), não uma escala de cores de prioridade. Foi assim desde o
// começo (commit 286349c: verificado | pendente) e se perdeu nas
// reescritas, quando virou sem|verde|laranja|vermelho.
const ETIQUETAS = Object.freeze(['pendente', 'conferido']);
// Valores antigos que ainda podem existir em base importada.
const ETIQUETAS_LEGADAS = Object.freeze({ sem: 'pendente', verde: 'conferido', laranja: 'pendente', vermelho: 'pendente' });
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
//  Periodicidade e prazos
// ---------------------------------------------------------------------
// Dias do período de cada frequência (usado para calcular a data esperada
// do próximo comparecimento).
const FREQ_DIAS = Object.freeze({ semanal: 7, quinzenal: 15, mensal: 30, bimestral: 60, trimestral: 90 });

// Dias de tolerância até o comparecimento ser considerado atrasado.
// Regra: 1,5x o período + 7 dias (fim de semana, feriado, recesso).
// Uma falta isolada não gera alerta; duas seguidas viram falta crítica.
const PRAZO_FREQUENCIA = Object.freeze({
  semanal: 18, quinzenal: 30, mensal: 52, bimestral: 97, trimestral: 142,
});

// Dias desde o último comparecimento até considerar "faltas consecutivas".
const TOLERANCIA_FALTA = 7;

// Data esperada do próximo comparecimento (a partir do último ou do início).
function proximoEsperado(assistido, ultimoComparecimento) {
  const base = ultimoComparecimento || assistido.dataInicio || null;
  if (!ehDataValida(base)) return null;
  const dias = FREQ_DIAS[assistido.frequencia] || 30;
  const [y, m, d] = String(base).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + dias)).toISOString().slice(0, 10);
}

// Diferença em dias entre duas datas (AAAA-MM-DD). Positivo = mais recente.
function diasEntre(deISO, ateISO) {
  if (!ehDataValida(deISO) || !ehDataValida(ateISO)) return null;
  const [ay, am, ad] = String(deISO).split('-').map(Number);
  const [by, bm, bd] = String(ateISO).split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

// Normaliza uma etiqueta vinda do banco (pode ser de base antiga).
function normalizaEtiqueta(valor) {
  const s = String(valor || '').trim().toLowerCase();
  if (ETIQUETAS.includes(s)) return s;
  return ETIQUETAS_LEGADAS[s] || 'pendente';
}

// ---------------------------------------------------------------------
//  Situação do monitorado em relação à periodicidade.
//
//  REGRA ÚNICA: a aba de alertas, o selo do card e os filtros usam
//  esta mesma função. Quando cada tela calculava por conta, elas
//  discordavam — foi o que gerou os bugs da aba Juntada.
//
//    em_dia            dentro do prazo
//    atrasado          passou do prazo (1+ faltas)
//    sem_comparecimento  nunca comparou e ja passou 30 dias do inicio
//    sem_historico     sem data de inicio e sem comparecimento
// ---------------------------------------------------------------------
function situacao(assistido, ultimoComparecimento, hojeISO) {
  const dia = hojeISO || new Date().toISOString().slice(0, 10);
  const prazo = PRAZO_FREQUENCIA[assistido.frequencia] || 52;
  const periodo = FREQ_DIAS[assistido.frequencia] || 30;

  if (!ultimoComparecimento) {
    const desdeInicio = assistido.dataInicio ? diasEntre(assistido.dataInicio, dia) : null;
    if (desdeInicio != null && desdeInicio > 30) {
      return {
        codigo: 'sem_comparecimento', dias: desdeInicio, prazo, faltas: 0,
        texto: 'Nunca compareceu (' + desdeInicio + ' dias)',
      };
    }
    return {
      codigo: 'sem_historico', dias: desdeInicio, prazo, faltas: 0,
      texto: 'Sem histórico de comparecimento',
    };
  }

  const dias = diasEntre(ultimoComparecimento.dataComparecimento, dia);
  if (dias != null && dias > prazo) {
    const faltas = Math.max(0, Math.floor(dias / periodo) - 1);
    return {
      codigo: 'atrasado', dias, prazo, faltas,
      texto: 'Atrasado há ' + dias + ' dias',
    };
  }
  return { codigo: 'em_dia', dias, prazo, faltas: 0, texto: 'Em dia' };
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
    // Estrito: valor desconhecido e erro (digitar 'conferido' errado
    // nao pode virar 'pendente' em silencio).
    const s = String(v == null ? '' : v).trim().toLowerCase();
    if (ETIQUETAS.includes(s) || Object.prototype.hasOwnProperty.call(ETIQUETAS_LEGADAS, s)) return null;
    return 'Etiqueta inválida. Use: pendente ou conferido.';
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
  ETIQUETAS_LEGADAS,
  STATUS_ASSISTIDO,
  STATUS_ENCERRADOS,
  CAMPOS_EDITAVEIS,
  FREQ_DIAS,
  PRAZO_FREQUENCIA,
  TOLERANCIA_FALTA,
  ehDataValida,
  normalizaData,
  ehDataFutura,
  validarCNJ,
  comparecimentoProtocolado,
  normalizaEtiqueta,
  situacao,
  estaExcluido,
  agruparComparecimentos,
  nomeKey,
  validarCampos,
  proximoEsperado,
  diasEntre,
};
