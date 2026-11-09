const ExcelJS = require('exceljs');
const fs = require('fs');

const file = 'D:\\Pasta Download Disco D\\Planilha Biometria - Novembro - 2026 (2).xlsx';
if (!fs.existsSync(file)) {
  console.error('Arquivo não encontrado:', file);
  process.exit(1);
}

const LOCAIS_VALIDOS = ['COAP CARIRI','COMEP CARIRI','ALBERGADO CARIRI'];
const PPS_CONHECIDOS = ['ERMINIO','MARCOS','WANDERSON','JOANDERSON','JULIANA','REJANE','AILTON'];
const LOCAIS_ASSINATURA = ['COMEP Cariri', 'Albergado Cariri', 'COAP Cariri'];

function excelSerialToISO(v) {
  if (v == null || v === '') return '';
  if (v instanceof Date) return v.toISOString().slice(0,10);
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10);
  if (/^\d{4,6}$/.test(s)) {
    const d = new Date((Number(s) - 25569) * 86400 * 1000);
    if (!isNaN(d)) return d.toISOString().slice(0,10);
  }
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    let [,dd,mm,yyyy] = m;
    if (yyyy.length === 2) yyyy = '20' + yyyy;
    const d = new Date(Number(yyyy), Number(mm)-1, Number(dd));
    if (!isNaN(d)) return d.toISOString().slice(0,10);
  }
  return s;
}
function normFreq(v) {
  const s = String(v||'').trim().toLowerCase();
  if (s.startsWith('sem')) return 'semanal';
  if (s.startsWith('quin')) return 'quinzenal';
  if (s.startsWith('bim')) return 'bimestral';
  if (s.startsWith('trim')) return 'trimestral';
  return 'mensal';
}
function isProcessoLike(v) {
  const s = String(v||'').trim();
  if (!s) return false;
  if (/^(ARQUIVADO|INATIVO|SEM DIGITAL)$/i.test(s)) return true;
  return /^\d{3,7}[\-\.]\d{2}[\.\-]\d{4}\.\d\.\d{2}\.\d{4}$/.test(s) ||
         /^\d{7}[\-\.]\d{2}$/.test(s);
}
function isLocalLike(v) {
  return LOCAIS_VALIDOS.includes(String(v||'').trim().toUpperCase());
}
function isFrequenciaLike(v) {
  const s = String(v||'').trim().toUpperCase();
  return /^(SEMANAL|MENSAL|QUINZENAL|BIMENSAL|TRIMENSAL|DIÁRIA|DIARIA|QUINQUEMESTRAL)$/.test(s);
}
function isDataLike(v) {
  if (v instanceof Date) return true;
  const s = String(v||'').trim();
  if (!s) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ||
         /^\d{2}\/\d{2}\/\d{4}$/.test(s) ||
         /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s);
}
function isVaraLike(v) {
  const s = String(v||'').trim().toUpperCase();
  return /VARA|JUIZADO|NÚCLEO|NUCLEO/.test(s);
}
function classifyCell(val) {
  if (val == null) return 'vazio';
  if (val instanceof Date) return 'data';
  const s = String(val).trim();
  if (!s) return 'vazio';
  const u = s.toUpperCase();
  if (isProcessoLike(s)) return 'processo';
  if (isLocalLike(s)) return 'local';
  if (isFrequenciaLike(s)) return 'frequencia';
  if (isDataLike(s)) return 'data';
  if (isVaraLike(s)) return 'vara';
  if (PPS_CONHECIDOS.includes(u)) return 'pp';
  return 'texto';
}
function lerLinhaAssistido(row) {
  const campos = {
    vinculo: '', nome: '', processo: '', vara: '', localAssinatura: '',
    dataInicio: '', frequencia: 'mensal', dataComparecimento: '', policialPlantao: '',
    observacao: '', status: 'ativo'
  };
  let melhorNome = '';
  row.eachCell((c, colIdx) => {
    const v = row.getCell(colIdx).value;
    const tipo = classifyCell(v);
    const s = String(v||'').trim();
    const u = s.toUpperCase();
    switch (tipo) {
      case 'processo':
        if (!campos.vinculo) campos.vinculo = s;
        else if (!campos.processo) campos.processo = s;
        break;
      case 'local':
        if (!campos.localAssinatura) campos.localAssinatura = s;
        break;
      case 'frequencia':
        if (!campos.frequencia || campos.frequencia==='mensal') campos.frequencia = normFreq(s);
        break;
      case 'data': {
        const iso = excelSerialToISO(v);
        if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
          if (!campos.dataInicio) campos.dataInicio = iso;
          else if (!campos.dataComparecimento) campos.dataComparecimento = iso;
        }
        break;
      }
      case 'vara':
        if (!campos.vara) campos.vara = s;
        break;
      case 'pp':
        if (!campos.policialPlantao) campos.policialPlantao = s;
        break;
      case 'texto':
        if (!melhorNome && s.split(/\s+/).filter(Boolean).length >= 2 &&
            !/ARQUIVADO|INATIVO|SEM DIGITAL|JUNTADA|SEEU|FLS|PROTOCOL/.test(u)) {
          melhorNome = s;
        } else if (!campos.observacao && s.length > 3) {
          campos.observacao = s;
        }
        break;
      case 'status_especial': {
        if (/ARQUIVADO/i.test(u)) campos.status = 'arquivado';
        else if (/INATIVO/i.test(u)) campos.status = 'arquivado';
        break;
      }
    }
  });
  if (melhorNome) campos.nome = melhorNome;
  campos.frequencia = normFreq(campos.frequencia);
  if (/ARQUIVADO/.test(String(campos.processo).toUpperCase()) || /ARQUIVADO/.test(String(campos.vara).toUpperCase())) {
    campos.status = 'arquivado';
  }
  return campos;
}

(async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.worksheets[0];
  let totalValidas = 0;
  let totalLidas = 0;
  const exemplos = [];
  const erros = [];
  ws.eachRow((row, idx) => {
    if (idx === 1) return;
    let temDado = false;
    row.eachCell((c) => { if (c.value != null && String(c.value).trim()) temDado = true; });
    if (!temDado) return;
    totalLidas++;
    const campos = lerLinhaAssistido(row);
    const { vinculo, nome } = campos;
    if (!vinculo || !nome) {
      erros.push(`Linha ${idx}: sem vinculo ou nome`);
      return;
    }
    totalValidas++;
    if (exemplos.length < 10) {
      exemplos.push(`Linha ${idx}: vinculo=${vinculo} | nome=${nome} | processo=${campos.processo} | vara=${campos.vara} | local=${campos.localAssinatura} | inicio=${campos.dataInicio} | freq=${campos.frequencia} | status=${campos.status} | comp=${campos.dataComparecimento} | pp=${campos.policialPlantao} | obs=${campos.observacao}`);
    }
  });
  console.log(`Total de linhas com dados: ${totalLidas}`);
  console.log(`Linhas válidas para importação: ${totalValidas}`);
  console.log('\n--- Primeiros 10 exemplos ---');
  exemplos.forEach(e => console.log(e));
  if (erros.length > 0) {
    console.log('\n--- Erros ---');
    erros.slice(0, 10).forEach(e => console.log(e));
  }
})();
