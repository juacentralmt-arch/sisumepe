const express = require('express');
const shared = require('../lib/shared');
const { store, ah, auth, broadcast, upload } = shared;
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const {
  LOCAIS_ASSINATURA, PERIODOS_COMPARECIMENTO, FREQ_DAYS, STATUS_ASSISTIDO,
  isoDate, cpfValido, agruparComparecimentos, comparecimentoProtocolado,
  nomeKey, filtrarAssistidosBase, proximoEsperadoAssistido
} = require('../lib/assistidos');
const router = express.Router();

async function temResponsabilidade(req, assistidoId) {
  if (req.auth.role === 'admin') return true;
  const comps = await store.assistidosComparecimentos.all(assistidoId);
  const meuNome = nomeKey(req.auth.name || req.auth.user);
  return comps.some(c => nomeKey(c.policialPlantao) === meuNome);
}

// Cadastro de assistido
router.get('/api/assistidos', auth(['admin','tecnico']), ah(async (req, res) => {
  const { page, limit } = req.query || {};
  const list = await store.assistidos.all();
  const comps = await store.assistidosComparecimentos.all();
  const byAssistido = agruparComparecimentos(comps);
  const enriched = list.map(a => {
    const cs = byAssistido.get(String(a.id)) || [];
    const last = cs[0] || null;
    const prox = proximoEsperadoAssistido(a, cs);
    const hoje = new Date().toISOString().slice(0,10);
    const vencendo = prox && prox <= hoje;
    const vencendo7 = prox && !vencendo && prox <= new Date(Date.now() + 7*864e5).toISOString().slice(0,10);
    return { ...a, ultimoComparecimento: last ? last.dataComparecimento : null, pendenteJuntada: !!(last && !comparecimentoProtocolado(last)), proximoEsperado: prox, vencendo: vencendo, vencendo7d: vencendo7 };
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
  if (!isoDate(b.dataInicio)) return res.status(400).json({ error: 'Data de início inválida (use uma data real no formato AAAA-MM-DD)' });
  if (b.dataFim && !isoDate(b.dataFim)) return res.status(400).json({ error: 'Data de término inválida' });
  if (b.cpf && !cpfValido(b.cpf)) return res.status(400).json({ error: 'CPF inválido' });
  if (b.processo && !validarCNJ(b.processo)) return res.status(400).json({ error: 'Processo inválido (deve ter 20 dígitos no formato CNJ)' });
  const freq = String(b.frequencia || 'mensal').trim();
  if (!PERIODOS_COMPARECIMENTO.includes(freq)) return res.status(400).json({ error: 'Frequência inválida' });
  const etiqueta = String(b.etiqueta || '').trim().slice(0, 40);
  const etiquetaTexto = String(b.etiquetaTexto || '').trim().slice(0, 60);
  const etiquetaCor = /^#[0-9A-Fa-f]{6}$/.test(String(b.etiquetaCor || '')) ? String(b.etiquetaCor) : '#4f46e5';
  const all = await store.assistidos.all();
  if (all.some(x => String(x.vinculo || '').trim().toLocaleLowerCase('pt-BR') === String(b.vinculo).trim().toLocaleLowerCase('pt-BR'))) return res.status(409).json({ error: 'Vínculo já cadastrado' });
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
    etiqueta,
    etiquetaTexto,
    etiquetaCor,
    status: 'ativo'
  });
  try { await store.audit.insert({ kind:'assistido', action:'criado', personName: row.nome, ref: 'assistido#'+row.id, byUser: req.auth.user, byName: req.auth.name, byRole: req.auth.role, summary: 'Assistido cadastrado: ' + row.nome }); } catch(e){}
  broadcast();
  res.status(201).json(row);
}));

