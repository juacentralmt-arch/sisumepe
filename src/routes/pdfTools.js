const express = require('express');
const { PDFDocument, StandardFonts, rgb, degrees } = require('pdf-lib');
const pdfParse = require('pdf-parse');
const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, convertInchesToTwip, convertTwipToInch } = require('docx');
const mammoth = require('mammoth');
const shared = require('../lib/shared');
const router = express.Router();

// helper para validar PDFs
function isPdf(buf){ return buf && buf.length>4 && buf.slice(0,4).toString()==='%PDF'; }

// Tetos anti-DoS no plano free (Render 512MB): PDFs gigantes (milhares de
// páginas ou zip-bomb) estourariam RAM/CPU no pdf-lib, que é síncrono e
// bloqueia o event loop. O multer já limita bytes (200MB); aqui limitamos
// páginas após o load, antes de processar.
const MAX_PDF_PAGES_IN = 500;   // páginas do PDF de entrada
const MAX_MERGE_PAGES_OUT = 300; // páginas do PDF resultante do merge
function tooBig(total){
  const e = new Error(`PDF com páginas demais (${total}). Máximo ${MAX_PDF_PAGES_IN} por vez.`);
  e.status = 400; throw e;
}

// ZIP mínimo (stored, sem compressão) — evita dependência extra no servidor
const ZIP_CRC_T = (()=>{ const t=new Uint32Array(256); for(let n=0;n<256;n++){ let c=n; for(let k=0;k<8;k++) c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1); t[n]=c>>>0; } return t; })();
function zipCrc32(u8){ let c=0xFFFFFFFF; for(let i=0;i<u8.length;i++) c=ZIP_CRC_T[(c^u8[i])&0xFF]^(c>>>8); return (c^0xFFFFFFFF)>>>0; }
function zipStore(files){
  const enc = new TextEncoder();
  const partes = [], central = [];
  let offset = 0;
  const le16=(v,a)=>a.push(v&0xFF,(v>>>8)&0xFF);
  const le32=(v,a)=>a.push(v&0xFF,(v>>>8)&0xFF,(v>>>16)&0xFF,(v>>>24)&0xFF);
  for(const f of files){
    const nomeB = enc.encode(f.name);
    const dados = Buffer.isBuffer(f.data) ? new Uint8Array(f.data) : f.data;
    const crc = zipCrc32(dados);
    const lh=[];
    le32(0x04034b50,lh); le16(20,lh); le16(0x0800,lh); le16(0,lh); le16(0,lh); le16(0,lh);
    le32(crc,lh); le32(dados.length,lh); le32(dados.length,lh);
    le16(nomeB.length,lh); le16(0,lh);
    const h=Buffer.from(lh);
    partes.push(h, Buffer.from(nomeB), Buffer.from(dados));
    const ch=[];
    le32(0x02014b50,ch); le16(20,ch); le16(20,ch); le16(0x0800,ch); le16(0,ch);
    le16(0,ch); le16(0,ch); le32(crc,ch);
    le32(dados.length,ch); le32(dados.length,ch);
    le16(nomeB.length,ch); le16(0,ch); le16(0,ch); le16(0,ch); le16(0,ch);
    le32(0,ch); le32(offset,ch);
    central.push(Buffer.from(ch), Buffer.from(nomeB));
    offset += h.length + nomeB.length + dados.length;
  }
  let centralTam=0;
  for(const c of central){ partes.push(c); centralTam+=c.length; }
  const fim=[];
  le32(0x06054b50,fim); le16(0,fim); le16(0,fim);
  le16(files.length,fim); le16(files.length,fim);
  le32(centralTam,fim); le32(offset,fim); le16(0,fim);
  partes.push(Buffer.from(fim));
  return Buffer.concat(partes);
}

