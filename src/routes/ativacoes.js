const express = require('express');
const shared = require('../lib/shared');
const { parseAtivacoes, scoreParse, crossValidate, mergeWithLlm } = require('../lib/ativacoesParser');
const { llmParse, getLlmConfig } = require('../lib/ativacoesLlm');
const { gerarAtivacaoPDF } = require('../lib/ativacoesPdf');
const router = express.Router();

// helper para extrair texto de PDF via pdfjs-dist (suporta PDFs modernos com object streams)
async function extractTextFromPdf(buffer){
  // tenta pdf-parse primeiro (mais leve), fallback para pdfjs-dist
  try{
    const pdfParse = require('pdf-parse');
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    const data = await pdfParse(buf);
    if(data.text && data.text.trim().length > 20) return data.text;
  }catch(e){
    // ignora e tenta pdfjs-dist
  }
  // fallback: pdfjs-dist v3 legacy (suporta object streams e XRef modernos)
  const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  // desativa worker para Node (sem canvas)
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buf), disableWorker: true, disableFontFace: true, isEvalSupported: false, useWorkerFetch: false });
  const pdf = await loadingTask.promise;
  let fullText='';
  for(let i=1;i<=pdf.numPages;i++){
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    fullText += '\n' + content.items.map(it=>it.str||'').join(' ');
  }
  return fullText;
}

// POST /api/ativacoes/auto-preencher  (multipart: arquivo = pdf)
router.post('/api/ativacoes/auto-preencher', shared.auth(['tecnico','psico','admin']), shared.upload.single('arquivo'), shared.ah(async (req,res)=>{
  if(!req.file) return res.status(400).json({ error: 'Envie um PDF em "arquivo"' });
  const mime = String(req.file.mimetype||'').toLowerCase();
  const name = String(req.file.originalname||'').toLowerCase();
  if(!(mime.includes('pdf') || name.endsWith('.pdf'))){
    return res.status(400).json({ error: 'Apenas PDF é aceito para auto preencher' });
  }
  if(req.file.buffer.length > 15*1024*1024) return res.status(400).json({ error: 'PDF muito grande (máx 15MB)' });
  let text='';
  try{
    text = await extractTextFromPdf(req.file.buffer);
  }catch(e){
    console.error('ativacoes extract error', e.message);
    // tenta via arquivo temporário como fallback (algumas versões de pdf-parse lidam melhor com arquivo)
    try{
      const fs=require('fs'), path=require('path'), os=require('os');
      const tmp = path.join(os.tmpdir(), 'ativ_upload_'+Date.now()+'.pdf');
      fs.writeFileSync(tmp, req.file.buffer);
      const fb = fs.readFileSync(tmp);
      text = await extractTextFromPdf(fb);
      try{ fs.unlinkSync(tmp); }catch(_){}
    }catch(e2){
      console.error('ativacoes fallback also fail', e2.message);
      return res.status(400).json({ error: 'Não foi possível ler o PDF. Verifique se é um PDF com texto selecionável (não apenas imagem). Erro: '+(e.message||'desconhecido') });
    }
  }
  if(!text || text.trim().length < 20){
    return res.status(400).json({ error: 'PDF sem texto extraível. Se for imagem escaneada, use o botão \"Tentar OCR (PDF escaneado)\" abaixo ou digite manualmente.', extractedLength: (text||'').length, isScanned: true });
  }
  // 1) Regex (rápido, determinístico)
  let dados = parseAtivacoes(text);
  // 2) LLM semântico (se configurado, preenche lacunas e resolve ambiguidades)
  let llmInfo = null;
  const useLlm = req.query.llm !== '0' && req.body?.useLlm !== false;
  if(useLlm){
    try{
      const r = await llmParse(text);
      if(r && r.data && !r.skipped){
        dados = mergeWithLlm(dados, r.data);
        llmInfo = { provider: r.provider, model: r.model, contrib: dados._llmContrib||0 };
      } else if(r.skipped){
        llmInfo = { skipped:true, reason: r.reason };
      }
    }catch(e){
      llmInfo = { error: e.message };
      console.warn('LLM parse falhou, segue regex', e.message);
    }
  }
  const score = scoreParse(dados);
  const warnings = crossValidate(text, dados);
  const llmCfg = getLlmConfig();
  res.json({ ok:true, dados, score, warnings, llm: llmInfo, llmConfigured: !!llmCfg, textoExtraido: text.slice(0,8000), paginas: text.split('\n').length });
}));

