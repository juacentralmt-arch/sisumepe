const express = require('express');
const { gerarTermoPDF, gerarTermoRecolhimentoPDF } = require('../lib/termosPdf');
const shared = require('../lib/shared');
const { store, ah, auth, broadcast, issueToken, loginRateLimit, isHash, upload, mapFiles, sortQueue, enrich, enrichAll, ticketOwnerOf, infinityBlocked, PERSON_LABELS, MOTIVOS_OK, getGoogleConfig, makeOAuthClient, getAuthedClientForUser, syncAgendaToGoogle, pendingGoogleStates, ROOT, PORT } = shared;
const router = express.Router();

// Termos - Listagem de Equipamentos
router.get('/api/termos', auth(['tecnico']), ah(async (req,res)=>{
  const list = await store.termos.allByUser(req.auth.user);
  res.json(list);
}));
router.post('/api/termos', auth(['tecnico']), ah(async (req,res)=>{
  const { tipo, dataEnvio, destinatario, equipamentos, respEntrega, respRecebimento, dados, modelo } = req.body||{};
  const t = (tipo === 'recolhimento') ? 'recolhimento' : 'listagem';
  if(t === 'recolhimento'){
    const d = (dados && typeof dados === 'object') ? dados : {};
    const eq = Array.isArray(d.equipamentos) ? d.equipamentos.slice(0,60) : [];
    const normEq = eq.map(r=>{
      const checks = {};
      ['ladoExterno','cinta','travas','ladoInterno','abaDireita','abaEsquerda'].forEach(k=>{
        const v = r.checks ? r.checks[k] : null;
        checks[k] = (v === true || v === 'sim') ? true : (v === false || v === 'nao') ? false : null;
      });
      return { numero: String(r.numero||'').trim().slice(0,30), danificado: !!r.danificado, checks };
    }).filter(r=> r.numero);
    if(!normEq.length) return res.status(400).json({ error: 'Adicione ao menos um equipamento com número' });
    const termo = await store.termos.insert({
      user: req.auth.user, tipo: 'recolhimento',
      dataEnvio: dataEnvio ? new Date(dataEnvio).toISOString().slice(0,10) : new Date().toISOString().slice(0,10),
      destinatario: '', equipamentos: [],
      respEntrega: '', respRecebimento: '',
      dados: {
        itensRecebidos: String(d.itensRecebidos||'').trim().slice(0,200),
        dataHora: d.dataHora ? new Date(d.dataHora).toISOString() : new Date().toISOString(),
        equipamentos: normEq,
        descricao: String(d.descricao||'').trim().slice(0,2000),
        policialNome: String(d.policialNome||'').trim().slice(0,80),
        policialMat: String(d.policialMat||'').trim().slice(0,30),
        tecnicoNome: String(d.tecnicoNome||'').trim().slice(0,80),
        tecnicoMat: String(d.tecnicoMat||'').trim().slice(0,30)
      }
    });
    broadcast();
    return res.status(201).json(termo);
  }
  // Listagem permite tudo em branco (destinatário e equipamentos opcionais)
  // modelo: 'tzpr' (TZPR04+FONTE04+CINTA+TRAVA) ou 'upr' (UPR04+FONTE04, sem cinta/trava)
  const modeloList = (modelo === 'upr') ? 'upr' : 'tzpr';
  const eqIn = Array.isArray(equipamentos) ? equipamentos.slice(0, 30) : [];
  // normaliza somente linhas preenchidas (até 30)
  const norm = modeloList === 'upr'
    ? eqIn.map(r => ({
        upr04: String((r && (r.upr04 ?? r.tzpr04)) || '').trim().slice(0, 30),
        fonte04: String((r && r.fonte04) || '').trim().slice(0, 30)
      })).filter(r => r.upr04 || r.fonte04)
    : eqIn.map(r => ({
        tzpr04: String((r && r.tzpr04) || '').trim().slice(0, 30),
        fonte04: String((r && r.fonte04) || '').trim().slice(0, 30),
        cinta: String((r && r.cinta) || '').trim().slice(0, 30),
        trava: String((r && r.trava) || '').trim().slice(0, 30)
      })).filter(r => r.tzpr04 || r.fonte04 || r.cinta || r.trava);
  const termo = await store.termos.insert({
    user: req.auth.user, tipo: 'listagem',
    dataEnvio: dataEnvio ? new Date(dataEnvio).toISOString().slice(0,10) : null,
    destinatario: String(destinatario).trim().slice(0,120),
    equipamentos: norm,
    respEntrega: String(respEntrega||'').trim().slice(0,80),
    respRecebimento: String(respRecebimento||'').trim().slice(0,80),
    dados: { modelo: modeloList }
  });
  broadcast();
  res.status(201).json(termo);
}));
router.get('/api/termos/:id', auth(['tecnico']), ah(async (req,res)=>{
  const t = await store.termos.byId(req.params.id);
  if(!t) return res.status(404).json({ error: 'Termo não encontrado' });
  if(t.user !== req.auth.user) return res.status(403).json({ error: 'Sem permissão' });
  res.json(t);
}));
router.patch('/api/termos/:id', auth(['tecnico']), ah(async (req,res)=>{
  const t = await store.termos.byId(req.params.id);
  if(!t) return res.status(404).json({ error: 'Termo não encontrado' });
  if(t.user !== req.auth.user) return res.status(403).json({ error: 'Sem permissão' });
  const { dataEnvio, destinatario, equipamentos, respEntrega, respRecebimento, dados, modelo } = req.body||{};
  const patch={};
  if(dataEnvio !== undefined) patch.dataEnvio = dataEnvio ? new Date(dataEnvio).toISOString().slice(0,10) : null;
  if(t.tipo === 'recolhimento' && dados && typeof dados === 'object'){
    const d = dados;
    const nd = Object.assign({}, t.dados||{});
    if(d.itensRecebidos!=null) nd.itensRecebidos = String(d.itensRecebidos).trim().slice(0,200);
    if(d.dataHora) nd.dataHora = new Date(d.dataHora).toISOString();
    if(Array.isArray(d.equipamentos)){
      nd.equipamentos = d.equipamentos.slice(0,60).map(r=>{
        const checks = {};
        ['ladoExterno','cinta','travas','ladoInterno','abaDireita','abaEsquerda'].forEach(k=>{
          const v = r.checks ? r.checks[k] : null;
          checks[k] = (v === true || v === 'sim') ? true : (v === false || v === 'nao') ? false : null;
        });
        return { numero: String(r.numero||'').trim().slice(0,30), danificado: !!r.danificado, checks };
      }).filter(r=> r.numero);
    }
    if(d.descricao!=null) nd.descricao = String(d.descricao).trim().slice(0,2000);
    if(d.policialNome!=null) nd.policialNome = String(d.policialNome).trim().slice(0,80);
    if(d.policialMat!=null) nd.policialMat = String(d.policialMat).trim().slice(0,30);
    if(d.tecnicoNome!=null) nd.tecnicoNome = String(d.tecnicoNome).trim().slice(0,80);
    if(d.tecnicoMat!=null) nd.tecnicoMat = String(d.tecnicoMat).trim().slice(0,30);
    patch.dados = nd;
  }
  if(destinatario!=null) patch.destinatario = String(destinatario).trim().slice(0,120);
  if(t.tipo !== 'recolhimento' && (modelo === 'upr' || modelo === 'tzpr')){
    patch.dados = Object.assign({}, t.dados||{}, { modelo });
  }
  if(equipamentos!=null && t.tipo !== 'recolhimento'){
    const modeloEff = (modelo === 'upr' || modelo === 'tzpr') ? modelo : ((t.dados && t.dados.modelo === 'upr') ? 'upr' : 'tzpr');
    const eqIn = Array.isArray(equipamentos) ? equipamentos.slice(0, 30) : [];
    patch.equipamentos = modeloEff === 'upr'
      ? eqIn.map(r => ({
          upr04: String((r && (r.upr04 ?? r.tzpr04)) || '').trim().slice(0, 30),
          fonte04: String((r && r.fonte04) || '').trim().slice(0, 30)
        })).filter(r => r.upr04 || r.fonte04)
      : eqIn.map(r => ({
          tzpr04: String((r && r.tzpr04) || '').trim().slice(0, 30),
          fonte04: String((r && r.fonte04) || '').trim().slice(0, 30),
          cinta: String((r && r.cinta) || '').trim().slice(0, 30),
          trava: String((r && r.trava) || '').trim().slice(0, 30)
        })).filter(r => r.tzpr04 || r.fonte04 || r.cinta || r.trava);
  } else if(equipamentos!=null){
    const eqIn = Array.isArray(equipamentos) ? equipamentos.slice(0, 30) : [];
    patch.equipamentos = eqIn.map(r => ({
      tzpr04: String((r && r.tzpr04) || '').trim().slice(0, 30),
      fonte04: String((r && r.fonte04) || '').trim().slice(0, 30),
      cinta: String((r && r.cinta) || '').trim().slice(0, 30),
      trava: String((r && r.trava) || '').trim().slice(0, 30)
    })).filter(r => r.tzpr04 || r.fonte04 || r.cinta || r.trava);
  }
  if(respEntrega!=null) patch.respEntrega = String(respEntrega).trim().slice(0,80);
  if(respRecebimento!=null) patch.respRecebimento = String(respRecebimento).trim().slice(0,80);
  const upd = await store.termos.patch(t.id, patch);
  broadcast();
  res.json(upd);
}));
router.delete('/api/termos/:id', auth(['tecnico']), ah(async (req,res)=>{
  const t = await store.termos.byId(req.params.id);
  if(!t) return res.status(404).json({ error: 'Termo não encontrado' });
  if(t.user !== req.auth.user) return res.status(403).json({ error: 'Sem permissão' });
  await store.termos.remove(t.id);
  broadcast();
  res.json({ ok: true });
}));
router.get('/api/termos/:id/pdf', auth(['tecnico']), ah(async (req,res)=>{
  const t = await store.termos.byId(req.params.id);
  if(!t) return res.status(404).json({ error: 'Termo não encontrado' });
  if(t.user !== req.auth.user) return res.status(403).json({ error: 'Sem permissão' });
  const pdf = (t.tipo === 'recolhimento') ? await gerarTermoRecolhimentoPDF(t) : await gerarTermoPDF(t);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="termo-${t.id}.pdf"`);
  res.send(Buffer.from(pdf));
}));
router.post('/api/termos/pdf-preview', auth(['tecnico']), ah(async (req,res)=>{
  const { tipo, dataEnvio, destinatario, equipamentos, respEntrega, respRecebimento, dados, modelo } = req.body||{};
  if(tipo === 'recolhimento'){
    const d = (dados && typeof dados === 'object') ? dados : {};
    const termo = {
      tipo: 'recolhimento',
      dados: {
        itensRecebidos: String(d.itensRecebidos||'').trim(),
        dataHora: d.dataHora ? new Date(d.dataHora).toISOString() : new Date().toISOString(),
        equipamentos: (Array.isArray(d.equipamentos) ? d.equipamentos.slice(0,60) : []).map(r=>({ numero: String(r.numero||''), danificado: !!r.danificado, checks: (r.checks||{}) })),
        descricao: String(d.descricao||'').trim(),
        policialNome: String(d.policialNome||'').trim(), policialMat: String(d.policialMat||'').trim(),
        tecnicoNome: String(d.tecnicoNome||'').trim(), tecnicoMat: String(d.tecnicoMat||'').trim()
      }
    };
    const pdf = await gerarTermoRecolhimentoPDF(termo);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="termo-preview.pdf"');
    return res.send(Buffer.from(pdf));
  }
  const termo = {
    dataEnvio: dataEnvio ? new Date(dataEnvio).toISOString().slice(0,10) : '',
    destinatario: String(destinatario||'').trim() || '_________________________',
    equipamentos: Array.isArray(equipamentos) ? equipamentos.slice(0,30).map(r=>({ tzpr04: String((r&&r.tzpr04)||''), upr04: String((r&&(r.upr04 ?? r.tzpr04))||''), fonte04: String((r&&r.fonte04)||''), cinta: String((r&&r.cinta)||''), trava: String((r&&r.trava)||'') })) : [],
    respEntrega: String(respEntrega||'').trim(),
    respRecebimento: String(respRecebimento||'').trim(),
    dados: { modelo: (modelo === 'upr') ? 'upr' : 'tzpr' }
  };
  while(termo.equipamentos.length<5) termo.equipamentos.push({ tzpr04:'', fonte04:'', cinta:'', trava:'' });
  const pdf = await gerarTermoPDF(termo);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline; filename="termo-preview.pdf"');
  res.send(Buffer.from(pdf));
}));

module.exports = router;
