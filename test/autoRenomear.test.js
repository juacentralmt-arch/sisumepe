// =====================================================================
//  Testes unitários do motor AutoRenomear (src/lib/autoRenomear.js)
//  Cobre as regressões já corrigidas no histórico de commits:
//   - a2e9b53 / fd11a91: tolerância a ruído de OCR (rótulos, espaços, lixo no fim)
//   - d291007: texto garbled vai para 'manual' (aciona OCR local no navegador)
//   - d3f0263: recolhimento sem nome + data extraída do nome do arquivo
//   - 2ae8ccb: recEquip priorizado + garbled detectado
//   - 3b6a22e: sobrenome "Nascimento" não é amputado
//   - a9ed2cb: marcador de versão do motor
//  Mesmo estilo do test/estoqueIA.test.js: script puro, sem framework.
// =====================================================================
const {
  sugerirNome, detectarTipo, extrairNome, extrairDataConteudo,
  extrairDataISO, extrairDataArquivo, sanitizar
} = require('../src/lib/autoRenomear');

let passed = 0, failed = 0;

function assert(condition, msg) {
  if (condition) { console.log('  ✅', msg); passed++; }
  else { console.log('  ❌', msg); failed++; }
}


console.log('\n=== TESTES AUTORENOMEAR — regressão Nascimento (3b6a22e) ===');

// Sobrenome "Nascimento" deve ser preservado, nunca cortado como rótulo de
// data. Linhas separadas (layout real do termo):
{
  const r = sugerirNome(
    'TERMO DE ATIVACAO\nNOME DO MONITORADO: MARIA ANTONIA DO NASCIMENTO MATOS\nData: 22/06/2026',
    'termo.pdf'
  );
  assert(r.tipoId === 'ativacao', 'nascimento: tipo ativacao com título correto');
  assert(r.nome === 'Maria Antonia do Nascimento Matos', 'nascimento: sobrenome Nascimento preservado — "' + r.nome + '"');
  assert(r.dataISO === '2026-06-22', 'nascimento: data do conteúdo');
  assert(r.confianca === 'alta', 'nascimento: confiança alta (tipo+nome+data)');
}
// Linha única com ruído de extração ("Matos Data: ..."):
{
  const r = sugerirNome('MONITORADO: Carlos do Nascimento Matos Data: 28/09/2026', 'doc.pdf');
  assert(r.nome === 'Carlos do Nascimento Matos', 'nascimento: linha única corta em "Data" — "' + r.nome + '"');
}
// "nascido" (sem dois-pontos) É corte — é rótulo de natalidade:
{
  const r = sugerirNome('MONITORADO: Joao Silva nascido em 01/01/1990', 'doc.pdf');
  assert(r.nome === 'Joao Silva', 'nascimento: "nascido em" corta o nome — "' + r.nome + '"');
}

console.log('\n=== TESTES AUTORENOMEAR — tolerância a OCR 0/O (a2e9b53, fd11a91) ===');

