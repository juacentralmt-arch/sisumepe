const UNIDADES = [
  'UMEPE Juazeiro','UP-Juazeiro','UP-Cariri','UP-Crato',
  'Fórum de Crato','Fórum de Jardim'
];
const MATERIAIS = ['TZPR04','TZPR','UPR04','FONTE04','CINTA','TRAVAS'];
const MATERIAIS_SERIAL = ['TZPR04','TZPR','UPR04'];
const LIMITES = { TZPR04: 5, TZPR: 5, UPR04: 5, FONTE04: 5, CINTA: 10, TRAVAS: 20 };
const CONTRATO_INFINITY = 'INF';

// Sinônimos para comandos
const SINONIMOS = {
  saldo: ['quantidade', 'quanto tem', 'estoque atual', 'tem quanto', 'quanto resta', 'level', 'nivel'],
  consumo: ['uso', 'gasto', 'saída', 'utilização', 'consumo médio', 'media de uso'],
  compra: ['pedir', 'adquirir', 'repor', 'comprar', 'pedido', 'sugestão de compra'],
  baixo: ['crítico', 'escasso', 'pouco', 'zerado', 'em falta', 'faltando', 'urgente'],
  alertas: ['avisos', 'atenção', 'problemas', 'itens baixos'],
  historico: ['histórico', 'movimentações', 'movimentacao', 'registro', 'log'],
  comparar: ['diferença', 'comparação', 'versus', 'vs', 'confrontar'],
  transferir: ['mover', 'transferência', 'enviar', 'passar', 'deslocar']
};

// Sinônimos para materiais
const SINONIMOS_MATERIAIS = {
  'TZPR04': ['tornozeleira', 'tornozeleira spacecom', 'tzpr 04', 'tzpr04', 'tornozeleira digital'],
  'TZPR': ['tornozeleira infinity', 'tzpr infinity', 'tornozeleira inf'],
  'UPR04': ['upr', 'upr04', 'unidade portátil', 'portátil'],
  'FONTE04': ['fonte', 'fonte de alimentação', 'carregador', 'fonte 04'],
  'CINTA': ['cinta', 'cinta de fixação', 'pulseira'],
  'TRAVAS': ['travas', 'trava', 'presilha', 'fixadores']
};

// Correções de typos comuns
const CORRECOES_TYPO = {
  'tornozeleira': 'TZPR04',
  'tornozeleiras': 'TZPR04',
  'upr04': 'UPR04',
  'tzpr04': 'TZPR04',
  'fnte': 'FONTE04',
  'citna': 'CINTA',
  'cinta': 'CINTA',
  'trava': 'TRAVAS',
  'travas': 'TRAVAS',
  'fonte': 'FONTE04',
  'carregador': 'FONTE04',
  'portatil': 'UPR04',
  'portátil': 'UPR04',
  'saldo': 'saldo',
  'consumo': 'consumo',
  'alerta': 'alertas',
  'alertas': 'alertas',
  'reposicao': 'reposição',
  'reposição': 'reposição',
  'compra': 'compra',
  'pedido': 'compra',
  'historico': 'historico',
  'histórico': 'historico',
  'movimentacoes': 'historico',
  'movimentações': 'historico',
  'unidade': 'unidades',
  'unidades': 'unidades',
  'serial': 'seriais',
  'seriais': 'seriais',
  'kit': 'kit',
  'transferencia': 'transferir',
  'transferência': 'transferir',
  'previsao': 'previsao ruptura',
  'previsão': 'previsao ruptura',
  'ruptura': 'previsao ruptura',
  'sugestao': 'sugestao compra',
  'sugestão': 'sugestao compra',
  'quanto tempo': 'duracao',
  'dura': 'duracao',
  'falta': 'itens em falta',
  'faltando': 'itens em falta',
  'tem': 'tem em'
};

function norm(s) {
  return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
}

// Distância de Levenshtein para fuzzy matching
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] 
        ? dp[i - 1][j - 1] 
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

// Busca com fuzzy matching
function fuzzyMatch(query, target, maxDist = 2) {
  if (!query || !target) return false;
  const q = norm(query);
  const t = norm(target);
  if (q.includes(t) || t.includes(q)) return true;
  if (q.length < 3 || t.length < 3) return false;
  return levenshtein(q, t) <= maxDist;
}

