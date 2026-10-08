// =====================================================================
//  ticketEdicao — regras puras de edição de tickets + histórico (edicoes).
//  - recepcao/admin editam ticket AGUARDANDO (campos + anexos)
//  - tecnico edita ticket EM_ATENDIMENTO do qual é dono (descrição + anexos)
//  - toda alteração gera entrada em ticket.edicoes: quem + o quê + quando
// =====================================================================

const MAX_ANEXOS = 20;
const MAX_EDICOES = 50;

// Quem pode fazer o quê. Retorna null se permitido ou {status, error}.
function checarPermissao({ role, status, dono, user }) {
  const r = String(role || '').toLowerCase();
  const st = String(status || '').toLowerCase();
  const eu = String(user || '').toLowerCase().trim();
  const donoNorm = String(dono || '').toLowerCase().trim();
  if (r === 'admin') {
    if (st !== 'aguardando' && st !== 'em_atendimento')
      return { status: 400, error: 'Só é possível alterar tickets aguardando ou em atendimento' };
    return null;
  }
  if (r === 'recepcao') {
    if (st !== 'aguardando') return { status: 400, error: 'Só é possível alterar tickets aguardando na fila' };
    return null;
  }
  if (r === 'tecnico') {
    if (st !== 'em_atendimento') return { status: 400, error: 'Só é possível alterar tickets em atendimento' };
    if (!donoNorm || eu !== donoNorm)
      return { status: 403, error: 'Somente o técnico vinculado pode alterar este atendimento.' };
    return null;
  }
  return { status: 403, error: 'Sem permissão para alterar tickets.' };
}

// Campos que cada perfil pode alterar via JSON (anexos têm endpoints próprios).
function camposPermitidos(role) {
  const r = String(role || '').toLowerCase();
  if (r === 'tecnico') return ['descricao'];
  return ['motivo', 'modeloTornozeleira', 'descricao', 'prioridadeLegal'];
}

// Monta a entrada de histórico (quem alterou + o que foi alterado + quando).
function montarEdicao(editor, changes) {
  const now = new Date().toISOString();
  return {
    at: now,
    byUser: (editor && editor.user) || '',
    byName: (editor && (editor.name || editor.user)) || '',
    byRole: (editor && editor.role) || '',
    changes: (changes || []).map(c => ({
      field: String(c.field || ''),
      label: String(c.label || c.field || ''),
      from: c.from == null ? '' : String(c.from),
      to: c.to == null ? '' : String(c.to)
    }))
  };
}

// Anexa a entrada ao histórico do ticket (mais recentes por último, teto 50).
function aplicarEdicao(ticket, entry) {
  const list = Array.isArray(ticket.edicoes) ? ticket.edicoes.slice() : [];
  list.push(entry);
  return list.slice(-MAX_EDICOES);
}

// Filtra anexos a remover (por url). Retorna {mantidos, removidos}.
// Com purgeExpired=true, marcadores expirados (sem url, arquivo já apagado
// pela limpeza) também saem do registro — sem isso eles eram eternos.
function separarAnexos(anexos, urls, purgeExpired) {
  const alvo = new Set((urls || []).map(u => String(u)));
  const mantidos = [], removidos = [];
  for (const a of (anexos || [])) {
    if (a && a.url && alvo.has(String(a.url))) removidos.push(a);
    else if (purgeExpired && a && a.expired) removidos.push(a);
    else mantidos.push(a);
  }
  return { mantidos, removidos };
}

// Valida adição de anexos (teto 20 ATIVOS por ticket, como na criação).
// Marcadores expirados não contam: o arquivo já sumiu e eles podem ser
// purgados — contar fantasmas travava o ticket para sempre no teto.
function validarAdicao(atual, novos) {
  const ativos = (atual || []).filter(a => a && !a.expired).length;
  const n = ativos + (novos || []).length;
  if (n > MAX_ANEXOS) return { status: 400, error: `Máximo de ${MAX_ANEXOS} anexos por ticket` };
  return null;
}

// Teto de tamanho total por lote. O multer limita por arquivo (15MB); sem teto
// de lote, 20 arquivos estouram a RAM (memoryStorage) e derrubam o processo.
const MAX_LOTE_MB = 100;
function validarTamanhoLote(files) {
  const total = (files || []).reduce((s, f) => s + (Number(f && f.size) || 0), 0);
  if (total > MAX_LOTE_MB * 1024 * 1024)
    return { status: 400, error: `Lote muito grande (${Math.round(total / 1048576)}MB). Máximo de ${MAX_LOTE_MB}MB por envio — divida em lotes menores.` };
  return null;
}

module.exports = { MAX_ANEXOS, MAX_EDICOES, MAX_LOTE_MB, checarPermissao, camposPermitidos, montarEdicao, aplicarEdicao, separarAnexos, validarAdicao, validarTamanhoLote };
