// =====================================================================
//  Datas locais para o fechamento de estoque.
//  Problema: o fechamento usava limites de dia em UTC (T00:00:00Z →
//  T23:59:59.999Z), mas as movimentações são gravadas com ISO/UTC.
//  Depois das 21h (Brasília = UTC-3) a movimentação caía no dia UTC
//  seguinte e sumia do "fechamento do dia" (e das correções/estornos).
//  Aqui os limites são calculados no fuso operacional (America/Fortaleza),
//  que é o mesmo fuso usado pelo horário comercial da recepção.
// =====================================================================
const TZ_PADRAO = process.env.RECP_TZ || 'America/Fortaleza';

// Offset do fuso (ms) em relação ao UTC no instante informado
function tzOffsetMs(date, tz) {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    const parts = dtf.formatToParts(date);
    const get = t => { const p = parts.find(x => x.type === t); return p ? Number(p.value) : 0; };
    const asUTC = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
    return asUTC - Math.floor(date.getTime() / 1000) * 1000;
  } catch (e) {
    return -3 * 3600e3; // fallback: Fortaleza (UTC-3)
  }
}

// Início do dia local (instante UTC) para 'YYYY-MM-DD'
function inicioDiaLocal(dateStr, tz) {
  const p = String(dateStr || '').slice(0, 10).split('-').map(Number);
  if (p.length !== 3 || p.some(isNaN)) return null;
  const [y, m, d] = p;
  const off = tzOffsetMs(new Date(Date.UTC(y, m - 1, d, 12, 0, 0)), tz);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - off);
}

// Intervalo do dia local: { inicio, fim } (instantes UTC)
function diaLocal(dateStr, tz) {
  const t = tz || TZ_PADRAO;
  const ini = inicioDiaLocal(dateStr, t);
  if (!ini) return null;
  const prox = inicioDiaLocal(addDiasISO(String(dateStr).slice(0, 10), 1), t);
  const fim = new Date((prox ? prox.getTime() : ini.getTime() + 24 * 3600e3) - 1);
  return { inicio: ini, fim };
}

// Soma dias a uma data ISO (YYYY-MM-DD)
function addDiasISO(dateStr, dias) {
  const p = String(dateStr || '').slice(0, 10).split('-').map(Number);
  if (p.length !== 3 || p.some(isNaN)) return null;
  const dt = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  dt.setUTCDate(dt.getUTCDate() + Number(dias || 0));
  return dt.toISOString().slice(0, 10);
}

// Data local de hoje (YYYY-MM-DD) no fuso operacional
function hojeLocal(tz) {
  const t = tz || TZ_PADRAO;
  const now = new Date();
  const off = tzOffsetMs(now, t);
  return new Date(now.getTime() + off).toISOString().slice(0, 10);
}

module.exports = { TZ_PADRAO, tzOffsetMs, inicioDiaLocal, diaLocal, addDiasISO, hojeLocal };
