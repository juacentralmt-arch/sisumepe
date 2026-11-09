const express = require('express');
const shared = require('../lib/shared');
const { store, ah, auth, broadcast, upload } = shared;
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const router = express.Router();

// Cadastro de assistido
router.get('/api/assistidos', auth(['admin','tecnico']), ah(async (req, res) => {
  const { page, limit } = req.query || {};
  const list = await store.assistidos.all();
  const comps = await store.assistidosComparecimentos.all();
  const byAssistido = new Map();
  comps.forEach(c => {
    const arr = byAssistido.get(c.assistidoId) || [];
    arr.push(c);
    byAssistido.set(c.assistidoId, arr);
  });
  const enriched = list.map(a => {
    const cs = (byAssistido.get(a.id) || []).sort((x, y) => String(y.dataComparecimento).localeCompare(String(x.dataComparecimento)));
    const last = cs[0] || null;
    const prox = proximoEsperadoAssistido(a, comps);
    const hoje = new Date().toISOString().slice(0,10);
    const vencendo = prox && prox <= hoje;
    const vencendo7 = prox && !vencendo && prox <= new Date(Date.now() + 7*864e5).toISOString().slice(0,10);
    const pendenteJuntada = cs.some(c => !String(c.juntada || '').trim());
    return { ...a, ultimoComparecimento: last ? last.dataComparecimento : null, pendenteJuntada, proximoEsperado: prox, vencendo: vencendo, vencendo7d: vencendo7 };
  });
  // Ordena por nome por padrão
  enriched.sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));
  const total = enriched.length;
  let paged = enriched;
  if (page !== undefined && limit !== undefined) {
    const p = Math.max(Number(page) || 1, 1);
    const l = Math.min(Math.max(Number(limit) || 50, 1), 100);
    const start = (p - 1) * l;
    paged = enriched.slice(start, start + l);
  }
  res.json({ items: paged, total, page: page ? Number(page) : 1, limit: limit ? Number(limit) : total });
}));

const LOCAIS_ASSINATURA = ['COMEP Cariri', 'Albergado Cariri', 'COAP Cariri'];
const PERIODOS_COMPARECIMENTO = ['semanal', 'quinzenal', 'mensal', 'bimestral', 'trimestral'];
const SISTEMAS_ASSISTIDO = ['spacecom', 'infinity'];
const CONTRATOS_ASSISTIDO = ['CE01', 'CE02', 'INF'];

router.get('/api/assistidos/:id(\\d+)', auth(['admin','tecnico']), ah(async (req, res) => {
  const row = await store.assistidos.byId(req.params.id);
  if (!row) return res.status(404).json({ error: 'Não encontrado' });
  res.json(row);
}));

// Validação de número CNJ (número único nacional do processo judicial brasileiro)
function validarCNJ(cnpjStr) {
  const cnpj = String(cnpjStr || '').replace(/[.\-/]/g, '');
  if (!/^\d{20}$/.test(cnpj)) return false;
  // Validação básica: número CNJ tem 20 dígitos
  return true;
}

router.post('/api/assistidos', auth(['admin']), ah(async (req, res) => {
  const b = req.body || {};
  if (!b.nome || !String(b.nome).trim()) return res.status(400).json({ error: 'Nome é obrigatório' });
  if (!b.vinculo || !String(b.vinculo).trim()) return res.status(400).json({ error: 'Número de vínculo é obrigatório' });
  if (!b.processo || !String(b.processo).trim()) return res.status(400).json({ error: 'Processo é obrigatório' });
  if (!b.vara || !String(b.vara).trim()) return res.status(400).json({ error: 'Vara é obrigatória' });
  if (!LOCAIS_ASSINATURA.includes(String(b.localAssinatura || '').trim())) return res.status(400).json({ error: 'Local de assinatura inválido' });
  if (!b.dataInicio) return res.status(400).json({ error: 'Data de início é obrigatória' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.dataInicio).trim())) return res.status(400).json({ error: 'Data de início inválida (use AAAA-MM-DD)' });
  if (b.cpf && !/^\d{11}$/.test(String(b.cpf).replace(/[.\-/]/g, ''))) return res.status(400).json({ error: 'CPF inválido (deve ter 11 dígitos)' });
  if (b.processo && !validarCNJ(b.processo)) return res.status(400).json({ error: 'Processo inválido (deve ter 20 dígitos no formato CNJ)' });
  const freq = PERIODOS_COMPARECIMENTO.includes(String(b.frequencia || '').trim()) ? String(b.frequencia).trim() : 'mensal';
  const all = await store.assistidos.all();
  if (all.some(x => String(x.vinculo) === String(b.vinculo).trim())) return res.status(409).json({ error: 'Vínculo já cadastrado' });
  const row = await store.assistidos.insert({
    vinculo: String(b.vinculo).trim(),
    nome: String(b.nome).trim(),
    cpf: String(b.cpf || '').trim(),
    telefone: String(b.telefone || '').trim(),
    endereco: String(b.endereco || '').trim(),
    processo: String(b.processo).trim(),
    vara: String(b.vara).trim(),
    situacaoJuridica: String(b.situacaoJuridica || '').trim(),
    tipoMedida: String(b.tipoMedida || '').trim(),
    localAssinatura: String(b.localAssinatura).trim(),
    dataInicio: String(b.dataInicio).trim(),
    dataFim: String(b.dataFim || '').trim(),
    cargaHoraria: String(b.cargaHoraria || '').trim(),
    frequencia: freq,
    status: 'ativo'
  });
  try { await store.audit.insert({ kind:'assistido', action:'criado', personName: row.nome, ref: 'assistido#'+row.id, byUser: req.auth.user, byName: req.auth.name, byRole: req.auth.role, summary: 'Assistido cadastrado: ' + row.nome }); } catch(e){}
  broadcast();
  res.status(201).json(row);
}));

