// =====================================================================
//  Testes das ferramentas PDF novas: watermark, pagenumber, remove-pages
//  (as 6 originais seguem o mesmo padrão pdf-lib já validado em produção)
//  Script puro (sem framework), no estilo das demais suítes do projeto.
// =====================================================================
let passed = 0, failed = 0;
const assert = (cond, msg) => {
  if (cond) { console.log('  ✅', msg); passed++; }
  else { console.log('  ❌', msg); failed++; }
};

process.env.SUPABASE_URL = '';
process.env.SUPABASE_KEY = '';

const express = require('express');
const { PDFDocument } = require('pdf-lib');
const shared = require('../src/lib/shared');
shared.auth = (roles) => (req, res, next) => {
  if (!req.auth) return res.status(401).json({ error: 'sem auth (teste)' });
  if (roles && roles.length && !roles.includes(req.auth.role)) return res.status(403).json({ error: 'Acesso restrito ao seu perfil.' });
  next();
};
const pdfRouter = require('../src/routes/pdfTools');

const app = express();
app.use((req, res, next) => {
  req.auth = { role: 'tecnico', user: 'tec1', name: 'Tec Um', sistema: 'spacecom', token: 't' };
  next();
});
app.use(pdfRouter);

const server = app.listen(0);
const BASE = 'http://127.0.0.1:' + server.address().port;

async function makePdf(n) {
  const d = await PDFDocument.create();
  for (let i = 0; i < n; i++) d.addPage([595.28, 841.89]);
  return Buffer.from(await d.save());
}
async function postPdf(path, pdfBuf, fields) {
  const fd = new FormData();
  fd.append('file', new Blob([pdfBuf], { type: 'application/pdf' }), 'doc.pdf');
  for (const [k, v] of Object.entries(fields || {})) fd.append(k, v);
  const res = await fetch(BASE + path, { method: 'POST', body: fd });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, ct: res.headers.get('content-type') || '', buf };
}

