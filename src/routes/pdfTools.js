const express = require('express');
const { PDFDocument, StandardFonts, rgb, degrees } = require('pdf-lib');
const shared = require('../lib/shared');
const router = express.Router();

// helper para validar PDFs
function isPdf(buf){ return buf && buf.length>4 && buf.slice(0,4).toString()==='%PDF'; }

// Merge PDFs
router.post('/api/pdf/merge', shared.auth(['tecnico','psico','admin']), shared.upload.array('files', 10), shared.ah(async (req,res)=>{
  if(!req.files || req.files.length<2) return res.status(400).json({ error: 'Envie ao menos 2 PDFs para mesclar' });
  const pdfDoc = await PDFDocument.create();
  for(const f of req.files){
    if(!isPdf(f.buffer)) return res.status(400).json({ error: 'Arquivo inválido: '+f.originalname+' não é PDF' });
    const src = await PDFDocument.load(f.buffer);
    const pages = await pdfDoc.copyPages(src, src.getPageIndices());
    pages.forEach(p=> pdfDoc.addPage(p));
  }
  const bytes = await pdfDoc.save();
  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition','attachment; filename="mesclado.pdf"');
  res.send(Buffer.from(bytes));
}));

// Split PDF (por intervalo ou páginas específicas)
router.post('/api/pdf/split', shared.auth(['tecnico','psico','admin']), shared.upload.single('file'), shared.ah(async (req,res)=>{
  if(!req.file) return res.status(400).json({ error: 'Envie um PDF' });
  if(!isPdf(req.file.buffer)) return res.status(400).json({ error: 'Arquivo não é PDF' });
  const { pages, from, to } = req.body||{};
  const src = await PDFDocument.load(req.file.buffer);
  const total = src.getPageCount();
  let indices=[];
  if(pages){
    // ex: "1,3,5-7" 1-based
    String(pages).split(',').forEach(part=>{
      const m=part.trim().match(/^(\d+)-(\d+)$/);
      if(m){ const s=parseInt(m[1],10), e=parseInt(m[2],10); for(let i=s;i<=e;i++) if(i>=1&&i<=total) indices.push(i-1); }
      else { const n=parseInt(part.trim(),10); if(n>=1&&n<=total) indices.push(n-1); }
    });
  } else if(from || to){
    const s=parseInt(from||1,10), e=parseInt(to||total,10);
    for(let i=s;i<=e;i++) if(i>=1&&i<=total) indices.push(i-1);
  } else {
    // sem param: retorna zip com cada página? por simplicidade retorna 1 PDF com todas (mesmo que original)
    indices = src.getPageIndices();
  }
  if(!indices.length) return res.status(400).json({ error: 'Nenhuma página válida. Ex: 1,3,5-7' });
  // Se pediu 1 intervalo contínuo, devolve 1 PDF; se múltiplos não-contínuos, devolve 1 PDF com as páginas selecionadas
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, indices);
  copied.forEach(p=> out.addPage(p));
  const bytes = await out.save();
  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition','attachment; filename="dividido.pdf"');
  res.send(Buffer.from(bytes));
}));

// Compress PDF (remove metadata, re-save)
router.post('/api/pdf/compress', shared.auth(['tecnico','psico','admin']), shared.upload.single('file'), shared.ah(async (req,res)=>{
  if(!req.file) return res.status(400).json({ error: 'Envie um PDF' });
  if(!isPdf(req.file.buffer)) return res.status(400).json({ error: 'Arquivo não é PDF' });
  const src = await PDFDocument.load(req.file.buffer);
  // remove metadados
  src.setTitle('');
  src.setAuthor('');
  src.setSubject('');
  src.setKeywords([]);
  src.setProducer('');
  src.setCreator('');
  const bytes = await src.save({ useObjectStreams: true });
  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition','attachment; filename="comprimido.pdf"');
  res.setHeader('X-Original-Size', String(req.file.buffer.length));
  res.setHeader('X-Compressed-Size', String(bytes.length));
  res.send(Buffer.from(bytes));
}));

