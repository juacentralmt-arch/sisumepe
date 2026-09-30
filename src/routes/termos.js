const express = require('express');
const { gerarTermoPDF, gerarTermoRecolhimentoPDF, gerarTermoRecolhimentoEquipamentoPDF, gerarTermoEnderecoPDF, gerarDeclaracaoPDF, gerarRelFrequenciaPDF, gerarRelTecnicoPDF, gerarOficioEncaminhamentoPDF } = require('../lib/termosPdf');
const { gerarAtivacaoPDF } = require('../lib/ativacoesPdf');
const shared = require('../lib/shared');
const visaoService = require('../services/visaoComputacional');
const { store, ah, auth, broadcast, issueToken, loginRateLimit, isHash, upload, mapFiles, sortQueue, enrich, enrichAll, ticketOwnerOf, infinityBlocked, PERSON_LABELS, MOTIVOS_OK, getGoogleConfig, makeOAuthClient, getAuthedClientForUser, syncAgendaToGoogle, pendingGoogleStates, ROOT, PORT } = shared;
const router = express.Router();

// Documentos psicossociais (prontuário/relatórios do perfil psico)
const PSI_DOCS = ['declaracao', 'relfreq', 'reltec', 'oficioenc'];
function normPsiDoc(src) {
  const s = (src && typeof src === 'object') ? src : {};
  const g = (k, n) => String(s[k] == null ? '' : s[k]).trim().slice(0, n);
  const nd = {};
  ['nome','cpf','processo','vara','medida','periodo','data','cidade','endereco','contato','destino','motivo','psicologo','crp'].forEach(k=>{ nd[k] = g(k, 300); });
  ['resumo','parecer','plano','texto'].forEach(k=>{ nd[k] = g(k, 3000); });
  ['dataInicio','dataFim','dataDoc'].forEach(k=>{ if(s[k]){ const dt = new Date(s[k]); if(!isNaN(dt)) nd[k] = dt.toISOString().slice(0,10); } });
  if(Array.isArray(s.itens)) nd.itens = s.itens.slice(0, 200).map(r=>({ data: String((r&&r.data)||'').slice(0,10), local: String((r&&r.local)||'').slice(0,120), status: String((r&&r.status)||'').slice(0,30), obs: String((r&&r.obs)||'').slice(0,300) }));
  return nd;
}

// Normalização do Termo de Recolhimento de Equipamento (UNEPE Juazeiro)
function normRecEquip(src){
  const s = (src && typeof src === 'object') ? src : {};
  const g = (k,n) => String(s[k]==null?'':s[k]).trim().slice(0,n);
  const nd = {};
  ['nomeMonitorado','numeroTermo','idMonitorado','perfil','estabelecimento','cpfRg','descricao','horaFim'].forEach(k=>{ nd[k]=g(k, k==='descricao'?1000:120); });
  ['monitoradoDesde','desativadoDesde'].forEach(k=>{
    if(s[k]){ const dt=new Date(s[k]); if(!isNaN(dt)) nd[k]=dt.toISOString().slice(0,10); }
  });
  ['dataHora'].forEach(k=>{ if(s[k]){ const dt=new Date(s[k]); if(!isNaN(dt)) nd[k]=dt.toISOString(); } });
  const CHECK_KEYS = ['ladoExterno','cinta','travas','fonte','fonteCE01','ladoInterno','abaDireita','abaEsquerda'];
  if(Array.isArray(s.equipamentos)){
    nd.equipamentos = s.equipamentos.slice(0,10).map(r=>{
      const checks = {};
      CHECK_KEYS.forEach(k=>{
        const v = r && r.checks ? r.checks[k] : null;
        checks[k] = (v === true || v === 'sim') ? true : (v === false || v === 'nao') ? false : null;
      });
      return { numero: String((r&&r.numero)||'').trim().slice(0,30), danificado: !!(r&&r.danificado), checks };
    }).filter(r=>r.numero);
  }
  return nd;
}

// Normalização do Termo de Recolhimento (unidades penais) — COMPARTILHADA por
// POST, PATCH e preview: os três caminhos produzem exatamente o mesmo registro,
// logo o preview é byte-idêntico ao PDF final.
function normRecolhimentoDados(src){
  const d = (src && typeof src === 'object') ? src : {};
  const eq = Array.isArray(d.equipamentos) ? d.equipamentos.slice(0,60) : [];
  const normEq = eq.map(r=>{
    const checks = {};
    ['ladoExterno','cinta','travas','ladoInterno','abaDireita','abaEsquerda'].forEach(k=>{
      const v = r.checks ? r.checks[k] : null;
      checks[k] = (v === true || v === 'sim') ? true : (v === false || v === 'nao') ? false : null;
    });
    return { numero: String(r.numero||'').trim().slice(0,30), danificado: !!r.danificado, checks };
  }).filter(r=> r.numero);
  return {
    itensRecebidos: String(d.itensRecebidos||'').trim().slice(0,200),
    dataHora: d.dataHora ? new Date(d.dataHora).toISOString() : new Date().toISOString(),
    equipamentos: normEq,
    descricao: String(d.descricao||'').trim().slice(0,2000),
    policialNome: String(d.policialNome||'').trim().slice(0,80),
    policialMat: String(d.policialMat||'').trim().slice(0,30),
    tecnicoNome: String(d.tecnicoNome||'').trim().slice(0,80),
    tecnicoMat: String(d.tecnicoMat||'').trim().slice(0,30)
  };
}

