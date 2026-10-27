const ExcelJS = require('exceljs');
const store = require('../store');

function pick(r, ...keys) {
  for (const k of keys) {
    if (r[k] != null && String(r[k]).trim() !== '') return r[k];
  }
  const low = Object.keys(r).map(x => x.toLowerCase());
  for (const k of keys) {
    const idx = low.indexOf(String(k).toLowerCase());
    if (idx >= 0) {
      const real = Object.keys(r)[idx];
      if (r[real] != null && String(r[real]).trim() !== '') return r[real];
    }
  }
  return '';
}
function toISODate(v) {
  if (v == null || v === '') return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  if (/^\d{4,6}$/.test(s)) {
    const d = new Date((Number(s) - 25569) * 86400 * 1000);
    if (!isNaN(d)) return d.toISOString().slice(0, 10);
  }
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    let [, dd, mm, yyyy] = m;
    if (yyyy.length === 2) yyyy = '20' + yyyy;
    const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
    if (!isNaN(d)) return d.toISOString().slice(0, 10);
  }
  const d2 = new Date(s);
  if (!isNaN(d2)) return d2.toISOString().slice(0, 10);
  return s;
}
function juntadasFromRow(r) {
  const parts = [];
  for (const k of Object.keys(r)) {
    if (/^juntada/i.test(k)) {
      const v = r[k];
      if (v != null && String(v).trim() !== '') parts.push(String(v).trim());
    }
  }
  const prox = pick(r, 'PROXIMAS JUNTADAS', 'PROXIMA JUNTADA');
  if (prox && String(prox).trim() !== '') parts.push('Próximas: ' + String(prox).trim());
  return parts.join('\n');
}
function findHeaderRow(ws) {
  for (let i = 1; i <= Math.min(10, ws.rowCount); i++) {
    const row = ws.getRow(i);
    let found = false;
    row.eachCell((c) => {
      const v = String(c.value || '').trim().toLowerCase();
      if (v === 'nome' || v === 'processo' || v === 'vara') found = true;
    });
    if (found) return i;
  }
  return 3;
}
function parseSheet(ws) {
  const headerIdx = findHeaderRow(ws);
  const headerRow = ws.getRow(headerIdx);
  const headers = [];
  headerRow.eachCell((c, col) => { headers[col] = String(c.value || '').trim(); });
  const rows = [];
  ws.eachRow((row, idx) => {
    if (idx <= headerIdx) return;
    const obj = {};
    let has = false;
    row.eachCell((c, col) => {
      const h = headers[col];
      if (!h) return;
      let val = c.value;
      if (val && typeof val === 'object' && val.result !== undefined) val = val.result;
      if (val instanceof Date) val = val.toISOString().slice(0, 10);
      obj[h] = (val == null ? '' : String(val).trim());
      if (obj[h]) has = true;
    });
    if (has) rows.push(obj);
  });
  return { headers, rows };
}

(async () => {
  const file = process.argv[2] || 'D:\\Pasta Download Disco D\\consolidado_registros_assistidos_filtrável.xlsx';
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  let total = 0;
  const sheetNames = wb.worksheets.map(w => w.name);
  console.log('SHEETS:', sheetNames);
  for (const name of sheetNames) {
    const ws = wb.getWorksheet(name);
    if (!ws) continue;
    const { rows } = parseSheet(ws);
    const mapped = rows.map(r => ({
      statusGrupo: String(name).toLowerCase().includes('conclu') ? 'concluido' : 'ativo',
      numero: pick(r, 'Nº', 'N°', 'No', 'NUMERO'),
      dias: pick(r, 'Dias', 'DIAS', 'NÚ DIAS'),
      alerta: pick(r, 'Alerta', 'ALERTA'),
      processo: pick(r, 'Processo', 'PROCESSO'),
      vara: pick(r, 'Vara', 'VARA'),
      nome: pick(r, 'Nome', 'NOME'),
      vinculo: pick(r, 'Vínculo', 'VINCULO', 'VÍNCULO'),
      sitJuridico: pick(r, 'SIT. JURICO PENAL', 'SITUAÇÃO', 'SIT JURIDICO PENAL'),
      inicio: toISODate(pick(r, 'Inicio da Medida', 'INICIO DA MEDIDA', 'INICIO DO CUMPRIMENTO')),
      status: pick(r, 'STATUS', 'Status'),
      observacao: pick(r, 'OBSERVAÇÃO', 'OBSERVACAO', 'EVOLUÇÃO  (OBSERVAÇÃO)'),
      juntadas: juntadasFromRow(r),
      proximaJuntada: pick(r, 'PROXIMAS JUNTADAS', 'PROXIMA JUNTADA'),
      extras: r
    }));
    await store.assistidos.bulkInsert(mapped);
    total += mapped.length;
    console.log(name, mapped.length);
  }
  console.log('TOTAL IMPORTADO:', total);
  console.log('TOTAL NO BANCO:', (await store.assistidos.all()).length);
})();
