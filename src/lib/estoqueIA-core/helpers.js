const UNIDADES = [
  'UMEPE Juazeiro','UP-Juazeiro','UP-Cariri','UP-Crato',
  'Fórum de Crato','Fórum de Jardim'
];
const MATERIAIS = ['TZPR04','TZPR','UPR04','FONTE04','CINTA','TRAVAS'];
const MATERIAIS_SERIAL = ['TZPR04','TZPR','UPR04'];
const LIMITES = { TZPR04: 5, TZPR: 5, UPR04: 5, FONTE04: 5, CINTA: 10, TRAVAS: 20 };
const CONTRATO_INFINITY = 'INF';

function norm(s) {
  return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
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
  for (const m of MATERIAIS) if (up.includes(m)) return m;
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
  if (/ultimos?\s*7\s*dias|uma semana/.test(n)) return 7;
  if (/ultimos?\s*15\s*dias/.test(n)) return 15;
  if (/ultimos?\s*30\s*dias|um mes/.test(n)) return 30;
  if (/esta semana/.test(n)) return 7;
  if (/este mes/.test(n)) return 30;
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
  norm, extractContrato, extractSistema, normContrato, labelContrato,
  extractMaterial, extractUnidade, extractData, extractPeriodo,
  extractSerial, extractThreshold, fmtSaldo, matTZPR, matsProntos
};