const express = require('express');
const shared = require('../lib/shared');
const estoqueIA = require('../lib/estoqueIA');
const { popularEstoque } = require('../lib/estoqueSeed');
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
const storeMod = require('../../store');
const normalizeSistema = storeMod.normalizeSistema || ((s)=> String(s||'').toLowerCase().trim() || null);
const normalizeContrato = storeMod.normalizeContrato || ((c)=> String(c||'').toUpperCase().trim() || null);
const contratoLabel = storeMod.contratoLabel || ((c)=> String(c||'').toUpperCase());
const contratosDoSistema = storeMod.contratosDoSistema || (()=> ['CE01','CE02']);
const CONTRATO_INFINITY = storeMod.CONTRATO_INFINITY || 'INF';
function getSistema(req){
  // admin pode especificar ?sistema=spacecom|infinity|all via query ou body, tecnico é forçado ao seu sistema
  const qSistema = (req.query && req.query.sistema) || (req.body && req.body.sistema);
  const userSistema = req.auth && req.auth.sistema ? req.auth.sistema : null;
  // se admin e especificar sistema, usa; se admin e não especificar, retorna null (todos)
  if(req.auth && req.auth.role==='admin'){
    if(qSistema){
      const s=String(qSistema).toLowerCase();
      if(s==='all' || s==='todos') return null;
      return normalizeSistema(s) || null;
    }
    return null;
  }
  // tecnico: usa seu sistema, ignora query
  if(userSistema) return normalizeSistema(userSistema) || 'spacecom';
  return 'spacecom';
}
function getSistemaFromUser(user){
  // helper para pegar sistema do user object (para auth)
  if(!user) return 'spacecom';
  if(user.sistema) return normalizeSistema(user.sistema) || 'spacecom';
  if(storeMod.getUserSistema) return storeMod.getUserSistema(user) || 'spacecom';
  return 'spacecom';
}
// Resolve contrato respeitando o sistema: infinity sempre INF (unificado)
function resolveContrato(contrato, sistema){
  if(sistema){
    const sis=normalizeSistema(sistema);
    if(sis==='infinity') return CONTRATO_INFINITY;
    if(sis==='spacecom'){
      if(!contrato) return null;
      const c=String(contrato).toUpperCase().trim();
      return (c==='CE01'||c==='CE02') ? c : c; // deixa validação posterior decidir
    }
  }
  // admin sem sistema definido (vendo tudo): normaliza aliases
  if(!contrato) return null;
  return normalizeContrato(contrato, sistema);
}
function contratosValidos(sistema){
  if(!sistema) return ['CE01','CE02',CONTRATO_INFINITY];
  const sis=normalizeSistema(sistema);
  if(sis==='infinity') return [CONTRATO_INFINITY];
  return ['CE01','CE02'];
}

// Todas as rotas exigem perfil tecnico ou admin
router.get('/api/estoque', shared.auth(['tecnico','admin']), shared.ah(async (req,res)=>{
  const { contrato, unidade, sistema } = req.query;
  const effectiveSistema = req.auth.role==='admin' ? (sistema ? normalizeSistema(sistema) : null) : getSistema(req);
  let list = await shared.store.estoque.all(effectiveSistema);
  const c = resolveContrato(contrato, effectiveSistema);
  if(c) list = list.filter(e=> String(e.contrato).toUpperCase()===c);
  if(unidade) list = list.filter(e=> String(e.unidade)===String(unidade).trim());
  res.json(list);
}));

// Contratos disponíveis por sistema (spacecom: CE01/CE02, infinity: Estoque Infinity)
router.get('/api/estoque/contratos', shared.auth(['tecnico','admin']), shared.ah(async (req,res)=>{
  const effectiveSistema = req.auth.role==='admin' ? (req.query.sistema ? normalizeSistema(req.query.sistema) : null) : getSistema(req);
  if(!effectiveSistema || effectiveSistema==='all'){
    res.json([
      { sistema:'spacecom', value:'CE01', label:'CE01' },
      { sistema:'spacecom', value:'CE02', label:'CE02' },
      { sistema:'infinity', value:CONTRATO_INFINITY, label:'Estoque Infinity' }
    ]);
    return;
  }
  if(effectiveSistema==='infinity'){
    res.json([{ sistema:'infinity', value:CONTRATO_INFINITY, label:'Estoque Infinity' }]);
    return;
  }
  res.json([
    { sistema:'spacecom', value:'CE01', label:'CE01' },
    { sistema:'spacecom', value:'CE02', label:'CE02' }
  ]);
}));