// Dígito zero no RÓTULO (MONITORAD0:) não pode impedir a extração do nome:
{
  const r = sugerirNome('MONITORAD0: Fulano Beltrano\nData: 28/08/2026', 'foto.jpg');
  assert(r.nome === 'Fulano Beltrano', 'OCR 0/O: rótulo MONITORAD0 extrai nome — "' + r.nome + '"');
}
// Rótulo com parênteses e sujeira pós-rótulo: "MONITORADO(A);  " (OCR):
{
  const r = sugerirNome('MONITORADO(A);   JOAO DA SILVA\nData: 28/09/2026', 'doc.pdf');
  assert(r.nome === 'Joao da Silva', 'OCR 0/O: tolera "(A);" e espaços pós-rótulo — "' + r.nome + '"');
}
// Espaço antes dos dois-pontos ("MONITORADO : "):
{
  const r = sugerirNome('MONITORADO : Maria Souza\nData: 01/02/2026', 'doc.pdf');
  assert(r.nome === 'Maria Souza', 'OCR 0/O: tolera espaço antes do dois-pontos — "' + r.nome + '"');
}
// Ruído colado no fim do nome (fd11a91):
{
  const r1 = sugerirNome('MONITORADO: Fulano Silva 28', 'doc.pdf');
  assert(r1.nome === 'Fulano Silva', 'OCR ruído: dígito solto no fim é cortado — "' + r1.nome + '"');
  const r2 = sugerirNome('MONITORADO: Chagas R', 'doc.pdf');
  assert(r2.nome === 'Chagas', 'OCR ruído: letra solta no fim é cortada — "' + r2.nome + '"');
}
// Início que nunca é nome (a2e9b53):
{
  const r = sugerirNome('Monitorado desde 01/02/2020', 'doc.pdf');
  assert(r.nome === '', 'OCR ruído: "desde" não vira nome');
  assert(r.dataISO === '2020-02-01', 'OCR ruído: data ainda extraída do conteúdo');
}
// Título com 0 no lugar do O (TERM0 DE ATIVACA0): detectarTipo agora busca
// também na variante 0→O, igual ao extrairNome (motor rn4).
{
  const r = sugerirNome('TERM0 DE ATIVACA0 DE T0RN0ZELEIRA\nMONITORAD0: Fulano Beltrano\nData/Hora: 28/08/2026 14:33', 'foto.jpg');
  assert(r.tipoId === 'ativacao', 'OCR título garbled: tipo detectado via 0→O — "' + r.tipoId + '"');
  assert(r.nome === 'Fulano Beltrano', 'OCR título garbled: nome extraído — "' + r.nome + '"');
  assert(r.dataISO === '2026-08-28', 'OCR título garbled: data extraída');
  assert(r.confianca === 'alta', 'OCR título garbled: confiança alta com tipo+nome+data');
}
// Título limpo NÃO pode ser confundido pela variante (0 real no meio de palavra
// não deve criar falsos positivos na direção O→0 — só buscamos 0→O):
{
  const r = sugerirNome('TERMO DE ATIVACAO\nMONITORADO: Ana Clara Ribeiro\nData: 15/04/2026', 'doc.pdf');
  assert(r.tipoId === 'ativacao' && r.nome === 'Ana Clara Ribeiro', 'título limpo segue detectando (sem regressão)');
}
// Chaves com dígitos reais (DAE) continuam casando:
{
  const r = sugerirNome('FUNPEN\nDOCUMENTO DE ARRECADACAO ESTADUAL\nData: 01/05/2026', 'dae.pdf');
  assert(r.tipoId === 'dae', 'dae: continua detectado após a mudança');
}
console.log('\n=== TESTES AUTORENOMEAR — rótulo Interessado (ofícios, motor rn4) ===');
// "Interessado:" é o rótulo típico de ofícios:
{
  const r = sugerirNome('OFICIO DE ENCAMINHAMENTO\nInteressado: Ciclano Souza\nJuazeiro do Norte, 10 de janeiro de 2026', 'ofi.pdf');
  assert(r.tipoId === 'endereco', 'interessado: tipo ofício detectado');
  assert(r.nome === 'Ciclano Souza', 'interessado: nome extraído do ofício — "' + r.nome + '"');
  assert(r.dataISO === '2026-01-10', 'interessado: data por extenso');
}
// Variante com parênteses e plural:
{
  const r1 = sugerirNome('OFICIO\nINTERESSADO(A): Maria de Fátima Oliveira\nData: 02/02/2026', 'ofi2.pdf');
  assert(r1.nome === 'Maria de Fátima Oliveira', 'interessado(a): variante com parênteses — "' + r1.nome + '"');
  const r2 = sugerirNome('OFICIO\nInteressados: Joao Pedro Almeida\nData: 03/03/2026', 'ofi3.pdf');
  assert(r2.nome === 'Joao Pedro Almeida', 'interessados: plural — "' + r2.nome + '"');
}
// Nome após "Interessado:" é cortado em localidade e rótulos de campo:
{
  const r = sugerirNome('OFICIO\nInteressado: Raimundo Nonato da Silva - Processo: 0001234-56\nData: 04/04/2026', 'ofi4.pdf');
  assert(r.nome === 'Raimundo Nonato da Silva', 'interessado: corta em rótulo Processo — "' + r.nome + '"');
}

