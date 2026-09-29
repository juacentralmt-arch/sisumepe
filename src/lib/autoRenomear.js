// =====================================================================
//  AutoRenomear — sugere nome de arquivo a partir do CONTEÚDO do documento.
//  Padrão: "<Tipo> - <Nome da pessoa> - <Data do documento>"
//  100% determinístico (regex), sem IA externa.
// =====================================================================

// Normaliza para busca: minúsculas, sem acento, espaços simples
function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Tipos na ordem de prioridade (o primeiro que casar vence)
const TIPOS = [
  { id: 'dae', label: 'DAE', chaves: ['documento de arrecadacao', 'arrecadacao estadual', 'funpen', 'dae - documento'] },
  { id: 'recolhimento', label: 'Termo de recolhimento', chaves: ['auto de recolhimento', 'entregues pelas unidades penais', 'nucleo juazeiro', 'unidade de monitoramento eletronico de pessoas'], semNome: true },
  { id: 'recEquip', label: 'Termo de recolhimento equipamento', chaves: ['termo de recolhimento', 'recolhimento de equipamento', 'monitorado(a):'], semNome: false },
  { id: 'manutencao', label: 'Termo de manutenção', chaves: ['termo de manutencao', 'manutencao de tornozeleira', 'manutencao preventiva', 'manutencao corretiva'] },
  { id: 'ativacao', label: 'Termo de ativação', chaves: ['termo de ativacao', 'ativacao de tornozeleira', 'instalacao de tornozeleira', 'termo de instalacao'] },
  { id: 'retirada', label: 'Termo de retirada', chaves: ['termo de retirada', 'retirada de tornozeleira', 'desativacao de tornozeleira'] },
  { id: 'listagem', label: 'Listagem de equipamentos', chaves: ['listagem de equipamentos', 'lista de equipamentos'] },
  { id: 'endereco', label: 'Ofício', chaves: ['oficio', 'endereco do monitorado', 'comunicacao de endereco'] },
  { id: 'declaracao', label: 'Declaração', chaves: ['declaracao'] },
  { id: 'relatorio', label: 'Relatório', chaves: ['relatorio'] },
  { id: 'ata', label: 'Ata', chaves: ['ata de reuniao', 'ata de audiencia'] }
];

function detectarTipo(texto) {
  const n = norm(texto).slice(0, 4000);
  for (const t of TIPOS) {
    if (t.chaves.some(k => n.includes(k))) return t;
  }
  return { id: 'documento', label: 'Documento' };
}

// Rótulos que antecedem o nome da pessoa nos documentos oficiais
const ROTULOS_NOME = [
  'nome do monitorado', 'monitorado\\(a\\)', 'monitorado', 'nome completo',
  'nome do assistido', 'assistido', 'nome do reeducando', 'reeducando',
  'nome do paciente', 'paciente', 'nome do declarante', 'declarante',
  'nome do requerente', 'requerente',
  'nome\\s+depositante', 'nome\\s+da\\s+m[ãa]e', 'nome\\s+do\\s+pai',
  // "nome" genérico NÃO pode casar rótulos compostos (ex: NOME DEPOSITANTE, NOME DA MÃE)
  '\\bnome\\b(?!\\s+(?:depositante|da\\s+m[ãa]e|do\\s+pai|completo))'
];

