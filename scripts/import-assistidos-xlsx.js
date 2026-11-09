// =====================================================================
//  Importação de Assistidos via planilha Excel (.xlsx)
//  Uso: node scripts/import-assistidos-xlsx.js <arquivo.xlsx>
//  Requer: DB_FILE apontando para o banco alvo (modo arquivo) ou
//          SUPABASE_URL/SUPABASE_KEY (modo Supabase).
// =====================================================================

const ExcelJS = require('exceljs');
const store = require('../store');

const LOCAIS_ASSINATURA = ['COMEP Cariri', 'Albergado Cariri', 'COAP Cariri'];
const PERIODOS_COMPARECIMENTO = ['semanal', 'quinzenal', 'mensal', 'bimestral', 'trimestral'];
const STATUS_VALIDOS = ['ativo', 'concluido', 'arquivado'];

function validarCNJ(valor) {
  const cnj = String(valor || '').replace(/[.\-/]/g, '');
  return /^\d{20}$/.test(cnj);
}

function normalizaData(v) {
  if (!v) return '';
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // serial do Excel (número a partir de 25569)
  if (/^\d{4,6}$/.test(s)) {
    const d = new Date((Number(s) - 25569) * 86400 * 1000);
    if (!isNaN(d)) return d.toISOString().slice(0, 10);
  }
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    let [, dd, mm, yyyy] = m;
    if (yyyy.length === 2) yyyy = '20' + yyyy;
    const dt = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
    if (!isNaN(dt)) return dt.toISOString().slice(0, 10);
  }
  const d2 = new Date(s);
  if (!isNaN(d2)) return d2.toISOString().slice(0, 10);
  return s;
}

function pick(r, ...keys) {
  for (const k of keys) {
    if (r[k] != null && String(r[k]).trim() !== '') return r[k];
  }
  const low = Object.keys(r).map(x => x.toLowerCase());
  for (const k of keys) {
    const idx = low.indexOf(String(k).toLowerCase());
    if (idx >= 0) {
      const real = Object.keys(r)[idx];
      if (r[real] != null && String(r[real]).trim() !== '') return r[real];
    }
  }
  return '';
}

function findHeaderRow(ws) {
  for (let i = 1; i <= Math.min(10, ws.rowCount); i++) {
    const row = ws.getRow(i);
    let found = false;
    row.eachCell((c) => {
      const v = String(c.value || '').trim().toLowerCase();
      if (v === 'nome' || v === 'processo' || v === 'vinculo') found = true;
    });
    if (found) return i;
  }
  return 3;
}

function parseSheet(ws) {
  const headerIdx = findHeaderRow(ws);
  const headerRow = ws.getRow(headerIdx);
  const headers = [];
  headerRow.eachCell((c, col) => { headers[col] = String(c.value || '').trim(); });
  const rows = [];
  ws.eachRow((row, idx) => {
    if (idx <= headerIdx) return;
    const obj = {};
    let has = false;
    row.eachCell((c, col) => {
      const h = headers[col];
      if (!h) return;
      let val = c.value;
      if (val && typeof val === 'object' && val.result !== undefined) val = val.result;
      if (val instanceof Date) val = val.toISOString().slice(0, 10);
      obj[h] = (val == null ? '' : String(val).trim());
      if (obj[h]) has = true;
    });
    if (has) rows.push(obj);
  });
  return rows;
}