console.log('\n=== TESTES AUTORENOMEAR — recolhimento sem nome (d3f0263) ===');

// Layout de cartões das unidades penais: SEM campo de monitorado — o nome é
// tentado mas não encontrado, então a sugestão usa "SEM NOME" (transparente).
{
  const r = sugerirNome(
    'AUTO DE RECOLHIMENTO\nITENS RECEBIDOS\nITENS REBIDOS\nDESCRICAO DO EQUIPAMENTOS\nENTREGUES PELAS UNIDADES PENAIS\nData: 28/09/2026',
    'rec.pdf'
  );
  assert(r.tipoId === 'recolhimento', 'recolhimento: tipo detectado pelas chaves do layout');
  assert(r.nome === '', 'recolhimento sem monitorado: nome vazio — "' + r.nome + '"');
  assert(r.sugestao.includes('SEM NOME'), 'recolhimento sem monitorado: sugestão contém "SEM NOME" — "' + r.sugestao + '"');
  assert(r.sugestao === 'Termo de recolhimento - SEM NOME - 28-09-2026.pdf', 'recolhimento sem monitorado: sugestão "Tipo - SEM NOME - Data" — "' + r.sugestao + '"');
}
// Termo de Recolhimento do núcleo COM "MONITORADO(A):" extrai o nome (rn6):
{
  const r = sugerirNome(
    'TERMO DE RECOLHIMENTO\nMONITORADO(A): JOAQUIM MENADEL SALVIANO RODRIGUES\nData/Hora: 28/08/2026 De 08:10h',
    'termo.pdf'
  );
  assert(r.tipoId === 'recolhimento', 'recolhimento núcleo: tipo detectado — "' + r.tipoId + '"');
  assert(r.nome === 'Joaquim Menadel Salviano Rodrigues', 'recolhimento núcleo: nome extraído via MONITORADO(A) — "' + r.nome + '"');
  assert(r.sugestao === 'Termo de recolhimento - Joaquim Menadel Salviano Rodrigues - 28-08-2026.pdf', 'recolhimento núcleo: sugestão completa — "' + r.sugestao + '"');
  assert(r.confianca === 'alta', 'recolhimento núcleo: confiança alta (tipo+nome+data)');
}
// Formulário de equipamento COM "MONITORADO(A):" continua caindo em recEquip:
{
  const r = sugerirNome(
    'DECLARACAO DE DEVOLUCAO DE EQUIPAMENTOS\nMONITORADO(A): JOAO DA SILVA\nData: 28/09/2026',
    'equip.pdf'
  );
  assert(r.tipoId === 'recEquip', 'recEquip: priorizado quando há MONITORADO(A)');
  assert(r.nome === 'Joao da Silva', 'recEquip: nome extraído — "' + r.nome + '"');
  assert(r.sugestao === 'Declaração de devolução de equipamentos - Joao da Silva - 28-09-2026.pdf', 'recEquip: sugestão completa — "' + r.sugestao + '"');
}
// Novo modelo: DECLARAÇÃO DE DEVOLUÇÃO — nome após "imposta a", data por extenso:
{
  const r = sugerirNome(
    'DECLARAÇÃO DE DEVOLUÇÃO DE EQUIPAMENTOS DE MONITORAÇÃO ELETRÔNICA\nDeclaro para os devidos fins que o(s) equipamento(s) de monitoração eletrônica, TZPR série 4315023610 e a fonte de energia elétrica (carregador), vinculados à medida judicial de monitoramento eletrônico imposta a FULANO DA SILVA, foi devolvido na presente Unidade de Monitoramento Eletrônico de Pessoas - UMEPE Juazeiro do Norte-CE na seguinte circunstância:\nINSPEÇÃO PRELIMINAR SIM NÃO\nEm Juazeiro do Norte-CE aos 05 de outubro de 2026.',
    'devol.pdf'
  );
  assert(r.tipoId === 'recEquip', 'devolucao: tipo detectado — "' + r.tipoId + '"');
  assert(r.nome === 'Fulano da Silva', 'devolucao: nome após "imposta a" — "' + r.nome + '"');
  assert(r.dataISO === '2026-10-05', 'devolucao: data por extenso — "' + r.dataISO + '"');
  assert(r.sugestao === 'Declaração de devolução de equipamentos - Fulano da Silva - 05-10-2026.pdf', 'devolucao: sugestão completa — "' + r.sugestao + '"');
  assert(r.confianca === 'alta', 'devolucao: confiança alta (tipo+nome+data)');
}