router.patch('/api/assistidos/:id(\\d+)', auth(['admin','tecnico']), ah(async (req, res) => {
  const b = req.body || {};
  const target = await store.assistidos.byId(req.params.id);
  if (!target) return res.status(404).json({ error: 'Não encontrado' });
  // Técnico só edita assistidos de sua responsabilidade (único comparecimento registrado por ele ou assistido sem técnico definido).
  if (req.auth.role === 'tecnico') {
    if (!await temResponsabilidade(req, req.params.id)) return res.status(403).json({ error: 'Técnico só pode editar assistidos de sua responsabilidade.' });
  }
  const fields = {};
  const requiredFields = new Set(['vinculo','nome','processo','vara','localAssinatura','dataInicio']);
  for (const k of ['vinculo','nome','processo','vara','localAssinatura','dataInicio','cpf','telefone','endereco','situacaoJuridica','tipoMedida','cargaHoraria','dataFim']) {
    if (b[k] === undefined) continue;
    fields[k] = String(b[k] == null ? '' : b[k]).trim();
    if (requiredFields.has(k) && !fields[k]) return res.status(400).json({ error: `${k} é obrigatório` });
  }
  if (b.frequencia !== undefined) {
    const freq = String(b.frequencia).trim();
    if (!PERIODOS_COMPARECIMENTO.includes(freq)) return res.status(400).json({ error: 'Frequência inválida' });
    fields.frequencia = freq;
  }
  if (b.etiqueta !== undefined) fields.etiqueta = String(b.etiqueta || '').trim().slice(0, 40);
  if (b.etiquetaTexto !== undefined) fields.etiquetaTexto = String(b.etiquetaTexto || '').trim().slice(0, 60);
  if (b.etiquetaCor !== undefined) fields.etiquetaCor = /^#[0-9A-Fa-f]{6}$/.test(String(b.etiquetaCor)) ? String(b.etiquetaCor) : '#4f46e5';

  if (b.status !== undefined) {
    const status = String(b.status).trim();
    if (!STATUS_ASSISTIDO.includes(status)) return res.status(400).json({ error: 'Status inválido' });
    fields.status = status;
  }
  if (b.localAssinatura !== undefined && !LOCAIS_ASSINATURA.includes(String(b.localAssinatura).trim())) return res.status(400).json({ error: 'Local de assinatura inválido' });
  if (b.cpf !== undefined && b.cpf && !cpfValido(b.cpf)) return res.status(400).json({ error: 'CPF inválido' });
  if (b.dataInicio !== undefined && !isoDate(b.dataInicio)) return res.status(400).json({ error: 'Data de início inválida' });
  if (b.dataFim !== undefined && b.dataFim !== '' && !isoDate(b.dataFim)) return res.status(400).json({ error: 'Data de término inválida' });
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

router.delete('/api/assistidos/:id(\\d+)', auth(['admin']), ah(async (req, res) => {
  const a = await store.assistidos.byId(req.params.id);
  if (!a) return res.status(404).json({ error: 'Assistido não encontrado' });
  await store.assistidos.remove(req.params.id);
  try { await store.audit.insert({ kind:'assistido', action:'excluido', personName: a ? a.nome : '', ref: 'assistido#'+req.params.id, byUser: req.auth.user, byName: req.auth.name, byRole: req.auth.role, summary: 'Assistido excluído' + (a ? ': ' + a.nome : '') }); } catch(e){}
  broadcast();
  res.json({ ok: true });
}));

// Comparecimentos
router.get('/api/assistidos/:id/comparecimentos', auth(['admin','tecnico']), ah(async (req, res) => {
  if (!await store.assistidos.byId(req.params.id)) return res.status(404).json({ error: 'Assistido não encontrado' });
  const list = await store.assistidosComparecimentos.all(req.params.id);
  res.json(list);
}));

router.get('/api/assistidos/:id/detalhe', auth(['admin','tecnico']), ah(async (req, res) => {
  const a = await store.assistidos.byId(req.params.id);
  if (!a) return res.status(404).json({ error: 'Não encontrado' });
  const comps = await store.assistidosComparecimentos.all(req.params.id);
  const sorted = comps.slice().sort((x, y) => String(y.dataComparecimento).localeCompare(String(x.dataComparecimento)));
  const pendentes = comps.filter(c => !comparecimentoProtocolado(c));
  res.json({ assistido: a, comparecimentos: sorted, pendentes: pendentes.length, total: comps.length });
}));

router.post('/api/assistidos/:id/comparecimentos', auth(['admin','tecnico']), ah(async (req, res) => {
  const b = req.body || {};
  if (!b.dataComparecimento) return res.status(400).json({ error: 'Data de comparecimento é obrigatória' });
  if (!isoDate(b.dataComparecimento)) return res.status(400).json({ error: 'Data de comparecimento inválida (use uma data real no formato AAAA-MM-DD)' });
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
    policialPlantao: req.auth.role === 'tecnico'
      ? String(req.auth.name || req.auth.user || '').trim()
      : String(b.policialPlantao || '').trim() || '—',
    assinadoPor: String(b.assinadoPor || '').trim() || null
  });
  try { await store.audit.insert({ kind:'assistido', action:'comparecimento', personName: a.nome, ref: 'comparecimento#'+row.id, byUser: req.auth.user, byName: req.auth.name, byRole: req.auth.role, summary: 'Comparecimento registrado: ' + row.dataComparecimento }); } catch(e){}
  broadcast();
  res.status(201).json(row);
}));

// Protocolar pendência (marcar comparecimento como protocolado + observações)
router.patch('/api/assistidos/comparecimentos/:id/protocolar', auth(['admin','tecnico']), ah(async (req, res) => {
  const b = req.body || {};
  if (b.dataProtocolacao && !isoDate(b.dataProtocolacao)) return res.status(400).json({ error: 'Data de protocolação inválida' });
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
      await store.assistidos.patch(assistido.id, { status: 'concluido' });
    }
  } catch (e) { throw e; }
  try { await store.audit.insert({ kind:'assistido', action:'juntada', personName: '', ref: 'comparecimento#'+req.params.id, byUser: req.auth.user, byName: req.auth.name, byRole: req.auth.role, summary: 'Juntada registrada' }); } catch(e){}
  broadcast();
  res.json(row);
}));