// Termos - Listagem de Equipamentos
router.get('/api/termos', auth(['tecnico', 'psico']), ah(async (req,res)=>{
  const list = await store.termos.allByUser(req.auth.user);
  res.json(list);
}));

// Normalização para Ativações (formulário completo de monitorado)
function normAtivacao(src){
  const s = (src && typeof src === 'object') ? src : {};
  const g = (k,n) => String(s[k]==null?'':s[k]).trim().slice(0,n);
  const nd = {};
  // strings curtas
  [
    ['nomeMonitorado',120], ['vulgo',80], ['nomeMae',120], ['nomePai',120], ['sexo',20],
    ['rg',30], ['orgaoExpedidor',20], ['cpf',20], ['processo',60], ['processos',600],
    ['perfil',120], ['artigos',500], ['lei',120], ['militar',120], ['codigoPenal',300],
    ['periculosidade',30], ['vara',120], ['isencao',60], ['origem',80], ['tipoCumprimento',80],
    ['dias',10], ['periodoReanalisar',80], ['tamanhoCinta',20], ['orcrim',10],
    ['deficiencia',20], ['tipoDeficiencia',80], ['descricaoDeficiencia',300],
    ['etnia',20], ['grauEscolaridade',60], ['naturalidade',60], ['nacionalidade',40],
    ['religiao',40], ['estadoCivil',30], ['nomeConjuge',120], ['contatosPrioritarios',120],
    ['endereco',500], ['residenciaComplemento',200], ['residenciaPontoReferencia',200],
    ['bairro',80], ['cep',10], ['estado',30], ['cidade',60]
  ].forEach(([k,n])=>{ nd[k]=g(k,n); });
  // alias nome -> nomeMonitorado compat
  if(!nd.nomeMonitorado && s.nome) nd.nomeMonitorado = g('nome',120);
  // datas
  ['dataNascimento','dataPrisao','inicioPrevisto','terminoPrevisto'].forEach(k=>{
    if(s[k]){
      const dt=new Date(s[k]);
      if(!isNaN(dt)) nd[k]=dt.toISOString().slice(0,10);
      else if(String(s[k]).match(/^\d{4}-\d{2}-\d{2}$/)) nd[k]=String(s[k]).slice(0,10);
    }
  });
  // calcula término se tiver dias e início mas sem término
  if(nd.inicioPrevisto && nd.dias && !nd.terminoPrevisto){
    const d=new Date(nd.inicioPrevisto);
    if(!isNaN(d)){ d.setDate(d.getDate()+Number(nd.dias)); nd.terminoPrevisto=d.toISOString().slice(0,10); }
  }
  return nd;
}
router.post('/api/termos', auth(['tecnico', 'psico']), ah(async (req,res)=>{
  const { tipo, dataEnvio, destinatario, equipamentos, respEntrega, respRecebimento, dados, modelo } = req.body||{};
  const t = (tipo === 'ativacao') ? 'ativacao' : (tipo === 'recolhimento') ? 'recolhimento' : (tipo === 'recEquip') ? 'recEquip' : (tipo === 'endereco' ? 'endereco' : (PSI_DOCS.includes(tipo) ? tipo : 'listagem'));
  if(t === 'recEquip'){
    const nd = normRecEquip(dados);
    if(!nd.equipamentos || !nd.equipamentos.length) return res.status(400).json({ error: 'Adicione ao menos um equipamento com número' });
    if(!nd.nomeMonitorado) return res.status(400).json({ error: 'Informe o nome do monitorado' });
    const termo = await store.termos.insert({
      user: req.auth.user, tipo: 'recEquip',
      dataEnvio: nd.dataHora ? nd.dataHora.slice(0,10) : new Date().toISOString().slice(0,10),
      destinatario: nd.estabelecimento || '', equipamentos: [],
      respEntrega: '', respRecebimento: '',
      dados: nd
    });
    broadcast();
    return res.status(201).json(termo);
  }
  if(t === 'ativacao'){
    const nd = normAtivacao(dados);
    if(!nd.nomeMonitorado) return res.status(400).json({ error: 'Informe o Nome do monitorado' });
    if(!nd.nomeMae) return res.status(400).json({ error: 'Informe o Nome da mãe' });
    if(!nd.processo) return res.status(400).json({ error: 'Informe o Processo' });
    if(!nd.vara) return res.status(400).json({ error: 'Informe a Vara' });
    if(!nd.sexo) return res.status(400).json({ error: 'Informe o Sexo' });
    if(!nd.dataNascimento) return res.status(400).json({ error: 'Informe a Data de nascimento' });
    if(!nd.religiao) return res.status(400).json({ error: 'Informe a Religião' });
    const termo = await store.termos.insert({
      user: req.auth.user, tipo: 'ativacao',
      dataEnvio: new Date().toISOString().slice(0,10),
      destinatario: nd.vara, equipamentos: [],
      respEntrega: '', respRecebimento: '',
      dados: nd
    });
    broadcast();
    return res.status(201).json(termo);
  }
  if(PSI_DOCS.includes(t)){
    if(req.auth.role !== 'psico') return res.status(403).json({ error: 'Documentos psicossociais: só o psicólogo' });
    const nd = normPsiDoc(dados);
    if(!nd.nome) return res.status(400).json({ error: 'Informe o nome da pessoa' });
    if(!nd.psicologo) nd.psicologo = req.auth.name || '';
    const termo = await store.termos.insert({
      user: req.auth.user, tipo: t,
      dataEnvio: nd.dataDoc || nd.data || new Date().toISOString().slice(0,10),
      destinatario: nd.vara || nd.destino || '', equipamentos: [],
      respEntrega: '', respRecebimento: '',
      dados: nd
    });
    broadcast();
    return res.status(201).json(termo);
  }
  if(t === 'endereco'){
    const src = (dados && typeof dados === 'object') ? dados : {};
    const g = (k, n) => String(src[k] == null ? '' : src[k]).trim().slice(0, n);
    const nd = {
      numero: g('numero', 20),
      ano: g('ano', 4) || String(new Date().getFullYear()),
      cidade: g('cidade', 60) || 'Fortaleza',
      dataOficio: src.dataOficio ? new Date(src.dataOficio).toISOString().slice(0,10) : new Date().toISOString().slice(0,10),
      vara: g('vara', 120),
      processo: g('processo', 60),
      nome: g('nome', 120),
      cpf: g('cpf', 20),
      mae: g('mae', 120),
      dataSolicitacao: src.dataSolicitacao ? new Date(src.dataSolicitacao).toISOString().slice(0,10) : '',
      endereco: g('endereco', 500),
      contato: g('contato', 30),
      motivo: g('motivo', 1000)
    };
    if(!nd.nome) return res.status(400).json({ error: 'Informe o nome da pessoa' });
    const termo = await store.termos.insert({
      user: req.auth.user, tipo: 'endereco',
      dataEnvio: nd.dataOficio,
      destinatario: nd.vara, equipamentos: [],
      respEntrega: '', respRecebimento: '',
      dados: nd
    });
    broadcast();
    return res.status(201).json(termo);
  }
  if(t === 'recolhimento'){
    const nd = normRecolhimentoDados(dados);
    if(!nd.equipamentos.length) return res.status(400).json({ error: 'Adicione ao menos um equipamento com número' });
    const termo = await store.termos.insert({
      user: req.auth.user, tipo: 'recolhimento',
      // dataEnvio espelha dados.dataHora (a data do documento); se o cliente
      // mandar dataEnvio explícita, ela vence — consistente com o PATCH.
      dataEnvio: dataEnvio ? new Date(dataEnvio).toISOString().slice(0,10)
        : (nd.dataHora ? nd.dataHora.slice(0,10) : new Date().toISOString().slice(0,10)),
      destinatario: '', equipamentos: [],
      respEntrega: '', respRecebimento: '',
      dados: nd
    });
    broadcast();
    return res.status(201).json(termo);
  }
  // Listagem permite tudo em branco (destinatário e equipamentos opcionais)
  // modelo: 'tzpr' (TZPR04+FONTE04+CINTA+TRAVA) ou 'upr' (UPR04+FONTE04, sem cinta/trava)
  const modeloList = (modelo === 'upr') ? 'upr' : 'tzpr';
  const eqIn = Array.isArray(equipamentos) ? equipamentos.slice(0, 30) : [];
  // normaliza somente linhas preenchidas (até 30)
  const norm = modeloList === 'upr'
    ? eqIn.map(r => ({
        upr04: String((r && (r.upr04 ?? r.tzpr04)) || '').trim().slice(0, 30),
        fonte04: String((r && r.fonte04) || '').trim().slice(0, 30)
      })).filter(r => r.upr04 || r.fonte04)
    : eqIn.map(r => ({
        tzpr04: String((r && r.tzpr04) || '').trim().slice(0, 30),
        fonte04: String((r && r.fonte04) || '').trim().slice(0, 30),
        cinta: String((r && r.cinta) || '').trim().slice(0, 30),
        trava: String((r && r.trava) || '').trim().slice(0, 30)
      })).filter(r => r.tzpr04 || r.fonte04 || r.cinta || r.trava);
  const termo = await store.termos.insert({
    user: req.auth.user, tipo: 'listagem',
    dataEnvio: dataEnvio ? new Date(dataEnvio).toISOString().slice(0,10) : null,
    destinatario: String(destinatario).trim().slice(0,120),
    equipamentos: norm,
    respEntrega: String(respEntrega||'').trim().slice(0,80),
    respRecebimento: String(respRecebimento||'').trim().slice(0,80),
    dados: { modelo: modeloList }
  });
  broadcast();
  res.status(201).json(termo);
}));
// Extração de texto on-prem: pdf-parse primeiro, pdfjs-dist como fallback
// (mesmo padrão de /api/ativacoes/auto-preencher).
async function extractTextAutoRenomear(buffer){
  try{
    const pdfParse = require('pdf-parse');
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    const data = await pdfParse(buf);
    if(data.text && data.text.trim().length > 20) return data.text;
  }catch(e){ /* tenta pdfjs */ }
  let pdfjs;
  try{ pdfjs = require('pdfjs-dist/legacy/build/pdf.js'); }catch{
    const m = await import('pdfjs-dist/legacy/build/pdf.mjs');
    pdfjs = m.default || m;
  }
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buf), disableWorker: true, disableFontFace: true, isEvalSupported: false, useWorkerFetch: false });
  const pdf = await loadingTask.promise;
  let fullText = '';
  const maxPages = Math.min(pdf.numPages, 5);
  for(let i = 1; i <= maxPages; i++){
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    fullText += '\n' + content.items.map(it => it.str || '').join(' ');
  }
  return fullText;
}

