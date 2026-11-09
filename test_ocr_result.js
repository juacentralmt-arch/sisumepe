const { sugerirNome } = require('./src/lib/autoRenomear');

const ocrTexts = {
  'pagina-03.pdf': `|               » — (ggCcEARA
to)                                  ação
ão
DADOS DA INSPEÇÃO
MANU
e      S
do U               138 54
áverpela       (   q                 14/20      s
realizadá pela
ÁS
NEVO""""""`,

  'pagina-04.pdf': ``,  // will test after extracting
  'pagina-05.pdf': ``,
  'pagina-06.pdf': ``,
  'pagina-07.pdf': ``,
  'pagina-08.pdf': ``,
};

for (const [filename, texto] of Object.entries(ocrTexts)) {
  if (!texto) continue;
  console.log('==================== ' + filename + ' ====================');
  console.log('TEXTO OCR:');
  console.log(texto);
  console.log('');
  const r = sugerirNome(texto, filename);
  console.log('SUGESTÃO:');
  console.log(JSON.stringify(r, null, 2));
  console.log('');
}
EOF