// POST /api/ativacoes/parse-text  (texto OCR ou colado) - com LLM + validação
router.post('/api/ativacoes/parse-text', shared.auth(['tecnico','psico','admin']), shared.ah(async (req,res)=>{
  const texto = String((req.body && (req.body.texto || req.body.text)) || '').trim();
  if(!texto || texto.length < 10) return res.status(400).json({ error: 'Envie o texto extraído (mín. 10 caracteres)' });
  let dados = parseAtivacoes(texto);
  let llmInfo=null;
  const useLlm = req.query.llm !== '0' && req.body?.useLlm !== false;
  if(useLlm){
    try{
      const r = await llmParse(texto);
      if(r && r.data && !r.skipped){ dados = mergeWithLlm(dados, r.data); llmInfo={ provider:r.provider, model:r.model, contrib: dados._llmContrib||0 }; }
      else if(r.skipped) llmInfo={ skipped:true, reason:r.reason };
    }catch(e){ llmInfo={ error:e.message }; }
  }
  const score = scoreParse(dados);
  const warnings = crossValidate(texto, dados);
  res.json({ ok:true, dados, score, warnings, llm: llmInfo, llmConfigured: !!getLlmConfig(), textoExtraido: texto.slice(0,8000) });
}));

// POST /api/ativacoes/llm-parse  (força LLM)
router.post('/api/ativacoes/llm-parse', shared.auth(['tecnico','psico','admin']), shared.ah(async (req,res)=>{
  const texto = String((req.body && (req.body.texto || req.body.text)) || '').trim();
  if(!texto) return res.status(400).json({ error: 'Envie texto' });
  const r = await llmParse(texto);
  if(r.skipped) return res.status(400).json({ error: r.reason, llmConfigured:false });
  const merged = mergeWithLlm(parseAtivacoes(texto), r.data);
  const warnings = crossValidate(texto, merged);
  res.json({ ok:true, dados: merged, llm: { provider:r.provider, model:r.model }, warnings, score: scoreParse(merged) });
}));

// GET /api/ativacoes/llm-status
router.get('/api/ativacoes/llm-status', shared.auth(['tecnico','psico','admin']), (req,res)=>{
  const cfg = getLlmConfig();
  res.json({ configured: !!cfg, provider: cfg?.provider||null, model: cfg?.model||null });
});

// Opcional: preview PDF de ativação sem salvar
router.post('/api/ativacoes/pdf-preview', shared.auth(['tecnico','psico','admin']), shared.ah(async (req,res)=>{
  const { dados } = req.body||{};
  if(!dados || typeof dados !== 'object') return res.status(400).json({ error: 'Envie dados' });
  const termo = { dados };
  const pdf = await gerarAtivacaoPDF(termo);
  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition','inline; filename="ativacao-preview.pdf"');
  res.send(Buffer.from(pdf));
}));

// Reuso do store.termos para persistir ativações (tipo='ativacao')
router.get('/api/ativacoes', shared.auth(['tecnico','psico','admin']), shared.ah(async (req,res)=>{
  const list = await shared.store.termos.allByUser(req.auth.user);
  const filt = list.filter(t=> (t.tipo==='ativacao'));
  res.json(filt);
}));

module.exports = router;
module.exports.gerarAtivacaoPDF = gerarAtivacaoPDF;
module.exports.extractTextFromPdf = extractTextFromPdf;