// Merge PDFs
router.post('/api/pdf/merge', shared.auth(['tecnico','psico','admin']), shared.uploadLarge.array('files', 10), shared.ah(async (req,res)=>{
  if(!req.files || req.files.length<2) return res.status(400).json({ error: 'Envie ao menos 2 PDFs para mesclar' });
  const pdfDoc = await PDFDocument.create();
  let totalOut = 0;
  for(const f of req.files){
    if(!isPdf(f.buffer)) return res.status(400).json({ error: 'Arquivo inválido: '+f.originalname+' não é PDF' });
    const src = await PDFDocument.load(f.buffer);
    if(src.getPageCount() > MAX_PDF_PAGES_IN) tooBig(src.getPageCount());
    totalOut += src.getPageCount();
    if(totalOut > MAX_MERGE_PAGES_OUT) return res.status(400).json({ error: `Resultado com páginas demais. Máximo ${MAX_MERGE_PAGES_OUT} no merge.` });
    const pages = await pdfDoc.copyPages(src, src.getPageIndices());
    pages.forEach(p=> pdfDoc.addPage(p));
  }
  const bytes = await pdfDoc.save();
  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition','attachment; filename="mesclado.pdf"');
  res.send(Buffer.from(bytes));
}));

// Split PDF (por intervalo ou páginas específicas)
router.post('/api/pdf/split', shared.auth(['tecnico','psico','admin']), shared.uploadLarge.single('file'), shared.ah(async (req,res)=>{
  if(!req.file) return res.status(400).json({ error: 'Envie um PDF' });
  if(!isPdf(req.file.buffer)) return res.status(400).json({ error: 'Arquivo não é PDF' });
  const { pages, from, to } = req.body||{};
  const src = await PDFDocument.load(req.file.buffer);
  const total = src.getPageCount();
  if(total > MAX_PDF_PAGES_IN) tooBig(total);
  let indices=[];
  if(pages){
    // "1,3,5-7" 1-based, preservando a ordem pedida (permite reordenar: "3,1")
    indices = parsePaginasOrdered(pages, total);
  } else if(from || to){
    const s=parseInt(from||1,10), e=parseInt(to||total,10);
    const a=Math.min(s,e), b=Math.max(s,e);
    for(let i=a;i<=b;i++) if(i>=1&&i<=total) indices.push(i-1);
  } else {
    return res.status(400).json({ error: 'Informe as páginas. Ex: 1,3,5-7' });
  }
  if(!indices.length) return res.status(400).json({ error: 'Nenhuma página válida. Ex: 1,3,5-7' });
  // Se pediu 1 intervalo contínuo, devolve 1 PDF; se múltiplos não-contínuos, devolve 1 PDF com as páginas selecionadas
  const bytes = await copiarPaginas(src, indices);
  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition','attachment; filename="dividido.pdf"');
  res.send(Buffer.from(bytes));
}));

// Compress PDF (remove metadata, re-save)
router.post('/api/pdf/compress', shared.auth(['tecnico','psico','admin']), shared.uploadLarge.single('file'), shared.ah(async (req,res)=>{
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
  // Honestidade: esta compressão remove só metadados/reempacota objetos —
  // PDF escaneado (só imagens) quase não encolhe. O frontend avisa quando
  // a redução é nula/negativa em vez de prometer o que não entrega.
  res.setHeader('X-Compress-Note', 'metadata-only');
  res.send(Buffer.from(bytes));
}));

