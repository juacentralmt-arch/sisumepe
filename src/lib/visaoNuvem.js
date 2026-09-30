// =====================================================================
//  VisaoNuvem — identifica dados do documento com IA MULTIMODAL de nuvem
//  (Google Gemini, plano gratuito, sem cartão) para o AutoRenomear.
//  Cobre as 4 técnicas pedidas numa única chamada de visão + linguagem:
//   - Visão Computacional Multimodal: modelo visão+linguagem em alta resolução;
//   - OCR: texto impresso/digitado das páginas digitalizadas;
//   - ICR: escrita manual (assinatura do campo ASSINATURA) via deep learning;
//   - Layout Analysis: associa RÓTULO → VALOR (ex: "MONITORADO(A):" → nome,
//     "Data/Hora:" → data, "Nº:" → dispositivo) pela estrutura visual.
//  A chave fica SÓ no servidor (GEMINI_KEY). Sem chave, tudo lança 400 e a
//  interface mantém o OCR local 100% on-prem.
// =====================================================================

const { sugerirNome } = require('./autoRenomear');

function chaveVisao() {
  return String(process.env.GEMINI_KEY || '').trim();
}

function temVisaoNuvem() {
  return !!chaveVisao();
}

function modeloVisao() {
  return String(process.env.GEMINI_MODEL || 'gemini-2.0-flash').trim() || 'gemini-2.0-flash';
}

const PROMPT_VISAO = [
  'Você extrai dados de documentos oficiais digitalizados (COMEP/CE, termos de monitoração eletrônica).',
  'Analise a(s) imagem(ns) — texto impresso (OCR), escrita manual/assinatura (ICR) e ESTRUTURA visual (associe cada RÓTULO ao seu VALOR: "MONITORADO(A):" → nome, "Data/Hora:" → data, "Nº:" → dispositivo, "ASSINATURA" → nome manuscrito).',
  'Responda SOMENTE com JSON válido, sem markdown, neste formato exato:',
  '{"tipo":"...","nome_monitorado":"...","data_documento":"AAAA-MM-DD","numero_dispositivo":"...","assinatura_manuscrita":"..."}',
  'Regras: tipo é o título do documento (ex: "TERMO DE RECOLHIMENTO"); nome_monitorado é o valor IMPRESSO do campo MONITORADO(A) ("" se ilegível/ausente); assinatura_manuscrita é o nome MANUSCRITO do campo ASSINATURA transcrito ("" se ilegível); data_documento é a data do campo Data/Hora em AAAA-MM-DD ("" se ausente); numero_dispositivo é o Nº da inspeção/dispositivo ("" se ausente). NUNCA invente dados: só transcreva o visível.'
].join('\n');

function limparCampo(v, max) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max || 120);
}

// Normaliza/valida o JSON da IA para campos conhecidos.
function normalizarCampos(j) {
  const o = (j && typeof j === 'object') ? j : {};
  const data = limparCampo(o.data_documento, 10);
  return {
    tipo: limparCampo(o.tipo, 120),
    nome_monitorado: limparCampo(o.nome_monitorado, 120),
    data_documento: /^\d{4}-\d{2}-\d{2}$/.test(data) ? data : '',
    numero_dispositivo: limparCampo(o.numero_dispositivo, 30),
    assinatura_manuscrita: limparCampo(o.assinatura_manuscrita, 120)
  };
}

// Monta um texto sintético rotulado a partir dos campos e reaproveita TODO o
// motor determinístico (detectarTipo, extrairNome, extrairDataISO, confiança,
// avisos, sugestão). Preferência: valor impresso do rótulo; fallback: ICR da
// assinatura manuscrita.
function textoDeCampos(f) {
  const partes = [];
  if (f.tipo) partes.push(f.tipo);
  const nome = f.nome_monitorado || f.assinatura_manuscrita || '';
  if (nome) partes.push('MONITORADO(A): ' + nome);
  if (f.data_documento) {
    const m = f.data_documento.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m && +m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31) partes.push('Data: ' + m[3] + '/' + m[2] + '/' + m[1]);
  }
  if (f.numero_dispositivo) partes.push('Nº: ' + f.numero_dispositivo);
  return partes.join('\n');
}

function interpretarVisao(campos, nomeOriginal) {
  const f = normalizarCampos(campos);
  const r = sugerirNome(textoDeCampos(f), nomeOriginal);
  const resumo = [
    f.nome_monitorado && ('nome=' + f.nome_monitorado),
    f.assinatura_manuscrita && ('assinatura=' + f.assinatura_manuscrita),
    f.data_documento && ('data=' + f.data_documento),
    f.numero_dispositivo && ('disp=' + f.numero_dispositivo)
  ].filter(Boolean).join(' ');
  return { ...r, trecho: ('IA visão • ' + (resumo || 'nada legível')).slice(0, 1500), visao: true };
}

// Envia até 3 imagens (buffers JPEG/PNG) ao Gemini e devolve os campos.
// Erros carregam .status (400 sem chave, 502 falha/inválido).
async function ocrVisaoNuvem(buffers, opts) {
  const key = chaveVisao();
  if (!key) {
    const e = new Error('IA de visão não configurada — cadastre a chave gratuita (GEMINI_KEY) no servidor');
    e.status = 400;
    throw e;
  }
  const lista = (Array.isArray(buffers) ? buffers : []).filter(Boolean).slice(0, 3);
  if (!lista.length) {
    const e = new Error('Nenhuma imagem para enviar à IA de visão');
    e.status = 400;
    throw e;
  }
  let total = 0;
  const parts = [{ text: PROMPT_VISAO }];
  for (const b of lista) {
    const buf = Buffer.isBuffer(b) ? b : Buffer.from(b);
    total += buf.length;
    if (total > 6 * 1024 * 1024) {
      const e = new Error('Imagens grandes demais para a IA de visão (máx. ~6MB no total)');
      e.status = 400;
      throw e;
    }
    parts.push({ inline_data: { mime_type: 'image/jpeg', data: buf.toString('base64') } });
  }
  const model = modeloVisao();
  const timeoutMs = (opts && Number(opts.timeoutMs)) || 120000;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  let r;
  try {
    r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(key), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { temperature: 0, maxOutputTokens: 512, responseMimeType: 'application/json' }
      }),
      signal: ctrl.signal
    });
  } catch (e) {
    clearTimeout(t);
    const err = new Error('IA de visão inacessível — verifique a internet do servidor (' + (e.message || 'falha de rede') + ')');
    err.status = 502;
    throw err;
  }
  clearTimeout(t);
  if (!r.ok) {
    const corpo = await r.text().catch(() => '');
    const err = new Error('IA de visão falhou (HTTP ' + r.status + (corpo && /quota|rate|limit/i.test(corpo) ? ' — cota gratuita estourada, tente mais tarde' : '') + ')');
    err.status = 502;
    throw err;
  }
  const j = await r.json().catch(() => ({}));
  const txt = (((j.candidates || [])[0] || {}).content || {}).parts;
  const cru = (Array.isArray(txt) ? txt : []).map(p => (p && p.text) || '').join('').trim()
    .replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  let obj;
  try {
    obj = JSON.parse(cru);
  } catch (e) {
    const err = new Error('IA de visão retornou resposta inválida');
    err.status = 502;
    throw err;
  }
  return normalizarCampos(obj);
}

module.exports = { ocrVisaoNuvem, interpretarVisao, normalizarCampos, textoDeCampos, temVisaoNuvem, chaveVisao, modeloVisao, PROMPT_VISAO };
