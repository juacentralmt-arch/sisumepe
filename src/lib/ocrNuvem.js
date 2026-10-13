// =====================================================================
//  OCR em nuvem (OPCIONAL) — OCR.space, plano gratuito (25 mil req/mês,
//  sem cartão; chave grátis em https://ocr.space/ocrapi).
//  Só ativa com OCR_SPACE_KEY no ambiente. Sem chave, tudo segue local
//  (nativo/WASM) e este módulo nunca é chamado de verdade.
//  ATENÇÃO (LGPD): com a chave configurada, a IMAGEM é enviada para
//  processamento externo (OCR.space, EUA). Documentos oficiais contêm dados
//  pessoais — avalie com a coordenação antes de ativar em produção.
//  Uso: fallback rápido e mais preciso que o Tesseract em scans ruidosos,
//  antes do WASM local. Imagens já chegam pequenas (JPEG do navegador);
//  aqui garante o teto de 1MB do plano gratuito.
// =====================================================================

const sharp = require('sharp');

const OCR_SPACE_URL = (process.env.OCR_SPACE_URL || 'https://api.ocr.space/parse/image').replace(/\/$/, '');
const OCR_TIMEOUT_MS = Number(process.env.OCR_SPACE_TIMEOUT_MS) || 90000;

function chaveConfigurada() {
  return !!(process.env.OCR_SPACE_KEY && String(process.env.OCR_SPACE_KEY).trim());
}

// Reduz para o teto gratuito (1MB): ~1400px + JPEG 70. Retorna Buffer.
async function enquadrarGratuito(buffer) {
  try {
    let img = sharp(buffer);
    const meta = await img.metadata();
    if (meta.width && meta.width > 1400) img = img.resize({ width: 1400 });
    const out = await img.jpeg({ quality: 70 }).toBuffer();
    if (out.length > 1024 * 1024) {
      return await sharp(out).resize({ width: 1000 }).jpeg({ quality: 60 }).toBuffer();
    }
    return out;
  } catch (e) { return buffer; }
}

function extrairTextoResposta(json) {
  if (!json || typeof json !== 'object') return '';
  const resultados = Array.isArray(json.ParsedResults) ? json.ParsedResults : [];
  return resultados.map(r => String((r && r.ParsedText) || '')).join('\n').trim();
}

// OCR de UMA imagem (buffer) -> texto. Sem chave: resolve '' (cadeia segue).
async function ocrImagemNuvem(buffer, opts) {
  if (!chaveConfigurada()) return '';
  const o = opts || {};
  const img = await enquadrarGratuito(Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer));
  const fd = new FormData();
  fd.append('apikey', String(process.env.OCR_SPACE_KEY).trim());
  fd.append('language', 'por');
  fd.append('OCREngine', '2');
  fd.append('scale', 'true');
  fd.append('isOverlayRequired', 'false');
  fd.append('file', new Blob([img], { type: 'image/jpeg' }), 'pagina.jpg');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), o.timeoutMs || OCR_TIMEOUT_MS);
  try {
    const res = await fetch(OCR_SPACE_URL, { method: 'POST', body: fd, signal: ctrl.signal });
    if (!res.ok) throw new Error('OCR.space HTTP ' + res.status);
    const json = await res.json().catch(() => null);
    if (json && json.IsErroredOnProcessing) {
      const msg = Array.isArray(json.ErrorMessage) ? json.ErrorMessage.join('; ') : String(json.ErrorMessage || 'erro');
      throw new Error('OCR.space: ' + msg.slice(0, 200));
    }
    return extrairTextoResposta(json);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { ocrImagemNuvem, chaveConfigurada, extrairTextoResposta, enquadrarGratuito };
