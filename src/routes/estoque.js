const express = require('express');
const shared = require('../lib/shared');
const estoqueIA = require('../lib/estoqueIA');
const router = express.Router();
const UNIDADES = ['UMEPE Juazeiro','UP-Juazeiro','UP-Cariri','UP-Crato','Fórum de Crato','Fórum de Jardim'];
const MATERIAIS = ['TZPR04','UPR04','FONTE04','CINTA','TRAVAS'];

// helper
function parseUnidade(u){ return String(u||'').trim() || null; }
function validaQtd(q){
  const n=Number(q);
  if(!Number.isFinite(n) || n===0) return 'Quantidade deve ser diferente de zero';
  if(Math.abs(n)>500) return 'Lote máximo 500 unidades';
  return null;
}

// Todas as rotas exigem perfil tecnico ou admin
router.get('/api/estoque', shared.auth(['tecnico','admin']), shared.ah(async (req,res)=>{
  const { contrato, unidade } = req.query;
  let list = await shared.store.estoque.all();
  if(contrato) list = list.filter(e=> String(e.contrato).toUpperCase()===String(contrato).toUpperCase());
  if(unidade) list = list.filter(e=> String(e.unidade)===String(unidade).trim());
  res.json(list);
}));

router.get('/api/estoque/unidades', shared.auth(['tecnico','admin']), shared.ah(async (req,res)=>{
  res.json(UNIDADES);
}));

router.get('/api/estoque/materiais', shared.auth(['tecnico','admin']), shared.ah(async (req,res)=>{
  res.json(MATERIAIS);
}));

router.get('/api/estoque/resumo', shared.auth(['tecnico','admin']), shared.ah(async (req,res)=>{
  const { contrato, unidade } = req.query;
  res.json(await shared.store.estoque.resumo({ contrato, unidade }));
}));

router.get('/api/estoque/alertas', shared.auth(['tecnico','admin']), shared.ah(async (req,res)=>{
  const { contrato, unidade, limite } = req.query;
  const thr = limite!=null ? Number(limite) : undefined;
  res.json(await shared.store.estoque.alertas({ contrato, unidade, limite: thr }));
}));

// Movimentação simples por unidade (com lote TZPR)
router.post('/api/estoque/movimentar', shared.auth(['tecnico','admin']), shared.ah(async (req,res)=>{
  const { contrato, material, unidade, qtd, motivo, seriais, tipo } = req.body||{};
  // compat: aceita tipo entrada/saida + qtd positiva, ou qtd com sinal
  let qtdFinal = qtd;
  if(tipo && String(tipo).toLowerCase()==='saida' && Number(qtd)>0) qtdFinal = -Math.abs(Number(qtd));
  if(tipo && String(tipo).toLowerCase()==='entrada' && Number(qtd)>0) qtdFinal = Math.abs(Number(qtd));
  const errQ=validaQtd(qtdFinal); if(errQ) return res.status(400).json({ error: errQ });
  if(!motivo || String(motivo).trim().length < 3) return res.status(400).json({ error: 'Motivo obrigatório (mín. 3 caracteres)' });
  const r = await shared.store.estoque.adjust({
    contrato, material, unidade, qtd: qtdFinal, motivo, seriais,
    user: req.auth.user, userName: req.auth.name
  });
  shared.broadcast();
  res.json(r);
}));

// Estorno de movimentação (inverte operação)
router.post('/api/estoque/estornar', shared.auth(['tecnico','admin']), shared.ah(async (req,res)=>{
  const { movId, id, motivo } = req.body||{};
  const targetId = movId || id;
  if(!targetId) return res.status(400).json({ error: 'Informe movId' });
  const r = await shared.store.estoque.estornar(targetId, { motivo: motivo||'Estorno solicitado', user: req.auth.user, userName: req.auth.name });
  shared.broadcast();
  res.json(r);
}));

// Transferência entre unidades (atômica) — lote TZPR suportado
router.post('/api/estoque/transferir', shared.auth(['tecnico','admin']), shared.ah(async (req,res)=>{
  const { contrato, material, qtd, unidadeOrigem, unidadeDestino, motivo, seriais } = req.body||{};
  if(!unidadeOrigem || !unidadeDestino) return res.status(400).json({ error: 'Informe unidadeOrigem e unidadeDestino' });
  const errQ=validaQtd(qtd); if(errQ) return res.status(400).json({ error: errQ });
  const r = await shared.store.estoque.transferir({
    contrato, material, qtd: Math.abs(Number(qtd)), unidadeOrigem, unidadeDestino, motivo, seriais,
    user: req.auth.user, userName: req.auth.name
  });
  shared.broadcast();
  res.json(r);
}));

// Seriais TZPR04/UPR04 disponíveis por contrato/unidade (10 dígitos)
router.get('/api/estoque/seriais', shared.auth(['tecnico','admin']), shared.ah(async (req,res)=>{
  const { contrato, unidade } = req.query;
  if(contrato && unidade) return res.json(await shared.store.estoqueSerial.byContratoUnidade(contrato, unidade));
  if(contrato) return res.json(await shared.store.estoqueSerial.byContrato(contrato));
  if(unidade) return res.json(await shared.store.estoqueSerial.byUnidade(unidade));
  res.json(await shared.store.estoqueSerial.all());
}));