// Listar pendências (comparecimentos sem juntada)
router.get('/api/assistidos/pendencias', auth(['admin','tecnico']), ah(async (req, res) => {
  const all = await store.assistidosComparecimentos.all();
  const assistidos = await store.assistidos.all();
  const byId = new Map(assistidos.map(a => [String(a.id), a]));
  const out = all.filter(c => !comparecimentoProtocolado(c) && byId.has(String(c.assistidoId))).map(c => ({ ...c, assistido: byId.get(String(c.assistidoId)) }));
  res.json(out);
}));

// Filtros + quantitativos
router.get('/api/assistidos/stats', auth(['admin','tecnico']), ah(async (req, res) => {
  const assistidos = await store.assistidos.all();
  const comps = await store.assistidosComparecimentos.all();
  const pend = comps.filter(c => !comparecimentoProtocolado(c));
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
  const query = req.query || {};
  let list = filtrarAssistidosBase(await store.assistidos.all(), query);
  const { dataProtocolo, usuarioProtocolo, protoDe, protoAte } = query;
  if (dataProtocolo || usuarioProtocolo || protoDe || protoAte) {
    const comps = await store.assistidosComparecimentos.all();
    const byAssistido = agruparComparecimentos(comps);
    list = list.filter(a => {
      const cs = byAssistido.get(String(a.id)) || [];
      return cs.some(c => {
        if (dataProtocolo && !String(c.dataProtocolacao || '').includes(dataProtocolo)) return false;
        if (usuarioProtocolo && !String(c.protocoladoPor || '').toLowerCase().includes(String(usuarioProtocolo).toLowerCase())) return false;
        if (protoDe && (!c.dataProtocolacao || String(c.dataProtocolacao) < protoDe)) return false;
        if (protoAte && (!c.dataProtocolacao || String(c.dataProtocolacao) > protoAte)) return false;
        return true;
      });
    });
  }
  list.sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR'));
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
  const query = req.query || {};
  const { dataProtocolo, usuarioProtocolo, protoDe, protoAte, campos } = query;
  let list = filtrarAssistidosBase(await store.assistidos.all(), query);
  const comps = await store.assistidosComparecimentos.all();
  const byAssistido = agruparComparecimentos(comps);
  if (dataProtocolo || usuarioProtocolo || protoDe || protoAte) {
    list = list.filter(a => {
      const cs = byAssistido.get(String(a.id)) || [];
      return cs.some(c => {
        if (dataProtocolo && !String(c.dataProtocolacao || '').includes(dataProtocolo)) return false;
        if (usuarioProtocolo && !String(c.protocoladoPor || '').toLowerCase().includes(String(usuarioProtocolo).toLowerCase())) return false;
        if (protoDe && (!c.dataProtocolacao || String(c.dataProtocolacao) < protoDe)) return false;
        if (protoAte && (!c.dataProtocolacao || String(c.dataProtocolacao) > protoAte)) return false;
        return true;
      });
    });
  }
  list = list.map(a => {
    const cs = byAssistido.get(String(a.id)) || [];
    const last = cs[0] || {};
    const protocolado = cs.find(comparecimentoProtocolado) || {};
    return { ...a, ultimoComparecimento: last.dataComparecimento || null, policialPlantao: last.policialPlantao || null, juntada: last.juntada || null, dataProtocolacao: protocolado.dataProtocolacao || last.dataProtocolacao || null, protocoladoPor: protocolado.protocoladoPor || last.protocoladoPor || null };
  }).sort((a, b) => (a.nome || '').localeCompare(b.nome || '', 'pt-BR'));

  const camposPermitidos = new Set(['vinculo','nome','processo','vara','localAssinatura','dataInicio','status','ultimoComparecimento','policialPlantao','juntada','dataProtocolacao','protocoladoPor']);
  const camposSel = (campos || 'vinculo,nome,processo,vara,localAssinatura,dataInicio,status,ultimoComparecimento,policialPlantao,juntada,dataProtocolacao,protocoladoPor').split(',').map(x => x.trim()).filter(k => camposPermitidos.has(k));
  if (!camposSel.length) camposSel.push('vinculo', 'nome');
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

// Pendentes de comparecimento: assistidos cujo próximo comparecimento esperado já passou
router.get('/api/assistidos/pendencias-comparecimento', auth(['admin','tecnico']), ah(async (req, res) => {
  const assistidos = await store.assistidos.all();
  const comps = await store.assistidosComparecimentos.all();
  const hoje = new Date().toISOString().slice(0,10);
  const out = [];
  const byAssistido = agruparComparecimentos(comps);
  for (const a of assistidos) {
    if (a.status && a.status !== 'ativo') continue;
    const last = (byAssistido.get(String(a.id)) || [])[0];
    const base = last ? last.dataComparecimento : (a.dataInicio || hoje);
    if (!isoDate(base)) continue;
    const dias = FREQ_DAYS[a.frequencia] || 30;
    const [y, m, d] = String(base).split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (isNaN(dt)) continue;
    const prox = new Date(dt.getTime() + dias*864e5).toISOString().slice(0,10);
    if (prox <= hoje) out.push({ ...a, ultimoComparecimento: last ? last.dataComparecimento : null, proximoEsperado: prox });
  }
  res.json(out);
}));


let lastImportStatus = { state: 'idle', total: 0, processed: 0, totalRows: 0, progress: 0, error: null, at: null };

function excelSerialToISO(v) {
  if (v == null || v === '') return '';
  if (v instanceof Date) {
    const iso = v.toISOString().slice(0,10);
    return isoDate(iso) ? iso : '';
  }
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return isoDate(s.slice(0,10)) ? s.slice(0,10) : '';
  if (/^\d{4,6}$/.test(s)) {
    const d = new Date((Number(s) - 25569) * 86400 * 1000);
    if (!isNaN(d)) return d.toISOString().slice(0,10);
  }
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    let [,dd,mm,yyyy] = m;
    if (yyyy.length === 2) yyyy = '20' + yyyy;
    const y = Number(yyyy), m = Number(mm), day = Number(dd);
    const d = new Date(Date.UTC(y, m-1, day));
    if (!isNaN(d) && d.getUTCFullYear() === y && d.getUTCMonth() === m-1 && d.getUTCDate() === day) return d.toISOString().slice(0,10);
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
  if (lastImportStatus.state === 'running') return res.status(409).json({ error: 'Já existe uma importação em andamento.' });
  lastImportStatus = { state: 'running', total: 0, processed: 0, totalRows: 0, progress: 0, error: null, at: new Date().toISOString() };
  res.json({ ok: true, assincrono: true, msg: 'Importação iniciada em background.' });
  setImmediate(async () => {
    let total = 0;
    let failedRows = 0;
    try {
      const ExcelJS = require('exceljs');
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buffer);
      let totalRows = 0;
      const allExisting = await store.assistidos.all();
      const seenVinculo = new Set(allExisting.map(a => String(a.vinculo || '').trim().toLocaleLowerCase('pt-BR')));
      {

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
              case 'status_especial': {
                if (/ARQUIVADO/i.test(u)) campos.status = 'arquivado';
                else if (/INATIVO/i.test(u)) campos.status = 'arquivado';
                break;
              }
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
            let temDado = false;
            row.eachCell((c) => { if (c.value != null && String(c.value).trim()) temDado = true; });
            if (!temDado) return;
            const campos = lerLinhaAssistido(row);
            if (!campos.vinculo || !campos.nome) return;
            if (seenVinculo.has(String(campos.vinculo).trim().toLocaleLowerCase('pt-BR'))) return;
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
            if (seenVinculo.has(String(vinculo).trim().toLocaleLowerCase('pt-BR'))) return;
            linhasParaProcessar.push({ campos, row });
          });
        }
        for (const { campos } of linhasParaProcessar) {
          const { vinculo, nome } = campos;
          if (seenVinculo.has(String(vinculo).trim().toLocaleLowerCase('pt-BR'))) continue;
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
            seenVinculo.add(String(vinculo).trim().toLocaleLowerCase('pt-BR'));
            total++;
            lastImportStatus.processed = total;
            lastImportStatus.progress = lastImportStatus.totalRows > 0 ? Math.round((total / lastImportStatus.totalRows) * 100) : 0;
            lastImportStatus.at = new Date().toISOString();
            try { await store.audit.insert({ kind:'assistido', action:'importado', personName: a.nome, ref:'assistido#'+a.id, byUser:'import', byName:'Importação Excel', byRole:'admin', summary:'Assistido importado: '+a.nome }); } catch (auditError) {}

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

          } catch (e) {
            failedRows++;
            lastImportStatus.failures = failedRows;
            lastImportStatus.lastError = String(e && e.message || e).slice(0, 250);
            console.error('import row error', e.message);
          }
        }
      }
      lastImportStatus = { state: failedRows ? 'done_with_errors' : 'done', total, failures: failedRows, error: null, at: new Date().toISOString() };
      shared.broadcast({ type: 'assistidos_import_done', total });
      console.log('[assistidos] importação concluída:', total);
    } catch (e) {
      console.error('[assistidos] importação falhou:', e && e.stack ? e.stack : e.message);
      lastImportStatus = { state: 'error', total, failures: failedRows, error: String(e && e.message ? e.message : e), at: new Date().toISOString() };
    }
  });
}));