// AutoRenomear: recebe arquivos (PDF com texto ou imagem) e sugere
// "<Tipo> - <Nome da pessoa> - <Data do documento>" a partir do conteúdo.
// Usa Visão Computacional Multimodal (OCR/ICR/Layout Analysis) local.
router.post('/api/termos/autorenomear', auth(['tecnico', 'psico', 'admin']), shared.upload.array('arquivos', 20), ah(async (req,res)=>{
  if(!req.files || !req.files.length) return res.status(400).json({ error: 'Selecione ao menos 1 arquivo (PDF, JPG ou PNG)' });
  const { sugerirNome } = require('../lib/autoRenomear');
  const out = [];
  for(const f of req.files){
    const original = f.originalname || 'arquivo';
    const isPdf = /\.pdf$/i.test(original) || f.mimetype === 'application/pdf';
    const isImg = /\.(jpe?g|png)$/i.test(original) || /^image\/(jpeg|png)$/.test(f.mimetype || '');
    if(!isPdf && !isImg){ out.push({ arquivo: original, erro: 'Tipo não suportado (use PDF, JPG ou PNG)' }); continue; }
    
    let visionResult = null;
    let texto = '';
    
    try {
      // Usar Visão Computacional Multimodal para extrair texto e campos estruturados
      const visionResult = await visaoService.analyzeDocument(f.buffer, original);
      
      if (visionResult && visionResult.full_text) {
        texto = visionResult.full_text;
        
        // Usar campos extraídos pela visão computacional para melhorar a sugestão
        const fields = visionResult.fields_dict || {};
        const visionFields = {
          nome: fields['MONITORADO'] || fields['MONITORADO(A)'] || fields['NOME DO MONITORADO'] || fields['NOME COMPLETO'] || fields['NOME'] || fields['INTERRESSADO'] || fields['INTERRESSADO(A)'] || fields['NOME DO MONITORADO'],
          data: fields['DATA'] || fields['DATA/HORA'] || fields['DATA/HORA:'] || fields['DATA:'],
          dispositivo: fields['NÚMERO'] || fields['Nº'] || fields['Nº:'] || fields['DISPOSITIVO']
        };
        
        // Gerar sugestão usando o motor existente + campos da visão
        const r = sugerirNome(texto.slice(0, 8000), original);
        
        // Melhorar com campos da visão se disponíveis
        let sugestaoFinal = r.sugestao;
        let nomeFinal = r.nome;
        let dataFinal = r.data;
        let dataISOFinal = r.dataISO;
        let confiancaFinal = r.confianca;
        let avisosFinal = [...r.avisos];
        
        // Se a visão encontrou nome com alta confiança, usar
        if (visionResult.fields_dict && visionResult.fields_dict['MONITORADO(A)']) {
          nomeFinal = visionResult.fields_dict['MONITORADO(A)'];
        } else if (visionResult.fields_dict && visionResult.fields_dict['MONITORADO']) {
          nomeFinal = visionResult.fields_dict['MONITORADO'];
        } else if (visionResult.fields_dict && visionResult.fields_dict['NOME DO MONITORADO']) {
          nomeFinal = visionResult.fields_dict['NOME DO MONITORADO'];
        } else if (visionResult.fields_dict && visionResult.fields_dict['NOME COMPLETO']) {
          nomeFinal = visionResult.fields_dict['NOME COMPLETO'];
        } else if (visionResult.fields_dict && visionResult.fields_dict['NOME']) {
          nomeFinal = visionResult.fields_dict['NOME'];
        } else if (visionResult.fields_dict && visionResult.fields_dict['INTERRESSADO(A)']) {
          nomeFinal = visionResult.fields_dict['INTERRESSADO(A)'];
        } else if (visionResult.fields_dict && visionResult.fields_dict['INTERRESSADO']) {
          nomeFinal = visionResult.fields_dict['INTERRESSADO'];
        } else if (visionResult.fields_dict && visionResult.fields_dict['NOME DO MONITORADO']) {
          nomeFinal = visionResult.fields_dict['NOME DO MONITORADO'];
        }
        
        // Se a visão encontrou data com alta confiança, usar
        if (visionResult.fields_dict && visionResult.fields_dict['DATA/HORA']) {
          dataISOFinal = visionResult.fields_dict['DATA/HORA'];
        } else if (visionResult.fields_dict && visionResult.fields_dict['DATA/HORA:']) {
          dataISOFinal = visionResult.fields_dict['DATA/HORA:'];
        } else if (visionResult.fields_dict && visionResult.fields_dict['DATA']) {
          dataISOFinal = visionResult.fields_dict['DATA'];
        } else if (visionResult.fields_dict && visionResult.fields_dict['DATA:']) {
          dataISOFinal = visionResult.fields_dict['DATA:'];
        }
        
        // Recalcular sugestão com dados da visão
        if (nomeFinal || dataISOFinal) {
          const tipo = visionResult.document_type || 'documento';
          const tipoLabel = {
            'termo_recolhimento': 'Termo de recolhimento',
            'termo_recolhimento_equipamento': 'Termo de recolhimento equipamento',
            'termo_ativacao': 'Termo de ativação',
            'termo_endereco': 'Ofício',
            'declaracao': 'Declaração',
            'relatorio': 'Relatório',
            'ata': 'Ata',
            'default': 'Documento'
          }[visionResult.document_type] || 'Documento';
          
          const { sanitizar, isoParaNome, extensaoDe } = require('../lib/autoRenomear');
          const nomeParte = nomeFinal ? sanitizar(nomeFinal, 60) : 'SEM NOME';
          const dataParte = dataISOFinal ? isoParaNome(dataISOFinal) : 'SEM DATA';
          sugestaoFinal = sanitizar(tipoLabel + ' - ' + nomeParte + ' - ' + dataParte, 120) + extensaoDe(original);
          
          // Confiança alta se visão encontrou ambos
          if (nomeFinal && dataISOFinal) confiancaFinal = 'alta';
          else if (nomeFinal || dataISOFinal) confiancaFinal = 'média';
          
          // Limpar avisos se visão encontrou os dados
          if (nomeFinal) avisosFinal = avisosFinal.filter(a => !/Nome não encontrado/i.test(a));
          if (dataISOFinal) avisosFinal = avisosFinal.filter(a => !/Data não encontrada/i.test(a));
          
          // Adicionar info de que visão foi usada
          avisosFinal.unshift('Extraído com Visão Computacional Multimodal (OCR/ICR/Layout Analysis)');
        }
        
        out.push({ 
          arquivo: original, 
          tamanho: f.size, 
          sugestao: sugestaoFinal, 
          tipo: visionResult.document_type || 'documento',
          tipoId: visionResult.document_type || 'documento',
          nome: nomeFinal,
          data: dataISOFinal ? dataISOFinal.split('-').reverse().join('-') : r.data,
          dataISO: dataISOFinal || r.dataISO,
          confianca: confiancaFinal,
          avisos: avisosFinal,
          visao: true,
          trecho: (visionResult.full_text || '').replace(/\s+/g, ' ').trim().slice(0, 1500)
        });
        continue;
      }
    } catch (visionError) {
      console.warn('[AutoRenomear] Visão computacional falhou, fallback para método tradicional:', visionError.message);
      // Fallback para método tradicional
    }
    
    // Fallback: método tradicional (pdf-parse + pdfjs)
    if (isPdf) {
      try {
        texto = await extractTextAutoRenomear(f.buffer);
      } catch (e) {
        out.push({ arquivo: original, erro: 'Não foi possível ler o PDF: ' + (e.message || 'arquivo inválido') });
        continue;
      }
      
      if (texto.replace(/\s/g, '').length < 20) {
        out.push({ arquivo: original, sugestao: '', tipo: '', nome: '', data: '', dataISO: '', confianca: 'manual',
          avisos: ['PDF escaneado (sem texto selecionável) — toque em 📷 Tentar OCR local abaixo ou preencha o nome manualmente'], trecho: '' });
        continue;
      }
      
      const r = sugerirNome(texto.slice(0, 8000), original);
      out.push({ arquivo: original, tamanho: f.size, ...r, trecho: texto.replace(/\s+/g, ' ').trim().slice(0, 1500) });
      continue;
    }
    
    // Imagem sem OCR local - precisa de visão computacional
    out.push({ arquivo: original, sugestao: '', tipo: '', nome: '', data: '', dataISO: '', confianca: 'manual',
      avisos: ['Imagem sem texto extraível — use Visão Computacional (requer serviço Python OCR)'], trecho: '' });
  }
  res.json({ total: out.length, itens: out });
}));

