// =====================================================================
//  OCR Servidor — Tesseract via WebAssembly puro, rodando NO SERVIDOR.
//  Desenhado para caber no plano free do Render (512MB RAM, sem GPU):
//   - sem binários nativos, sem apt, sem Python, sem GPU;
//   - só JS + ~2MB de dados de português baixados na 1ª execução;
//   - worker único reutilizado (singleton) entre requisições.
//  Recebe IMAGENS (JPEG/PNG). Páginas de PDF são rasterizadas NO NAVEGADOR
//  (que renderiza perfeitamente) e enviadas prontas pelo endpoint
//  /api/termos/autorenomear-ocr — rasterizar no servidor é inviável
//  (o render do pdfjs trava nativo com qualquer canvas server-side).
//  Cobre OCR de impresso + associação rótulo→valor (via motor regex
//  existente). NÃO cobre ICR/manuscrito — isso exige modelos pesados
//  (Paddle/EasyOCR+Torch) que não cabem no free; manuscrito continua manual.
// =====================================================================

const sharp = require('sharp');

let worker = null;
let workerPronto = false;

async function getWorker(logger) {
  if (worker && workerPronto) return worker;
  const Tesseract = require('tesseract.js');
  const w = await Tesseract.createWorker('por', 1, {
    logger: logger || (() => {}),
    cacheMethod: 'refresh',
    gzip: true
  });
  await w.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
  worker = w;
  workerPronto = true;
  return worker;
}

// Descarta o worker (ex.: após timeout com worker preso). O próximo uso
// recria do zero.
async function resetOcrServidor() {
  const w = worker;
  worker = null;
  workerPronto = false;
  try { if (w && w.terminate) await w.terminate(); } catch (e) {}
}

// Rejeita se o OCR estourar o tempo (evita requisição presa no free).
function comTimeout(promise, ms, rotulo) {
  let timer = null;
  return Promise.race([
    promise.finally ? promise : Promise.resolve(promise),
    new Promise((_, rej) => {
      timer = setTimeout(() => rej(new Error(rotulo || 'timeout no OCR servidor')), ms);
    })
  ]).finally(() => { if (timer) clearTimeout(timer); });
}

// Normaliza imagem para o OCR: limita largura (CPU fraca) via sharp.
// maxW padrão 1200: impresso continua legível e o OCR fica ~5x mais rápido
// que em 2000px (medido: foto 3000px 2912ms -> 531ms, mesma precisão).
async function normalizarImagem(buffer, maxW) {
  const limite = maxW || 1200;
  try {
    let img = sharp(buffer);
    const meta = await img.metadata();
    if (meta.width && meta.width > limite) {
      img = img.resize({ width: limite });
    }
    // Enhance image for better OCR: increase contrast, sharpen
    img = img
      .normalize()           // normalize histogram
      .sharpen(2, 1, 2)      // sigma, flat, jagged
      .modulate({ brightness: 1.1, saturation: 0 })  // slight brightness boost, desaturate
      .jpeg({ quality: 90 });
    return await img.toBuffer();
  } catch (e) { /* segue com o original */ }
  return buffer;
}

// Redimensiona para a largura máxima + JPEG (via rápida, sem filtros).
async function redimensionar(buffer, maxW) {
  const limite = maxW || 1200;
  try {
    let img = sharp(buffer);
    const meta = await img.metadata();
    if (meta.width && meta.width > limite) img = img.resize({ width: limite });
    return await img.jpeg({ quality: 85 }).toBuffer();
  } catch (e) { /* segue com o original */ }
  return buffer;
}

// OCR de UMA imagem (buffer JPEG/PNG) -> texto.
// Via rápida primeiro (só reduz + JPEG): suficiente p/ imagem limpa e bem
// mais rápida. Se sair pouco texto (<20 chars), repete com os filtros
// completos (normalize/sharpen) para scans ruidosos — precisão preservada.
async function ocrImagem(buffer, opts) {
  const o = opts || {};
  const src = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const w = await getWorker(o.logger);
  // Melhor configuração para documentos formulários
  await w.setParameters({
    tessedit_pageseg_mode: '4',  // PSM 4: single column of text
    preserve_interword_spaces: '1',
    tessedit_ocr_engine_mode: '1',  // LSTM only
    tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzÀ-ÖØ-öø-ÿ0123456789.,:;/\\()-',
  });
  const rapido = await redimensionar(src, o.maxW);
  let r = await w.recognize(rapido);
  let texto = String((r.data && r.data.text) || '').trim();
  if (texto.replace(/\s/g, '').length >= 20) return texto;
  const full = await normalizarImagem(src, o.maxW);
  r = await w.recognize(full);
  return String((r.data && r.data.text) || '').trim();
}

// pdfjs-dist v5 (ESM) — importa dinamicamente para CJS funcionar
async function carregarPdfjs() {
  try { return require('pdfjs-dist/legacy/build/pdf.js'); } catch (_) {
    const m = await import('pdfjs-dist/legacy/build/pdf.mjs');
    return m.default || m;
  }
}

module.exports = { ocrImagem, comTimeout, resetOcrServidor, getWorker, carregarPdfjs };