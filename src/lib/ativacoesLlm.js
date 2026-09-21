require('dotenv').config();

// Prompt jurídico para extração semântica dos 46 campos
const SYSTEM_PROMPT = `Você é um assistente jurídico especializado em extração de dados de documentos de monitoração eletrônica (tornozeleira) do Ceará.
Extraia os 46 campos abaixo do texto fornecido. Resolva ambiguidades: "custodiado", "indiciado", "flagranteado", "réu", "apenado", "monitorado" referem-se à mesma pessoa (nomeMonitorado). "genitora", "filiação materna", "mãe" → nomeMae. "genitor", "filiação paterna", "pai" → nomePai.
Retorne APENAS JSON válido (sem markdown) com as chaves exatas abaixo, valores string ou "" se não encontrado. Datas em ISO yyyy-mm-dd. CPF com máscara 000.000.000-00. Processo CNJ 0000000-00.0000.0.00.0000. Title Case (primeira letra maiúscula por palavra) para nomes/endereços.
Campos: nomeMonitorado, vulgo, nomeMae, nomePai, sexo, dataNascimento, rg, orgaoExpedidor, cpf, processo, processos, perfil, artigos, lei, militar, codigoPenal, periculosidade, vara, isencao, origem, tipoCumprimento, dataPrisao, inicioPrevisto, terminoPrevisto, dias, periodoReanalisar, tamanhoCinta, orcrim, deficiencia, tipoDeficiencia, descricaoDeficiencia, etnia, grauEscolaridade, naturalidade, nacionalidade, religiao, estadoCivil, nomeConjuge, contatosPrioritarios, endereco, residenciaComplemento, residenciaPontoReferencia, bairro, cep, estado, cidade.

Perfil opções: Fiscalização, Medida Protetiva, Prisão Domiciliar, Prisão Domiciliar Com Estudo Externo, Prisão Domiciliar Hc 143.641, Saída Temporária, Recolhimento Integral Aos Finais De Semana E Feriados, Recolhimento Noturno E Integral Aos Finais De Semana E Feriados, Recolhimento Noturno Ou Diurno, Prisão Domiciliar Com Trabalho Externo.
Periculosidade: Baixa, Média, Alta, Altíssima, Alta Repercussão.
Isenção: Isento (Assistido da Defensoria Pública), Isento (Beneficiário de Programa Social), Isento (Hipossuficiência), Não Isento (Contribuinte Mensal), Decisão Judicial.
TamanhoCinta: PP,P,M,G,GG,XG,36,38,40,42,44,46.
Exemplo saída: {"nomeMonitorado":"Joao Da Silva","cpf":"123.456.789-00",...}
Se campo não estiver literalmente nomeado, infira pelo contexto (ex.: "art. 33 da Lei 11.343" → artigos:"Art. 33", lei:"Lei 11.343").`;

function getLlmConfig(){
  // Suporta OpenAI-compatível, Anthropic, Google Gemini via env
  if(process.env.OPENAI_API_KEY){
    return {
      provider: 'openai',
      apiKey: process.env.OPENAI_API_KEY,
      baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      model: process.env.OPENAI_MODEL || process.env.LLM_MODEL || 'gpt-4o-mini'
    };
  }
  if(process.env.ANTHROPIC_API_KEY){
    return {
      provider: 'anthropic',
      apiKey: process.env.ANTHROPIC_API_KEY,
      baseUrl: 'https://api.anthropic.com',
      model: process.env.ANTHROPIC_MODEL || process.env.LLM_MODEL || 'claude-3-haiku-20240307'
    };
  }
  if(process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY){
    return {
      provider: 'google',
      apiKey: process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY,
      baseUrl: 'https://generativelanguage.googleapis.com',
      model: process.env.GEMINI_MODEL || process.env.LLM_MODEL || 'gemini-1.5-flash'
    };
  }
  if(process.env.LLM_API_KEY){
    return {
      provider: 'openai',
      apiKey: process.env.LLM_API_KEY,
      baseUrl: process.env.LLM_API_URL || 'https://api.openai.com/v1',
      model: process.env.LLM_MODEL || 'gpt-4o-mini'
    };
  }
  return null;
}