router.get('/api/estoque/unidades', shared.auth(['tecnico','admin']), shared.ah(async (req,res)=>{
  res.json(UNIDADES);
}));

router.get('/api/estoque/materiais', shared.auth(['tecnico','admin']), shared.ah(async (req,res)=>{
  res.json(MATERIAIS);
}));

router.get('/api/estoque/resumo', shared.auth(['tecnico','admin']), shared.ah(async (req,res)=>{
  const { contrato, unidade } = req.query;
  const sistema = req.auth.role==='admin' ? (req.query.sistema ? normalizeSistema(req.query.sistema) : null) : getSistema(req);
  res.json(await shared.store.estoque.resumo({ contrato: resolveContrato(contrato, sistema), unidade, sistema }));
}));

router.get('/api/estoque/alertas', shared.auth(['tecnico','admin']), shared.ah(async (req,res)=>{
  const { contrato, unidade, limite } = req.query;
  const thr = limite!=null ? Number(limite) : undefined;
  const sistema = req.auth.role==='admin' ? (req.query.sistema ? normalizeSistema(req.query.sistema) : null) : getSistema(req);
  res.json(await shared.store.estoque.alertas({ contrato: resolveContrato(contrato, sistema), unidade, limite: thr, sistema }));
}));

// Movimentação simples por unidade (com lote TZPR)
router.post('/api/estoque/movimentar', shared.auth(['tecnico','admin']), shared.ah(async (req,res)=>{
  const { contrato, material, unidade, qtd, motivo, seriais, tipo, sistema } = req.body||{};
  // compat: aceita tipo entrada/saida + qtd positiva, ou qtd com sinal
  let qtdFinal = qtd;
  if(tipo && String(tipo).toLowerCase()==='saida' && Number(qtd)>0) qtdFinal = -Math.abs(Number(qtd));
  if(tipo && String(tipo).toLowerCase()==='entrada' && Number(qtd)>0) qtdFinal = Math.abs(Number(qtd));
  const errQ=validaQtd(qtdFinal); if(errQ) return res.status(400).json({ error: errQ });
  if(!motivo || String(motivo).trim().length < 3) return res.status(400).json({ error: 'Motivo obrigatório (mín. 3 caracteres)' });
  const sis = req.auth.role==='admin' ? (sistema ? normalizeSistema(sistema) : null) : getSistema(req);
  const effectiveSistema = sis || getSistema(req) || 'spacecom';
  const contratoNorm = resolveContrato(contrato, effectiveSistema);
  if(effectiveSistema==='infinity' && contratoNorm!==CONTRATO_INFINITY) return res.status(400).json({ error: 'Infinity usa contrato único: Estoque Infinity' });
  if(effectiveSistema==='spacecom' && contratoNorm && !['CE01','CE02'].includes(contratoNorm)) return res.status(400).json({ error: 'Contrato inválido (CE01/CE02)' });
  if(effectiveSistema==='spacecom' && !contratoNorm) return res.status(400).json({ error: 'Informe o contrato (CE01/CE02)' });
  const r = await shared.store.estoque.adjust({
    sistema: effectiveSistema, contrato: contratoNorm, material, unidade, qtd: qtdFinal, motivo, seriais,
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
  const { contrato, material, qtd, unidadeOrigem, unidadeDestino, motivo, seriais, sistema } = req.body||{};
  if(!unidadeOrigem || !unidadeDestino) return res.status(400).json({ error: 'Informe unidadeOrigem e unidadeDestino' });
  const errQ=validaQtd(qtd); if(errQ) return res.status(400).json({ error: errQ });
  const sis = req.auth.role==='admin' ? (sistema ? normalizeSistema(sistema) : null) : getSistema(req);
  const effectiveSistema = sis || getSistema(req) || 'spacecom';
  const contratoNorm = resolveContrato(contrato, effectiveSistema);
  if(effectiveSistema==='infinity' && contratoNorm!==CONTRATO_INFINITY) return res.status(400).json({ error: 'Infinity usa contrato único: Estoque Infinity' });
  if(effectiveSistema==='spacecom' && contratoNorm && !['CE01','CE02'].includes(contratoNorm)) return res.status(400).json({ error: 'Contrato inválido (CE01/CE02)' });
  if(effectiveSistema==='spacecom' && !contratoNorm) return res.status(400).json({ error: 'Informe o contrato (CE01/CE02)' });
  const r = await shared.store.estoque.transferir({
    sistema: effectiveSistema, contrato: contratoNorm, material, qtd: Math.abs(Number(qtd)), unidadeOrigem, unidadeDestino, motivo, seriais,
    user: req.auth.user, userName: req.auth.name
  });
  shared.broadcast();
  res.json(r);
}));

// Seriais TZPR04/UPR04 disponíveis por contrato/unidade (10 dígitos)
router.get('/api/estoque/seriais', shared.auth(['tecnico','admin']), shared.ah(async (req,res)=>{
  const { contrato, unidade } = req.query;
  const sistema = req.auth.role==='admin' ? (req.query.sistema ? normalizeSistema(req.query.sistema) : null) : getSistema(req);
  const opts = sistema ? { sistema } : {};
  const c = contrato ? resolveContrato(contrato, sistema) : null;
  if(c && unidade) return res.json(await shared.store.estoqueSerial.all({ ...opts, contrato: c, unidade }));
  if(c) return res.json(await shared.store.estoqueSerial.all({ ...opts, contrato: c }));
  if(unidade) return res.json(await shared.store.estoqueSerial.all({ ...opts, unidade }));
  res.json(await shared.store.estoqueSerial.all(opts));
}));

// Histórico: estoque como estava em determinada data (suporta unidade e sistema; infinity = Estoque Infinity único)
router.get('/api/estoque/historico', shared.auth(['tecnico','admin']), shared.ah(async (req,res)=>{
  const { contrato, data, unidade } = req.query;
  const sistema = req.auth.role==='admin' ? (req.query.sistema ? normalizeSistema(req.query.sistema) : null) : getSistema(req);
  const effectiveSistema = sistema || getSistema(req);
  const c = resolveContrato(contrato, effectiveSistema) || (effectiveSistema==='infinity' ? CONTRATO_INFINITY : 'CE01');
  if(!contratosValidos(effectiveSistema).includes(c)) return res.status(400).json({ error: effectiveSistema==='infinity' ? 'Infinity usa contrato único: Estoque Infinity' : 'Contrato inválido (CE01/CE02)' });
  if(!data) return res.status(400).json({ error: 'Informe a data (YYYY-MM-DD)' });
  if(unidade){
    res.json(await shared.store.estoque.atDate(c, data, unidade, effectiveSistema));
  } else {
    res.json(await shared.store.estoque.atDate(c, data, null, effectiveSistema));
  }
}));

router.get('/api/estoque/historico/detalhado', shared.auth(['tecnico','admin']), shared.ah(async (req,res)=>{
  const { contrato, data } = req.query;
  const sistema = req.auth.role==='admin' ? (req.query.sistema ? normalizeSistema(req.query.sistema) : null) : getSistema(req);
  const effectiveSistema = sistema || getSistema(req);
  const c = resolveContrato(contrato, effectiveSistema) || (effectiveSistema==='infinity' ? CONTRATO_INFINITY : 'CE01');
  if(!contratosValidos(effectiveSistema).includes(c)) return res.status(400).json({ error: effectiveSistema==='infinity' ? 'Infinity usa contrato único: Estoque Infinity' : 'Contrato inválido (CE01/CE02)' });
  if(!data) return res.status(400).json({ error: 'Informe a data (YYYY-MM-DD)' });
  res.json(await shared.store.estoque.atDateDetailed(c, data, effectiveSistema));
}));

// Histórico de movimentações (com paginação e filtros server-side)
router.get('/api/estoque-mov', shared.auth(['tecnico','admin']), shared.ah(async (req,res)=>{
  const { contrato, unidade, material, limit, offset } = req.query;
  const n=Math.min(Math.max(Number(limit)||50,1),200);
  const off=Math.max(Number(offset)||0,0);
  const sistema = req.auth.role==='admin' ? (req.query.sistema ? normalizeSistema(req.query.sistema) : null) : getSistema(req);
  const effectiveSistema = sistema || getSistema(req);
  // limit:'all' — o total informado tem de refletir o histórico inteiro, não só as 1000 últimas
  let list = await shared.store.estoqueMov.all({ limit: 'all', contrato: resolveContrato(contrato, effectiveSistema), unidade, material, sistema: effectiveSistema });
  const total=list.length;
  list=list.slice(off, off+n);
  res.json({ total, offset: off, limit: n, items: list, hasMore: off+n < total });
}));

// Compat: rota antiga ainda retorna array direto para fallback
router.get('/api/estoque/mov', shared.auth(['tecnico','admin']), shared.ah(async (req,res)=>{
  const { contrato, unidade, limit } = req.query;
  const sistema = req.auth.role==='admin' ? (req.query.sistema ? normalizeSistema(req.query.sistema) : null) : getSistema(req);
  const effectiveSistema = sistema || getSistema(req);
  const list = await shared.store.estoqueMov.all({ limit: Math.min(Number(limit)||50,200), contrato: resolveContrato(contrato, effectiveSistema), unidade, sistema: effectiveSistema });
  res.json(list);
}));

// Chat IA estoque — on-prem, sem LLM externo (parser determinístico)
router.post('/api/estoque/ia', shared.auth(['tecnico','admin']), shared.ah(async (req,res)=>{
  const { message, pergunta, q } = req.body||{};
  const query = String(message || pergunta || q || '').trim();
  if(!query) return res.status(400).json({ error: 'Informe message' });
  const sistema = req.auth.role==='admin' ? (req.body.sistema || req.query.sistema ? normalizeSistema(req.body.sistema || req.query.sistema) : null) : getSistema(req);
  const effectiveSistema = sistema || getSistema(req);
  // passa sistema e usuário para contexto
  const out = await estoqueIA.answer(query, shared.store, { sistema: effectiveSistema, user: req.auth.user });
  // log opcional em audit como consulta IA (não persiste saldo)
  res.json({ pergunta: query, ...out, geradoEm: new Date().toISOString(), sistema: effectiveSistema });
}));
router.get('/api/estoque/ia/sugestoes', shared.auth(['tecnico','admin']), shared.ah(async (req,res)=>{
  res.json({ sugestoes: ['saldo TZPR04 UMEPE Juazeiro CE01','saldo total CE01','histórico 2026-09-24 UMEPE Juazeiro','últimas movimentações CE01','seriais TZPR04 CE01','buscar serial 1234567890','ranking CINTA CE01','estoque baixo','resumo CE01','alertas CE01','saldo por unidade CE01','unidades'] });
}));

// Seed antigo de demonstração (só modo arquivo, sem transferências entre
// locais). Mantido para compatibilidade; prefira POST /api/estoque/seed.
router.post('/api/estoque/seed-demo', shared.auth(['admin']), shared.ah(async (req,res)=>{
  const { force, sistema } = req.query;
  const seedSistema = normalizeSistema(sistema) || 'spacecom';
  const movs = await shared.store.estoqueMov.all();
  if(movs.length > 5 && force!=='1') return res.json({ ok:false, msg: `Já existem ${movs.length} movimentações. Use ?force=1 para forçar.` });
  // Se já tem dados e não forçado, não faz nada
  function genSeriais(base, qtd){ const s=Number(base); return Array.from({length:qtd},(_,i)=> String(s+i).padStart(10,'0')); }
  function daysAgoISO(n){ const d=new Date(); d.setDate(d.getDate()-n); d.setHours(10,Math.floor(Math.random()*60),0,0); return d.toISOString(); }
  const UNIDADES_SEED = UNIDADES;
  let tzprNext=4315023610, uprNext=4714569930;
  // Se já existe histórico massivo, não recria os 16 iniciais já patchados
  const opsBase = [
    {dias:30, contrato:'CE01', material:'FONTE04', unidade:'UMEPE Juazeiro', qtd:15, motivo:'Recebimento 30d atrás - FONTE04 lote inicial'},
    {dias:28, contrato:'CE01', material:'CINTA', unidade:'UMEPE Juazeiro', qtd:30, motivo:'Recebimento 28d atrás - CINTA'},
    {dias:25, contrato:'CE01', material:'TRAVAS', unidade:'UMEPE Juazeiro', qtd:40, motivo:'Recebimento 25d atrás - TRAVAS'},
    {dias:21, contrato:'CE01', material:'FONTE04', unidade:'UP-Cariri', qtd:10, motivo:'Recebimento 21d atrás - FONTE04 UP-Cariri'},
    {dias:18, contrato:'CE01', material:'CINTA', unidade:'UP-Cariri', qtd:20, motivo:'Recebimento 18d atrás - CINTA UP-Cariri'},
    {dias:14, contrato:'CE01', material:'UPR04', unidade:'UMEPE Juazeiro', qtd:12, motivo:'Recebimento 14d atrás - UPR04 lote', seriais: genSeriais('4714569895',12)},
    {dias:10, contrato:'CE01', material:'UPR04', unidade:'UP-Cariri', qtd:6, motivo:'Recebimento 10d atrás - UPR04 UP-Cariri', seriais: genSeriais('4714569907',6)},
    {dias:7, contrato:'CE01', material:'TZPR04', unidade:'UMEPE Juazeiro', qtd:15, motivo:'Recebimento 7d atrás - TZPR04 lote', seriais: genSeriais('4315023568',15)},
    {dias:5, contrato:'CE01', material:'TZPR04', unidade:'UP-Cariri', qtd:8, motivo:'Recebimento 5d atrás - TZPR04 UP-Cariri', seriais: genSeriais('4315023583',8)},
    {dias:4, contrato:'CE01', material:'TZPR04', unidade:'UP-Crato', qtd:6, motivo:'Recebimento 4d atrás - TZPR04 UP-Crato', seriais: genSeriais('4315023591',6)},
    {dias:3, contrato:'CE01', material:'UPR04', unidade:'UP-Crato', qtd:4, motivo:'Recebimento 3d atrás - UPR04 UP-Crato', seriais: genSeriais('4714569913',4)},
    {dias:2, contrato:'CE01', material:'TZPR04', unidade:'UMEPE Juazeiro', qtd:-3, motivo:'Saída 2d atrás - instalação', seriais: genSeriais('4315023568',3)},
    {dias:1, contrato:'CE01', material:'UPR04', unidade:'UMEPE Juazeiro', qtd:-2, motivo:'Saída 1d atrás - instalação UPR', seriais: genSeriais('4714569895',2)},
    {dias:1, contrato:'CE01', material:'FONTE04', unidade:'UMEPE Juazeiro', qtd:-4, motivo:'Saída 1d atrás - uso FONTE'},
    {dias:12, contrato:'CE02', material:'TZPR04', unidade:'UMEPE Juazeiro', qtd:10, motivo:'CE02 - TZPR 12d atrás', seriais: genSeriais('4315023600',10)},
    {dias:8, contrato:'CE02', material:'UPR04', unidade:'UMEPE Juazeiro', qtd:8, motivo:'CE02 - UPR 8d atrás', seriais: genSeriais('4714569920',8)},
  ];
  // Gera mais 50 aleatórios para totalizar ~60 dias
  for(let d=60; d>=1; d--){
    if([30,28,25,21,18,14,12,10,8,7,5,4,3,2,1].includes(d)) continue;
    if(Math.random()<0.7) continue;
    const unidade = UNIDADES_SEED[Math.floor(Math.random()*UNIDADES_SEED.length)];
    const contrato = Math.random()<0.8 ? 'CE01' : 'CE02';
    const r=Math.random();
    let material, qtd, seriais=[];
    if(r<0.25){ material='TZPR04'; qtd=1+Math.floor(Math.random()*3); seriais=genSeriais(String(tzprNext), Math.abs(qtd)); tzprNext+=Math.abs(qtd); }
    else if(r<0.45){ material='UPR04'; qtd=1+Math.floor(Math.random()*3); seriais=genSeriais(String(uprNext), Math.abs(qtd)); uprNext+=Math.abs(qtd); }
    else if(r<0.65){ material='FONTE04'; qtd=2+Math.floor(Math.random()*5); }
    else if(r<0.82){ material='CINTA'; qtd=5+Math.floor(Math.random()*8); }
    else { material='TRAVAS'; qtd=8+Math.floor(Math.random()*10); }
    if(Math.random()<0.3) qtd=-Math.abs(qtd); else qtd=Math.abs(qtd);
    opsBase.push({dias:d, contrato, material, unidade, qtd, motivo:`Auto ${d}d ${material} ${unidade}`, seriais});
  }
  opsBase.sort((a,b)=> b.dias - a.dias);
  let ok=0, skip=0;
  for(const op of opsBase){
    try{
      const res = await shared.store.estoque.adjust({ sistema: seedSistema, contrato: resolveContrato(op.contrato, seedSistema), material:op.material, unidade:op.unidade, qtd:op.qtd, motivo:op.motivo, seriais:op.seriais||[], user:req.auth.user, userName:req.auth.name });
      // backdate
      const pastISO = daysAgoISO(op.dias);
      // patch direto no store (file ou supabase via fallback)
      try{
        // tenta atualizar via db.json se for file, ou via supabase se falhar ignora
        const fs=require('fs'); const path=require('path');
        const dbPath=path.join(__dirname,'..','..','db.json');
        if(fs.existsSync(dbPath)){
          let j=JSON.parse(fs.readFileSync(dbPath,'utf8'));
          let mov=j.estoqueMov.find(m=> m.id===res.mov.id);
          if(mov){ mov.createdAt=pastISO; fs.writeFileSync(dbPath, JSON.stringify(j,null,2)); }
        }
      }catch(e){}
      // também tenta atualizar no supabase se estiver em modo supabase
      try{
        if(shared.store.mode==='supabase'){
          const supa=require('../../store').supa || null;
          // não temos acesso direto, mas o ajuste já criou com now, vamos tentar update via store internal
        }
      }catch(e){}
      ok++;
    }catch(e){ skip++; }
  }
  // Re-patch datas corretamente
  try{
    const fs=require('fs'); const path=require('path');
    const dbPath=path.join(__dirname,'..','..','db.json');
    if(fs.existsSync(dbPath)){
      let j=JSON.parse(fs.readFileSync(dbPath,'utf8'));
      function parseDias(motivo){ const m=String(motivo).match(/(\d+)d/); return m? Number(m[1]) : null; }
      let now=new Date(); now.setHours(10,0,0,0);
      j.estoqueMov.forEach(m=>{
        const d=parseDias(m.motivo||'');
        if(d!==null){ const dd=new Date(now); dd.setDate(dd.getDate()-d); dd.setMinutes(Math.floor(Math.random()*60)); m.createdAt=dd.toISOString(); }
      });
      fs.writeFileSync(dbPath, JSON.stringify(j,null,2));
    }
  }catch(e){}
  shared.broadcast();
  const resumo = await shared.store.estoque.resumo({contrato: seedSistema==='infinity' ? CONTRATO_INFINITY : 'CE01', sistema: seedSistema});
  res.json({ ok:true, inseridos: ok, skips: skip, total: (await shared.store.estoqueMov.all({ sistema: seedSistema })).length, resumo, sistema: seedSistema });
}));

// Seed completo (admin): até 300 dias de histórico em todos os locais e
// sistemas, com adições, saídas E transferências entre locais, gravando as
// datas reais — funciona igual em modo arquivo e no Supabase.
//   ?dias=N      janela (1..300, padrão 60)
//   ?force=1     libera em base que já tem movimentações
//   ?lote=0      pula o lote inicial (só movimentações)
//   ?assincrono=1 responde na hora e avisa quem está online (SSE) ao terminar
let seedEstoqueRodando = false;
router.post('/api/estoque/seed', shared.auth(['admin']), shared.ah(async (req,res)=>{
  const { force, dias, semente, lote, assincrono } = req.query;
  const janela = Math.min(Math.max(Math.round(Number(dias)||60),1),300);
  const existentes = await shared.store.estoqueMov.all({ limit: 6 });
  if(existentes.length > 5 && force!=='1')
    return res.json({ ok:false, msg:`Já existem movimentações no estoque. Use ?force=1 para acrescentar mais ${janela} dias de histórico.` });
  const opcoes = {
    dias: janela,
    semente: Number(semente)||undefined,
    semLote: lote==='0',
    user: req.auth.user,
    userName: req.auth.name || req.auth.user,
  };
  const log = m=> console.log('[seed-estoque]', m);
  if(assincrono==='1'){
    if(seedEstoqueRodando) return res.json({ ok:false, msg:'Já existe uma carga de estoque em andamento.' });
    seedEstoqueRodando = true;
    popularEstoque({ ...opcoes, log })
      .then(r=>{ console.log('[seed-estoque] concluída:', JSON.stringify(r.stats)); shared.broadcast(); })
      .catch(e=> console.error('[seed-estoque] falhou:', e.message))
      .finally(()=>{ seedEstoqueRodando = false; });
    return res.json({ ok:true, assincrono:true, dias:janela, msg:'Carga iniciada — o estoque e a auditoria são atualizados ao terminar.' });
  }
  const rel = await popularEstoque({ ...opcoes, log });
  shared.broadcast();
  res.json(rel);
}));

// Relatório completo (estoque atual + movimentações + auditoria) com filtro unidade e sistema
router.get('/api/estoque/relatorio', shared.auth(['tecnico','admin']), shared.ah(async (req,res)=>{
  const { contrato, unidade, from, to } = req.query;
  const sistema = req.auth.role==='admin' ? (req.query.sistema ? normalizeSistema(req.query.sistema) : null) : getSistema(req);
  const effectiveSistema = sistema || getSistema(req);
  // valida contrato conforme o sistema (infinity = INF único)
  const c = resolveContrato(contrato, effectiveSistema);
  if(contrato && c && !contratosValidos(effectiveSistema).includes(c)) return res.status(400).json({ error: effectiveSistema==='infinity' ? 'Infinity usa contrato único: Estoque Infinity' : 'Contrato inválido (CE01/CE02)' });
  let estoque = c ? await shared.store.estoque.byContrato(c, effectiveSistema) : await shared.store.estoque.all(effectiveSistema);
  if(unidade) estoque = estoque.filter(e=> String(e.unidade)===String(unidade).trim());
  // limit:'all' — o filtro por período precisa enxergar o histórico completo
  let movs = await shared.store.estoqueMov.all({ sistema: effectiveSistema, limit: 'all' });
  if(c) movs = movs.filter(m=> String(m.contrato).toUpperCase()===c);
  if(unidade) movs = movs.filter(m=> String(m.unidade)===String(unidade).trim() || String(m.unidadeDestino)===String(unidade).trim());
  if(from){ const d=new Date(from); if(!isNaN(d)) movs=movs.filter(m=> new Date(m.createdAt) >= d); }
  if(to){ const d=new Date(to); if(!isNaN(d)){ d.setHours(23,59,59,999); movs=movs.filter(m=> new Date(m.createdAt) <= d); } }
  let audit = await shared.store.audit.recent(500);
  audit = audit.filter(a=> String(a.kind)==='estoque');
  if(effectiveSistema) audit = audit.filter(a=> String(a.ref||'').toLowerCase().includes(effectiveSistema) || String(a.summary||'').toLowerCase().includes(effectiveSistema));
  if(c) audit = audit.filter(a=> String(a.ref||'').includes(c) || String(a.ref||'').includes(contratoLabel(c)));
  if(unidade) audit = audit.filter(a=> String(a.ref||'').includes(String(unidade).trim()) || String(a.summary||'').includes(String(unidade).trim()));
  // limita o corpo (relatórios longos) mas informa o total real do período
  res.json({ estoque, movimentacoes: movs.slice(0, 5000), totalMovimentacoes: movs.length, auditoria: audit, geradoEm: new Date().toISOString(), unidades: UNIDADES, sistema: effectiveSistema, contrato: c||null, contratoLabel: c?contratoLabel(c):null });
}));

// Rota paramétrica por contrato - DEVE ficar por último entre /api/estoque/* para não sombrear /relatorio, /seriais, /historico, etc.
// Aceita CE01/CE02 (spacecom) e INF/Estoque Infinity (infinity)
router.get('/api/estoque/:contrato', shared.auth(['tecnico','admin']), shared.ah(async (req,res)=>{
  const sistema = req.auth.role==='admin' ? (req.query.sistema ? normalizeSistema(req.query.sistema) : null) : getSistema(req);
  const effectiveSistema = sistema || getSistema(req);
  const c = resolveContrato(req.params.contrato, effectiveSistema) || normalizeContrato(req.params.contrato, effectiveSistema);
  if(!c || !contratosValidos(effectiveSistema).includes(c)) return res.status(400).json({ error: effectiveSistema==='infinity' ? 'Infinity usa contrato único: Estoque Infinity' : 'Contrato inválido (CE01/CE02)' });
  const { unidade } = req.query;
  if(unidade){
    res.json(await shared.store.estoque.byContratoUnidade(c, unidade, effectiveSistema));
  } else {
    res.json(await shared.store.estoque.byContrato(c, effectiveSistema));
  }
}));

module.exports = router;