// JPG/PNG -> PDF (cada imagem vira uma página A4)
router.post('/api/pdf/jpg-to-pdf', shared.auth(['tecnico','psico','admin']), shared.uploadLarge.array('files', 20), shared.ah(async (req,res)=>{
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
router.post('/api/pdf/rotate', shared.auth(['tecnico','psico','admin']), shared.uploadLarge.single('file'), shared.ah(async (req,res)=>{
  if(!req.file) return res.status(400).json({ error: 'Envie um PDF' });
  if(!isPdf(req.file.buffer)) return res.status(400).json({ error: 'Arquivo não é PDF' });
  const angle = parseInt(req.body.angle||'90',10);
  const allowed=[90,180,270];
  if(!allowed.includes(angle)) return res.status(400).json({ error: 'Ângulo deve ser 90, 180 ou 270' });
  const doc = await PDFDocument.load(req.file.buffer);
  if(doc.getPageCount() > MAX_PDF_PAGES_IN) tooBig(doc.getPageCount());
  doc.getPages().forEach(p=> p.setRotation(degrees(p.getRotation().angle + angle)));
  const bytes = await doc.save();
  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition',`attachment; filename="rotacionado-${angle}.pdf"`);
  res.send(Buffer.from(bytes));
}));

// Extract pages as single PDF (alias de split — mesma ordem pedida)
router.post('/api/pdf/extract', shared.auth(['tecnico','psico','admin']), shared.uploadLarge.single('file'), shared.ah(async (req,res)=>{
  if(!req.file) return res.status(400).json({ error: 'Envie um PDF' });
  const pages = String(req.body.pages||'').trim();
  if(!pages) return res.status(400).json({ error: 'Informe as páginas. Ex: 1,3,5-7' });
  // reutiliza lógica do split
  if(!isPdf(req.file.buffer)) return res.status(400).json({ error: 'Arquivo não é PDF' });
  const src = await PDFDocument.load(req.file.buffer);
  const total=src.getPageCount();
  if(total > MAX_PDF_PAGES_IN) tooBig(total);
  const indices = parsePaginasOrdered(pages, total);
  if(!indices.length) return res.status(400).json({ error: 'Nenhuma página válida' });
  const bytes = await copiarPaginas(src, indices);
  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition','attachment; filename="extraido.pdf"');
  res.send(Buffer.from(bytes));
}));

// "1,3,5-7" (1-based) -> índices 0-based na ORDEM pedida (permite "3,1"),
// sem duplicadas, com intervalos invertidos ("7-5" == "5-7").
function parsePaginasOrdered(str, total){
  const out = [];
  const seen = new Set();
  String(str||'').split(',').forEach(part=>{
    const m = part.trim().match(/^(\d+)-(\d+)$/);
    if(m){
      const s = parseInt(m[1],10), e = parseInt(m[2],10);
      const a = Math.min(s,e), b = Math.max(s,e);
      for(let i=a;i<=b;i++) if(i>=1 && i<=total && !seen.has(i-1)){ seen.add(i-1); out.push(i-1); }
    } else {
      const n = parseInt(part.trim(),10);
      if(n>=1 && n<=total && !seen.has(n-1)){ seen.add(n-1); out.push(n-1); }
    }
  });
  return out;
}

// Copia as páginas nos índices dados para um PDF novo (ordem preservada).
async function copiarPaginas(src, indices){
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, indices);
  copied.forEach(p=> out.addPage(p));
  return out.save();
}

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
router.post('/api/pdf/watermark', shared.auth(['tecnico','psico','admin']), shared.uploadLarge.single('file'), shared.ah(async (req,res)=>{
  if(!req.file) return res.status(400).json({ error: 'Envie um PDF' });
  if(!isPdf(req.file.buffer)) return res.status(400).json({ error: 'Arquivo não é PDF' });
  const text = String(req.body.text||'').trim().slice(0,60);
  if(!text) return res.status(400).json({ error: 'Informe o texto da marca d\'água' });
  const pos = req.body.pos === 'rodape' ? 'rodape' : 'centro';
  const doc = await PDFDocument.load(req.file.buffer);
  if(doc.getPageCount() > MAX_PDF_PAGES_IN) tooBig(doc.getPageCount());
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
router.post('/api/pdf/pagenumber', shared.auth(['tecnico','psico','admin']), shared.uploadLarge.single('file'), shared.ah(async (req,res)=>{
  if(!req.file) return res.status(400).json({ error: 'Envie um PDF' });
  if(!isPdf(req.file.buffer)) return res.status(400).json({ error: 'Arquivo não é PDF' });
  const pos = req.body.pos === 'direita' ? 'direita' : 'centro';
  const inicio = Math.max(1, parseInt(req.body.inicio||'1',10) || 1);
  const doc = await PDFDocument.load(req.file.buffer);
  if(doc.getPageCount() > MAX_PDF_PAGES_IN) tooBig(doc.getPageCount());
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
router.post('/api/pdf/remove-pages', shared.auth(['tecnico','psico','admin']), shared.uploadLarge.single('file'), shared.ah(async (req,res)=>{
  if(!req.file) return res.status(400).json({ error: 'Envie um PDF' });
  if(!isPdf(req.file.buffer)) return res.status(400).json({ error: 'Arquivo não é PDF' });
  const pages = String(req.body.pages||'').trim();
  if(!pages) return res.status(400).json({ error: 'Informe as páginas a remover. Ex: 1,3,5-7' });
  const doc = await PDFDocument.load(req.file.buffer);
  const total = doc.getPageCount();
  if(total > MAX_PDF_PAGES_IN) tooBig(total);
  const idx = parsePaginas(pages, total);
  if(!idx.length) return res.status(400).json({ error: 'Nenhuma página válida. Ex: 1,3,5-7' });
  if(idx.length >= total) return res.status(400).json({ error: 'Não é possível remover todas as páginas' });
  for(const i of [...idx].sort((a,b)=>b-a)) doc.removePage(i);
  const bytes = await doc.save();
  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition','attachment; filename="sem-paginas.pdf"');
  res.send(Buffer.from(bytes));
}));

// Extrair texto do PDF -> .txt (pdf-parse; escaneados sem texto usam o OCR)
router.post('/api/pdf/text', shared.auth(['tecnico','psico','admin']), shared.uploadLarge.single('file'), shared.ah(async (req,res)=>{
  if(!req.file) return res.status(400).json({ error: 'Envie um PDF' });
  if(!isPdf(req.file.buffer)) return res.status(400).json({ error: 'Arquivo não é PDF' });
  // pdf-parse usa PDF.js antigo que ignora o byteOffset de Buffers vindos
  // do pool do Node (lê lixo vizinho e falha): cópia exata antes de extrair
  const clean = new Uint8Array(req.file.buffer);
  const data = await pdfParse(clean);
  const txt = String(data.text||'').replace(/\r/g,'').trim();
  if(!txt) return res.status(400).json({ error: 'Nenhum texto extraível — PDF escaneado? Use o OCR do AutoRenomear' });
  res.setHeader('Content-Type','text/plain; charset=utf-8');
  res.setHeader('Content-Disposition','attachment; filename="texto.txt"');
  res.send(txt);
}));

// Dividir em ZIP: 1 PDF por página (limite 60 páginas por vez).
// Aceita seleção opcional pages="1,3,5-7" ou from/to — cada página
// selecionada vira 1 PDF dentro do ZIP. Sem seleção, divide todas.
router.post('/api/pdf/split-zip', shared.auth(['tecnico','psico','admin']), shared.uploadLarge.single('file'), shared.ah(async (req,res)=>{
  if(!req.file) return res.status(400).json({ error: 'Envie um PDF' });
  if(!isPdf(req.file.buffer)) return res.status(400).json({ error: 'Arquivo não é PDF' });
  const src = await PDFDocument.load(req.file.buffer);
  const total = src.getPageCount();
  if(total > MAX_PDF_PAGES_IN) tooBig(total);
  const { pages, from, to } = req.body || {};
  let indices = [];
  if(pages) {
    indices = parsePaginas(pages, total);
  } else if(from || to) {
    const s = parseInt(from || 1, 10), e = parseInt(to || total, 10);
    const a = Math.min(s, e), b = Math.max(s, e);
    for(let i = a; i <= b; i++) if(i >= 1 && i <= total) indices.push(i - 1);
  } else {
    if(total < 2) return res.status(400).json({ error: 'PDF tem só 1 página — use Dividir' });
    indices = src.getPageIndices();
  }
  if(!indices.length) return res.status(400).json({ error: 'Nenhuma página válida. Ex: 1,3,5-7 (ou deixe vazio para todas)' });
  if(indices.length > 60) return res.status(400).json({ error: 'Máximo 60 páginas por vez' });
  const files = [];
  for(const i of indices){
    const out = await PDFDocument.create();
    const [p] = await out.copyPages(src, [i]);
    out.addPage(p);
    files.push({ name: `pagina-${String(i+1).padStart(2,'0')}.pdf`, data: Buffer.from(await out.save()) });
  }
  const zip = zipStore(files);
  res.setHeader('Content-Type','application/zip');
  res.setHeader('Content-Disposition','attachment; filename="paginas.zip"');
  res.send(zip);
}));

// =====================================================================
//  Novas ferramentas PDF: redação (blackout), cabeçalho/rodapé
//  personalizado e redimensionamento de páginas. Todas 100% on-prem,
//  sem envio externo.
// =====================================================================

// Redigir / blackout: cobre áreas retangulares com retângulo preto opaco
router.post('/api/pdf/redact', shared.auth(['tecnico','psico','admin']), shared.uploadLarge.single('file'), shared.ah(async (req,res)=>{
  if(!req.file) return res.status(400).json({ error: 'Envie um PDF' });
  if(!isPdf(req.file.buffer)) return res.status(400).json({ error: 'Arquivo não é PDF' });
  const { areas } = req.body||{};
  let areasList = [];
  try { areasList = typeof areas === 'string' ? JSON.parse(areas) : (Array.isArray(areas) ? areas : []); } catch { return res.status(400).json({ error: 'Áreas inválidas (envie JSON)' }); }
  if(!areasList.length) return res.status(400).json({ error: 'Informe ao menos uma área para redigir' });
  const doc = await PDFDocument.load(req.file.buffer);
  if(doc.getPageCount() > MAX_PDF_PAGES_IN) tooBig(doc.getPageCount());
  const pages = doc.getPages();
  for(const a of areasList){
    const pageIdx = Number(a.page) - 1;
    if(pageIdx < 0 || pageIdx >= pages.length) continue;
    const page = pages[pageIdx];
    const { width, height } = page.getSize();
    const x = Math.max(0, Math.min(Number(a.x||0), width));
    const topY = Math.max(0, Math.min(Number(a.y||0), height));
    const w = Math.max(0, Math.min(Number(a.w||100), width - x));
    const h = Math.max(0, Math.min(Number(a.h||40), height - topY));
    // pdf-lib usa origem inferior-esquerda; y do frontend é do topo
    page.drawRectangle({ x, y: height - topY - h, width: w, height: h, color: rgb(0,0,0), borderColor: rgb(0,0,0), borderWidth: 0 });
  }
  const bytes = await doc.save();
  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition','attachment; filename="redigido.pdf"');
  res.send(Buffer.from(bytes));
}));

// Adicionar cabeçalho e/ou rodapé personalizado em todas as páginas
router.post('/api/pdf/header-footer', shared.auth(['tecnico','psico','admin']), shared.uploadLarge.single('file'), shared.ah(async (req,res)=>{
  if(!req.file) return res.status(400).json({ error: 'Envie um PDF' });
  if(!isPdf(req.file.buffer)) return res.status(400).json({ error: 'Arquivo não é PDF' });
  const { headerText, footerText, headerSize, footerSize, headerPos, footerPos, headerY, footerY } = req.body||{};
  if(!headerText && !footerText) return res.status(400).json({ error: 'Informe texto do cabeçalho e/ou rodapé' });
  const doc = await PDFDocument.load(req.file.buffer);
  if(doc.getPageCount() > MAX_PDF_PAGES_IN) tooBig(doc.getPageCount());
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  const hSize = Number(headerSize||10);
  const fSize = Number(footerSize||10);
  const hPos = headerPos || 'centro';
  const fPos = footerPos || 'centro';
  const hY = headerY != null ? Number(headerY) : null;
  const fY = footerY != null ? Number(footerY) : null;
  for(const page of pages){
    const { width, height } = page.getSize();
    if(headerText){
      const hTxt = String(headerText).slice(0,120);
      const hW = font.widthOfTextAtSize(hTxt, hSize);
      let hx = hPos === 'direita' ? width - hW - 40 : hPos === 'esquerda' ? 40 : (width - hW)/2;
      let hy = hY != null ? hY : height - 40;
      page.drawText(hTxt, { x: hx, y: hy, size: hSize, font, color: rgb(0,0,0) });
    }
    if(footerText){
      const fTxt = String(footerText).slice(0,120);
      const fW = font.widthOfTextAtSize(fTxt, fSize);
      let fx = fPos === 'direita' ? width - fW - 40 : fPos === 'esquerda' ? 40 : (width - fW)/2;
      let fy = fY != null ? fY : 30;
      page.drawText(fTxt, { x: fx, y: fy, size: fSize, font, color: rgb(0,0,0) });
    }
  }
  const bytes = await doc.save();
  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition','attachment; filename="com-cabecalho-rodape.pdf"');
  res.send(Buffer.from(bytes));
}));

// =====================================================================
//  Conversão PDF <-> Word (DOCX). Todas 100% on-prem, sem envio externo.
//  PDF -> DOCX: extrai texto com pdf-parse e monta DOCX com a biblioteca docx.
//  DOCX -> PDF: extrai texto com mammoth e renderiza PDF com pdf-lib.
// =====================================================================

// PDF -> Word (DOCX)
router.post('/api/pdf/pdf-to-word', shared.auth(['tecnico','psico','admin']), shared.uploadLarge.single('file'), shared.ah(async (req,res)=>{
  if(!req.file) return res.status(400).json({ error: 'Envie um PDF' });
  if(!isPdf(req.file.buffer)) return res.status(400).json({ error: 'Arquivo não é PDF' });
  const { titulo } = req.body||{};
  const clean = new Uint8Array(req.file.buffer);
  const data = await pdfParse(clean);
  const texto = String(data.text||'').replace(/\r/g,'');
  if(!texto.trim()) return res.status(400).json({ error: 'Nenhum texto extraível do PDF (pode estar escaneado)' });

  const doc = new Document();
  const secTitle = String(titulo||'').trim() || 'Documento convertido do PDF';
  doc.addParagraph(new Paragraph({
    heading: HeadingLevel.TITLE,
    text: secTitle,
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 }
  }));

  // Divide texto em parágrafos por linha em branco; linhas soltas viram parágrafos simples
  const paragrafos = texto.split(/\n\s*\n/).filter(p=>p.trim());
  for(const p of paragrafos){
    const linhas = p.split(/\n/).map(l=>l.trim()).filter(Boolean);
    if(linhas.length===1){
      doc.addParagraph(new Paragraph({ children: [new TextRun({ text: linhas[0] })], spacing: { after: 120 } }));
    } else {
      // bloco com múltiplas linhas: cada linha um parágrafo ou um único com quebra
      for(const l of linhas){
        doc.addParagraph(new Paragraph({ children: [new TextRun({ text: l })], spacing: { after: 60 } }));
      }
    }
  }

  const blob = await Packer.toBuffer(doc);
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition','attachment; filename="convertido.docx"');
  res.send(Buffer.from(blob));
}));

// Word (DOCX) -> PDF
router.post('/api/pdf/word-to-pdf', shared.auth(['tecnico','psico','admin']), shared.uploadLarge.single('file'), shared.ah(async (req,res)=>{
  if(!req.file) return res.status(400).json({ error: 'Envie um DOCX' });
  const name = String(req.file.originalname||'').toLowerCase();
  if(!name.endsWith('.docx') && req.file.mimetype !== 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    return res.status(400).json({ error: 'Arquivo não é DOCX' });

  const resultado = await mammoth.extractRawText({ buffer: req.file.buffer });
  const texto = String(resultado.value||'').replace(/\r/g,'');
  if(!texto.trim()) return res.status(400).json({ error: 'Nenhum texto extraível do DOCX' });

  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const PW = 595.32, PH = 841.92, M = 54;
  const W = PW - 2*M;
  const LH = 14;
  let pg = pdfDoc.addPage([PW, PH]);
  let y = PH - M;

  // Título simples na primeira linha
  const primeiroTitulo = texto.split(/\n/)[0].slice(0,90);
  if(primeiroTitulo.trim()){
    const tW = fontBold.widthOfTextAtSize(primeiroTitulo, 13);
    pg.drawText(primeiroTitulo, { x: (PW - tW)/2, y, size: 13, font: fontBold, color: rgb(0,0,0) });
    y -= 26;
  }

  const linhas = texto.split(/\n/);
  let bufferLinha = '';
  const flush = () => {
    if(!bufferLinha.trim()) return;
    const t = bufferLinha.trim();
    bufferLinha = '';
    // quebra por palavras se passar da largura
    const palavras = t.split(/\s+/);
    let linhaAtual = '';
    for(const w of palavras){
      const cand = linhaAtual ? linhaAtual + ' ' + w : w;
      if(font.widthOfTextAtSize(cand, 10) > W && linhaAtual){
        pg.drawText(linhaAtual, { x: M, y, size: 10, font, color: rgb(0,0,0) });
        y -= LH;
        if(y < M + 20){ pg = pdfDoc.addPage([PW, PH]); y = PH - M; }
        linhaAtual = w;
      } else {
        linhaAtual = cand;
      }
    }
    if(linhaAtual){
      pg.drawText(linhaAtual, { x: M, y, size: 10, font, color: rgb(0,0,0) });
      y -= LH;
      if(y < M + 20){ pg = pdfDoc.addPage([PW, PH]); y = PH - M; }
    }
  };

  for(const linha of linhas){
    if(y < M + 20){ pg = pdfDoc.addPage([PW, PH]); y = PH - M; }
    if(linha.trim() === ''){
      flush();
      y -= 6;
    } else {
      bufferLinha += (bufferLinha ? ' ' : '') + linha;
      if(font.widthOfTextAtSize(bufferLinha, 10) > W){
        flush();
      }
    }
  }
  flush();

  const bytes = await pdfDoc.save();
  res.setHeader('Content-Type','application/pdf');
  res.setHeader('Content-Disposition','attachment; filename="convertido.pdf"');
  res.send(Buffer.from(bytes));
}));

module.exports = router;
