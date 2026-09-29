// Salva um PDFDocument com metadados determinísticos.
// O pdf-lib grava CreationDate/ModDate com o momento da geração — sem fixar,
// cada chamada produz bytes diferentes, e o preview nunca é idêntico ao PDF
// final (regressões viram invisíveis). Fixar a data não remove o relógio do
// documento: o pdfDoc herda a data de geração, só deixa de variar entre
// gerações com o mesmo conteúdo.
// Também zera o ID do trailer (pdf-lib gera aleatório por default) — senão
// duas gerações do mesmo conteúdo ainda divergiriam no fim do arquivo.
const crypto = require('crypto');

async function saveDeterministico(pdfDoc) {
  const agora = new Date();
  pdfDoc.setCreationDate(agora);
  pdfDoc.setModificationDate(agora);
  const bytes = await pdfDoc.save();
  // Trailer /ID [<...><...>]: substitui os dois hex de 16 bytes pelo mesmo
  // valor derivado do conteúdo — mesmo documento ⇒ mesmo ID.
  const s = bytes.toString('latin1');
  const m = s.match(/\/ID\s*\[<([0-9a-fA-F]+)><([0-9a-fA-F]+)>\]/);
  if (!m) return bytes;
  const h = crypto.createHash('md5').update(bytes).digest('hex');
  return Buffer.from(
    s.slice(0, m.index) + '/ID [<' + h + '><' + h + '>]' + s.slice(m.index + m[0].length),
    'latin1'
  );
}

module.exports = { saveDeterministico };