router.patch('/api/assistidos/:id', auth(['admin','tecnico']), ah(async (req, res) => {
  const b = req.body || {};
  const target = await store.assistidos.byId(req.params.id);
  if (!target) return res.status(404).json({ error: 'Não encontrado' });
  // Técnico só edita assistidos de sua responsabilidade (único comparecimento registrado por ele ou assistido sem técnico definido).
  if (req.auth.role === 'tecnico') {
    const comps = await store.assistidosComparecimentos.all(req.params.id);
    const meu = comps.some(c => String(c.policialPlantao || '').toLowerCase() === String(req.auth.name || req.auth.user).toLowerCase());
    if (!meu) return res.status(403).json({ error: 'Técnico só pode editar assistidos de sua responsabilidade.' });
  }
  const fields = {};
  for (const k of ['vinculo','nome','processo','vara','localAssinatura','dataInicio','cpf','telefone','endereco','situacaoJuridica','tipoMedida','cargaHoraria','dataFim']) if (b[k] !== undefined) fields[k] = b[k];
  if (b.frequencia !== undefined && PERIODOS_COMPARECIMENTO.includes(String(b.frequencia).trim())) fields.frequencia = String(b.frequencia).trim();

  if (b.status !== undefined && ['ativo','concluido','arquivado'].includes(String(b.status).trim())) fields.status = String(b.status).trim();
  if (b.localAssinatura !== undefined && !LOCAIS_ASSINATURA.includes(String(b.localAssinatura).trim())) return res.status(400).json({ error: 'Local de assinatura inválido' });
  if (b.cpf !== undefined && b.cpf && !/^\d{11}$/.test(String(b.cpf).replace(/[.\-/]/g, ''))) return res.status(400).json({ error: 'CPF inválido (deve ter 11 dígitos)' });
  if (b.processo && !validarCNJ(b.processo)) return res.status(400).json({ error: 'Processo inválido (deve ter 20 dígitos no formato CNJ)' });
  // Validação: vínculo não pode ser duplicado em outro assistido
  if (fields.vinculo !== undefined && String(fields.vinculo).trim()) {
    const todos = await store.assistidos.allIncludingDeleted();
    const dup = todos.find(x => String(x.id) !== String(req.params.id) && String(x.vinculo).trim().toLowerCase() === String(fields.vinculo).trim().toLowerCase() && !x.deleted_at);
    if (dup) return res.status(409).json({ error: 'Vínculo já cadastrado em outro assistido: ' + dup.nome });
  }
  const row = await store.assistidos.patch(req.params.id, fields);
  if (!row) return res.status(404).json({ error: 'Não encontrado' });
  try { await store.audit.insert({ kind:'assistido', action:'editado', personName: row.nome, ref: 'assistido#'+row.id, byUser: req.auth.user, byName: req.auth.name, byRole: req.auth.role, summary: 'Assistido editado: ' + row.nome }); } catch(e){}
  broadcast();
  res.json(row);
}));

router.delete('/api/assistidos/:id', auth(['admin']), ah(async (req, res) => {
  const a = await store.assistidos.byId(req.params.id);
  const comps = await store.assistidosComparecimentos.all(req.params.id);
  for (const c of comps) await store.assistidosComparecimentos.remove(c.id);
  await store.assistidos.remove(req.params.id);
  try { await store.audit.insert({ kind:'assistido', action:'excluido', personName: a ? a.nome : '', ref: 'assistido#'+req.params.id, byUser: req.auth.user, byName: req.auth.name, byRole: req.auth.role, summary: 'Assistido excluído' + (a ? ': ' + a.nome : '') }); } catch(e){}
  broadcast();
  res.json({ ok: true });
}));

// Comparecimentos
router.get('/api/assistidos/:id/comparecimentos', auth(['admin','tecnico']), ah(async (req, res) => {
  const list = await store.assistidosComparecimentos.all(req.params.id);
  res.json(list);
}));

router.get('/api/assistidos/:id/detalhe', auth(['admin','tecnico']), ah(async (req, res) => {
  const a = await store.assistidos.byId(req.params.id);
  if (!a) return res.status(404).json({ error: 'Não encontrado' });
  const comps = await store.assistidosComparecimentos.all(req.params.id);
  const sorted = comps.slice().sort((x, y) => String(y.dataComparecimento).localeCompare(String(x.dataComparecimento)));
  const pendentes = comps.filter(c => !String(c.juntada || '').trim());
  res.json({ assistido: a, comparecimentos: sorted, pendentes: pendentes.length, total: comps.length });
}));

