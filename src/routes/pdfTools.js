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

// helper: "1,3,5-7" (1-based) -> índices 0-based válidos
function parsePaginas(str, total){
  const idx = new Set();
  String(str||'').split(',').forEach(part=>{
    const m = part.trim().match(/^(\d+)-(\d+)$/);
    if(m){
      const s = parseInt(m[1],10), e = parseInt(m[2],10);
      const a = Math.min(s,e), b = Math.max(s,e);
      for(let i=a;i<=b;i++) if(i>=1 && i<=total) idx.add(i-1);
    } else {
      const n = parseInt(part.trim(),10);
      if(n>=1 && n<=total) idx.add(n-1);
    }
  });
  return [...idx].sort((a,b)=>a-b);
}

// Marca d'água (texto em todas as páginas: centro diagonal ou rodapé)
router.post('/api/pdf/watermark', shared.auth(['tecnico','psico','admin']), shared.upload.single('file'), shared.ah(async (req,res)=>{
  if(!req.file) return res.status(400).json({ error: 'Envie um PDF' });
  if(!isPdf(req.file.buffer)) return res.status(400).json({ error: 'Arquivo não é PDF' });
  const text = String(req.body.text||'').trim().slice(0,60);
  if(!text) return res.status(400).json({ error: 'Informe o texto da marca d\'água' });
  const pos = req.body.pos === 'rodape' ? 'rodape' : 'centro';
  const doc = await PDFDocument.load(req.file.buffer);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  doc.getPages().forEach(p=>{
    const { width, height } = p.getSize();
    if(pos === 'rodape'){
      const size = 10;
      const w = font.widthOfTextAtSize(text, size);
      p.drawText(text, { x: (width-w)/2, y: 24, size, font, color: rgb(0.45,0.45,0.45), opacity: 0.85 });
    } else {
      const size = Math.min(64, Math.max(28, Math.floor(width/9)));
      const w = font.widthOfTextAtSize(text, size);
      const h = font.heightAtSize(size);
      p.drawText(text, { x: width/2 - w/2, y: height/2 - h/4, size, font, color: rgb(0.5,0.5,0.5), opacity: 0.28, rotate: degrees(45) });
    }
  });
  const bytes = await doc.save();
  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition','attachment; filename="com-marca.pdf"');
  res.send(Buffer.from(bytes));
}));

// Numerar páginas (rodapé: centro ou direita, a partir de N)
router.post('/api/pdf/pagenumber', shared.auth(['tecnico','psico','admin']), shared.upload.single('file'), shared.ah(async (req,res)=>{
  if(!req.file) return res.status(400).json({ error: 'Envie um PDF' });
  if(!isPdf(req.file.buffer)) return res.status(400).json({ error: 'Arquivo não é PDF' });
  const pos = req.body.pos === 'direita' ? 'direita' : 'centro';
  const inicio = Math.max(1, parseInt(req.body.inicio||'1',10) || 1);
  const doc = await PDFDocument.load(req.file.buffer);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const size = 10;
  doc.getPages().forEach((p,i)=>{
    const { width } = p.getSize();
    const label = String(inicio + i);
    const w = font.widthOfTextAtSize(label, size);
    const x = pos === 'direita' ? width - w - 36 : (width-w)/2;
    p.drawText(label, { x, y: 28, size, font, color: rgb(0.4,0.4,0.4) });
  });
  const bytes = await doc.save();
  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition','attachment; filename="numerado.pdf"');
  res.send(Buffer.from(bytes));
}));

// Remover páginas ("1,3,5-7" = páginas a EXCLUIR)
router.post('/api/pdf/remove-pages', shared.auth(['tecnico','psico','admin']), shared.upload.single('file'), shared.ah(async (req,res)=>{
  if(!req.file) return res.status(400).json({ error: 'Envie um PDF' });
  if(!isPdf(req.file.buffer)) return res.status(400).json({ error: 'Arquivo não é PDF' });
  const pages = String(req.body.pages||'').trim();
  if(!pages) return res.status(400).json({ error: 'Informe as páginas a remover. Ex: 1,3,5-7' });
  const doc = await PDFDocument.load(req.file.buffer);
  const total = doc.getPageCount();
  const idx = parsePaginas(pages, total);
  if(!idx.length) return res.status(400).json({ error: 'Nenhuma página válida. Ex: 1,3,5-7' });
  if(idx.length >= total) return res.status(400).json({ error: 'Não é possível remover todas as páginas' });
  for(const i of [...idx].sort((a,b)=>b-a)) doc.removePage(i);
  const bytes = await doc.save();
  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition','attachment; filename="sem-paginas.pdf"');
  res.send(Buffer.from(bytes));
}));

module.exports = router;
