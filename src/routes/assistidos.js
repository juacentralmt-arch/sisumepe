const express = require('express');
const shared = require('../lib/shared');
const { store, ah, auth, broadcast, upload } = shared;
const router = express.Router();

// Cadastro de assistido
router.get('/api/assistidos', auth(['admin','tecnico']), ah(async (req, res) => {
  const list = await store.assistidos.all();
  res.json(list);
}));

router.post('/api/assistidos', auth(['admin']), ah(async (req, res) => {
  const b = req.body || {};
  if (!b.nome || !String(b.nome).trim()) return res.status(400).json({ error: 'Nome é obrigatório' });
  if (!b.vinculo || !String(b.vinculo).trim()) return res.status(400).json({ error: 'Número de vínculo é obrigatório' });
  if (!b.processo || !String(b.processo).trim()) return res.status(400).json({ error: 'Processo é obrigatório' });
  if (!b.vara || !String(b.vara).trim()) return res.status(400).json({ error: 'Vara é obrigatória' });
  if (!b.localAssinatura || !String(b.localAssinatura).trim()) return res.status(400).json({ error: 'Local de assinatura é obrigatório' });
  if (!b.dataInicio) return res.status(400).json({ error: 'Data de início é obrigatória' });
  const all = await store.assistidos.all();
  if (all.some(x => String(x.vinculo) === String(b.vinculo).trim())) return res.status(409).json({ error: 'Vínculo já cadastrado' });
  const row = await store.assistidos.insert({
    vinculo: String(b.vinculo).trim(),
    nome: String(b.nome).trim(),
    processo: String(b.processo).trim(),
    vara: String(b.vara).trim(),
    localAssinatura: String(b.localAssinatura).trim(),
    dataInicio: String(b.dataInicio).trim(),
    frequencia: b.frequencia || 'mensal',
    status: 'ativo'
  });
  try { await store.audit.insert({ kind:'assistido', action:'criado', personName: row.nome, ref: 'assistido#'+row.id, byUser: req.auth.user, byName: req.auth.name, byRole: req.auth.role, summary: 'Assistido cadastrado: ' + row.nome }); } catch(e){}
  broadcast();
  res.status(201).json(row);
}));

router.patch('/api/assistidos/:id', auth(['admin']), ah(async (req, res) => {
  const b = req.body || {};
  const fields = {};
  for (const k of ['vinculo','nome','processo','vara','localAssinatura','dataInicio']) if (b[k] !== undefined) fields[k] = b[k];
  const row = await store.assistidos.patch(req.params.id, fields);
  if (!row) return res.status(404).json({ error: 'Não encontrado' });
  broadcast();
  res.json(row);
}));

router.delete('/api/assistidos/:id', auth(['admin']), ah(async (req, res) => {
  await store.assistidos.remove(req.params.id);
  broadcast();
  res.json({ ok: true });
}));

// Comparecimentos
router.get('/api/assistidos/:id/comparecimentos', auth(['admin','tecnico']), ah(async (req, res) => {
  const list = await store.assistidosComparecimentos.all(req.params.id);
  res.json(list);
}));

router.post('/api/assistidos/:id/comparecimentos', auth(['admin','tecnico']), ah(async (req, res) => {
  const b = req.body || {};
  if (!b.dataComparecimento) return res.status(400).json({ error: 'Data de comparecimento é obrigatória' });
  if (!b.policialPlantao || !String(b.policialPlantao).trim()) return res.status(400).json({ error: 'Policial de plantão é obrigatório' });
  const a = await store.assistidos.byId(req.params.id);
  if (!a) return res.status(404).json({ error: 'Assistido não encontrado' });
  const row = await store.assistidosComparecimentos.insert({
    assistidoId: Number(req.params.id),
    dataComparecimento: String(b.dataComparecimento).trim(),
    policialPlantao: String(b.policialPlantao).trim()
  });
  try { await store.audit.insert({ kind:'assistido', action:'comparecimento', personName: a.nome, ref: 'comparecimento#'+row.id, byUser: req.auth.user, byName: req.auth.name, byRole: req.auth.role, summary: 'Comparecimento registrado: ' + row.dataComparecimento }); } catch(e){}
  broadcast();
  res.status(201).json(row);
}));

// Protocolar pendência (marcar comparecimento como protocolado + observações)
router.patch('/api/assistidos/comparecimentos/:id/protocolar', auth(['admin','tecnico']), ah(async (req, res) => {
  const b = req.body || {};
  const row = await store.assistidosComparecimentos.patch(req.params.id, {
    protocolado: true,
    dataProtocolacao: b.dataProtocolacao || new Date().toISOString().slice(0,10),
    observacoes: b.observacoes || ''
  });
  if (!row) return res.status(404).json({ error: 'Comparecimento não encontrado' });
  broadcast();
  res.json(row);
}));