function limparNome(s) {
  let v = String(s || '').replace(/\s+/g, ' ').trim();
  // corta em localidade (quando o extrator junta linhas: "Fulano Juazeiro do Norte, 10 de...")
  v = v.split(/\b(juazeiro\s+do\s+norte|fortaleza|crat[oó]|cariri|jardim|cear[áa]|juizado|comarca|vara\s+[úu]nica)\b/i)[0].trim();
  // corta em rótulos de campo (quando o extrator junta linhas: "...Silva Data: 28/...")
  v = v.split(/\b(data|cpf|cnpj|r\.?g\.?\b|orgao\s+expedidor|endereco|telefone|celular|processo|vara|nascimento|nome\s+da\s+m[ãa]e|nome\s+do\s+pai|estado\s+civil|naturalidade|profiss[ãa]o|assinatura)\b/i)[0].trim();
  // corta em CPF, RG, vírgula, ponto-e-vírgula, parêntese ou "nascid"
  v = v.split(/,|;|\(|cpf|r\.?g\.?\b|nascid|brasileir|casad|solteir|residente|\d{3}\.?\d{3}\.?/i)[0].trim();
  // corta dígitos residuais do fim (ruído de data colada: "Silva 28")
  v = v.replace(/\s+\d[\d\s/.\-]*$/, '').trim();
  // corta letra solta do fim (ruído de "R$" colado: "Chagas R")
  v = v.replace(/\s+[A-Za-z]$/, '').trim();
  // remove pontuação residual nas bordas
  v = v.replace(/^[.\-–:]+|[.\-–:]+$/g, '').trim();
  return v;
}

function tituloProprio(s) {
  const minusculas = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);
  return String(s || '').toLowerCase().split(/\s+/)
    .map((w, i) => (i > 0 && minusculas.has(w)) ? w : (w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

// Inícios que nunca são nome (evita "Monitorado desde 01/02/2020" → "desde")
const STOP_INICIO_NOME = /^(desde|at[ée]|ao|aos|de|do|da|para|com|por|em|no|na|e|ou)\b/i;
function extrairNome(texto) {
  const t = String(texto || '').slice(0, 8000);
  // cópia com confusão clássica de OCR normalizada (0→O, ex: MONITORAD0):
  // troca 1:1, então as posições são idênticas às do original
  const tOcr = t.replace(/0/g, 'O');
  // após o rótulo, pula até 12 chars não-nome ("(A): ", "(A); ", ": ") — tolera OCR
  const padrao = new RegExp('(?:' + ROTULOS_NOME.join('|') + ')[^A-Za-zÀ-ÖØ-öø-ÿ0-9]{0,12}([A-Za-zÀ-ÖØ-öø-ÿ0-9\'´`. \\t]{3,90})', 'gi');
  const cands = [];
  for (const src of [t, tOcr]) {
    for (const m of src.matchAll(padrao)) cands.push({ idx: m.index, cap: m[1] });
  }
  cands.sort((a, b) => a.idx - b.idx);
  for (const c of cands) {
    const nome = tituloProprio(limparNome(c.cap));
    if (nome.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ]/g, '').length < 3) continue;
    if (STOP_INICIO_NOME.test(nome)) continue;
    return nome;
  }
  // fallback: "Eu, NOME COMPLETO," (comum em declarações)
  for (const src of [t, tOcr]) {
    const m2 = src.match(/\beu\s*,?\s*([A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ0-9'´`. \t]{2,80}?)\s*[,.;]/i);
    if (m2) {
      const nome = tituloProprio(limparNome(m2[1]));
      if (nome.split(/\s+/).length >= 2) return nome;
    }
  }
  return '';
}

const MESES_PT = {
  janeiro: '01', fevereiro: '02', marco: '03', abril: '04', maio: '05', junho: '06',
  julho: '07', agosto: '08', setembro: '09', outubro: '10', novembro: '11', dezembro: '12'
};

function extrairDataISO(texto, nomeOriginal) {
  const t = String(texto || '').slice(0, 8000);
  // 1) data rotulada: "Data: 28/09/2026", "Data/Hora: 28/08/2026" (espaços do OCR tolerados)
  let m = t.match(/(?:\bdata\b|datado|emitido\s+em|lavrado\s+em|aos?)[\s/:.\-]*(\d{1,2})\s*[\/.\-]\s*(\d{1,2})\s*[\/.\-]\s*(\d{4})/i);
  // 2) qualquer DD/MM/AAAA (ou - .), com espaços eventuais do OCR
  if (!m) m = t.match(/(\d{1,2})\s*[\/.\-]\s*(\d{1,2})\s*[\/.\-]\s*(\d{4})/);
  if (m) {
    const dd = m[1].padStart(2, '0'), mm = m[2].padStart(2, '0'), aa = m[3];
    if (Number(mm) >= 1 && Number(mm) <= 12 && Number(dd) >= 1 && Number(dd) <= 31) return aa + '-' + mm + '-' + dd;
  }
  // 3) ISO AAAA-MM-DD
  m = t.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  // 4) por extenso: "28 de setembro de 2026"
  m = norm(t).match(/(\d{1,2})\s+de\s+([a-z]+)\s+de\s+(\d{4})/);
  if (m && MESES_PT[m[2]]) return m[3] + '-' + MESES_PT[m[2]] + '-' + String(m[1]).padStart(2, '0');
  // 5) tentar extrair do nome do arquivo: victor_260925_133554.pdf -> 26/09/2025
  if (nomeOriginal) {
    const fnMatch = nomeOriginal.match(/(\d{2})(\d{2})(\d{2})/);
    if (fnMatch) {
      const dd = fnMatch[1], mm = fnMatch[2], aa = '20' + fnMatch[3];
      if (Number(mm) >= 1 && Number(mm) <= 12 && Number(dd) >= 1 && Number(dd) <= 31) return aa + '-' + mm + '-' + dd;
    }
  }
  return '';
}

function isoParaNome(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? m[3] + '-' + m[2] + '-' + m[1] : '';
}

// Sanitiza para nome de arquivo (Windows/Linux): sem \ / : * ? " < > |
function sanitizar(s, max) {
  let v = String(s || '').replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();
  v = v.replace(/^[.\s]+|[.\s]+$/g, '');
  const n = Math.max(10, Math.min(Number(max) || 80, 120));
  if (v.length > n) v = v.slice(0, n).trim();
  return v;
}

function extensaoDe(nomeOriginal) {
  const m = String(nomeOriginal || '').toLowerCase().match(/\.(pdf|jpe?g|png)$/);
  return m ? '.' + m[1].replace('jpeg', 'jpg') : '.pdf';
}

function sugerirNome(texto, nomeOriginal) {
  const tipo = detectarTipo(texto);
  const skipNome = tipo.semNome === true;
  const nome = skipNome ? '' : extrairNome(texto);
  const dataISO = extrairDataISO(texto, nomeOriginal);
  const nomeParte = (skipNome || nome) ? sanitizar(nome, 60) : 'SEM NOME';
  const dataParte = dataISO ? isoParaNome(dataISO) : 'SEM DATA';
  const sugestao = sanitizar(tipo.label + (skipNome ? '' : ' - ' + nomeParte) + ' - ' + dataParte, 120) + extensaoDe(nomeOriginal);
  const achados = (tipo.id !== 'documento' ? 1 : 0) + (skipNome ? 1 : (nome ? 1 : 0)) + (dataISO ? 1 : 0);
  const avisos = [];
  if (tipo.id === 'documento') avisos.push('Tipo não identificado — verifique o título do documento');
  if (!skipNome && !nome) avisos.push('Nome não encontrado — complete manualmente');
  if (!dataISO) avisos.push('Data não encontrada — complete manualmente');
  return {
    sugestao,
    tipo: tipo.label,
    tipoId: tipo.id,
    nome: skipNome ? undefined : nome,
    data: dataParte,
    dataISO,
    confianca: achados === 3 ? 'alta' : (achados === 2 ? 'média' : 'baixa'),
    avisos
  };
}

module.exports = { TIPOS, detectarTipo, extrairNome, extrairDataISO, sanitizar, sugerirNome };
