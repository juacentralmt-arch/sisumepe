// =====================================================================
//  Teste do OCR Servidor (src/lib/ocrServidor.js) — Tesseract WASM no Node.
//  Gera imagem sintética com texto conhecido e confere a leitura fim a fim
//  (OCR -> sugerirNome). Páginas de PDF são rasterizadas NO NAVEGADOR
//  (endpoint /api/termos/autorenomear-ocr), então não há teste de PDF aqui.
//  Exige internet na 1ª execução (baixa ~2MB de dados de português).
//  Mesmo estilo dos demais testes: script puro, sem framework.
// =====================================================================
const { createCanvas } = require('canvas');
const ocr = require('../src/lib/ocrServidor');

let passed = 0, failed = 0, skipped = false;
function assert(condition, msg) {
  if (skipped) return;
  if (condition) { console.log('  ✅', msg); passed++; }
  else { console.log('  ❌', msg); failed++; }
}
function skip(msg) {
  console.log('  ⏭️ SKIP:', msg);
  skipped = true;
}

function desenharPagina() {
  const canvas = createCanvas(1650, 900);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 1650, 900);
  ctx.fillStyle = '#000000';
  ctx.font = 'bold 64px sans-serif';
  ctx.fillText('TERMO DE RECOLHIMENTO', 120, 140);
  ctx.font = '48px sans-serif';
  ctx.fillText('MONITORADO(A): Maria da Silva', 120, 260);
  ctx.fillText('Data/Hora: 28/08/2026', 120, 340);
  ctx.fillText('N: 4212024905', 120, 420);
  return canvas.toBuffer('image/png');
}

(async () => {
  console.log('\n=== TESTES OCR SERVIDOR (Tesseract WASM, por) ===');

  // 1) OCR de imagem
  let textoImg = '';
  try {
    textoImg = await ocr.comTimeout(ocr.ocrImagem(desenharPagina()), 180000, 'timeout');
  } catch (e) {
    if (/fetch|network|ENOTFOUND|EAI_AGAIN|abort|load|download/i.test(e.message || '')) return skip('sem internet p/ dados de idioma: ' + e.message);
    console.log('  ❌ ocrImagem lançou: ' + e.message);
    process.exitCode = 1;
    return;
  }
  const n = String(textoImg).toLowerCase();
  assert(n.includes('monitorado'), 'imagem: lê rótulo MONITORADO');
  assert(n.includes('maria da silva'), 'imagem: lê nome impresso — trecho: "' + String(textoImg).replace(/\s+/g, ' ').slice(0, 80) + '"');
  assert(/28\/08\/2026/.test(textoImg), 'imagem: lê data do conteúdo');

  // 2) fim a fim: texto do OCR alimenta o sugerirNome
  if (!skipped) {
    const { sugerirNome } = require('../src/lib/autoRenomear');
    const r = sugerirNome(String(textoImg).slice(0, 8000), 'teste.jpg');
    assert(r.nome === 'Maria da Silva', 'fim a fim: nome extraído — "' + r.nome + '"');
    assert(r.dataISO === '2026-08-28', 'fim a fim: data extraída — "' + r.dataISO + '"');
  }

  console.log(`\n=== RESULTADO: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exitCode = 1;
})()
  .catch(e => { console.log('  ❌ fatal: ' + (e && e.message)); process.exitCode = 1; })
  .finally(async () => {
    // Worker Tesseract mantém o event loop vivo: encerra e sai explícito.
    try { await ocr.resetOcrServidor(); } catch (e) {}
    process.exit(process.exitCode || 0);
  });
