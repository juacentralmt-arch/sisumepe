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
async function normalizarImagem(buffer, maxW) {
  const limite = maxW || 2000;
  try {
    const meta = await sharp(buffer).metadata();
    if (meta.width && meta.width > limite) {
      return await sharp(buffer).resize({ width: limite }).jpeg({ quality: 85 }).toBuffer();
    }
  } catch (e) { /* segue com o original */ }
  return buffer;
}

// OCR de UMA imagem (buffer JPEG/PNG) -> texto.
async function ocrImagem(buffer, opts) {
  const o = opts || {};
  const buf = await normalizarImagem(Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer), o.maxW);
  const w = await getWorker(o.logger);
  const { data } = await w.recognize(buf);
  return String((data && data.text) || '').trim();
}

module.exports = { ocrImagem, comTimeout, resetOcrServidor, getWorker };