// Histórico: estoque como estava em determinada data (suporta unidade)
router.get('/api/estoque/historico', shared.auth(['tecnico','admin']), shared.ah(async (req,res)=>{
  const { contrato, data, unidade } = req.query;
  const c = String(contrato||'CE01').toUpperCase();
  if(!['CE01','CE02'].includes(c)) return res.status(400).json({ error: 'Contrato inválido' });
  if(!data) return res.status(400).json({ error: 'Informe a data (YYYY-MM-DD)' });
  if(unidade){
    res.json(await shared.store.estoque.atDate(c, data, unidade));
  } else {
    res.json(await shared.store.estoque.atDate(c, data));
  }
}));

router.get('/api/estoque/historico/detalhado', shared.auth(['tecnico','admin']), shared.ah(async (req,res)=>{
  const { contrato, data } = req.query;
  const c = String(contrato||'CE01').toUpperCase();
  if(!['CE01','CE02'].includes(c)) return res.status(400).json({ error: 'Contrato inválido' });
  if(!data) return res.status(400).json({ error: 'Informe a data (YYYY-MM-DD)' });
  res.json(await shared.store.estoque.atDateDetailed(c, data));
}));

// Histórico de movimentações (com paginação e filtros server-side)
router.get('/api/estoque-mov', shared.auth(['tecnico','admin']), shared.ah(async (req,res)=>{
  const { contrato, unidade, material, limit, offset } = req.query;
  const n=Math.min(Math.max(Number(limit)||50,1),200);
  const off=Math.max(Number(offset)||0,0);
  let list = await shared.store.estoqueMov.all({ limit: 1000, contrato, unidade, material });
  const total=list.length;
  list=list.slice(off, off+n);
  res.json({ total, offset: off, limit: n, items: list, hasMore: off+n < total });
}));

// Compat: rota antiga ainda retorna array direto para fallback
router.get('/api/estoque/mov', shared.auth(['tecnico','admin']), shared.ah(async (req,res)=>{
  const { contrato, unidade, limit } = req.query;
  const list = await shared.store.estoqueMov.all({ limit: Math.min(Number(limit)||50,200), contrato, unidade });
  res.json(list);
}));

// Chat IA estoque — on-prem, sem LLM externo (parser determinístico)
router.post('/api/estoque/ia', shared.auth(['tecnico','admin']), shared.ah(async (req,res)=>{
  const { message, pergunta, q } = req.body||{};
  const query = String(message || pergunta || q || '').trim();
  if(!query) return res.status(400).json({ error: 'Informe message' });
  const out = await estoqueIA.answer(query, shared.store);
  // log opcional em audit como consulta IA (não persiste saldo)
  res.json({ pergunta: query, ...out, geradoEm: new Date().toISOString() });
}));
router.get('/api/estoque/ia/sugestoes', shared.auth(['tecnico','admin']), shared.ah(async (req,res)=>{
  res.json({ sugestoes: ['saldo TZPR04 UMEPE Juazeiro CE01','saldo total CE01','histórico 2026-09-24 UMEPE Juazeiro','últimas movimentações CE01','seriais TZPR04 CE01','buscar serial 1234567890','ranking CINTA CE01','estoque baixo','resumo CE01','alertas CE01','saldo por unidade CE01','unidades'] });
}));

// Relatório completo (estoque atual + movimentações + auditoria) com filtro unidade
router.get('/api/estoque/relatorio', shared.auth(['tecnico','admin']), shared.ah(async (req,res)=>{
  const { contrato, unidade, from, to } = req.query;
  // valida contrato apenas se informado
  if(contrato && !['CE01','CE02'].includes(String(contrato).toUpperCase())) return res.status(400).json({ error: 'Contrato inválido' });
  let estoque = contrato ? await shared.store.estoque.byContrato(contrato) : await shared.store.estoque.all();
  if(unidade) estoque = estoque.filter(e=> String(e.unidade)===String(unidade).trim());
  let movs = await shared.store.estoqueMov.all();
  if(contrato) movs = movs.filter(m=> String(m.contrato).toUpperCase()===String(contrato).toUpperCase());
  if(unidade) movs = movs.filter(m=> String(m.unidade)===String(unidade).trim() || String(m.unidadeDestino)===String(unidade).trim());
  if(from){ const d=new Date(from); if(!isNaN(d)) movs=movs.filter(m=> new Date(m.createdAt) >= d); }
  if(to){ const d=new Date(to); if(!isNaN(d)){ d.setHours(23,59,59,999); movs=movs.filter(m=> new Date(m.createdAt) <= d); } }
  let audit = await shared.store.audit.recent(500);
  audit = audit.filter(a=> String(a.kind)==='estoque');
  if(contrato) audit = audit.filter(a=> String(a.ref||'').includes(contrato));
  if(unidade) audit = audit.filter(a=> String(a.ref||'').includes(String(unidade).trim()) || String(a.summary||'').includes(String(unidade).trim()));
  res.json({ estoque, movimentacoes: movs, auditoria: audit, geradoEm: new Date().toISOString(), unidades: UNIDADES });
}));

// Rota paramétrica por contrato - DEVE ficar por último entre /api/estoque/* para não sombrear /relatorio, /seriais, /historico, etc.
router.get('/api/estoque/:contrato', shared.auth(['tecnico','admin']), shared.ah(async (req,res)=>{
  const c = String(req.params.contrato||'').toUpperCase();
  if(!['CE01','CE02'].includes(c)) return res.status(400).json({ error: 'Contrato inválido' });
  const { unidade } = req.query;
  if(unidade){
    res.json(await shared.store.estoque.byContratoUnidade(c, unidade));
  } else {
    res.json(await shared.store.estoque.byContrato(c));
  }
}));

module.exports = router;