router.post('/api/assistidos/:id/comparecimentos', auth(['admin','tecnico']), ah(async (req, res) => {
  const b = req.body || {};
  if (!b.dataComparecimento) return res.status(400).json({ error: 'Data de comparecimento é obrigatória' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.dataComparecimento).trim())) return res.status(400).json({ error: 'Data de comparecimento inválida (use AAAA-MM-DD)' });
  const a = await store.assistidos.byId(req.params.id);
  if (!a) return res.status(404).json({ error: 'Assistido não encontrado' });
  // Bloqueia comparecimento duplicado no mesmo dia para o mesmo assistido
  const comps = await store.assistidosComparecimentos.all(req.params.id);
  if (comps.some(c => String(c.dataComparecimento).trim() === String(b.dataComparecimento).trim())) {
    return res.status(409).json({ error: 'Já existe comparecimento registrado nesta data para este assistido.' });
  }
  const row = await store.assistidosComparecimentos.insert({
    assistidoId: Number(req.params.id),
    dataComparecimento: String(b.dataComparecimento).trim(),
    policialPlantao: String(b.policialPlantao || '').trim() || '—',
    assinadoPor: String(b.assinadoPor || '').trim() || null
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
    protocoladoPor: req.auth.name || req.auth.user,
    observacoes: b.observacoes || ''
  });
  if (!row) return res.status(404).json({ error: 'Comparecimento não encontrado' });
  try { await store.audit.insert({ kind:'assistido', action:'protocolado', personName: '', ref: 'comparecimento#'+req.params.id, byUser: req.auth.user, byName: req.auth.name, byRole: req.auth.role, summary: 'Comparecimento protocolado' }); } catch(e){}
  broadcast();
  res.json(row);
}));

// Registrar juntada (coluna Juntada) de um comparecimento
router.patch('/api/assistidos/comparecimentos/:id/juntada', auth(['admin','tecnico']), ah(async (req, res) => {
  const b = req.body || {};
  const val = String(b.juntada || '').trim();
  if (!val) return res.status(400).json({ error: 'Dados da juntada são obrigatórios' });
  const row = await store.assistidosComparecimentos.patch(req.params.id, {
    juntada: val,
    protocolado: true,
    dataProtocolacao: new Date().toISOString().slice(0, 10),
    protocoladoPor: req.auth.name || req.auth.user
  });
  if (!row) return res.status(404).json({ error: 'Comparecimento não encontrado' });
  // Transição automática: assistido passa a concluído após juntada
  try {
    const assistido = await store.assistidos.byId(row.assistidoId);
    if (assistido && assistido.status === 'ativo') {
      await store.assistidos.patch(row.assistidoId, { status: 'concluido' });
    }
  } catch (e) {}
  try { await store.audit.insert({ kind:'assistido', action:'juntada', personName: '', ref: 'comparecimento#'+req.params.id, byUser: req.auth.user, byName: req.auth.name, byRole: req.auth.role, summary: 'Juntada registrada' }); } catch(e){}
  broadcast();
  res.json(row);
}));

// Listar pendências (comparecimentos sem juntada)
router.get('/api/assistidos/pendencias', auth(['admin','tecnico']), ah(async (req, res) => {
  const all = await store.assistidosComparecimentos.all();
  const list = all.filter(c => !String(c.juntada||'').trim());
  const assistidos = await store.assistidos.all();
  const byId = new Map(assistidos.map(a => [a.id, a]));
  const out = list.map(c => ({ ...c, assistido: byId.get(c.assistidoId) || null }));
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
  const porStatus = {};
  const porLocal = {};
  const porSistema = {};
  const porContrato = {};
  assistidos.forEach(a => { porVara[a.vara || '—'] = (porVara[a.vara || '—'] || 0) + 1; });
  assistidos.forEach(a => { porStatus[a.status || '—'] = (porStatus[a.status || '—'] || 0) + 1; });
  assistidos.forEach(a => { porLocal[a.localAssinatura || '—'] = (porLocal[a.localAssinatura || '—'] || 0) + 1; });

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
    porMes: Object.entries(porMes).map(([mes,total]) => ({ mes, total })).sort((a,b)=>a.mes.localeCompare(b.mes)),
    porStatus: Object.entries(porStatus).map(([s,total]) => ({ status: s, total })).sort((a,b)=>b.total-a.total),
    porLocal: Object.entries(porLocal).map(([l,total]) => ({ local: l, total })).sort((a,b)=>b.total-a.total),
  });
}));

