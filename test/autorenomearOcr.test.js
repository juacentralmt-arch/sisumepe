// =====================================================================
//  Teste do endpoint /api/termos/autorenomear-ocr com early-exit:
//  a 1ª imagem (recorte do cabeçalho) já rende tipo+nome+data, então o
//  servidor deve processar só 1 imagem mesmo recebendo 2.
//  Script puro (sem framework), no estilo das demais suítes.
// =====================================================================
let passed = 0, failed = 0;
const assert = (cond, msg) => {
  if (cond) { console.log('  ✅', msg); passed++; }
  else { console.log('  ❌', msg); failed++; }
};

process.env.SUPABASE_URL = '';
process.env.SUPABASE_KEY = '';

const express = require('express');
const { createCanvas } = require('canvas');
const shared = require('../src/lib/shared');
shared.auth = (roles) => (req, res, next) => {
  if (!req.auth) return res.status(401).json({ error: 'sem auth (teste)' });
  if (roles && roles.length && !roles.includes(req.auth.role)) return res.status(403).json({ error: 'Acesso restrito ao seu perfil.' });
  next();
};
const termosRouter = require('../src/routes/termos');

const app = express();
app.use((req, res, next) => {
  req.auth = { role: 'tecnico', user: 'tec1', name: 'Tec Um', sistema: 'spacecom', token: 't' };
  next();
});
app.use(termosRouter);

const server = app.listen(0);
const BASE = 'http://127.0.0.1:' + server.address().port;

function paginaLegivel() {
  const canvas = createCanvas(1200, 700);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 1200, 700);
  ctx.fillStyle = '#000000';
  ctx.font = 'bold 56px sans-serif';
  ctx.fillText('TERMO DE RECOLHIMENTO', 80, 120);
  ctx.font = '44px sans-serif';
  ctx.fillText('MONITORADO(A): Maria da Silva', 80, 240);
  ctx.fillText('Data/Hora: 28/08/2026', 80, 320);
  return canvas.toBuffer('image/png');
}

function paginaEmBranco() {
  const canvas = createCanvas(800, 600);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 800, 600);
  return canvas.toBuffer('image/png');
}

(async () => {
  console.log('\n=== AUTORENOMEAR-OCR — early-exit ===');
  const img = paginaLegivel();  // 2 imagens legíveis: a 1ª já basta -> early-exit processa só 1
  {
    const t0 = Date.now();
    const fd = new FormData();
    fd.append('arquivo', 'termo.pdf');
    fd.append('imagens', new Blob([img], { type: 'image/png' }), 'pagina1.png');
    fd.append('imagens', new Blob([img], { type: 'image/png' }), 'pagina2.png');
    const res = await fetch(BASE + '/api/termos/autorenomear-ocr', { method: 'POST', body: fd });
    const j = await res.json().catch(() => ({}));
    const ms = Date.now() - t0;
    assert(res.status === 200, `ocr endpoint: 200 (${ms}ms)`);
    assert(j.nome === 'Maria da Silva', 'ocr endpoint: nome — "' + j.nome + '"');
    assert(j.imagensProcessadas === 1, `ocr endpoint: early-exit processou 1 de 2 (imagensProcessadas=${j.imagensProcessadas})`);
  }
  // imagem em branco -> 502
  {
    const fd = new FormData();
    fd.append('arquivo', 'branco.pdf');
    fd.append('imagens', new Blob([paginaEmBranco()], { type: 'image/png' }), 'branco.png');
    const res = await fetch(BASE + '/api/termos/autorenomear-ocr', { method: 'POST', body: fd });
    assert(res.status === 502, 'ocr endpoint branco: 502');
  }

  try { await require('../src/lib/ocrServidor').resetOcrServidor(); } catch {}
  server.close();
  console.log(`\n=== RESULTADO: ${passed} passed, ${failed} failed ===`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('FALHA:', e); server.close(); process.exit(1); });
