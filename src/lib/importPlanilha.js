// =====================================================================
//  Importacao da Planilha Geral (CSV ou XLSX).
//
//  A Planilha Geral tem uma linha por monitorado e, as vezes, a data do
//  ultimo comparecimento. A importacao e por VINCULO (numero CNJ):
//  quem ja existe e atualizado, quem nao existe e criado.
//
//  Duas coisas podem ser importadas na mesma passagem:
//    - o assistido (vinculo, nome, vara, local, frequencia, ...)
//    - o comparecimento (data + numero da juntada), quando a planilha
//      tiver a coluna de data
//
//  Modo simulacao (?dry=1) processa tudo e devolve o relatorio sem
//  gravar nada — para conferir a planilha antes de mexer na base.
//
//  Cabecalho: os nomes das colunas sao reconhecidos por apelido, em
//  qualquer ordem. Vide ALIASES.
// =====================================================================
const ExcelJS = require('exceljs');

// Apelidos de cabecalho -> campo canonico.
const ALIASES = {
  vinculo: ['vinculo', 'vínculo', 'processo', 'numero_processo', 'n_processo', 'numero', 'n', 'chave'],
  nome: ['nome', 'monitorado', 'assistido', 'nome_completo', 'nome do assistido', 'nome_monitorado'],
  vara: ['vara', 'comarca', 'vara_criminal'],
  local: ['local', 'local_assinatura', 'local de assinatura', 'unidade', 'prisao', 'prisão', 'comarca_unidade'],
  dataInicio: ['data_inicio', 'data de inicio', 'inicio', 'data_monitoramento', 'data de monitoramento', 'data_inicio_monitoramento', 'inicio_monitoramento'],
  frequencia: ['frequencia', 'frequência', 'periodicidade', 'periodicidade_comparecimento', 'intervalo', 'frequencia_comparecimento'],
  etiqueta: ['etiqueta', 'prioridade', 'situacao', 'situação', 'classificacao'],
  status: ['status', 'situacao_assistido', 'situacao_do_assistido'],
  responsavel: ['responsavel', 'responsável', 'responsavel_tecnico', 'responsável técnico', 'tecnico', 'tecnico_responsavel'],
  cpf: ['cpf'],
  telefone: ['telefone', 'contato', 'celular', 'fone'],
  endereco: ['endereco', 'endereço', 'logradouro'],
  situacaoJuridica: ['situacao_juridica', 'situação jurídica', 'situacao', 'situacao_juridica_assistido'],
  dataComparecimento: ['data_comparecimento', 'data do comparecimento', 'ultima_data', 'última data', 'data', 'ultimo_comparecimento', 'último comparecimento', 'data_ultimo_comparecimento', 'comparcimento'],
  pp: ['pp', 'policial_plantao', 'policial de plantao', 'plantao', 'plantão'],
  juntada: ['juntada', 'numero_juntada', 'n_juntada', 'protocolo', 'numero_protocolo', 'n_protocolo', 'numero_juntada_protocolo'],
  observacao: ['observacao', 'observação', 'obs', 'observacoes', 'observações'],
  protocoladoPor: ['protocolado_por', 'protocolado por', 'responsavel_protocolo'],
};

const normalizaChave = s => String(s || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .trim().toLowerCase().replace(/[\s_]+/g, ' ');

// Mapa cabecalho -> campo canonico
function mapearColunas(head) {
  const mapa = {};
  head.forEach((h, i) => {
    const chave = normalizaChave(h);
    if (!chave) return;
    for (const [campo, apelidos] of Object.entries(ALIASES)) {
      if (mapa[campo] != null) continue;
      if (apelidos.some(a => normalizaChave(a) === chave)) { mapa[campo] = i; return; }
    }
  });
  return mapa;
}

// Le CSV (aceita ; ou , como separador) ou XLSX (primeira aba).
async function lerPlanilha(buffer, filename) {
  const nome = String(filename || '').toLowerCase();
  const ehXlsx = /\.xlsx$/i.test(nome) || (buffer[0] === 0x50 && buffer[1] === 0x4b);

  if (ehXlsx) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const ws = wb.worksheets[0];
    if (!ws) throw new Error('Planilha sem abas');
    const linhas = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const vals = [];
      row.eachCell({ includeEmpty: true }, (cell, col) => {
        let v = cell.value;
        if (v && typeof v === 'object') {
          if (v.text != null) v = v.text;              // rich text
          else if (v.result != null) v = v.result;     // formula
          else if (v instanceof Date) v = v.toISOString().slice(0, 10);
          else if (v.richText) v = v.richText.map(t => t.text).join('');
        }
        vals[col - 1] = v == null ? '' : v;
      });
      linhas.push(vals.map(v => String(v)));
    });
    if (!linhas.length) throw new Error('Planilha vazia');
    const head = linhas[0].map(h => String(h || '').trim());
    return { head, rows: linhas.slice(1), formato: 'xlsx' };
  }

  // CSV
  const texto = buffer.toString('utf8').replace(/^\uFEFF/, '');
  const linhas = [];
  let campo = '', linha = [], dentroAspas = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (dentroAspas) {
      if (ch === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++; }
        else dentroAspas = false;
      } else campo += ch;
      continue;
    }
    if (ch === '"') { dentroAspas = true; continue; }
    if (ch === ';' || ch === ',') { linha.push(campo); campo = ''; continue; }
    if (ch === '\n') { linha.push(campo); linhas.push(linha); linha = []; campo = ''; continue; }
    if (ch === '\r') continue;
    campo += ch;
  }
  if (campo !== '' || linha.length) { linha.push(campo); linhas.push(linha); }
  if (!linhas.length) throw new Error('Arquivo vazio');
  const head = linhas[0].map(h => String(h || '').trim());
  return { head, rows: linhas.slice(1), formato: 'csv' };
}

// Divide um valor de data em AAAA-MM-DD (aceita dd/mm/aaaa e aaaa-mm-dd).
function dataISO(valor) {
  const s = String(valor || '').trim();
  if (!s) return '';
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return '';
}

// Diferença campo a campo (usada na trilha da auditoria da importação).
function diff(antes, depois, campos) {
  const out = [];
  for (const c of campos) {
    const de = antes && antes[c] != null ? String(antes[c]) : '';
    const para = depois && depois[c] != null ? String(depois[c]) : '';
    if (de !== para) out.push({ campo: c, de, para });
  }
  return out;
}

module.exports = { ALIASES, mapearColunas, lerPlanilha, dataISO, normalizaChave, diff };