// Filtro de listagem
router.get('/api/assistidos/filtrar', auth(['admin','tecnico']), ah(async (req, res) => {
  const { q, vara, nome, vinculo, processo, local, status, dataProtocolo, usuarioProtocolo } = req.query || {};
  let list = await store.assistidos.all();
  if (q) {
    const t = String(q).toLowerCase();
    list = list.filter(a => (a.nome||'').toLowerCase().includes(t) || (a.processo||'').toLowerCase().includes(t) || (a.vinculo||'').toLowerCase().includes(t));
  }
  if (nome) {
    const t = String(nome).toLowerCase();
    list = list.filter(a => (a.nome||'').toLowerCase().includes(t));
  }
  if (vinculo) {
    const t = String(vinculo).toLowerCase();
    list = list.filter(a => (a.vinculo||'').toLowerCase().includes(t));
  }
  if (processo) {
    const t = String(processo).toLowerCase();
    list = list.filter(a => (a.processo||'').toLowerCase().includes(t));
  }
  if (vara) list = list.filter(a => a.vara === vara);
  if (local) list = list.filter(a => a.localAssinatura === local);
  if (status) list = list.filter(a => a.status === status);
  if (dataProtocolo || usuarioProtocolo) {
    const comps = await store.assistidosComparecimentos.all();
    const byAssistido = new Map();
    comps.forEach(c => {
      const arr = byAssistido.get(c.assistidoId) || [];
      arr.push(c);
      byAssistido.set(c.assistidoId, arr);
    });
    list = list.filter(a => {
      const cs = byAssistido.get(a.id) || [];
      return cs.some(c => {
        if (dataProtocolo && !String(c.dataProtocolacao || '').includes(dataProtocolo)) return false;
        if (usuarioProtocolo && !String(c.protocoladoPor || '').toLowerCase().includes(String(usuarioProtocolo).toLowerCase())) return false;
        return true;
      });
    });
  }
  // Paginação
  const { page, limit } = req.query || {};
  const total = list.length;
  let paged = list;
  if (page !== undefined && limit !== undefined) {
    const p = Math.max(Number(page) || 1, 1);
    const l = Math.min(Math.max(Number(limit) || 50, 1), 100);
    const start = (p - 1) * l;
    paged = list.slice(start, start + l);
  }
  res.json({ items: paged, total, page: page ? Number(page) : 1, limit: limit ? Number(limit) : total });
}));

// Relatório em PDF — aplica os mesmos filtros de /filtrar e gera PDF para download
router.get('/api/assistidos/relatorio/pdf', auth(['admin','tecnico']), ah(async (req, res) => {
  const { q, vara, nome, vinculo, processo, local, status, dataProtocolo, usuarioProtocolo, protoDe, protoAte, campos } = req.query || {};
  let list = await store.assistidos.all();
  if (q) {
    const t = String(q).toLowerCase();
    list = list.filter(a => (a.nome||'').toLowerCase().includes(t) || (a.processo||'').toLowerCase().includes(t) || (a.vinculo||'').toLowerCase().includes(t));
  }
  if (nome) { const t = String(nome).toLowerCase(); list = list.filter(a => (a.nome||'').toLowerCase().includes(t)); }
  if (vinculo) { const t = String(vinculo).toLowerCase(); list = list.filter(a => (a.vinculo||'').toLowerCase().includes(t)); }
  if (processo) { const t = String(processo).toLowerCase(); list = list.filter(a => (a.processo||'').toLowerCase().includes(t)); }
  if (vara) list = list.filter(a => a.vara === vara);
  if (local) list = list.filter(a => a.localAssinatura === local);
  if (status) list = list.filter(a => a.status === status);
  if (dataProtocolo || usuarioProtocolo || protoDe || protoAte) {
    const comps = await store.assistidosComparecimentos.all();
    const byAssistido = new Map();
    comps.forEach(c => { const arr = byAssistido.get(c.assistidoId) || []; arr.push(c); byAssistido.set(c.assistidoId, arr); });
    list = list.filter(a => {
      const cs = byAssistido.get(a.id) || [];
      return cs.some(c => {
        if (dataProtocolo && !String(c.dataProtocolacao || '').includes(dataProtocolo)) return false;
        if (usuarioProtocolo && !String(c.protocoladoPor || '').toLowerCase().includes(String(usuarioProtocolo).toLowerCase())) return false;
        if (protoDe && c.dataProtocolacao && String(c.dataProtocolacao) < protoDe) return false;
        if (protoAte && c.dataProtocolacao && String(c.dataProtocolacao) > protoAte) return false;
        return true;
      });
    });
  }
  list = list.slice().sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));

  const camposSel = (campos || 'vinculo,nome,processo,vara,localAssinatura,dataInicio,status,ultimoComparecimento,policialPlantao,juntada,dataProtocolacao,protocoladoPor').split(',').filter(Boolean);
  const labels = { vinculo:'Vínculo', nome:'Nome', processo:'Processo', vara:'Vara', localAssinatura:'Local', dataInicio:'Início', status:'Status', ultimoComparecimento:'Últ. Comparecimento', policialPlantao:'Policial', juntada:'Juntada', dataProtocolacao:'Protocolado em', protocoladoPor:'Protocolado por' };
  const fmtBR = (v) => { if (!v) return '—'; const s = String(v).trim(); if (/^\d{4}-\d{2}-\d{2}/.test(s)) { const [y,m,d] = s.slice(0,10).split('-'); return d+'/'+m+'/'+y; } return s; };

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 595.28, H = 841.89, M = 40;
  let page = pdf.addPage([W, H]);
  let y = H - M;

  function drawHeader(pg) {
    pg.drawText('Relatório de Assistidos — SISUMEPE Juazeiro', { x: M, y: H - M, size: 14, font: boldFont, color: rgb(0.1, 0.2, 0.5) });
    pg.drawText('Gerado em: ' + new Date().toLocaleString('pt-BR', { timeZone: 'America/Fortaleza' }), { x: M, y: H - M - 18, size: 8, font, color: rgb(0.4, 0.4, 0.4) });
    pg.drawText('Total de registros: ' + list.length, { x: M, y: H - M - 30, size: 9, font: boldFont, color: rgb(0, 0, 0) });
    let hx = M;
    pg.drawRectangle({ x: M, y: H - M - 46, width: W - 2 * M, height: 14, color: rgb(0.2, 0.3, 0.6) });
    const colW = (W - 2 * M) / camposSel.length;
    camposSel.forEach(k => {
      let txt = String(labels[k] || k);
      while (txt.length > 1 && boldFont.widthOfTextAtSize(txt, 7.5) > colW - 6) {
        txt = txt.slice(0, -1);
      }
      pg.drawText(txt, { x: hx + 2, y: H - M - 42, size: 7.5, font: boldFont, color: rgb(1, 1, 1) });
      hx += colW;
    });
    return H - M - 62;
  }

  let cy = drawHeader(page);
  const rowH = 14;
  list.forEach((a, i) => {
    if (cy < M + 30) {
      page = pdf.addPage([W, H]);
      cy = drawHeader(page);
    }
    if (i % 2 === 0) {
      page.drawRectangle({ x: M, y: cy - rowH + 2, width: W - 2 * M, height: rowH, color: rgb(0.97, 0.97, 0.98) });
    }
    const colW = (W - 2 * M) / camposSel.length;
    let px = M;
    camposSel.forEach(k => {
      let v = a[k];
      if (k === 'dataInicio' || k === 'ultimoComparecimento' || k === 'dataProtocolacao') v = fmtBR(v);
      let txt = String(v || '—');
      // Trunca com base na largura real do texto para não estourar a coluna
      while (txt.length > 1 && font.widthOfTextAtSize(txt, 7.5) > colW - 6) {
        txt = txt.slice(0, -1);
      }
      page.drawText(txt, { x: px + 2, y: cy - 10, size: 7.5, font, color: rgb(0, 0, 0) });
      px += colW;
    });
    cy -= rowH + 4;
  });

  const bytes = await pdf.save();
  const buf = Buffer.from(bytes);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="relatorio-assistidos.pdf"');
  res.send(buf);
}));

