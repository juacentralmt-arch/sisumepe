const express = require('express');
const ExcelJS = require('exceljs');
const shared = require('../lib/shared');
const { store, ah, auth, upload } = shared;
const router = express.Router();

function norm(v){ return v == null ? '' : String(v).trim(); }

function parseSheet(ws) {
  // header na linha 3
  const headerRow = ws.getRow(3);
  const headers = [];
  headerRow.eachCell((c, col) => { headers[col] = String(c.value || '').trim(); });
  const rows = [];
  ws.eachRow((row, idx) => {
    if (idx <= 3) return;
    const obj = {};
    let has = false;
    row.eachCell((c, col) => {
      const h = headers[col];
      if (!h) return;
      let val = c.value;
      if (val && typeof val === 'object' && val.result !== undefined) val = val.result;
      if (val instanceof Date) val = val.toISOString().slice(0,10);
      obj[h] = (val == null ? '' : String(val).trim());
      if (obj[h]) has = true;
    });
    if (has) rows.push(obj);
  });
  return { headers, rows };
}

router.get('/api/assistidos', auth(['admin','tecnico']), ah(async (req, res) => {
  // secretária é tecnico? no sistema secretaria é tecnico. Permitir admin e tecnico.
  const list = await store.assistidos.all();
  res.json(list);
}));

router.post('/api/assistidos/import', auth(['admin']), upload.single('arquivo'), ah(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Envie o arquivo .xlsx' });
  // Processa em background para não estourar timeout do Render/HTTP
  const buffer = req.file.buffer;
  res.json({ ok: true, assincrono: true, msg: 'Importação iniciada em background. Aguarde ~1-2 min e atualize a lista.' });
  setImmediate(async () => {
    try {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      let total = 0;
      const sheets = ['ATIVOS','ARQUIVADOS'];
      for (const name of sheets) {
        const ws = wb.getWorksheet(name);
        if (!ws) continue;
        const { rows } = parseSheet(ws);
        const mapped = rows.map(r => ({
          statusGrupo: name === 'ATIVOS' ? 'ativo' : 'arquivado',
          processo: r['PROCESSO'] || r['PROCESSO '] || '',
          vara: r['VARA'] || r['VARA '] || '',
          nome: r['NOME'] || '',
          vinculo: r['VÍNCULO'] || r['VINCULO'] || '',
          sitJuridico: r['SIT. JURICO PENAL'] || r['SITUAÇÃO'] || '',
          inicio: r['INICIO DA MEDIDA'] || r['INICIO DO CUMPRIMENTO'] || '',
          status: r['STATUS'] || '',
          observacao: r['OBSERVAÇÃO'] || r['EVOLUÇÃO  (OBSERVAÇÃO)'] || '',
          proximaJuntada: r['PROXIMA JUNTADA'] || r['PROXIMA JUNTADA.1'] || '',
          dias: r['Nº DIAS'] || r['DIAS'] || '',
          alerta: r['ALERTA'] || '',
          extras: r
        }));
        await store.assistidos.bulkInsert(mapped);
        total += mapped.length;
      }
      console.log('[assistidos] importação concluída:', total);
      shared.broadcast();
    } catch (e) {
      console.error('[assistidos] importação falhou:', e.message);
    }
  });
}));

router.post('/api/assistidos', auth(['admin']), ah(async (req, res) => {
  const b = req.body || {};
  const row = await store.assistidos.insert({
    statusGrupo: b.statusGrupo || 'ativo',
    processo: b.processo || '',
    vara: b.vara || '',
    nome: b.nome || '',
    vinculo: b.vinculo || '',
    sitJuridico: b.sitJuridico || '',
    inicio: b.inicio || '',
    status: b.status || '',
    observacao: b.observacao || '',
    proximaJuntada: b.proximaJuntada || '',
    dias: b.dias || '',
    alerta: b.alerta || '',
    extras: b.extras || {}
  });
  res.status(201).json(row);
}));

router.patch('/api/assistidos/:id', auth(['admin']), ah(async (req, res) => {
  const b = req.body || {};
  const row = await store.assistidos.patch(req.params.id, b);
  if (!row) return res.status(404).json({ error: 'Não encontrado' });
  res.json(row);
}));

router.delete('/api/assistidos/:id', auth(['admin']), ah(async (req, res) => {
  await store.assistidos.remove(req.params.id);
  res.json({ ok: true });
}));

module.exports = router;