// Registrar juntada (coluna Juntada) de um comparecimento
router.patch('/api/assistidos/comparecimentos/:id/juntada', auth(['admin','tecnico']), ah(async (req, res) => {
  const b = req.body || {};
  const row = await store.assistidosComparecimentos.patch(req.params.id, {
    juntada: String(b.juntada || '').trim()
  });
  if (!row) return res.status(404).json({ error: 'Comparecimento não encontrado' });
  broadcast();
  res.json(row);
}));

// Listar pendências (comparecimentos sem juntada)
router.get('/api/assistidos/pendencias', auth(['admin','tecnico']), ah(async (req, res) => {
  const all = await store.assistidosComparecimentos.all();
  const list = all.filter(c => !String(c.juntada||'').trim());
  const out = [];
  for (const c of list) {
    const a = await store.assistidos.byId(c.assistidoId);
    out.push({ ...c, assistido: a });
  }
  res.json(out);
}));

// Filtros + quantitativos
router.get('/api/assistidos/stats', auth(['admin','tecnico']), ah(async (req, res) => {
  const assistidos = await store.assistidos.all();
  const comps = await store.assistidosComparecimentos.all();
  const pend = comps.filter(c => !c.protocolado);
  const porVara = {};
  const porPolicial = {};
  const porMes = {};
  assistidos.forEach(a => { porVara[a.vara || '—'] = (porVara[a.vara || '—'] || 0) + 1; });
  comps.forEach(c => {
    const p = c.policialPlantao || '—';
    porPolicial[p] = (porPolicial[p] || 0) + 1;
    const mes = String(c.dataComparecimento || '').slice(0,7) || '—';
    porMes[mes] = (porMes[mes] || 0) + 1;
  });
  res.json({
    totalAssistidos: assistidos.length,
    totalComparecimentos: comps.length,
    totalPendencias: pend.length,
    totalProtocolados: comps.length - pend.length,
    porVara: Object.entries(porVara).map(([vara,total]) => ({ vara, total })).sort((a,b)=>b.total-a.total),
    porPolicial: Object.entries(porPolicial).map(([policial,total]) => ({ policial, total })).sort((a,b)=>b.total-a.total),
    porMes: Object.entries(porMes).map(([mes,total]) => ({ mes, total })).sort((a,b)=>a.mes.localeCompare(b.mes))
  });
}));

// Filtro de listagem
router.get('/api/assistidos/filtrar', auth(['admin','tecnico']), ah(async (req, res) => {
  const { q, vara } = req.query || {};
  let list = await store.assistidos.all();
  if (q) {
    const t = String(q).toLowerCase();
    list = list.filter(a => (a.nome||'').toLowerCase().includes(t) || (a.processo||'').toLowerCase().includes(t) || (a.vinculo||'').toLowerCase().includes(t));
  }
  if (vara) list = list.filter(a => a.vara === vara);
  res.json(list);
}));

const FREQ_DAYS = { semanal:7, quinzenal:15, mensal:30, bimestral:60, trimestral:90 };
// Pendentes de comparecimento: assistidos cujo próximo comparecimento esperado já passou
router.get('/api/assistidos/pendencias-comparecimento', auth(['admin','tecnico']), ah(async (req, res) => {
  const assistidos = await store.assistidos.all();
  const comps = await store.assistidosComparecimentos.all();
  const hoje = new Date().toISOString().slice(0,10);
  const out = [];
  for (const a of assistidos) {
    if (a.status && a.status !== 'ativo') continue;
    const last = comps.filter(c => c.assistidoId === a.id).sort((x,y)=> String(y.dataComparecimento).localeCompare(String(x.dataComparecimento)))[0];
    const base = last ? last.dataComparecimento : (a.dataInicio || hoje);
    const dias = FREQ_DAYS[a.frequencia] || 30;
    const prox = new Date(new Date(base).getTime() + dias*864e5).toISOString().slice(0,10);
    if (prox <= hoje) out.push({ ...a, ultimoComparecimento: last ? last.dataComparecimento : null, proximoEsperado: prox });
  }
  res.json(out);
}));


let lastImportStatus = { state: 'idle', total: 0, error: null, at: null };