const FREQ_DAYS = { semanal:7, quinzenal:15, mensal:30, bimestral:60, trimestral:90 };
function proximoEsperadoAssistido(a, comps){
  const last = comps.filter(c => c.assistidoId === a.id).sort((x,y)=> String(y.dataComparecimento).localeCompare(String(x.dataComparecimento)))[0];
  const base = last ? last.dataComparecimento : (a.dataInicio || null);
  if (!base || !/^\d{4}-\d{2}-\d{2}$/.test(String(base))) return null;
  const dias = FREQ_DAYS[a.frequencia] || 30;
  const dt = new Date(String(base) + 'T00:00:00');
  if (isNaN(dt)) return null;
  return new Date(dt.getTime() + dias*864e5).toISOString().slice(0,10);
}
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
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(base))) continue;
    const dias = FREQ_DAYS[a.frequencia] || 30;
    const dt = new Date(String(base) + 'T00:00:00');
    if (isNaN(dt)) continue;
    const prox = new Date(dt.getTime() + dias*864e5).toISOString().slice(0,10);
    if (prox <= hoje) out.push({ ...a, ultimoComparecimento: last ? last.dataComparecimento : null, proximoEsperado: prox });
  }
  res.json(out);
}));


let lastImportStatus = { state: 'idle', total: 0, processed: 0, totalRows: 0, progress: 0, error: null, at: null };

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
  lastImportStatus = { state: 'running', total: 0, processed: 0, totalRows: 0, progress: 0, error: null, at: new Date().toISOString() };
  res.json({ ok: true, assincrono: true, msg: 'Importação iniciada em background.' });
  setImmediate(async () => {
    try {
      const ExcelJS = require('exceljs');
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      let total = 0;
      let totalRows = 0;
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

        // ---------------------------------------------------------------
        // Classificador de células por conteúdo (dados estão frequentemente
        // deslocados entre colunas na planilha de origem).
        // ---------------------------------------------------------------
        const LOCAIS_VALIDOS = ['COAP CARIRI','COMEP CARIRI','ALBERGADO CARIRI'];
        const PPS_CONHECIDOS = ['ERMINIO','MARCOS','WANDERSON','JOANDERSON','JULIANA','REJANE','AILTON'];

        function isProcessoLike(v) {
          const s = String(v||'').trim();
          if (!s) return false;
          if (/^(ARQUIVADO|INATIVO|SEM DIGITAL)$/i.test(s)) return true;
          return /^\d{7,}[\-\.]\d{2}[\.\-]\d{4}\.\d\.\d{2}\.\d{4}$/.test(s) ||
                 /^\d{7,}[\-\.]\d{2}$/.test(s);
        }
        function isLocalLike(v) {
          return LOCAIS_VALIDOS.includes(String(v||'').trim().toUpperCase());
        }
        function isFrequenciaLike(v) {
          const s = String(v||'').trim().toUpperCase();
          return /^(SEMANAL|MENSAL|QUINZENAL|BIMENSAL|TRIMENSAL|DIÁRIA|DIARIA|QUINQUEMESTRAL)$/.test(s);
        }
        function isDataLike(v) {
          if (v instanceof Date) return true;
          const s = String(v||'').trim();
          if (!s) return false;
          return /^\d{4}-\d{2}-\d{2}$/.test(s) ||
                 /^\d{2}\/\d{2}\/\d{4}$/.test(s) ||
                 /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s);
        }
        function isVaraLike(v) {
          const s = String(v||'').trim().toUpperCase();
          return /VARA|JUIZADO|NÚCLEO|NUCLEO/.test(s);
        }
        // Classifica uma célula pelo conteúdo, retornando o campo que preenche.
        function classifyCell(val) {
          if (val == null) return 'vazio';
          if (val instanceof Date) return 'data';
          const s = String(val).trim();
          if (!s) return 'vazio';
          const u = s.toUpperCase();
          if (isProcessoLike(s)) return 'processo';
          if (isLocalLike(s)) return 'local';
          if (isFrequenciaLike(s)) return 'frequencia';
          if (isDataLike(s)) return 'data';
          if (isVaraLike(s)) return 'vara';
          // PP conhecido por nome
          if (PPS_CONHECIDOS.includes(u)) return 'pp';
          return 'texto'; // nome, pp generico ou obs
        }

        // Lê todas as células da linha e classifica cada uma.
        // Retorna um objeto com os campos mapeados (prioriza o conteúdo certo).
        function lerLinhaAssistido(row) {
          const campos = {
            vinculo: '', nome: '', processo: '', vara: '', localAssinatura: '',
            dataInicio: '', frequencia: 'mensal', dataComparecimento: '', policialPlantao: '',
            observacao: '', status: 'ativo'
          };
          let melhorNome = '';
          row.eachCell((c, colIdx) => {
            const v = row.getCell(colIdx).value;
            const tipo = classifyCell(v);
            const s = String(v||'').trim();
            const u = s.toUpperCase();
            switch (tipo) {
              case 'processo':
                // Se ainda não tem vinculo definido, este pode ser o vinculo
                if (!campos.vinculo) campos.vinculo = s;
                else if (!campos.processo) campos.processo = s;
                break;
              case 'local':
                if (!campos.localAssinatura) campos.localAssinatura = s;
                break;
              case 'frequencia':
                if (!campos.frequencia || campos.frequencia==='mensal') campos.frequencia = normFreq(s);
                break;
              case 'data': {
                const iso = excelSerialToISO(v);
                if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
                  if (!campos.dataInicio) campos.dataInicio = iso;
                  else if (!campos.dataComparecimento) campos.dataComparecimento = iso;
                }
                break;
              }
              case 'vara':
                if (!campos.vara) campos.vara = s;
                break;
              case 'pp':
                if (!campos.policialPlantao) campos.policialPlantao = s;
                break;
              case 'texto':
                // Pode ser nome, PP genérico ou observação.
                // Ignora "Nº" da planilha (números curtos, apenas dígitos)
                if (/^\d{1,4}$/.test(s)) break;
                // Nome: texto com 2+ palavras, não é PP conhecido, não contém palavras de status.
                if (!melhorNome && s.split(/\s+/).filter(Boolean).length >= 2 &&
                    !/ARQUIVADO|INATIVO|SEM DIGITAL|JUNTADA|SEEU|FLS|PROTOCOL/.test(u)) {
                  melhorNome = s;
                } else if (!campos.observacao && s.length > 3) {
                  campos.observacao = s;
                }
                break;
              // status_especial removido: classifyCell nunca retorna esse tipo (código morto)
            }
          });
          // Se achou um "texto" que parece nome, usa como nome
          if (melhorNome) campos.nome = melhorNome;
          // Se processo não foi preenchido mas vinculo tem número de processo, usa como processo
          if (!campos.processo && campos.vinculo && isProcessoLike(campos.vinculo)) {
            campos.processo = campos.vinculo;
          }
          // Ajusta frequência via normFreq (garante valor válido)
          campos.frequencia = normFreq(campos.frequencia);
          // Status: processo/vara com ARQUIVADO → arquivado
          if (/ARQUIVADO/.test(String(campos.processo).toUpperCase()) || /ARQUIVADO/.test(String(campos.vara).toUpperCase())) {
            campos.status = 'arquivado';
          }
          return campos;
        }

        // Primeira passagem: conta total de linhas válidas (para barra de progresso)
        for (const ws of wb.worksheets) {
          ws.eachRow((row, idx) => {
            if (idx === 1) return;
            const temVinculo = false;
            let temDado = false;
            row.eachCell((c) => { if (c.value != null && String(c.value).trim()) temDado = true; });
            if (!temDado) return;
            const campos = lerLinhaAssistido(row);
            if (!campos.vinculo || !campos.nome) return;
            if (seenVinculo.has(campos.vinculo)) return;
            totalRows++;
          });
        }
        lastImportStatus.totalRows = totalRows;

        // Segunda passagem: processa e insere
        // Coleta as linhas válidas primeiro (eachRow não suporta async),
        // depois processa com await fora do callback.
        const linhasParaProcessar = [];
        for (const ws of wb.worksheets) {
          ws.eachRow((row, idx) => {
            if (idx === 1) return;
            let temDado = false;
            row.eachCell((c) => { if (c.value != null && String(c.value).trim()) temDado = true; });
            if (!temDado) return;
            const campos = lerLinhaAssistido(row);
            const { vinculo, nome } = campos;
            if (!vinculo || !nome) return;
            if (seenVinculo.has(vinculo)) return;
            linhasParaProcessar.push({ campos, row });
          });
        }
        for (const { campos } of linhasParaProcessar) {
          const { vinculo, nome } = campos;
          if (seenVinculo.has(vinculo)) continue;
          try {
            // Garante local válido
            let localFinal = campos.localAssinatura;
            if (!LOCAIS_ASSINATURA.includes(localFinal)) localFinal = '';
            if (!localFinal) localFinal = 'COMEP Cariri';

            const processoFinal = campos.processo || '';
            const varaFinal = campos.vara || '';

            const statusFinal = (processoFinal.toUpperCase()==='ARQUIVADO' || varaFinal.toUpperCase()==='ARQUIVADO' || campos.status==='arquivado') ? 'arquivado' : 'ativo';

            const a = await store.assistidos.insert({
              vinculo, nome, processo: processoFinal, vara: varaFinal,
              localAssinatura: localFinal,
              dataInicio: campos.dataInicio || '',
              frequencia: campos.frequencia,
              status: statusFinal
            });

            // Comparecimento (se houver data)
            if (campos.dataComparecimento && /^\d{4}-\d{2}-\d{2}$/.test(campos.dataComparecimento)) {
              const cmp = await store.assistidosComparecimentos.insert({
                assistidoId: a.id,
                dataComparecimento: campos.dataComparecimento,
                policialPlantao: campos.policialPlantao || '—'
              });
              if (campos.observacao) {
                await store.assistidosComparecimentos.patch(cmp.id, { juntada: campos.observacao });
              }
            }

            seenVinculo.add(vinculo);
            total++;
            lastImportStatus.processed = total;
            lastImportStatus.progress = lastImportStatus.totalRows > 0 ? Math.round((total / lastImportStatus.totalRows) * 100) : 0;
            lastImportStatus.at = new Date().toISOString();
          } catch (e) {
            console.error('import row error', e.message);
          }
        }
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

// Visão de fluxo (kanban) — assistidos agrupados por etapa
router.get('/api/assistidos/fluxo', auth(['admin','tecnico']), ah(async (req, res) => {
  const assistidos = await store.assistidos.all();
  const comps = await store.assistidosComparecimentos.all();
  const hoje = new Date().toISOString().slice(0,10);
  const FREQ_DAYS = { semanal:7, quinzenal:15, mensal:30, bimestral:60, trimestral:90 };
  const etapas = { aguardando: [], compareceu: [], protocolado: [], concluido: [] };
  for (const a of assistidos) {
    if (a.status === 'concluido' || a.status === 'arquivado') { etapas.concluido.push(a); continue; }
    const last = comps.filter(c => c.assistidoId === a.id).sort((x,y)=> String(y.dataComparecimento).localeCompare(String(x.dataComparecimento)))[0];
    if (!last) { etapas.aguardando.push(a); continue; }
    const proto = comps.filter(c => c.assistidoId === a.id).find(c => String(c.juntada||'').trim());
    if (!String(last.juntada||'').trim()) { etapas.compareceu.push({ ...a, ultimoComparecimento: last.dataComparecimento, compId: last.id, juntada: last.juntada, policialPlantao: last.policialPlantao, dataProtocolacao: proto ? proto.dataProtocolacao : last.dataProtocolacao, protocoladoPor: proto ? proto.protocoladoPor : last.protocoladoPor }); continue; }
    etapas.protocolado.push({ ...a, ultimoComparecimento: last.dataComparecimento, compId: last.id, juntada: last.juntada, policialPlantao: last.policialPlantao, dataProtocolacao: proto ? proto.dataProtocolacao : last.dataProtocolacao, protocoladoPor: proto ? proto.protocoladoPor : last.protocoladoPor });
  }
  res.json(etapas);
}));

// Lista assistidos com vínculo pendente (vinculo começa com PENDENTE-)
router.get('/api/assistidos/pendentes-vinculo', auth(['admin','tecnico']), ah(async (req, res) => {
  const todos = await store.assistidos.allIncludingDeleted();
  const pendentes = todos.filter(a => String(a.vinculo||'').startsWith('PENDENTE-') && !a.deleted_at);
  res.json(pendentes.sort((a, b) => String(a.vinculo||'').localeCompare(String(b.vinculo||''))));
}));

// Edição em lote de vínculos pendentes (atualiza múltiplos assistidos de uma vez)
router.patch('/api/assistidos/bulk-vinculo', auth(['admin']), ah(async (req, res) => {
  const { items } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Informe a lista de itens para atualizar' });
  }

  let atualizados = 0;
  let erros = 0;
  const detalhes = [];

  for (const item of items) {
    const { id, vinculo } = item;
    if (!id || !vinculo || String(vinculo).trim() === '') {
      erros++;
      detalhes.push({ id, erro: 'ID e vínculo são obrigatórios' });
      continue;
    }

    try {
      // Verifica se o vínculo já existe em outro assistido
      const todos = await store.assistidos.allIncludingDeleted();
      const dup = todos.find(x => String(x.id) !== String(id) && String(x.vinculo||'').trim().toLowerCase() === String(vinculo).trim().toLowerCase() && !x.deleted_at);
      if (dup) {
        erros++;
        detalhes.push({ id, vinculo, erro: `Vínculo já cadastrado em outro assistido (${dup.nome})` });
        continue;
      }

      const atualizado = await store.assistidos.patch(id, { vinculo: String(vinculo).trim() });
      if (atualizado) {
        atualizados++;
        detalhes.push({ id, vinculo: atualizado.vinculo, status: 'atualizado' });
      } else {
        erros++;
        detalhes.push({ id, erro: 'Assistido não encontrado' });
      }
    } catch (e) {
      erros++;
      detalhes.push({ id, erro: e.message });
    }
  }

  // Rebusca os pendentes restantes para retornar ao frontend
  const todos = await store.assistidos.allIncludingDeleted();
  const pendentes = todos.filter(a => String(a.vinculo||'').startsWith('PENDENTE-') && !a.deleted_at);

  res.json({
    atualizados,
    erros,
    total: items.length,
    pendentesRestantes: pendentes.length,
    detalhes
  });
}));