// JPG/PNG -> PDF (cada imagem vira uma página A4)
router.post('/api/pdf/jpg-to-pdf', shared.auth(['tecnico','psico','admin']), shared.upload.array('files', 20), shared.ah(async (req,res)=>{
  if(!req.files || !req.files.length) return res.status(400).json({ error: 'Envie imagens JPG/PNG' });
  const pdfDoc = await PDFDocument.create();
  for(const f of req.files){
    const isJpg = f.mimetype==='image/jpeg' || /\.jpe?g$/i.test(f.originalname);
    const isPng = f.mimetype==='image/png' || /\.png$/i.test(f.originalname);
    if(!isJpg && !isPng) return res.status(400).json({ error: 'Apenas JPG/PNG: '+f.originalname });
    const img = isJpg ? await pdfDoc.embedJpg(f.buffer) : await pdfDoc.embedPng(f.buffer);
    const page = pdfDoc.addPage([595.28,841.89]);
    const maxW=595.28-40, maxH=841.89-40;
    const scale = Math.min(maxW/img.width, maxH/img.height);
    const w=img.width*scale, h=img.height*scale;
    page.drawImage(img, { x:(595.28-w)/2, y:(841.89-h)/2, width:w, height:h });
  }
  const bytes = await pdfDoc.save();
  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition','attachment; filename="imagens.pdf"');
  res.send(Buffer.from(bytes));
}));

// Rotate PDF
router.post('/api/pdf/rotate', shared.auth(['tecnico','psico','admin']), shared.upload.single('file'), shared.ah(async (req,res)=>{
  if(!req.file) return res.status(400).json({ error: 'Envie um PDF' });
  if(!isPdf(req.file.buffer)) return res.status(400).json({ error: 'Arquivo não é PDF' });
  const angle = parseInt(req.body.angle||'90',10);
  const allowed=[0,90,180,270];
  if(!allowed.includes(angle)) return res.status(400).json({ error: 'Ângulo deve ser 90, 180 ou 270' });
  const doc = await PDFDocument.load(req.file.buffer);
  doc.getPages().forEach(p=> p.setRotation(degrees(p.getRotation().angle + angle)));
  const bytes = await doc.save();
  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition',`attachment; filename="rotacionado-${angle}.pdf"`);
  res.send(Buffer.from(bytes));
}));

// Extract pages as single PDF (alias de split)
router.post('/api/pdf/extract', shared.auth(['tecnico','psico','admin']), shared.upload.single('file'), shared.ah(async (req,res)=>{
  if(!req.file) return res.status(400).json({ error: 'Envie um PDF' });
  const pages = String(req.body.pages||'').trim();
  if(!pages) return res.status(400).json({ error: 'Informe as páginas. Ex: 1,3,5-7' });
  req.body.pages=pages;
  // reutiliza lógica do split
  if(!isPdf(req.file.buffer)) return res.status(400).json({ error: 'Arquivo não é PDF' });
  const src = await PDFDocument.load(req.file.buffer);
  const total=src.getPageCount();
  let indices=[];
  String(pages).split(',').forEach(part=>{
    const m=part.trim().match(/^(\d+)-(\d+)$/);
    if(m){ const s=parseInt(m[1],10), e=parseInt(m[2],10); for(let i=s;i<=e;i++) if(i>=1&&i<=total) indices.push(i-1); }
    else { const n=parseInt(part.trim(),10); if(n>=1&&n<=total) indices.push(n-1); }
  });
  if(!indices.length) return res.status(400).json({ error: 'Nenhuma página válida' });
  const out=await PDFDocument.create();
  const copied=await out.copyPages(src, indices);
  copied.forEach(p=> out.addPage(p));
  const bytes=await out.save();
  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition','attachment; filename="extraido.pdf"');
  res.send(Buffer.from(bytes));
}));

module.exports = router;