function excelSerialToISO(v) {
  if (v == null || v === '') return '';
  if (v instanceof Date) return v.toISOString().slice(0,10);
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10);
  if (/^\d{4,6}$/.test(s)) {
    const d = new Date((Number(s) - 25569) * 86400 * 1000);
    if (!isNaN(d)) return d.toISOString().slice(0,10);
  }
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    let [,dd,mm,yyyy] = m;
    if (yyyy.length === 2) yyyy = '20' + yyyy;
    const d = new Date(Number(yyyy), Number(mm)-1, Number(dd));
    if (!isNaN(d)) return d.toISOString().slice(0,10);
  }
  return s;
}
function normFreq(v) {
  const s = String(v||'').trim().toLowerCase();
  if (s.startsWith('sem')) return 'semanal';
  if (s.startsWith('quin')) return 'quinzenal';
  if (s.startsWith('bim')) return 'bimestral';
  if (s.startsWith('trim')) return 'trimestral';
  return 'mensal';
}

router.get('/api/assistidos/import/status', auth(['admin']), ah(async (req, res) => {
  res.json(lastImportStatus);
}));

router.post('/api/assistidos/import', auth(['admin']), upload.single('arquivo'), ah(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Envie o arquivo .xlsx' });
  const buffer = req.file.buffer;
  lastImportStatus = { state: 'running', total: 0, error: null, at: new Date().toISOString() };
  res.json({ ok: true, assincrono: true, msg: 'Importação iniciada em background.' });
  setImmediate(async () => {
    try {
      const ExcelJS = require('exceljs');
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      let total = 0;
      const allExisting = await store.assistidos.all();
      const seenVinculo = new Set(allExisting.map(a => String(a.vinculo)));
      for (const ws of wb.worksheets) {
        const headerRow = ws.getRow(1);
        const headers = [];
        headerRow.eachCell((c, col) => { headers[col] = String(c.value || '').trim(); });
        const findCol = (...names) => {
          const low = headers.map(h => String(h||'').toLowerCase());
          for (const n of names) {
            const idx = low.indexOf(String(n).toLowerCase());
            if (idx >= 0) return idx + 1;
          }
          return null;
        };
        const cVinculo = findCol('Vínculo','VINCULO');
        const cNome = findCol('Nome','NOME');
        const cProcesso = findCol('Processo','PROCESSO');
        const cVara = findCol('Vara','VARA');
        const cLocal = findCol('local de assinatura','Local de assinatura','LOCAL DE ASSINATURA');
        const cInicio = findCol('Data Início','Data Inicio','DATA INÍCIO','DATA INICIO');
        const cFreq = findCol('Frequência','FREQUENCIA','Frequencia');
        const cComp = findCol('Data de Comparecimento','DATA DE COMPARECIMENTO');
        const cPP = findCol('PP de Plantão','PP DE PLANTÃO','PP DE PLANTAO');
        const cObs = findCol('Observação do PP: Em qual sistema foi protocolado e a folha','Observação do PP','OBSERVAÇÃO');
        ws.eachRow((row, idx) => {
          if (idx === 1) return;
          const get = (col) => col ? row.getCell(col).value : null;
          const vinculo = String(get(cVinculo) || '').trim();
          const nome = String(get(cNome) || '').trim();
          if (!vinculo || !nome) return;
          if (seenVinculo.has(vinculo)) return;
          const processo = String(get(cProcesso) || '').trim();
          const vara = String(get(cVara) || '').trim();
          const local = String(get(cLocal) || '').trim();
          const inicio = excelSerialToISO(get(cInicio));
          const freq = normFreq(get(cFreq));
          const status = (processo.toUpperCase()==='ARQUIVADO' || vara.toUpperCase()==='ARQUIVADO') ? 'arquivado' : 'ativo';
          store.assistidos.insert({
            vinculo, nome, processo, vara, localAssinatura: local, dataInicio: inicio, frequencia: freq, status
          }).then(async (a) => {
            const dComp = excelSerialToISO(get(cComp));
            const pp = String(get(cPP) || '').trim();
            const obs = String(get(cObs) || '').trim();
            if (dComp) {
              const cmp = await store.assistidosComparecimentos.insert({
                assistidoId: a.id,
                dataComparecimento: dComp,
                policialPlantao: pp || '—'
              });
              if (obs) await store.assistidosComparecimentos.patch(cmp.id, { juntada: obs });
            }
          }).catch(e => console.error('import row error', e.message));
          seenVinculo.add(vinculo);
          total++;
        });
      }
      lastImportStatus = { state: 'done', total, error: null, at: new Date().toISOString() };
      shared.broadcast({ type: 'assistidos_import_done', total });
      console.log('[assistidos] importação concluída:', total);
    } catch (e) {
      console.error('[assistidos] importação falhou:', e && e.stack ? e.stack : e.message);
      lastImportStatus = { state: 'error', total: 0, error: String(e && e.message ? e.message : e), at: new Date().toISOString() };
    }
  });
}));

module.exports = router;