const express = require('express');
const ExcelJS = require('exceljs');
const shared = require('../lib/shared');
const { store, ah, auth, upload } = shared;
const router = express.Router();

function norm(v){ return v == null ? '' : String(v).trim(); }

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

router.get('/api/assistidos', auth(['admin','tecnico']), ah(async (req, res) => {
  const list = await store.assistidos.all();
  res.json(list);
}));
router.get('/api/assistidos/debug', auth(['admin']), ah(async (req, res) => {
  let err = null, rows = null;
  try { rows = await store.assistidos.all(); }
  catch (e) { err = e && e.message; }
  res.json({ mode: store.mode, count: Array.isArray(rows) ? rows.length : null, error: err });
}));
router.get('/api/assistidos/debug-insert', auth(['admin']), ah(async (req, res) => {
  const { createClient } = require('@supabase/supabase-js');
  const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
  const r = await supa.from('assistidos').insert({ nome: 'DEBUG' }).select();
  res.json(r);
}));
router.get('/api/assistidos/debug-select', auth(['admin']), ah(async (req, res) => {
  const { createClient } = require('@supabase/supabase-js');
  const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
  const r = await supa.from('assistidos').select('*');
  res.json(r);
}));

let lastImportStatus = { state: 'idle', total: 0, error: null, at: null };
router.get('/api/assistidos/import/status', auth(['admin']), ah(async (req, res) => {
  res.json(lastImportStatus);
}));

router.post('/api/assistidos/import', auth(['admin']), upload.single('arquivo'), ah(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Envie o arquivo .xlsx' });
  const buffer = req.file.buffer;
  lastImportStatus = { state: 'running', total: 0, error: null, at: new Date().toISOString() };
  res.json({ ok: true, assincrono: true, msg: 'Importação iniciada em background. Aguarde e atualize a lista.' });
  setImmediate(async () => {
    try {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      let total = 0;
      const sheets = wb.worksheets.map(w => w.name);
      for (const name of sheets) {
        const ws = wb.getWorksheet(name);
        if (!ws) continue;
        const lower = String(name).toLowerCase();
        const grupo = lower.includes('conclu') ? 'concluido' : (lower.includes('arquiv') ? 'arquivado' : 'ativo');
        const { rows } = parseSheet(ws);
        const mapped = rows.map(r => ({
          statusGrupo: grupo,
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
      }
      console.log('[assistidos] importação concluída:', total);
      lastImportStatus = { state: 'done', total, error: null, at: new Date().toISOString() };
      shared.broadcast({ type: 'assistidos_import_done', total });
    } catch (e) {
      console.error('[assistidos] importação falhou:', e && e.stack ? e.stack : e.message);
      lastImportStatus = { state: 'error', total: 0, error: String(e && e.message ? e.message : e), at: new Date().toISOString() };
    }
  });
}));

router.post('/api/assistidos', auth(['admin']), ah(async (req, res) => {
  const b = req.body || {};
  const row = await store.assistidos.insert({
    statusGrupo: b.statusGrupo || 'ativo',
    numero: b.numero || '',
    dias: b.dias || '',
    alerta: b.alerta || '',
    processo: b.processo || '',
    vara: b.vara || '',
    nome: b.nome || '',
    vinculo: b.vinculo || '',
    sitJuridico: b.sitJuridico || '',
    inicio: b.inicio || '',
    status: b.status || '',
    observacao: b.observacao || '',
    juntadas: b.juntadas || '',
    proximaJuntada: b.proximaJuntada || '',
    extras: b.extras || {}
  });
  res.status(201).json(row);
}));

router.patch('/api/assistidos/:id', auth(['admin']), ah(async (req, res) => {
  const b = req.body || {};
  const fields = {};
  const allowed = ['statusGrupo','numero','dias','alerta','processo','vara','nome','vinculo','sitJuridico','inicio','status','observacao','juntadas','proximaJuntada','extras'];
  for (const k of allowed) if (b[k] !== undefined) fields[k] = b[k];
  const row = await store.assistidos.patch(req.params.id, fields);
  if (!row) return res.status(404).json({ error: 'Não encontrado' });
  res.json(row);
}));

router.delete('/api/assistidos/:id', auth(['admin']), ah(async (req, res) => {
  await store.assistidos.remove(req.params.id);
  res.json({ ok: true });
}));

// Marcar como concluído (move para aba Concluídos)
router.post('/api/assistidos/:id/concluir', auth(['admin','tecnico']), ah(async (req, res) => {
  const row = await store.assistidos.patch(req.params.id, { statusGrupo: 'concluido' });
  if (!row) return res.status(404).json({ error: 'Não encontrado' });
  shared.broadcast();
  res.json(row);
}));

// Reabrir (voltar para Ativos)
router.post('/api/assistidos/:id/reabrir', auth(['admin','tecnico']), ah(async (req, res) => {
  const row = await store.assistidos.patch(req.params.id, { statusGrupo: 'ativo' });
  if (!row) return res.status(404).json({ error: 'Não encontrado' });
  shared.broadcast();
  res.json(row);
}));

module.exports = router;