async function callOpenAI(text, cfg){
  const url = `${cfg.baseUrl.replace(/\/$/,'')}/chat/completions`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type':'application/json', 'Authorization': `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role:'system', content: SYSTEM_PROMPT },
        { role:'user', content: `Texto do documento:\n${text.slice(0,12000)}` }
      ]
    })
  });
  const j = await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(j.error?.message || `LLM ${r.status}`);
  const content = j.choices?.[0]?.message?.content;
  if(!content) throw new Error('LLM sem conteúdo');
  return JSON.parse(content);
}

async function callAnthropic(text, cfg){
  const url = `${cfg.baseUrl}/v1/messages`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type':'application/json', 'x-api-key': cfg.apiKey, 'anthropic-version':'2023-06-01' },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: 4000,
      temperature: 0,
      system: SYSTEM_PROMPT,
      messages: [{ role:'user', content: `Texto do documento:\n${text.slice(0,12000)}` }]
    })
  });
  const j = await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(j.error?.message || `Anthropic ${r.status}`);
  const textOut = j.content?.[0]?.text;
  if(!textOut) throw new Error('Anthropic sem conteúdo');
  // extrai JSON do texto
  const m = textOut.match(/\{[\s\S]*\}/);
  if(!m) throw new Error('Anthropic não retornou JSON');
  return JSON.parse(m[0]);
}

async function callGoogle(text, cfg){
  const url = `${cfg.baseUrl}/v1beta/models/${cfg.model}:generateContent?key=${cfg.apiKey}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: SYSTEM_PROMPT + `\n\nTexto do documento:\n${text.slice(0,12000)}` }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json' }
    })
  });
  const j = await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(j.error?.message || `Google ${r.status}`);
  const out = j.candidates?.[0]?.content?.parts?.[0]?.text;
  if(!out) throw new Error('Google sem conteúdo');
  return JSON.parse(out);
}

async function llmParse(text){
  const cfg = getLlmConfig();
  if(!cfg) return { data: null, skipped: true, reason: 'LLM não configurado (defina OPENAI_API_KEY, ANTHROPIC_API_KEY ou GOOGLE_API_KEY)' };
  const trimmed = String(text||'').slice(0,12000);
  if(trimmed.length < 20) throw new Error('Texto muito curto para LLM');
  let data;
  if(cfg.provider === 'openai') data = await callOpenAI(trimmed, cfg);
  else if(cfg.provider === 'anthropic') data = await callAnthropic(trimmed, cfg);
  else if(cfg.provider === 'google') data = await callGoogle(trimmed, cfg);
  else throw new Error('Provider desconhecido');
  // normaliza chaves
  const norm = {};
  const keys = ["nomeMonitorado","vulgo","nomeMae","nomePai","sexo","dataNascimento","rg","orgaoExpedidor","cpf","processo","processos","perfil","artigos","lei","militar","codigoPenal","periculosidade","vara","isencao","origem","tipoCumprimento","dataPrisao","inicioPrevisto","terminoPrevisto","dias","periodoReanalisar","tamanhoCinta","orcrim","deficiencia","tipoDeficiencia","descricaoDeficiencia","etnia","grauEscolaridade","naturalidade","nacionalidade","religiao","estadoCivil","nomeConjuge","contatosPrioritarios","endereco","residenciaComplemento","residenciaPontoReferencia","bairro","cep","estado","cidade"];
  for(const k of keys) norm[k] = data[k] != null ? String(data[k]).trim().slice(0, k==='endereco'?500:300) : '';
  return { data: norm, skipped:false, provider: cfg.provider, model: cfg.model };
}

module.exports = { llmParse, getLlmConfig, SYSTEM_PROMPT };
