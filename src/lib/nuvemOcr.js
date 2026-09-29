// =====================================================================
//  NuvemOCR — OCR em nuvem para o AutoRenomear 2.
//  Provider: OCR.space (plano gratuito: 25 mil conversões/mês, sem cartão).
//  Chave gratuita em https://ocr.space/ocrapi -> configura em OCRSPACE_KEY.
//  Recebe buffers de imagem (JPEG/PNG das páginas) e devolve o texto.
// =====================================================================

const OCRSPACE_URL = 'https://api.ocr.space/parse/image';

function chaveNuvemOcr() {
  return String(process.env.OCRSPACE_KEY || process.env.OCR_SPACE_KEY || '').trim();
}

function temNuvemOcr() {
  return !!chaveNuvemOcr();
}

// Extrai texto de até 3 imagens (páginas). Lança erro com .status quando
// a chave não está configurada (400) ou a nuvem falha (502).
async function ocrEspacoNuvem(buffers, opts) {
  const key = chaveNuvemOcr();
  if (!key) {
    const e = new Error('OCR em nuvem não configurado — cadastre a chave gratuita (OCRSPACE_KEY) no servidor');
    e.status = 400;
    throw e;
  }
  const lista = (Array.isArray(buffers) ? buffers : []).filter(Boolean).slice(0, 3);
  if (!lista.length) {
    const e = new Error('Nenhuma imagem para enviar à nuvem');
    e.status = 400;
    throw e;
  }
  const timeoutMs = (opts && Number(opts.timeoutMs)) || 90000;
  const textos = [];
  for (let k = 0; k < lista.length; k++) {
    const buf = Buffer.isBuffer(lista[k]) ? lista[k] : Buffer.from(lista[k]);
    const form = new FormData();
    form.append('apikey', key);
    form.append('language', 'por');
    form.append('OCREngine', '2');
    form.append('scale', 'true');
    form.append('detectOrientation', 'true');
    form.append('isOverlayRequired', 'false');
    form.append('file', new Blob([buf], { type: 'image/jpeg' }), 'pagina' + (k + 1) + '.jpg');
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    let r;
    try {
      r = await fetch(OCRSPACE_URL, { method: 'POST', body: form, signal: ctrl.signal });
    } catch (e) {
      clearTimeout(t);
      const err = new Error('OCR em nuvem inacessível — verifique a internet do servidor (' + (e.message || 'falha de rede') + ')');
      err.status = 502;
      throw err;
    }
    clearTimeout(t);
    if (!r.ok) {
      const err = new Error('OCR em nuvem falhou (HTTP ' + r.status + ')');
      err.status = 502;
      throw err;
    }
    const j = await r.json().catch(() => ({}));
    const ok = j.OCRExitCode === 1 || j.OCRExitCode === 2;
    const txt = ((j.ParsedResults || []).map(p => (p && p.ParsedText) || '').join('\n')).trim();
    if (!ok || !txt) {
      const detalhe = j.ErrorMessage || ((j.ParsedResults || []).map(p => p && (p.ErrorDetails || p.ErrorMessage)).filter(Boolean).join('; ')) || 'sem texto retornado';
      const err = new Error('OCR em nuvem: ' + String(detalhe).slice(0, 200));
      err.status = 502;
      throw err;
    }
    textos.push(txt);
  }
  return textos.join('\n');
}

module.exports = { ocrEspacoNuvem, temNuvemOcr, chaveNuvemOcr };
