// Testes da importacao da Planilha Geral (CSV e XLSX).
process.env.SUPABASE_URL = '';
process.env.SUPABASE_KEY = '';
const os = require('os'); const fs = require('fs'); const path = require('path');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sisumepe-import-'));
process.env.DB_FILE = path.join(tmpDir, 'test-db.json');
fs.writeFileSync(process.env.DB_FILE, '{}');

const store = require('../store');
const shared = require('../src/lib/shared');
shared.auth = (roles) => (req, res, next) => {
  if (!req.auth) return res.status(401).json({ error: 'sem auth (teste)' });
  if (roles && roles.length && !roles.includes(req.auth.role)) return res.status(403).json({ error: 'Acesso restrito.' });
  next();
};
const router = require('../src/routes/assistidos');
const ExcelJS = require('exceljs');

const express = require('express');
const app = express();
app.use(express.json({ limit: '2mb' }));
app.use((req, res, next) => {
  const raw = req.headers['x-test-auth'] || '';
  const [role, user, name] = raw.split('|');
  req.auth = { role: role || 'admin', user: user || 'admin', name: name || 'Admin', sistema: null, token: 't' };
  next();
});
app.use(router);
const server = app.listen(0);
const BASE = 'http://127.0.0.1:' + server.address().port;

let passed = 0, failed = 0;
const assert = (cond, msg) => {
  if (cond) { console.log('  ok.', msg); passed++; }
  else { console.log('  FAIL', msg); failed++; }
};

const H = { 'X-Test-Auth': 'admin|admin|Admin' };