// Visão de fluxo (kanban) — assistidos agrupados por etapa
router.get('/api/assistidos/fluxo', auth(['admin','tecnico']), ah(async (req, res) => {
  const assistidos = await store.assistidos.all();
  const comps = await store.assistidosComparecimentos.all();
  const byAssistido = agruparComparecimentos(comps);
  const etapas = { aguardando: [], compareceu: [], protocolado: [], concluido: [] };
  for (const a of assistidos) {
    if (a.status === 'concluido' || a.status === 'arquivado') { etapas.concluido.push(a); continue; }
    const cs = byAssistido.get(String(a.id)) || [];
    const last = cs[0];
    if (!last) { etapas.aguardando.push(a); continue; }
    const proto = cs.find(comparecimentoProtocolado);
    if (!comparecimentoProtocolado(last)) { etapas.compareceu.push({ ...a, ultimoComparecimento: last.dataComparecimento, compId: last.id, juntada: last.juntada, policialPlantao: last.policialPlantao, dataProtocolacao: proto ? proto.dataProtocolacao : last.dataProtocolacao, protocoladoPor: proto ? proto.protocoladoPor : last.protocoladoPor }); continue; }
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
//  Alertas automáticos por intervalo da frequência do assistido
// =====================================================================
router.get('/api/assistidos/alertas', auth(['admin','tecnico']), ah(async (req, res) => {
  const assistidos = await store.assistidos.all();
  const comps = await store.assistidosComparecimentos.all();
  const hoje = new Date().toISOString().slice(0,10);
  const hojeDate = new Date(hoje);

  const ultimoPorAssistido = agruparComparecimentos(comps);

  const alertas = [];
  for (const a of assistidos) {
    if (a.status !== 'ativo') continue;
    const historico = ultimoPorAssistido.get(String(a.id)) || [];
    const last = historico[0];
    if (!last) continue; // sem comparecimento registrado
    if (!isoDate(last.dataComparecimento)) continue;
    const ultimoProtocolo = historico.find(comparecimentoProtocolado);
    const diasDesdeProtocolacao = ultimoProtocolo && isoDate(ultimoProtocolo.dataProtocolacao)
      ? Math.floor((hojeDate - new Date(ultimoProtocolo.dataProtocolacao)) / 86400000)
      : null;

    const ultimaData = new Date(last.dataComparecimento);
    const diasDiff = Math.floor((hojeDate - ultimaDate) / (1000 * 60 * 60 * 24));
    const freqDias = FREQ_DAYS[a.frequencia] || 30;
    const diasAteProximo = freqDias - diasDiff;

    let tipo = 'EM_DIA';
    if (diasDiff > freqDias * 2) tipo = 'CRITICO';
    else if (diasDiff > freqDias) tipo = 'ATENCAO';

    // Só alerta se já passou do prazo ou está prestes a vencer (7 dias)
    if (diasDiff > freqDias || diasAteProximo <= 7) {
      alertas.push({
        assistidoId: a.id,
        nome: a.nome,
        vinculo: a.vinculo,
        tipo,
        diasUltimaJuntada: diasDesdeProtocolacao,
        diasUltimoComparecimento: diasDiff,
        diasAteProximo: diasAteProximo > 0 ? diasAteProximo : 0,
        frequencia: a.frequencia,
        ultimaJuntada: ultimoProtocolo ? ultimoProtocolo.dataProtocolacao : null,
        ultimoComparecimento: last.dataComparecimento,
        local: a.localAssinatura,
        vara: a.vara
      });
    }
  }

  alertas.sort((a, b) => {
    const ordem = { CRITICO: 0, ATENCAO: 1, EM_DIA: 2 };
    return (ordem[a.tipo] ?? 99) - (ordem[b.tipo] ?? 99);
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
//  Etiquetar/desetiquetar assistido (etiqueta personalizada com cor)
// =====================================================================
router.patch('/api/assistidos/:id/etiqueta', auth(['admin','tecnico']), ah(async (req, res) => {
  const { etiqueta, etiquetaCor } = req.body || {};
  const target = await store.assistidos.byId(req.params.id);
  if (!target) return res.status(404).json({ error: 'Assistido não encontrado' });
  const texto = String(etiqueta || '').trim().slice(0, 40);
  if (!texto) {
    const row = await store.assistidos.patch(req.params.id, { etiqueta: '', etiquetaCor: '' });
    if (!row) return res.status(404).json({ error: 'Assistido não encontrado' });
    try { await store.audit.insert({ kind:'assistido', action:'etiqueta', personName: row.nome, ref: 'assistido#'+row.id, byUser: req.auth.user, byName: req.auth.name, byRole: req.auth.role, summary: 'Etiqueta removida' }); } catch(e){}
    return res.json({ id: row.id, etiqueta: row.etiqueta, etiquetaCor: row.etiquetaCor });
  }
  const etiquetaCorValida = /^#[0-9A-Fa-f]{6}$/.test(String(etiquetaCor || '')) ? String(etiquetaCor) : '#4f46e5';
  const row = await store.assistidos.patch(req.params.id, { etiqueta: texto, etiquetaCor: etiquetaCorValida });
  if (!row) return res.status(404).json({ error: 'Assistido não encontrado' });
  try { await store.audit.insert({ kind:'assistido', action:'etiqueta', personName: row.nome, ref: 'assistido#'+row.id, byUser: req.auth.user, byName: req.auth.name, byRole: req.auth.role, summary: 'Etiqueta: ' + texto + ' (' + etiquetaCorValida + ')' }); } catch(e){}
  res.json({ id: row.id, etiqueta: row.etiqueta, etiquetaCor: row.etiquetaCor });
}));

module.exports = router;
