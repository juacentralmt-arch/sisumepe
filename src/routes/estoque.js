const express = require('express');
const shared = require('../lib/shared');
const router = express.Router();

// Todas as rotas exigem perfil tecnico ou admin
router.get('/api/estoque', shared.auth(['tecnico','admin']), shared.ah(async (req,res)=>{
  const list = await shared.store.estoque.all();
  res.json(list);
}));

router.get('/api/estoque/:contrato', shared.auth(['tecnico','admin']), shared.ah(async (req,res)=>{
  const c = String(req.params.contrato||'').toUpperCase();
  if(!['CE01','CE02'].includes(c)) return res.status(400).json({ error: 'Contrato inválido' });
  res.json(await shared.store.estoque.byContrato(c));
}));

router.post('/api/estoque/movimentar', shared.auth(['tecnico','admin']), shared.ah(async (req,res)=>{
  const { contrato, material, qtd, motivo } = req.body||{};
  const r = await shared.store.estoque.adjust({
    contrato, material, qtd, motivo,
    user: req.auth.user, userName: req.auth.name
  });
  shared.broadcast();
  res.json(r);
}));

// Histórico de movimentações
router.get('/api/estoque-mov', shared.auth(['tecnico','admin']), shared.ah(async (req,res)=>{
  const { contrato, limit } = req.query;
  let list = await shared.store.estoqueMov.all();
  if(contrato) list = list.filter(m=> String(m.contrato).toUpperCase()===String(contrato).toUpperCase());
  if(limit) list = list.slice(0, Math.min(Number(limit)||50, 200));
  res.json(list);
}));

// Relatório completo (estoque atual + movimentações + auditoria)
router.get('/api/estoque/relatorio', shared.auth(['tecnico','admin']), shared.ah(async (req,res)=>{
  const { contrato, from, to } = req.query;
  const estoque = contrato ? await shared.store.estoque.byContrato(contrato) : await shared.store.estoque.all();
  let movs = await shared.store.estoqueMov.all();
  if(contrato) movs = movs.filter(m=> String(m.contrato).toUpperCase()===String(contrato).toUpperCase());
  if(from){ const d=new Date(from); if(!isNaN(d)) movs=movs.filter(m=> new Date(m.createdAt) >= d); }
  if(to){ const d=new Date(to); if(!isNaN(d)){ d.setHours(23,59,59,999); movs=movs.filter(m=> new Date(m.createdAt) <= d); } }
  // auditoria filtrada por estoque
  let audit = await shared.store.audit.recent(500);
  audit = audit.filter(a=> String(a.kind)==='estoque');
  if(contrato) audit = audit.filter(a=> String(a.ref||'').includes(contrato));
  res.json({ estoque, movimentacoes: movs, auditoria: audit, geradoEm: new Date().toISOString() });
}));

module.exports = router;