// monta multipart/form-data manualmente (o multer precisa do corpo cru)
function multipart(filename, conteudo, tipo) {
  const boundary = '----sisumepeTeste' + Date.now();
  const buf = Buffer.isBuffer(conteudo) ? conteudo : Buffer.from(conteudo, 'utf8');
  const head = Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="arquivo"; filename="${filename}"\r\n` +
    `Content-Type: ${tipo || 'text/csv'}\r\n\r\n`, 'utf8');
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  return { body: Buffer.concat([head, buf, tail]), tipo: 'multipart/form-data; boundary=' + boundary };
}

async function importar(nomeArquivo, conteudo, tipo, query) {
  const mp = multipart(nomeArquivo, conteudo, tipo);
  const r = await fetch(BASE + '/api/assistidos/import' + (query || ''), {
    method: 'POST',
    headers: Object.assign({}, H, { 'Content-Type': mp.tipo }),
    body: mp.body,
  });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}

(async () => {
  console.log('\n=== IMPORTACAO DA PLANILHA GERAL ===');

  // 1) CSV com os nomes canonicos
  const csv1 = [
    'vinculo;nome;vara;local;data_inicio;frequencia;etiqueta;ultima_data;pp;juntada',
    '0000001-00.2026.8.06.0001;MARIA DE TESTE;1a VARA;COMEP Cariri;2026-01-10;semanal;verde;2026-11-03;Marcos;71377',
    '0000002-00.2026.8.06.0002;JOAO DE TESTE;2a VARA;COMEP Cariri;15/02/2026;mensal;sem;2026-11-05;Erminio;69044',
  ].join('\n');
  const r1 = await importar('planilha.csv', csv1);
  assert(r1.status === 200, 'CSV: 200');
  assert(r1.json.assistidos.novos === 2, 'CSV: 2 assistidos novos (recebeu ' + r1.json.assistidos.novos + ')');
  assert(r1.json.comparecimentos.novos === 2, 'CSV: 2 comparecimentos criados');
  assert(r1.json.totalFalhas === 0, 'CSV: sem falhas');
  assert(Array.isArray(r1.json.colunasReconhecidas) && r1.json.colunasReconhecidas.includes('dataComparecimento'),
    'CSV: coluna de data reconhecida pelo apelido "ultima_data"');

  const lista = await (await fetch(BASE + '/api/assistidos?limit=50', { headers: H })).json();
  const maria = lista.itens.find(x => x.vinculo === '0000001-00.2026.8.06.0001');
  assert(!!maria, 'CSV: assistido gravado');
  assert(maria && maria.nome === 'MARIA DE TESTE', 'CSV: nome gravado');
  assert(maria && maria.frequencia === 'semanal', 'CSV: frequencia gravada');
  assert(maria && maria.etiqueta === 'verde', 'CSV: etiqueta gravada');
  assert(maria && maria.dataInicio === '2026-01-10', 'CSV: data de inicio gravada');
  assert(maria && maria.ultimoComparecimento === '2026-11-03', 'CSV: ultimo comparecimento gravado');

  const joao = lista.itens.find(x => x.vinculo === '0000002-00.2026.8.06.0002');
  assert(joao && joao.dataInicio === '2026-02-15', 'CSV: data dd/mm/aaaa convertida');

  const det = await (await fetch(BASE + '/api/assistidos/' + maria.id + '/detalhe', { headers: H })).json();
  const comp = (det.comparecimentos || [])[0];
  assert(!!comp && comp.dataComparecimento === '2026-11-03', 'CSV: comparecimento com a data');
  assert(!!comp && comp.juntada === '71377', 'CSV: numero da juntada gravado');
  assert(!!comp && comp.protocolado === true, 'CSV: comparecimento com juntada fica protocolado');
  assert(!!comp && comp.ppPlantao === 'Marcos', 'CSV: PP de plantao gravado');

  // 2) Reimportar o MESMO vinculo atualiza, nao duplica
  const csv2 = [
    'vinculo;nome;vara;frequencia',
    '0000001-00.2026.8.06.0001;MARIA DE TESTE EDITADA;1a VARA;quinzenal',
  ].join('\n');
  const r2 = await importar('planilha.csv', csv2);
  assert(r2.status === 200, 'CSV: reimportacao 200');
  assert(r2.json.assistidos.novos === 0, 'CSV: reimportacao nao cria novo assistido');
  assert(r2.json.assistidos.atualizados === 1, 'CSV: reimportacao atualiza o existente');
  const depois = await (await fetch(BASE + '/api/assistidos?limit=50', { headers: H })).json();
  assert(depois.itens.filter(x => x.vinculo === '0000001-00.2026.8.06.0001').length === 1,
    'CSV: sem duplicar vinculo');
  const maria2 = depois.itens.find(x => x.vinculo === '0000001-00.2026.8.06.0001');
  assert(maria2 && maria2.nome === 'MARIA DE TESTE EDITADA', 'CSV: nome atualizado');
  assert(maria2 && maria2.frequencia === 'quinzenal', 'CSV: frequencia atualizada');

  // 3) Modo simulacao nao grava
  const csv3 = [
    'vinculo;nome;vara',
    '0000009-00.2026.8.06.0009;SIMULACAO;VARA',
  ].join('\n');
  const r3 = await importar('planilha.csv', csv3, null, '?dry=1');
  assert(r3.status === 200, 'Simulacao: 200');
  assert(r3.json.simulado === true, 'Simulacao: marcada como simulada');
  assert(r3.json.assistidos.novos === 1, 'Simulacao: contaria o novo assistido');
  const naoGravou = await (await fetch(BASE + '/api/assistidos?limit=50', { headers: H })).json();
  assert(!naoGravou.itens.some(x => x.vinculo === '0000009-00.2026.8.06.0009'),
    'Simulacao: nada foi gravado');

  // 4) Dados invalidos viram falha com o numero da linha
  const csv4 = [
    'vinculo;nome;vara;frequencia',
    '0000010-00.2026.8.06.0010;VALIDO;VARA;mensal',
    '0000011-00.2026.8.06.0011;INVALIDO;VARA;semanal-semanal',
    '0000012-00.2026.8.06.0012;;VARA;mensal',
  ].join('\n');
  const r4 = await importar('planilha.csv', csv4);
  assert(r4.status === 200, 'Invalidos: 200 (relatorio, nao erro)');
  assert(r4.json.assistidos.novos === 1, 'Invalidos: so a linha valida foi importada');
  assert(r4.json.totalFalhas >= 1, 'Invalidos: falhas relatadas');
  assert(r4.json.falhas.length > 0 && typeof r4.json.falhas[0].linha === 'number',
    'Invalidos: falha com o numero da linha');

  // 5) Cabecalho sem vinculo/nome -> 400 com os nomes recebidos
  const csv5 = 'colunaA;colunaB\n1;2';
  const r5 = await importar('planilha.csv', csv5);
  assert(r5.status === 400, 'Cabecalho invalido: 400');
  assert(/Cabeçalho não reconhecido/.test(r5.json.error || ''), 'Cabecalho invalido: mensagem clara');
  assert(Array.isArray(r5.json.cabecalhoRecebido), 'Cabecalho invalido: mostra o cabecalho recebido');

  // 6) XLSX
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Planilha');
  ws.addRow(['Vínculo', 'Nome', 'Vara', 'Local', 'Data Início', 'Frequência', 'Ultima Data', 'PP']);
  ws.addRow(['0000020-00.2026.8.06.0020', 'XLSX DE TESTE', '3a VARA', 'COMEP Cariri', '2026-03-01', 'quinzenal', '2026-11-08', 'Marcos']);
  const buf = await wb.xlsx.writeBuffer();
  const r6 = await importar('planilha.xlsx', Buffer.from(buf), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert(r6.status === 200, 'XLSX: 200');
  assert(r6.json.formato === 'xlsx', 'XLSX: formato identificado');
  assert(r6.json.assistidos.novos === 1, 'XLSX: assistido importado');
  assert(r6.json.comparecimentos.novos === 1, 'XLSX: comparecimento importado');
  const xl = await (await fetch(BASE + '/api/assistidos?limit=50', { headers: H })).json();
  const reg = xl.itens.find(x => x.vinculo === '0000020-00.2026.8.06.0020');
  assert(!!reg && reg.nome === 'XLSX DE TESTE', 'XLSX: nome gravado');

  // 7) A importacao fica na trilha de auditoria
  const aud = await (await fetch(BASE + '/api/assistidos/auditoria?limit=50', { headers: H })).json();
  assert(aud.itens.some(x => x.acao === 'importacao'), 'Auditoria: importacao registrada');

  // 7b) Colunas desconhecidas vao para `extras` (nao se perde dado)
  const csvExtras = [
    'vinculo;nome;vara;coluna_do_futuro;outra_coluna',
    '0000040-00.2026.8.06.0040;COM EXTRAS;VARA;valor-1;valor-2',
  ].join('\n');
  const rExtras = await importar('planilha.csv', csvExtras);
  assert(rExtras.json.assistidos.novos === 1, 'Extras: assistido importado');
  const comExtras = await (await fetch(BASE + '/api/assistidos?limit=50', { headers: H })).json();
  const regExtras = comExtras.itens.find(x => x.vinculo === '0000040-00.2026.8.06.0040');
  assert(!!regExtras && regExtras.extras && regExtras.extras.coluna_do_futuro === 'valor-1',
    'Extras: coluna desconhecida guardada em extras');
  assert(!!regExtras && regExtras.extras && regExtras.extras.outra_coluna === 'valor-2',
    'Extras: segunda coluna desconhecida guardada');

  // 8) O processo deriva do vinculo quando nao vem
  const semProcesso = await (await fetch(BASE + '/api/assistidos', {
    method: 'POST', headers: Object.assign({}, H, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      vinculo: '0000030-00.2026.8.06.0030', nome: 'SEM PROCESSO', vara: 'V',
      localAssinatura: 'COMEP Cariri', dataInicio: '2026-01-01',
    }),
  })).json();
  assert(semProcesso.processo === '0000030-00.2026.8.06.0030', 'Processo: deriva do vinculo no cadastro');

  // 9) ... e tambem na edicao, quando o vinculo muda
  const mudouVinculo = await (await fetch(BASE + '/api/assistidos/' + semProcesso.id, {
    method: 'PATCH', headers: Object.assign({}, H, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ vinculo: '0000031-00.2026.8.06.0031' }),
  })).json();
  assert(mudouVinculo.processo === '0000031-00.2026.8.06.0031', 'Processo: acompanha o vinculo na edicao');

  console.log('\n==================== RESUMO ====================');
  console.log(`Testes: OK=${passed} | Falha=${failed}`);
  process.exit(failed ? 1 : 0);
})();
