// =====================================================================
//  Testes do OCR em nuvem (OCR.space, opt-in via OCR_SPACE_KEY).
//  Sem chave: tudo local, nenhuma requisição externa (rede nunca tocada).
//  Script puro (sem framework), no estilo das demais suítes do projeto.
// =====================================================================
let passed = 0, failed = 0;
const assert = (cond, msg) => {
  if (cond) { console.log('  ✅', msg); passed++; }
  else { console.log('  ❌', msg); failed++; }
};

const SALVA = process.env.OCR_SPACE_KEY;
delete process.env.OCR_SPACE_KEY;

const nuvem = require('../src/lib/ocrNuvem');

(async () => {
  console.log('\n=== OCR NUVEM — opt-in e parsing ===');
  assert(nuvem.chaveConfigurada() === false, 'sem OCR_SPACE_KEY: desativado');
  process.env.OCR_SPACE_KEY = 'teste';
  assert(nuvem.chaveConfigurada() === true, 'com OCR_SPACE_KEY: ativado');
  delete process.env.OCR_SPACE_KEY;

  const j = { ParsedResults: [{ ParsedText: 'OLA ' }, { ParsedText: 'MUNDO' }] };
  assert(nuvem.extrairTextoResposta(j) === 'OLA \nMUNDO', 'parse: junta blocos com quebra');
  assert(nuvem.extrairTextoResposta({ ParsedResults: [] }) === '', 'parse: vazio dá vazio');
  assert(nuvem.extrairTextoResposta(null) === '', 'parse: nulo dá vazio');

  console.log('\n=== OCR NUVEM — sem chave não toca rede ===');
  const t0 = Date.now();
  const r = await nuvem.ocrImagemNuvem(Buffer.from([1, 2, 3]));
  assert(r === '' && Date.now() - t0 < 2000, 'sem chave: resolve vazio na hora');

  console.log('\n=== OCR NUVEM — enquadramento gratuito ===');
  const sharp = require('sharp');
  const grande = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: { r: 250, g: 250, b: 250 } } }).png().toBuffer();
  const pequena = await nuvem.enquadrarGratuito(grande);
  const meta = await sharp(pequena).metadata();
  assert(meta.width <= 1400 && pequena.length <= 1024 * 1024, `enquadra 3000px em ${meta.width}px/${Math.round(pequena.length / 1024)}KB`);

  console.log(`\n=== RESULTADO: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exitCode = 1;
})().catch((e) => {
  console.error('  ❌ erro inesperado:', e && e.message ? e.message : e);
  process.exitCode = 1;
}).finally(() => {
  if (SALVA === undefined) delete process.env.OCR_SPACE_KEY;
  else process.env.OCR_SPACE_KEY = SALVA;
});