function normalizarRegistro(r, responsavelPadrao) {
  const vinculo = pick(r, 'vínculo', 'vinculo', 'VÍNCULO', 'VINCULO') || '';
  const nome = pick(r, 'nome', 'NOME') || '';
  const processo = pick(r, 'processo', 'PROCESSO') || '';
  const vara = pick(r, 'vara', 'VARA') || '';
  const cpf = pick(r, 'cpf', 'CPF') || '';
  const telefone = pick(r, 'telefone', 'TELEFONE') || '';
  const endereco = pick(r, 'endereco', 'ENDERECO') || '';
  const situacaoJuridica = pick(r, 'situação jurídica', 'situacao_juridica', 'SITUACAO_JURIDICA') || '';
  const localAssinatura = pick(r, 'local assinatura', 'local_assinatura', 'LOCAL_ASSINATURA') || 'COMEP Cariri';
  const dataInicio = normalizaData(pick(r, 'data início', 'data_inicio', 'DATA_INICIO') || '');
  const dataFim = normalizaData(pick(r, 'data fim', 'data_fim', 'DATA_FIM') || '');
  const frequencia = pick(r, 'frequência', 'frequencia', 'FREQUENCIA') || 'mensal';
  const status = pick(r, 'status', 'STATUS') || 'ativo';
  const etiqueta = pick(r, 'etiqueta', 'ETIQUETA') || '';
  const etiquetaCor = pick(r, 'cor etiqueta', 'etiqueta_cor', 'ETIQUETA_COR') || '#4f46e5';
  const etiquetaTexto = pick(r, 'texto etiqueta', 'etiqueta_texto', 'ETIQUETA_TEXTO') || '';
  const responsavelTecnico = pick(r, 'responsável técnico', 'responsavel_tecnico', 'RESPONSAVEL_TECNICO') || responsavelPadrao;

  return {
    vinculo: String(vinculo).trim(),
    nome: String(nome).trim(),
    processo: String(processo).trim(),
    vara: String(vara).trim(),
    cpf: String(cpf).trim(),
    telefone: String(telefone).trim(),
    endereco: String(endereco).trim(),
    situacaoJuridica: String(situacaoJuridica).trim(),
    localAssinatura: String(localAssinatura).trim(),
    dataInicio,
    dataFim,
    frequencia: PERIODOS_COMPARECIMENTO.includes(frequencia) ? frequencia : 'mensal',
    status: STATUS_VALIDOS.includes(status) ? status : 'ativo',
    etiqueta: String(etiqueta).trim(),
    etiquetaCor: /^#[0-9A-Fa-f]{6}$/.test(String(etiquetaCor)) ? String(etiquetaCor) : '#4f46e5',
    etiquetaTexto: String(etiquetaTexto).trim(),
    responsavelTecnico: String(responsavelTecnico).trim(),
  };
}

function validarRegistro(reg) {
  const erros = [];
  if (!reg.nome) erros.push('Nome obrigatório');
  if (!reg.vinculo) erros.push('Vínculo obrigatório');
  if (!reg.processo) erros.push('Processo obrigatório');
  else if (!validarCNJ(reg.processo)) erros.push('Processo inválido (CNJ 20 dígitos)');
  if (!reg.vara) erros.push('Vara obrigatória');
  if (!LOCAIS_ASSINATURA.includes(reg.localAssinatura)) erros.push('Local de assinatura inválido');
  if (!reg.dataInicio) erros.push('Data de início obrigatória');
  if (reg.dataFim && reg.dataFim < reg.dataInicio) erros.push('Data fim anterior ao início');
  if (reg.cpf && !/^\d{11}$/.test(reg.cpf.replace(/[.\-/]/g, ''))) erros.push('CPF inválido');
  return erros;
}

async function run(filePath, responsavelPadrao = 'admin') {
  if (!filePath) {
    console.log('Uso: node scripts/import-assistidos-xlsx.js <arquivo.xlsx> [responsavel_padrao]');
    process.exit(1);
  }

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.readFile(filePath);
  } catch (e) {
    console.error('Erro ao ler XLSX:', e.message);
    process.exit(1);
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    console.error('Planilha vazia');
    process.exit(1);
  }

  const rows = parseSheet(worksheet);
  console.log(`Linhas encontradas: ${rows.length}`);

  const resultados = { importados: 0, erros: [], total: rows.length };
  const jaCadastrados = new Set();
  const todos = await store.assistidos.allIncludingDeleted();
  todos.forEach(x => { if (!x.deleted_at) jaCadastrados.add(String(x.vinculo).trim().toLowerCase()); });

  for (let i = 0; i < rows.length; i++) {
    const linha = i + 2;
    const r = rows[i];
    try {
      const reg = normalizarRegistro(r, responsavelPadrao);
      const erros = validarRegistro(reg);
      if (erros.length) { resultados.erros.push({ linha, erros, dados: reg }); continue; }

      const chave = reg.vinculo.toLowerCase();
      if (jaCadastrados.has(chave)) { resultados.erros.push({ linha, erros: ['Vínculo duplicado'], dados: reg }); continue; }

      await store.assistidos.insert(reg);
      jaCadastrados.add(chave);
      resultados.importados++;
    } catch (e) {
      resultados.erros.push({ linha, erros: [e.message], dados: r });
    }
  }

  console.log('\n==================== RESULTADO ====================');
  console.log(`Total: ${resultados.total} | Importados: ${resultados.importados} | Erros: ${resultados.erros.length}`);
  if (resultados.erros.length) {
    console.log('\n--- Erros ---');
    resultados.erros.forEach(e => {
      console.log(`Linha ${e.linha}: ${e.erros.join(', ')}`);
      if (e.dados) console.log('  Dados:', JSON.stringify(e.dados));
    });
  }
}

const filePath = process.argv[2];
const responsavelPadrao = process.argv[3] || 'admin';
run(filePath, responsavelPadrao).catch(e => { console.error(e); process.exit(1); });

module.exports = { normalizarRegistro, validarRegistro, parseSheet };