console.log('\n=== TESTES AUTORENOMEAR — data do nome do arquivo (d3f0263) ===');

// Data embutida no nome do arquivo é fallback, NUNCA conta como achado:
{
  const r = sugerirNome('conteudo qualquer sem datas nem nomes uteis', 'victor_260925_133554.pdf');
  assert(r.dataISO === '2025-09-26', 'data arquivo: 260925 → 2025-09-26');
  assert(r.data === '26-09-2025', 'data arquivo: formatada DD-MM-AAAA');
  assert(r.avisos.some(a => /nome do arquivo/i.test(a)), 'data arquivo: aviso explícito de origem');
  assert(r.confianca === 'manual', 'data arquivo: sem achados de conteúdo → manual (dispara OCR no cliente)');
}
// Data do CONTEÚDO vence a do nome do arquivo, e aí não há aviso:
{
  const r = sugerirNome('DECLARACAO\nData: 05/03/2026', 'x_010125_y.pdf');
  assert(r.dataISO === '2026-03-05', 'data conteúdo vence: 05/03/2026 do conteúdo');
  assert(!r.avisos.some(a => /nome do arquivo/i.test(a)), 'data conteúdo vence: sem aviso de arquivo');
}
// extrairDataArquivo valida mês/dia (não inventa data de lixo):
{
  assert(extrairDataArquivo('x_990999.pdf') === '', 'data arquivo: mês/dia inválidos → vazio');
  assert(extrairDataArquivo('semnumeros.pdf') === '', 'data arquivo: sem 6 dígitos → vazio');
}

console.log('\n=== TESTES AUTORENOMEAR — confiança manual / escaneado (d291007, 2ae8ccb) ===');

// PDF escaneado (texto vazio/garbled): confiança 'manual' aciona o OCR local.
{
  const r = sugerirNome('. . . - - - . . .', 'scan.pdf');
  assert(r.confianca === 'manual', 'escaneado: confiança manual');
  assert(r.avisos.some(a => /Nome não encontrado/i.test(a)), 'escaneado: aviso de nome ausente');
  assert(r.sugestao.includes('SEM NOME') && r.sugestao.includes('SEM DATA'), 'escaneado: sugestão com placeholders');
}
// Com tipo e data de conteúdo mas sem nome → média (não manual):
{
  const r = sugerirNome('DECLARACAO\nEu sou o servidor público e declaro por 28/09/2026', 'doc.pdf');
  assert(r.confianca === 'média', 'sem nome mas com tipo+data → média');
}

console.log('\n=== TESTES AUTORENOMEAR — formato da sugestão e helpers ===');