// Aplica correções de typos comuns
function corrigirTypos(query) {
  const n = norm(query);
  let corrigida = n;
  let teveCorrecao = false;
  
  for (const [errado, correto] of Object.entries(CORRECOES_TYPO)) {
    const regex = new RegExp(`\\b${errado.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    if (regex.test(corrigida)) {
      corrigida = corrigida.replace(regex, correto.toLowerCase());
      teveCorrecao = true;
    }
  }
  
  return teveCorrecao ? { original: query, corrigida } : null;
}

// Expande query com sinônimos e correções
function expandQuery(query) {
  const n = norm(query);
  
  // Aplicar correções de typos primeiro
  const correcao = corrigirTypos(query);
  const queryFinal = correcao ? correcao.corrigida : n;
  
  const expanded = [queryFinal];
  
  // Sinônimos de comandos
  for (const [key, syns] of Object.entries(SINONIMOS)) {
    if (syns.some(s => queryFinal.includes(norm(s)))) {
      expanded.push(norm(key));
    }
  }
  
  // Sinônimos de materiais
  for (const [mat, syns] of Object.entries(SINONIMOS_MATERIAIS)) {
    if (syns.some(s => fuzzyMatch(queryFinal, s, 1))) {
      expanded.push(norm(mat));
    }
  }
  
  return expanded.join(' ');
}

function extractContrato(q) {
  const up = String(q).toUpperCase();
  if (/\bINF\b/.test(up) || /INFINITY/.test(up) || /ESTOQUE INFINITY/.test(up)) return 'INF';
  const m = up.match(/\bCE0[12]\b/);
  return m ? m[0] : null;
}

function extractSistema(q) {
  const n = norm(q);
  if (/infinity|infinito|\binf\b/.test(n)) return 'infinity';
  if (/spacecom|space\b|\bspc\b/.test(n)) return 'spacecom';
  if (/\bambos\b|os dois|tudo|geral/.test(n)) return null;
  return null;
}

function normContrato(contrato, sistema, store) {
  if (store && store.normalizeContrato) {
    try { return store.normalizeContrato(contrato, sistema); } catch(e) {}
  }
  const raw = String(contrato||'').toUpperCase().trim();
  const sis = String(sistema||'').toLowerCase();
  if (sis === 'infinity') return 'INF';
  return raw || null;
}

function labelContrato(contrato, store) {
  if (store && store.contratoLabel) {
    try { return store.contratoLabel(contrato); } catch(e) {}
  }
  const c = String(contrato||'').toUpperCase();
  if (c === 'INF') return 'Estoque Infinity';
  return c;
}

function extractMaterial(q) {
  const up = String(q).toUpperCase();
  // Busca direta
  for (const m of MATERIAIS) if (up.includes(m)) return m;
  
  // Busca por sinônimos
  const n = norm(q);
  for (const [mat, syns] of Object.entries(SINONIMOS_MATERIAIS)) {
    for (const syn of syns) {
      if (fuzzyMatch(n, syn, 1)) return mat;
    }
  }
  
  // Padrões legados
  if (/\btornozeleira\b|\btzpr\b/i.test(q)) return 'TZPR04';
  if (/\bupr\b/i.test(q)) return 'UPR04';
  if (/\bfonte\b/i.test(q)) return 'FONTE04';
  if (/\bcinta\b/i.test(q)) return 'CINTA';
  if (/\btrava\b/i.test(q)) return 'TRAVAS';
  return null;
}

function extractUnidade(q) {
  const n = norm(q);
  for (const u of UNIDADES) {
    if (n.includes(norm(u))) return u;
  }
  if (n.includes('umepe')) return 'UMEPE Juazeiro';
  if (n.includes('up juazeiro') || n.includes('up-juazeiro')) return 'UP-Juazeiro';
  if (n.includes('up cariri') || n.includes('up-cariri')) return 'UP-Cariri';
  if (n.includes('up crato') || n.includes('up-crato')) return 'UP-Crato';
  if (n.includes('forum de crato') || n.includes('forum crato')) return 'Fórum de Crato';
  if (n.includes('forum de jardim') || n.includes('forum jardim') || n.includes('jardim')) return 'Fórum de Jardim';
  return null;
}

function extractData(q) {
  const m = String(q).match(/(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const m2 = String(q).match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (m2) return `${m2[3]}-${m2[2]}-${m2[1]}`;
  const n = norm(q);
  const hoje = new Date().toISOString().slice(0,10);
  if (/\bhoje\b/.test(n)) return hoje;
  if (/\bontem\b/.test(n)) { const d=new Date(); d.setDate(d.getDate()-1); return d.toISOString().slice(0,10); }
  if (/\banteontem\b/.test(n)) { const d=new Date(); d.setDate(d.getDate()-2); return d.toISOString().slice(0,10); }
  return null;
}

function extractPeriodo(q) {
  const n = norm(q);
  if (/ultimos?\s*7\s*dias|uma semana|semana passada|semana anterior/.test(n)) return 7;
  if (/ultimos?\s*15\s*dias|quinze dias|duas semanas/.test(n)) return 15;
  if (/ultimos?\s*30\s*dias|um mes|mes passado|mes anterior|trinta dias/.test(n)) return 30;
  if (/ultimos?\s*60\s*dias|dois meses|60 dias/.test(n)) return 60;
  if (/ultimos?\s*90\s*dias|tres meses|90 dias|trimestre/.test(n)) return 90;
  if (/esta semana|semana atual/.test(n)) return 7;
  if (/este mes|mes atual/.test(n)) return 30;
  const m = n.match(/ultimos?\s*(\d{1,3})\s*dias/);
  if (m) return Math.min(90, Math.max(1, Number(m[1])));
  return null;
}

function extractSerial(q) {
  const m = String(q).match(/\b\d{10}\b/);
  if (m) return m[0];
  if (/serial|buscar/.test(norm(q))) {
    const m2 = String(q).match(/\b\d{4,9}\b/);
    return m2 ? m2[0] : null;
  }
  return null;
}

function extractThreshold(q, material) {
  const m = String(q).match(/(abaixo de|menor que|<)\s*(\d+)/i);
  if (m) return Number(m[2]);
  if (/baixo|critico|alerta|zerado/.test(norm(q))) {
    if (material && LIMITES[material]) return LIMITES[material];
    return null;
  }
  return null;
}

// Todos os materiais do sistema (para "consumo de materiais"/"todos")
function matsTodos(sistema) {
  return String(sistema) === 'infinity' ? ['TZPR','FONTE04','CINTA','TRAVAS'] : ['TZPR04','UPR04','FONTE04','CINTA','TRAVAS'];
}

// Localiza usuário (login ou nome) mencionado na pergunta.
// Retorna {user, name} ou null. Ex: "movimentações de joanderson" → {user:'joanderson',...}
function findUsuario(q, users) {
  const list = Array.isArray(users) ? users : [];
  if (!list.length) return null;
  const n = norm(q);
  const escRx = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const u of list) {
    const user = norm((u && u.user) || '');
    const name = norm((u && u.name) || '');
    if (!user) continue;
    const first = (name.split(/\s+/)[0] || '');
    const cands = [user];
    if (name && name !== user) cands.push(name);
    if (first && first.length >= 4 && first !== user && first !== name) cands.push(first);
    for (const c of cands) {
      if (!c || c.length < 3) continue;
      if (new RegExp(`\\b${escRx(c)}\\b`).test(n)) return { user: u.user, name: u.name || u.user };
    }
  }
  return null;
}

function fmtSaldo(n) {
  return Number(n||0).toLocaleString('pt-BR');
}

function matTZPR(sistema) {
  return String(sistema) === 'infinity' ? 'TZPR' : 'TZPR04';
}

function matsProntos(sistema) {
  return String(sistema) === 'infinity' ? ['TZPR'] : ['TZPR04','UPR04'];
}

module.exports = {
  UNIDADES, MATERIAIS, MATERIAIS_SERIAL, LIMITES, CONTRATO_INFINITY,
  SINONIMOS, SINONIMOS_MATERIAIS, CORRECOES_TYPO,
  norm, levenshtein, fuzzyMatch, expandQuery, corrigirTypos,
  extractContrato, extractSistema, normContrato, labelContrato,
  extractMaterial, extractUnidade, extractData, extractPeriodo,
  extractSerial, extractThreshold, fmtSaldo, matTZPR, matsProntos,
  matsTodos, findUsuario
};