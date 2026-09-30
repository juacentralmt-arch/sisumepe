// =====================================================================
//  Testes de retenção do áudio da descrição do ticket.
//  O áudio recebe createdAt no upload e a limpeza o apaga após 24 horas,
//  inclusive em tickets ainda ativos. Fotos e áudios recentes são mantidos.
// =====================================================================
process.env.SUPABASE_URL = '';
process.env.SUPABASE_KEY = '';

const store = require('../store');

let passed = 0, failed = 0;
function assert(condition, msg) {
  if (condition) { console.log('  ✅', msg); passed++; }
  else { console.log('  ❌', msg); failed++; }
}

(async () => {
  const originalTicketsAll = store.tickets.all;
  const originalTicketsPatch = store.tickets.patch;
  const originalDeleteStoredFile = store.deleteStoredFile;
  const originalChatList = store.chat.list;
  const originalTtl = process.env.FILES_TTL_HOURS;
  const hour = 3600e3;
  const now = Date.now();
  const oldAudio = {
    url: '/uploads/audio-antigo.webm',
    name: 'descricao-audio.webm',
    mimetype: 'audio/webm',
    kind: 'audio',
    createdAt: new Date(now - 25 * hour).toISOString()
  };
  const freshAudio = {
    url: '/uploads/audio-recente.webm',
    name: 'descricao-audio.webm',
    mimetype: 'audio/webm',
    kind: 'audio',
    createdAt: new Date(now - hour).toISOString()
  };
  const photo = {
    url: '/uploads/foto.jpg',
    name: 'foto.jpg',
    mimetype: 'image/jpeg',
    kind: 'file',
    createdAt: new Date(now - 25 * hour).toISOString()
  };
  const legacyAudio = {
    url: '/uploads/audio-sem-data.webm',
    name: 'descricao-audio.webm',
    mimetype: 'audio/webm',
    kind: 'audio'
  };
  const ticket = {
    id: 'ticket-audio',
    status: 'aguardando',
    anexos: [oldAudio, freshAudio, photo, legacyAudio],
    fotosPos: []
  };
  const deleted = [];
  const patched = [];
  process.env.FILES_TTL_HOURS = '24';
  store.tickets.all = async () => [ticket];
  store.tickets.patch = async (id, fields) => {
    patched.push({ id, fields });
    Object.assign(ticket, fields);
    return ticket;
  };
  store.deleteStoredFile = async (url) => { deleted.push(url); };
  store.chat.list = async () => [];

  try {
    const result = await store.cleanupExpiredFiles();
    assert(deleted.includes(oldAudio.url), 'áudio com 25h em ticket ativo é apagado');
    assert(!deleted.includes(freshAudio.url), 'áudio com 1h é mantido');
    assert(!deleted.includes(photo.url), 'foto antiga em ticket ativo é mantida');
    assert(!deleted.includes(legacyAudio.url), 'áudio sem createdAt não é apagado por segurança');
    assert(result.filesRemoved === 1, 'limpeza conta exatamente um arquivo removido');
    assert(ticket.anexos[0].expired === true, 'áudio expirado vira marcador');
    assert(ticket.anexos[0].kind === 'audio', 'marcador preserva que era áudio');
    assert(ticket.anexos[0].createdAt === oldAudio.createdAt, 'marcador preserva a data do upload');
    assert(ticket.anexos[1] === freshAudio, 'objeto do áudio recente não é alterado');
    assert(ticket.anexos[2] === photo, 'objeto da foto não é alterado');
    assert(patched.length === 1, 'ticket ativo é atualizado uma vez');
  } finally {
    store.tickets.all = originalTicketsAll;
    store.tickets.patch = originalTicketsPatch;
    store.deleteStoredFile = originalDeleteStoredFile;
    store.chat.list = originalChatList;
    if (originalTtl === undefined) delete process.env.FILES_TTL_HOURS;
    else process.env.FILES_TTL_HOURS = originalTtl;
  }

  console.log(`\n=== RESULTADO: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exitCode = 1;
})().catch((e) => {
  console.error('  ❌ erro inesperado:', e && e.message ? e.message : e);
  process.exitCode = 1;
});
