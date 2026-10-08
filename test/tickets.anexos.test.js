// =====================================================================
//  Testes dos anexos de ticket — órfãos, fantasmas, lote e vídeo.
//  - DELETE de anexo apaga o arquivo físico (sem órfão em disco/bucket)
//  - marcadores expirados não contam no teto e podem ser purgados
//  - lote parcial com 1 arquivo ruim faz rollback (nada órfão)
//  - mp4/mov com assinatura ftyp são aceitos; sem assinatura, 400
//  - lote acima de 100MB é barrado antes de processar
//  Script puro (sem framework), no estilo das demais suítes do projeto.
// =====================================================================
process.env.SUPABASE_URL = '';
process.env.SUPABASE_KEY = '';

const store = require('../store');
const shared = require('../src/lib/shared');
const { validarAdicao, separarAnexos, validarTamanhoLote, MAX_LOTE_MB } = require('../src/lib/ticketEdicao');

let passed = 0, failed = 0;
const assert = (cond, msg) => {
  if (cond) { console.log('  ✅', msg); passed++; }
  else { console.log('  ❌', msg); failed++; }
};

const ghost = (i) => ({ name: 'audio' + i + '.webm', kind: 'audio', expired: true, expiredAt: new Date().toISOString() });

(async () => {
  console.log('\n=== ANEXOS — teto ignora fantasmas e purge limpa ===');
  const ghosts = Array.from({ length: 20 }, (_, i) => ghost(i));
  const limLivre = validarAdicao(ghosts, [{ originalname: 'novo.pdf' }]);
  assert(!limLivre, '20 fantasmas + 1 novo: permite (fantasma não ocupa vaga)');
  const cheios = Array.from({ length: 20 }, (_, i) => ({ url: '/uploads/a' + i + '.pdf', name: 'a' + i + '.pdf' }));
  const limCheio = validarAdicao(cheios, [{ originalname: 'novo.pdf' }]);
  assert(limCheio && limCheio.status === 400, '20 ativos + 1 novo: bloqueia (teto vale para ativos)');
  const sep = separarAnexos(ghosts, [], true);
  assert(sep.removidos.length === 20 && sep.mantidos.length === 0, 'purgeExpired:true remove os 20 marcadores');
  const sepSem = separarAnexos(ghosts, [], false);
  assert(sepSem.removidos.length === 0, 'sem purge, fantasma sem url não sai (comportamento antigo preservado p/ URLs)');
  const vivos = [{ url: '/uploads/a.pdf', name: 'a.pdf' }, ghost(9)];
  const limMisto = validarAdicao(vivos, [{}, {}, {}]);
  assert(!limMisto, '1 ativo + 1 fantasma + 3 novos (4 ativos): permite');

  console.log('\n=== ANEXOS — teto de lote ===');
  assert(MAX_LOTE_MB === 100, 'teto documentado de 100MB por lote');
  const big = [{ size: 60 * 1024 * 1024 }, { size: 50 * 1024 * 1024 }];
  const limLote = validarTamanhoLote(big);
  assert(limLote && limLote.status === 400, '110MB em 2 arquivos: barrado antes de processar');
  assert(!validarTamanhoLote([{ size: 15 * 1024 * 1024 }]), '15MB: permitido');

  console.log('\n=== ANEXOS — rollback de lote parcial ===');
  const origSave = store.saveFileUpload;
  const origDel = store.deleteStoredFile;
  const saved = [], deleted = [];
  store.saveFileUpload = async (f) => {
    if (String(f.originalname).includes('ruim')) { const e = new Error('Arquivo JPG inválido'); e.status = 400; throw e; }
    const rec = { url: '/uploads/' + f.originalname, name: f.originalname };
    saved.push(rec);
    return rec;
  };
  store.deleteStoredFile = async (url) => { deleted.push(url); };
  try {
    let erro = null;
    try {
      await shared.mapFiles([{ originalname: 'bom.txt' }, { originalname: 'ruim.jpg' }]);
    } catch (e) { erro = e; }
    assert(erro && erro.status === 400, 'lote com 1 ruim: erro 400 propagado');
    assert(saved.length === 1 && deleted.length === 1 && deleted[0] === saved[0].url, 'arquivo salvo antes da falha é apagado (sem órfão)');
    const ok = await shared.mapFiles([{ originalname: 'a.txt' }, { originalname: 'b.txt' }]);
    assert(ok.length === 2 && deleted.length === 1, 'lote 100% válido: nada é apagado');
  } finally {
    store.saveFileUpload = origSave;
    store.deleteStoredFile = origDel;
  }

  console.log('\n=== ANEXOS — vídeo mp4/mov ===');
  const mp4ok = { originalname: 'video.mp4', mimetype: 'video/mp4', size: 12, buffer: Buffer.concat([Buffer.from([0, 0, 0, 32]), Buffer.from('ftypisom')]) };
  const r1 = await store.saveFileUpload(mp4ok).catch(e => e);
  assert(!(r1 instanceof Error), 'mp4 com ftyp: aceito');
  if (!(r1 instanceof Error)) await store.deleteStoredFile(r1.url).catch(() => {});
  const movok = { originalname: 'video.mov', mimetype: 'video/quicktime', size: 12, buffer: Buffer.concat([Buffer.from([0, 0, 0, 32]), Buffer.from('ftypqt  ')]) };
  const r2 = await store.saveFileUpload(movok).catch(e => e);
  assert(!(r2 instanceof Error), 'mov com ftyp: aceito');
  if (!(r2 instanceof Error)) await store.deleteStoredFile(r2.url).catch(() => {});
  const mp4ruim = { originalname: 'falso.mp4', mimetype: 'video/mp4', size: 12, buffer: Buffer.from('nao-e-video nenhum') };
  const r3 = await store.saveFileUpload(mp4ruim).catch(e => e);
  assert(r3 instanceof Error && r3.status === 400, 'mp4 sem assinatura ftyp: 400');

  console.log(`\n=== RESULTADO: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exitCode = 1;
})().catch((e) => {
  console.error('  ❌ erro inesperado:', e && e.message ? e.message : e);
  process.exitCode = 1;
});