// AutoRenomear via texto: usado após OCR local no navegador (PDF escaneado/foto).
router.post('/api/termos/autorenomear-texto', auth(['tecnico', 'psico', 'admin']), ah(async (req,res)=>{
  const { texto, arquivo } = req.body || {};
  const t = String(texto || '').trim();
  if(t.length < 10) return res.status(400).json({ error: 'Texto muito curto para analisar (mín. 10 caracteres)' });
  const { sugerirNome } = require('../lib/autoRenomear');
  const r = sugerirNome(t.slice(0, 8000), arquivo || 'documento.pdf');
  res.json({ arquivo: arquivo || 'texto', ...r, trecho: t.replace(/\s+/g, ' ').trim().slice(0, 1500) });
}));

router.get('/api/termos/:id', auth(['tecnico', 'psico']), ah(async (req,res)=>{
  const t = await store.termos.byId(req.params.id);
  if(!t) return res.status(404).json({ error: 'Termo não encontrado' });
  if(t.user !== req.auth.user) return res.status(403).json({ error: 'Sem permissão' });
  res.json(t);
}));
router.patch('/api/termos/:id', auth(['tecnico', 'psico']), ah(async (req,res)=>{
  const t = await store.termos.byId(req.params.id);
  if(!t) return res.status(404).json({ error: 'Termo não encontrado' });
  if(t.user !== req.auth.user) return res.status(403).json({ error: 'Sem permissão' });
  const { dataEnvio, destinatario, equipamentos, respEntrega, respRecebimento, dados, modelo } = req.body||{};
  const patch={};
  if(dataEnvio !== undefined) patch.dataEnvio = dataEnvio ? new Date(dataEnvio).toISOString().slice(0,10) : null;
  if(t.tipo === 'recEquip' && dados && typeof dados === 'object'){
    const nd = normRecEquip(Object.assign({}, t.dados||{}, dados));
    if(!nd.equipamentos || !nd.equipamentos.length) return res.status(400).json({ error: 'Adicione ao menos um equipamento com número' });
    patch.dados = nd;
    if(nd.dataHora) patch.dataEnvio = nd.dataHora.slice(0,10);
    if(nd.estabelecimento != null) patch.destinatario = nd.estabelecimento;
  }
  if(t.tipo === 'recolhimento' && dados && typeof dados === 'object'){
    // Mescla parcial: campos ausentes no PATCH preservam o valor salvo, depois
    // tudo passa pelo MESMO normalizador do POST (checks, cortes, dataHora).
    const base = Object.assign({}, t.dados||{});
    const d = dados;
    if(d.itensRecebidos!=null) base.itensRecebidos = d.itensRecebidos;
    if(d.dataHora!=null) base.dataHora = d.dataHora;
    if(Array.isArray(d.equipamentos)) base.equipamentos = d.equipamentos;
    if(d.descricao!=null) base.descricao = d.descricao;
    if(d.policialNome!=null) base.policialNome = d.policialNome;
    if(d.policialMat!=null) base.policialMat = d.policialMat;
    if(d.tecnicoNome!=null) base.tecnicoNome = d.tecnicoNome;
    if(d.tecnicoMat!=null) base.tecnicoMat = d.tecnicoMat;
    const nd = normRecolhimentoDados(base);
    patch.dados = nd;
    // dataEnvio espelha dados.dataHora (mesma regra do POST e do recEquip):
    // editar o horário do documento atualiza a data exibida na listagem.
    if(nd.dataHora) patch.dataEnvio = nd.dataHora.slice(0,10);
  }
  if(t.tipo === 'ativacao' && dados && typeof dados === 'object'){
    const nd = normAtivacao(Object.assign({}, t.dados||{}, dados));
    if(!nd.nomeMonitorado) return res.status(400).json({ error: 'Informe o Nome do monitorado' });
    if(!nd.nomeMae) return res.status(400).json({ error: 'Informe o Nome da mãe' });
    if(!nd.processo) return res.status(400).json({ error: 'Informe o Processo' });
    if(!nd.vara) return res.status(400).json({ error: 'Informe a Vara' });
    patch.dados = nd;
    patch.destinatario = nd.vara || t.destinatario;
  }
  if(destinatario!=null) patch.destinatario = String(destinatario).trim().slice(0,120);
  if(t.tipo === 'endereco' && dados && typeof dados === 'object'){
    const nd = Object.assign({}, t.dados||{});
    const g = (k, n) => String(dados[k] == null ? '' : dados[k]).trim().slice(0, n);
    ['numero','ano','cidade','vara','processo','nome','cpf','mae','endereco','contato','motivo'].forEach(k=>{
      const n = { numero:20, ano:4, cidade:60, vara:120, processo:60, nome:120, cpf:20, mae:120, endereco:500, contato:30, motivo:1000 }[k];
      if(dados[k] != null) nd[k] = g(k, n);
    });
    if(dados.dataOficio) nd.dataOficio = new Date(dados.dataOficio).toISOString().slice(0,10);
    if(dados.dataSolicitacao !== undefined) nd.dataSolicitacao = dados.dataSolicitacao ? new Date(dados.dataSolicitacao).toISOString().slice(0,10) : '';
    if(dados.dataOficio) patch.dataEnvio = nd.dataOficio;
    if(dados.vara != null) patch.destinatario = nd.vara;
    patch.dados = nd;
  }
  if(t.tipo !== 'recolhimento' && t.tipo !== 'endereco' && !PSI_DOCS.includes(t.tipo) && (modelo === 'upr' || modelo === 'tzpr')){
    patch.dados = Object.assign({}, t.dados||{}, { modelo });
  }
  if(PSI_DOCS.includes(t.tipo) && dados && typeof dados === 'object'){
    if(req.auth.role !== 'psico') return res.status(403).json({ error: 'Documentos psicossociais: só o psicólogo' });
    const nd = normPsiDoc(Object.assign({}, t.dados||{}, dados));
    if(!nd.nome) return res.status(400).json({ error: 'Informe o nome da pessoa' });
    patch.dados = nd;
    if(dados.dataDoc) patch.dataEnvio = nd.dataDoc || t.dataEnvio;
    if(dados.vara != null || dados.destino != null) patch.destinatario = nd.vara || nd.destino || '';
  }
  if(equipamentos!=null && t.tipo !== 'recolhimento' && t.tipo !== 'endereco' && !PSI_DOCS.includes(t.tipo)){
    const modeloEff = (modelo === 'upr' || modelo === 'tzpr') ? modelo : ((t.dados && t.dados.modelo === 'upr') ? 'upr' : 'tzpr');
    const eqIn = Array.isArray(equipamentos) ? equipamentos.slice(0, 30) : [];
    patch.equipamentos = modeloEff === 'upr'
      ? eqIn.map(r => ({
          upr04: String((r && (r.upr04 ?? r.tzpr04)) || '').trim().slice(0, 30),
          fonte04: String((r && r.fonte04) || '').trim().slice(0, 30)
        })).filter(r => r.upr04 || r.fonte04)
      : eqIn.map(r => ({
          tzpr04: String((r && r.tzpr04) || '').trim().slice(0, 30),
          fonte04: String((r && r.fonte04) || '').trim().slice(0, 30),
          cinta: String((r && r.cinta) || '').trim().slice(0, 30),
          trava: String((r && r.trava) || '').trim().slice(0, 30)
        })).filter(r => r.tzpr04 || r.fonte04 || r.cinta || r.trava);
  } else if(equipamentos!=null){
    const eqIn = Array.isArray(equipamentos) ? equipamentos.slice(0, 30) : [];
    patch.equipamentos = eqIn.map(r => ({
      tzpr04: String((r && r.tzpr04) || '').trim().slice(0, 30),
      fonte04: String((r && r.fonte04) || '').trim().slice(0, 30),
      cinta: String((r && r.cinta) || '').trim().slice(0, 30),
      trava: String((r && r.trava) || '').trim().slice(0, 30)
    })).filter(r => r.tzpr04 || r.fonte04 || r.cinta || r.trava);
  }
  if(respEntrega!=null) patch.respEntrega = String(respEntrega).trim().slice(0,80);
  if(respRecebimento!=null) patch.respRecebimento = String(respRecebimento).trim().slice(0,80);
  const upd = await store.termos.patch(t.id, patch);
  broadcast();
  res.json(upd);
}));
router.delete('/api/termos/:id', auth(['tecnico', 'psico']), ah(async (req,res)=>{
  const t = await store.termos.byId(req.params.id);
  if(!t) return res.status(404).json({ error: 'Termo não encontrado' });
  if(t.user !== req.auth.user) return res.status(403).json({ error: 'Sem permissão' });
  await store.termos.remove(t.id);
  broadcast();
  res.json({ ok: true });
}));
async function termoPDFFromRecord(t) {
  if (!t) throw Object.assign(new Error('Termo não encontrado'), { status: 404 });
  if (t.tipo === 'ativacao') return gerarAtivacaoPDF(t);
  if (t.tipo === 'recolhimento') return gerarTermoRecolhimentoPDF(t);
  if (t.tipo === 'recEquip') return gerarTermoRecolhimentoEquipamentoPDF(t);
  if (t.tipo === 'endereco') return gerarTermoEnderecoPDF(t);
  if (t.tipo === 'declaracao') return gerarDeclaracaoPDF(t);
  if (t.tipo === 'relfreq') return gerarRelFrequenciaPDF(t);
  if (t.tipo === 'reltec') return gerarRelTecnicoPDF(t);
  if (t.tipo === 'oficioenc') return gerarOficioEncaminhamentoPDF(t);
  return gerarTermoPDF(t);
}
router.get('/api/termos/:id/pdf', auth(['tecnico', 'psico']), ah(async (req,res)=>{
  const t = await store.termos.byId(req.params.id);
  if(!t) return res.status(404).json({ error: 'Termo não encontrado' });
  if(t.user !== req.auth.user) return res.status(403).json({ error: 'Sem permissão' });
  const pdf = await termoPDFFromRecord(t);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="termo-${t.id}.pdf"`);
  res.send(Buffer.from(pdf));
}));
router.post('/api/termos/pdf-preview', auth(['tecnico', 'psico']), ah(async (req,res)=>{
  const { tipo, dataEnvio, destinatario, equipamentos, respEntrega, respRecebimento, dados, modelo } = req.body||{};
  // Tipos com normalização dedicada montam o MESMO registro do POST e delegam
  // ao termoPDFFromRecord — preview e PDF final passam pelo mesmo caminho, e
  // qualquer mudança de layout aparece no preview automaticamente.
  const enviarPdf = async (registro) => {
    const pdf = await termoPDFFromRecord(registro);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="termo-preview.pdf"');
    return res.send(Buffer.from(pdf));
  };
  if(tipo === 'recEquip'){
    return enviarPdf({ tipo: 'recEquip', dados: normRecEquip(dados) });
  }
  if(tipo === 'recolhimento'){
    return enviarPdf({ tipo: 'recolhimento', dados: normRecolhimentoDados(dados) });
  }
  if(tipo === 'endereco'){
    const d = (dados && typeof dados === 'object') ? dados : {};
    const g = (k) => String(d[k] == null ? '' : d[k]).trim();
    const termo = {
      tipo: 'endereco',
      dados: {
        numero: g('numero'), ano: g('ano') || String(new Date().getFullYear()),
        cidade: g('cidade') || 'Fortaleza',
        dataOficio: d.dataOficio ? new Date(d.dataOficio).toISOString().slice(0,10) : new Date().toISOString().slice(0,10),
        vara: g('vara'), processo: g('processo'), nome: g('nome'), cpf: g('cpf'), mae: g('mae'),
        dataSolicitacao: d.dataSolicitacao ? new Date(d.dataSolicitacao).toISOString().slice(0,10) : '',
        endereco: g('endereco'), contato: g('contato'), motivo: g('motivo')
      }
    };
    return enviarPdf(termo);
  }
  if(tipo === 'ativacao'){
    return enviarPdf({ tipo: 'ativacao', dados: normAtivacao(dados) });
  }
  if(PSI_DOCS.includes(tipo)){
    if(req.auth.role !== 'psico') return res.status(403).json({ error: 'Documentos psicossociais: só o psicólogo' });
    const nd = normPsiDoc(dados);
    if(!nd.psicologo) nd.psicologo = (req.auth && req.auth.name) || '';
    return enviarPdf({ tipo, dados: nd });
  }
  const termo = {
    dataEnvio: dataEnvio ? new Date(dataEnvio).toISOString().slice(0,10) : '',
    destinatario: String(destinatario||'').trim() || '_________________________',
    equipamentos: Array.isArray(equipamentos) ? equipamentos.slice(0,30).map(r=>({ tzpr04: String((r&&r.tzpr04)||''), upr04: String((r&&(r.upr04 ?? r.tzpr04))||''), fonte04: String((r&&r.fonte04)||''), cinta: String((r&&r.cinta)||''), trava: String((r&&r.trava)||'') })) : [],
    respEntrega: String(respEntrega||'').trim(),
    respRecebimento: String(respRecebimento||'').trim(),
    dados: { modelo: (modelo === 'upr') ? 'upr' : 'tzpr' }
  };
  while(termo.equipamentos.length<5) termo.equipamentos.push({ tzpr04:'', fonte04:'', cinta:'', trava:'' });
  const pdf = await gerarTermoPDF(termo);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline; filename="termo-preview.pdf"');
  res.send(Buffer.from(pdf));
}));

// Visão Computacional Multimodal: endpoint direto para análise de documentos
// usando OCR/ICR/Layout Analysis local (Python + PaddleOCR/EasyOCR/Tesseract + OpenCV)
router.post('/api/termos/visao-analisar', auth(['tecnico', 'psico', 'admin']), shared.upload.array('arquivos', 10), ah(async (req,res)=>{
  if(!req.files || !req.files.length) return res.status(400).json({ error: 'Selecione ao menos 1 arquivo (PDF, JPG ou PNG)' });
  const out = [];
  for(const f of req.files){
    const original = f.originalname || 'arquivo';
    const isPdf = /\.pdf$/i.test(original) || f.mimetype === 'application/pdf';
    const isImg = /\.(jpe?g|png)$/i.test(original) || /^image\/(jpeg|png)$/.test(f.mimetype || '');
    if(!isPdf && !isImg){ out.push({ arquivo: original, erro: 'Tipo não suportado (use PDF, JPG ou PNG)' }); continue; }
    
    try {
      let visionResult = null;
      
      if (isPdf) {
        // Para PDF, converter páginas para imagens e processar
        const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
        const loadingTask = pdfjs.getDocument({ 
          data: new Uint8Array(f.buffer),
          disableWorker: true,
          disableFontFace: true,
          isEvalSupported: false,
          useWorkerFetch: false
        });
        const pdf = await loadingTask.promise;
        const maxPages = Math.min(pdf.numPages, 5);
        
        const pageResults = [];
        for(let i = 1; i <= maxPages; i++) {
          const page = await pdf.getPage(i);
          const viewport = page.getViewport({ scale: 2.0 });
          
          // Criar canvas para renderizar
          const { createCanvas } = require('canvas');
          const canvas = createCanvas(viewport.width, viewport.height);
          const context = canvas.getContext('2d');
          
          await page.render({ 
            canvasContext: context, 
            viewport 
          }).promise;
          
          const imageBuffer = canvas.toBuffer('image/png');
          const result = await visaoService.analyzeDocument(imageBuffer, `${original}_page${i}.png`);
          pageResults.push(result);
        }
        
        // Combinar resultados
        if (pageResults.length > 0) {
          visionResult = pageResults[0];
          if (pageResults.length > 1) {
            // Combinar campos de todas as páginas
            for (const page of pageResults.slice(1)) {
              for (const [key, value] of Object.entries(page.fields_dict || {})) {
                if (value && !visionResult.fields_dict[key]) {
                  visionResult.fields_dict[key] = value;
                }
              }
              visionResult.full_text += '\n\n--- PAGE BREAK ---\n\n' + page.full_text;
            }
          }
        }
      } else {
        // Imagem direta
        visionResult = await visaoService.analyzeDocument(f.buffer, original);
      }
      
      if (visionResult) {
        out.push({ 
          arquivo: original, 
          tamanho: f.size,
          document_type: visionResult.document_type,
          full_text: visionResult.full_text,
          confidence: visionResult.confidence,
          fields: visionResult.fields,
          fields_dict: visionResult.fields_dict,
          raw_ocr_count: visionResult.raw_ocr_results?.length || 0,
          trecho: visionResult.full_text?.replace(/\s+/g, ' ').trim().slice(0, 1500) || ''
        });
      } else {
        out.push({ arquivo: original, erro: 'Falha na análise de visão' });
      }
    } catch (e) {
      out.push({ arquivo: original, erro: 'Erro na visão computacional: ' + e.message });
    }
  }
  res.json({ total: out.length, itens: out });
}));

module.exports = router;