// =====================================================================
//  Alertas automáticos — calcula dias desde última juntada
//  Semáforo: EM DIA (0-30 dias) / ATENÇÃO (31-60 dias) / CRÍTICO (>60 dias)
// =====================================================================
router.get('/api/assistidos/alertas', auth(['admin','tecnico']), ah(async (req, res) => {
  const assistidos = await store.assistidos.all();
  const comps = await store.assistidosComparecimentos.all();
  const hoje = new Date().toISOString().slice(0,10);
  const hojeDate = new Date(hoje);
  const FREQ_DAYS = { semanal:7, quinzenal:15, mensal:30, bimestral:60, trimestral:90 };

  // Último comparecimento por assistido
  const ultimoPorAssistido = {};
  comps.forEach(c => {
    const aid = String(c.assistidoId);
    if (!ultimoPorAssistido[aid] || String(c.dataComparecimento) > String(ultimoPorAssistido[aid].dataComparecimento)) {
      ultimoPorAssistido[aid] = c;
    }
  });

  const alertas = [];
  for (const a of assistidos) {
    if (a.status !== 'ativo') continue;
    const last = ultimoPorAssistido[String(a.id)];
    if (!last) continue; // sem comparecimento registrado

    const ultimaData = new Date(last.dataComparecimento);
    const diasDiff = Math.floor((hojeDate - ultimaDate) / (1000 * 60 * 60 * 24));
    const freqDias = FREQ_DAYS[a.frequencia] || 30;
    const diasAteProximo = freqDias - diasDiff;

    let tipo = 'EM_DIA';
    if (diasDiff > 60) tipo = 'CRITICO';
    else if (diasDiff > 30) tipo = 'ATENCAO';

    // Só alerta se já passou do prazo ou está prestes a vencer (7 dias)
    if (diasDiff > freqDias || diasAteProximo <= 7) {
      alertas.push({
        assistidoId: a.id,
        nome: a.nome,
        vinculo: a.vinculo,
        tipo,
        diasUltimaJuntada: diasDiff,
        diasAteProximo: diasAteProximo > 0 ? diasAteProximo : 0,
        frequencia: a.frequencia,
        ultimaJuntada: last.dataComparecimento,
        ultimoComparecimento: last.dataComparecimento,
        local: a.localAssinatura,
        vara: a.vara
      });
    }
  }

  alertas.sort((a, b) => {
    const ordem = { CRITICO: 0, ATENCAO: 1, EM_DIA: 2 };
    return (ordem[a.tipo] || 99) - (ordem[b.tipo] || 99);
  });

  res.json(alertas);
}));