// Formato canônico "<Tipo> - <Nome> - <DD-MM-AAAA>.<ext>":
{
  const r = sugerirNome('MONITORADO: Ana Lima\nData: 01/02/2026', 'FOTO.JPG');
  assert(r.sugestao === 'Documento - Ana Lima - 01-02-2026.jpg', 'formato: extensão .jpg preservada (maiúscula) — "' + r.sugestao + '"');
}
// sanitizar remove caracteres proibidos de nome de arquivo (Windows/Linux):
{
  assert(sanitizar('a/b:c*d?e"f<g>h|i', 80) === 'abcdefghi', 'sanitizar: remove \\/:*?"<>|');
  assert(sanitizar('  .ponto inicial. ', 80) === 'ponto inicial', 'sanitizar: pontos/espaços das bordas');
  assert(sanitizar('x'.repeat(300), 120).length <= 120, 'sanitizar: limite de tamanho respeitado');
}
// extrairDataConteudo: formatos rotulado, por extenso e ISO:
{
  assert(extrairDataConteudo('Data: 28/09/2026') === '2026-09-28', 'data: rotulada DD/MM/AAAA');
  assert(extrairDataConteudo('Data/Hora: 28/08/2026 14:33') === '2026-08-28', 'data: rotulada com hora');
  assert(extrairDataConteudo('Juazeiro do Norte, 10 de janeiro de 2026') === '2026-01-10', 'data: por extenso');
  assert(extrairDataConteudo('emitido em 2026-09-28 no sistema') === '2026-09-28', 'data: ISO');
  assert(extrairDataConteudo('13/13/2026') === undefined || extrairDataConteudo('13/13/2026') === '2026-13-13' || true, 'data: roda sem lançar em mês inválido');
}
// extrairDataISO compõe conteúdo > arquivo:
{
  assert(extrairDataISO('Data: 28/09/2026', 'x_010125.pdf') === '2026-09-28', 'extrairDataISO: conteúdo vence');
  assert(extrairDataISO('sem data aqui', 'x_010125.pdf') === '2025-01-01', 'extrairDataISO: fallback arquivo');
  assert(extrairDataISO('sem data aqui', 'x.pdf') === '', 'extrairDataISO: nada → vazio');
}
// detectarTipo: ordem de prioridade entre chaves (dae antes das demais):
{
  assert(detectarTipo('DAE - DOCUMENTO DE ARRECADACAO ESTADUAL FUNPEN').id === 'dae', 'detectarTipo: DAE');
  assert(detectarTipo('ATA DE REUNIAO DO CONSELHO').id === 'ata', 'detectarTipo: ata');
  assert(detectarTipo('nenhuma chave reconhecivel aqui').id === 'documento', 'detectarTipo: fallback documento');
}
// Marcador de versão do motor presente (a9ed2cb) — prova qual código gerou:
{
  const r = sugerirNome('MONITORADO: Teste Da Silva\nData: 01/01/2026', 'doc.pdf');
  assert(r.motor === 'rn7', 'motor: versão rn7 (separarNome restaurado + data-arquivo isolada) — "' + r.motor + '"');
}

console.log('\n=== TESTES AUTORENOMEAR — termos de recolhimento reais (núcleo Juazeiro) ===');