(async () => {
  console.log('\n=== PDF TOOLS — watermark / pagenumber / remove-pages ===');
  const pdf3 = await makePdf(3);

  // watermark centro
  let r = await postPdf('/api/pdf/watermark', pdf3, { text: 'CONFIDENCIAL', pos: 'centro' });
  assert(r.status === 200, 'watermark: 200');
  assert(/application\/pdf/.test(r.ct), 'watermark: content-type pdf');
  assert((await PDFDocument.load(r.buf)).getPageCount() === 3, 'watermark: mantém 3 páginas');

  // watermark rodapé
  r = await postPdf('/api/pdf/watermark', pdf3, { text: 'X', pos: 'rodape' });
  assert(r.status === 200, 'watermark rodapé: 200');

  // watermark sem texto -> 400
  r = await postPdf('/api/pdf/watermark', pdf3, { text: '' });
  assert(r.status === 400, 'watermark sem texto: 400');

  // pagenumber
  r = await postPdf('/api/pdf/pagenumber', pdf3, { inicio: '5', pos: 'direita' });
  assert(r.status === 200, 'pagenumber: 200');
  assert((await PDFDocument.load(r.buf)).getPageCount() === 3, 'pagenumber: mantém 3 páginas');

  // remove-pages: tira 2 de 3
  r = await postPdf('/api/pdf/remove-pages', pdf3, { pages: '2' });
  assert(r.status === 200, 'remove-pages: 200');
  assert((await PDFDocument.load(r.buf)).getPageCount() === 2, 'remove-pages: 3 -> 2 páginas');

  // remove-pages: intervalo
  const pdf5 = await makePdf(5);
  r = await postPdf('/api/pdf/remove-pages', pdf5, { pages: '1,4-5' });
  assert(r.status === 200, 'remove-pages intervalo: 200');
  assert((await PDFDocument.load(r.buf)).getPageCount() === 2, 'remove-pages intervalo: 5 -> 2 páginas');

  // remove-pages: todas -> 400
  r = await postPdf('/api/pdf/remove-pages', pdf3, { pages: '1-3' });
  assert(r.status === 400, 'remove-pages todas: 400');

  // remove-pages: sem páginas -> 400
  r = await postPdf('/api/pdf/remove-pages', pdf3, {});
  assert(r.status === 400, 'remove-pages vazio: 400');

  // arquivo não-PDF -> 400
  r = await postPdf('/api/pdf/watermark', Buffer.from('nao é pdf'), { text: 'X' });
  assert(r.status === 400, 'watermark não-PDF: 400');

  console.log('\n=== PDF TOOLS — text / split-zip ===');
  // text: pdf com texto
  const { StandardFonts } = require('pdf-lib');
  const dt = await PDFDocument.create();
  const pg = dt.addPage([595.28, 841.89]);
  const fnt = await dt.embedFont(StandardFonts.Helvetica);
  pg.drawText('Ola mundo SISUMEPE', { x: 50, y: 700, size: 14, font: fnt });
  const pdfTxt = Buffer.from(await dt.save());
  {
    const fd = new FormData();
    fd.append('file', new Blob([pdfTxt], { type: 'application/pdf' }), 'doc.pdf');
    const res = await fetch(BASE + '/api/pdf/text', { method: 'POST', body: fd });
    const body = await res.text();
    assert(res.status === 200, 'text: 200');
    assert(/text\/plain/.test(res.headers.get('content-type') || ''), 'text: content-type txt');
    assert(body.includes('SISUMEPE'), 'text: contém o texto do PDF');
  }
  // text: pdf sem texto -> 400
  {
    const fd = new FormData();
    fd.append('file', new Blob([pdf3], { type: 'application/pdf' }), 'vazio.pdf');
    const res = await fetch(BASE + '/api/pdf/text', { method: 'POST', body: fd });
    assert(res.status === 400, 'text sem texto: 400');
  }
  // split-zip: 3 páginas -> zip com 3 entradas
  {
    const fd = new FormData();
    fd.append('file', new Blob([pdf3], { type: 'application/pdf' }), 'doc.pdf');
    const res = await fetch(BASE + '/api/pdf/split-zip', { method: 'POST', body: fd });
    const buf = Buffer.from(await res.arrayBuffer());
    assert(res.status === 200, 'split-zip: 200');
    assert(/application\/zip/.test(res.headers.get('content-type') || ''), 'split-zip: content-type zip');
    assert(buf.slice(0, 2).toString() === 'PK', 'split-zip: assinatura PK');
    const names = (buf.toString('binary').match(/pagina-\d+\.pdf/g) || []);
    assert(new Set(names).size === 3, 'split-zip: 3 entradas pagina-NN.pdf');
  }
  // split-zip: 1 página -> 400
  {
    const one = await makePdf(1);
    const fd = new FormData();
    fd.append('file', new Blob([one], { type: 'application/pdf' }), 'um.pdf');
    const res = await fetch(BASE + '/api/pdf/split-zip', { method: 'POST', body: fd });
    assert(res.status === 400, 'split-zip 1 página: 400');
  }
  // split-zip com seleção: 5 páginas, pede "2,4-5" -> zip com 3 entradas
  {
    const pdf5sel = await makePdf(5);
    const r = await postPdf('/api/pdf/split-zip', pdf5sel, { pages: '2,4-5' });
    assert(r.status === 200, 'split-zip seleção: 200');
    assert(/application\/zip/.test(r.ct), 'split-zip seleção: content-type zip');
    const names = (r.buf.toString('binary').match(/pagina-\d+\.pdf/g) || []);
    const uniq = [...new Set(names)].sort();
    assert(uniq.length === 3, 'split-zip seleção: 3 entradas');
    assert(uniq.join(',') === 'pagina-02.pdf,pagina-04.pdf,pagina-05.pdf', 'split-zip seleção: páginas 02,04,05');
  }
  // split-zip com seleção inválida -> 400
  {
    const pdf5inv = await makePdf(5);
    const r = await postPdf('/api/pdf/split-zip', pdf5inv, { pages: '99' });
    assert(r.status === 400, 'split-zip seleção inválida: 400');
  }

  console.log('\n=== PDF TOOLS — merge / split / rotate / compress / jpg-to-pdf ===');
  // merge: 2 PDFs de 2 págs -> 4 págs; 1 arquivo -> 400
  {
    const a = await makePdf(2), b = await makePdf(2);
    const fd = new FormData();
    fd.append('files', new Blob([a], { type: 'application/pdf' }), 'a.pdf');
    fd.append('files', new Blob([b], { type: 'application/pdf' }), 'b.pdf');
    const res = await fetch(BASE + '/api/pdf/merge', { method: 'POST', body: fd });
    const buf = Buffer.from(await res.arrayBuffer());
    assert(res.status === 200, 'merge: 200');
    assert((await PDFDocument.load(buf)).getPageCount() === 4, 'merge: 2+2 -> 4 páginas');
  }
  {
    const a = await makePdf(1);
    const fd = new FormData();
    fd.append('files', new Blob([a], { type: 'application/pdf' }), 'a.pdf');
    const res = await fetch(BASE + '/api/pdf/merge', { method: 'POST', body: fd });
    assert(res.status === 400, 'merge 1 arquivo: 400');
  }
  // split: "3,1" preserva a ordem pedida; sem param -> 400; invertido "5-4" vale
  {
    const pdf5 = await makePdf(5);
    const r = await postPdf('/api/pdf/split', pdf5, { pages: '2,4-5' });
    assert(r.status === 200, 'split: 200');
    assert((await PDFDocument.load(r.buf)).getPageCount() === 3, 'split 2,4-5: 3 páginas');
  }
  {
    const pdf5 = await makePdf(5);
    const fd = new FormData();
    fd.append('file', new Blob([pdf5], { type: 'application/pdf' }), 'doc.pdf');
    const res = await fetch(BASE + '/api/pdf/split', { method: 'POST', body: fd });
    assert(res.status === 400, 'split sem páginas: 400');
  }
  {
    const pdf5 = await makePdf(5);
    const r = await postPdf('/api/pdf/extract', pdf5, { pages: '5-4' });
    assert(r.status === 200, 'extract invertido 5-4: 200');
    assert((await PDFDocument.load(r.buf)).getPageCount() === 2, 'extract 5-4: 2 páginas');
  }
  // rotate: 90 ok; 0 agora é 400 (front só oferece 90/180/270)
  {
    const pdf2 = await makePdf(2);
    const r = await postPdf('/api/pdf/rotate', pdf2, { angle: '90' });
    assert(r.status === 200, 'rotate 90: 200');
    assert((await PDFDocument.load(r.buf)).getPageCount() === 2, 'rotate: mantém 2 páginas');
    const r0 = await postPdf('/api/pdf/rotate', pdf2, { angle: '0' });
    assert(r0.status === 400, 'rotate 0: 400');
  }
  // compress: 200 + header metadata-only honesto
  {
    const pdf2 = await makePdf(2);
    const fd = new FormData();
    fd.append('file', new Blob([pdf2], { type: 'application/pdf' }), 'doc.pdf');
    const res = await fetch(BASE + '/api/pdf/compress', { method: 'POST', body: fd });
    assert(res.status === 200, 'compress: 200');
    assert(res.headers.get('x-compress-note') === 'metadata-only', 'compress: header metadata-only');
  }
  // jpg-to-pdf: 1 PNG 1x1 -> 1 página
  {
    const png1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const fd = new FormData();
    fd.append('files', new Blob([png1x1], { type: 'image/png' }), 'p.png');
    const res = await fetch(BASE + '/api/pdf/jpg-to-pdf', { method: 'POST', body: fd });
    const buf = Buffer.from(await res.arrayBuffer());
    assert(res.status === 200, 'jpg-to-pdf: 200');
    assert((await PDFDocument.load(buf)).getPageCount() === 1, 'jpg-to-pdf: 1 imagem -> 1 página');
  }

  // ===== Novas ferramentas: redact / header-footer / resize-pages =====
  // redact com áreas válidas
  {
    const pdf = await makePdf(2);
    const fd = new FormData();
    fd.append('file', new Blob([pdf], { type: 'application/pdf' }), 'doc.pdf');
    fd.append('areas', JSON.stringify([{ page: 1, x: 100, y: 100, w: 200, h: 50 }, { page: 2, x: 50, y: 50, w: 100, h: 30 }]));
    const res = await fetch(BASE + '/api/pdf/redact', { method: 'POST', body: fd });
    assert(res.status === 200, 'redact: 200');
    assert((await PDFDocument.load(Buffer.from(await res.arrayBuffer()))).getPageCount() === 2, 'redact: mantém 2 páginas');
  }
  // redact sem áreas -> 400
  {
    const pdf = await makePdf(1);
    const fd = new FormData();
    fd.append('file', new Blob([pdf], { type: 'application/pdf' }), 'doc.pdf');
    const res = await fetch(BASE + '/api/pdf/redact', { method: 'POST', body: fd });
    assert(res.status === 400, 'redact sem áreas: 400');
  }
  // header-footer com textos
  {
    const pdf = await makePdf(2);
    const fd = new FormData();
    fd.append('file', new Blob([pdf], { type: 'application/pdf' }), 'doc.pdf');
    fd.append('headerText', 'CONFIDENCIAL');
    fd.append('footerText', 'Página');
    fd.append('headerPos', 'centro');
    fd.append('footerPos', 'direita');
    const res = await fetch(BASE + '/api/pdf/header-footer', { method: 'POST', body: fd });
    assert(res.status === 200, 'header-footer: 200');
    assert(/application\/pdf/.test(res.headers.get('content-type')||''), 'header-footer: content-type pdf');
  }
  // header-footer sem textos -> 400
  {
    const pdf = await makePdf(1);
    const fd = new FormData();
    fd.append('file', new Blob([pdf], { type: 'application/pdf' }), 'doc.pdf');
    const res = await fetch(BASE + '/api/pdf/header-footer', { method: 'POST', body: fd });
    assert(res.status === 400, 'header-footer sem texto: 400');
  }

  server.close();
  console.log(`\n=== RESULTADO: ${passed} passed, ${failed} failed ===`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FALHA:', e); server.close(); process.exit(1); });