// =====================================================================
//  Busca fuzzy por nome — detecta duplicidades e nomes similares
// =====================================================================
router.get('/api/assistidos/buscar', auth(['admin','tecnico']), ah(async (req, res) => {
  const { q } = req.query || {};
  if (!q || String(q).trim().length < 3) {
    return res.status(400).json({ error: 'Informe pelo menos 3 caracteres para busca' });
  }

  const qLower = String(q).trim().toLowerCase();
  const assistidos = await store.assistidos.all();

  // Busca exata primeiro
  const exatos = assistidos.filter(a => String(a.nome || '').toLowerCase().includes(qLower));

  // Busca fuzzy: detecta nomes similares (mesmas palavras em ordem diferente)
  const palavrasQ = qLower.split(/\s+/).filter(Boolean);
  const fuzzy = assistidos.filter(a => {
    const nome = String(a.nome || '').toLowerCase();
    const palavrasNome = nome.split(/\s+/).filter(Boolean);
    // Se todas as palavras da busca aparecem no nome
    return palavrasQ.every(p => palavrasNome.some(pn => pn.includes(p) || pn.startsWith(p)));
  }).filter(a => !exatos.includes(a)); // remove duplicatas com exatos

  res.json({
    exatos,
    fuzzy,
    total: exatos.length + fuzzy.length
  });
}));

// =====================================================================
//  Etiquetar/desetiquetar assistido (Verificado/Pendente)
// =====================================================================
router.patch('/api/assistidos/:id/etiqueta', auth(['admin','tecnico']), ah(async (req, res) => {
  const { etiqueta } = req.body || {};
  if (!etiqueta || !['verificado', 'pendente', ''].includes(etiqueta)) {
    return res.status(400).json({ error: 'Etiqueta inválida. Use: verificado, pendente ou vazio' });
  }
  const target = await store.assistidos.byId(req.params.id);
  if (!target) return res.status(404).json({ error: 'Assistido não encontrado' });
  const row = await store.assistidos.patch(req.params.id, { etiqueta });
  try { await store.audit.insert({ kind:'assistido', action:'etiqueta', personName: row.nome, ref: 'assistido#'+row.id, byUser: req.auth.user, byName: req.auth.name, byRole: req.auth.role, summary: 'Etiqueta: ' + etiqueta }); } catch(e){}
  res.json({ id: row.id, etiqueta: row.etiqueta });
}));

module.exports = router;