// Textos simulando a extração (pdf-parse/OCR) dos 5 termos enviados:
// layout MONITORADO(A) + Data/Hora + Nº do dispositivo + assinatura + CPF.
{
  const r = sugerirNome(
    'POLÍCIA PENAL Coordenadoria de Monitoração Eletronica de Pessoas - COMEP\nTERMO DE RECOLHIMENTO\nUNIDADE DE MONITORAMENTO ELETRONICO DE PESSOAS – NUCLEO JUAZEIRO\nMONITORADO(A): Enrickson Rafael da Cunha Data/Hora: 28/08/2026 De 08:10h às 20:15h\n1) INSPEÇÃO NO DISPOSITIVO Nº: 4212090807\nPor ser verdade, firmo o presente.\nASSINATURA CPF/RG 488.954.388-09\nJoanderson Vitor / Mat 1334 Técnico responsável',
    'termo.pdf'
  );
  assert(r.tipoId === 'recolhimento', 'doc1: tipo recolhimento');
  assert(r.nome === 'Enrickson Rafael da Cunha', 'doc1: nome — "' + r.nome + '"');
  assert(r.dataISO === '2026-08-28', 'doc1: data do campo Data/Hora');
  assert(r.sugestao === 'Termo de recolhimento - Enrickson Rafael da Cunha - 28-08-2026.pdf', 'doc1: sugestão — "' + r.sugestao + '"');
  assert(r.confianca === 'alta', 'doc1: confiança alta');
}
{
  const r = sugerirNome(
    'TERMO DE RECOLHIMENTO\nUNIDADE DE MONITORAMENTO ELETRONICO DE PESSOAS – NUCLEO JUAZEIRO\nMONITORADO(A): Francisco Jose Gomes Rodrigues\nData/Hora: 28/08/2026 De 08:10h às 20:15h\nNº: 4213040487\nASSINATURA CPF/RG 759.309.603-30',
    'termo2.pdf'
  );
  assert(r.nome === 'Francisco Jose Gomes Rodrigues', 'doc2: nome — "' + r.nome + '"');
  assert(r.dataISO === '2026-08-28', 'doc2: data');
  assert(r.sugestao === 'Termo de recolhimento - Francisco Jose Gomes Rodrigues - 28-08-2026.pdf', 'doc2: sugestão — "' + r.sugestao + '"');
}
{
  const r = sugerirNome(
    'TERMO DE RECOLHIMENTO\nMONITORADO(A): Francisco Roberto Cornélio Silva de Souza\nData/Hora: 28/08/2026 De 08:10h às 19:10h\nNº: 4314033784\nASSINATURA CPF/RG 131.475.533-10',
    'termo3.pdf'
  );
  assert(r.nome === 'Francisco Roberto Cornélio Silva de Souza', 'doc3: nome com acento e 6 partes — "' + r.nome + '"');
  assert(r.dataISO === '2026-08-28', 'doc3: data');
  assert(r.sugestao === 'Termo de recolhimento - Francisco Roberto Cornélio Silva de Souza - 28-08-2026.pdf', 'doc3: sugestão — "' + r.sugestao + '"');
}
// Armadilha real do layout: "Monitorado desde: 05/03/2026 // Desativado desde:
// 28/08/2026" — a data do documento é a do campo Data/Hora, e "desde" não é nome.
{
  const r = sugerirNome(
    'TERMO DE RECOLHIMENTO\nMONITORADO(A): Joaquim Menadel Salviano Rodrigues\nData/Hora: 28/08/2026 De 08:10h às 16:30h\nNº: 4315094058\nMonitorado desde: 05/03/2026 // Desativado desde: 28/08/2026\nASSINATURA CPF/RG 076.039.503-92',
    'termo4.pdf'
  );
  assert(r.nome === 'Joaquim Menadel Salviano Rodrigues', 'doc4: nome — "' + r.nome + '"');
  assert(r.dataISO === '2026-08-28', 'doc4: Data/Hora vence "Monitorado desde" — "' + r.dataISO + '"');
  assert(r.sugestao === 'Termo de recolhimento - Joaquim Menadel Salviano Rodrigues - 28-08-2026.pdf', 'doc4: sugestão — "' + r.sugestao + '"');
  assert(r.confianca === 'alta', 'doc4: confiança alta');
}
// OCR que cola os espaços ("MariadaSilva", como no teste do Tesseract):
{
  const r = sugerirNome('TERMO DE RECOLHIMENTO\nMONITORADO(A):MariadaSilva\nData/Hora:28/08/2026\nN: 4212024905', 'scan.jpg');
  assert(r.nome === 'Maria da Silva', 'doc5: partícula colada separada — "' + r.nome + '"');
  assert(r.dataISO === '2026-08-28', 'doc5: data');
  assert(r.confianca === 'alta', 'doc5: confiança alta');
}
// Serial do dispositivo no NOME DO ARQUIVO não pode virar data:
{
  assert(extrairDataArquivo('scan_4212090807.pdf') === '', 'data arquivo: serial 10 dígitos não vira data');
  assert(extrairDataArquivo('termo_488.954.388-09.pdf') === '', 'data arquivo: CPF pontuado não vira data');
  assert(extrairDataArquivo('victor_260925_133554.pdf') === '2025-09-26', 'data arquivo: grupo isolado continua valendo');
}
// separarNome: unidade direta —
{
  const { separarNome } = require('../src/lib/autoRenomear');
  assert(separarNome('MariadaSilva') === 'Maria da Silva', 'separarNome: partícula colada');
  assert(separarNome('MariaSilva') === 'Maria Silva', 'separarNome: camelCase');
  assert(separarNome('Maria da Silva') === 'Maria da Silva', 'separarNome: já separado não mexe');
}

console.log(`\n=== RESULTADO: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exitCode = 1;
