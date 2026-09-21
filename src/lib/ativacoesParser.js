// Parser para Ativações - Auto Preencher
// Extrai campos do texto de documentação PDF enviada
// Normaliza para Title Case (primeira letra maiúscula de cada palavra)

function toTitleCase(str){
  if(!str) return '';
  return String(str).trim().toLowerCase().replace(/(^|\s|-|\(|\/)([a-zà-ú])/g, (m, pre, ch) => pre + ch.toUpperCase());
}

function titleCaseField(s){
  if(!s) return '';
  // Preserva siglas? Não, converte tudo para Title Case exceto se for CPF/RG etc
  // Remove espaços duplos e aplica title case
  const t = String(s).trim().replace(/\s+/g, ' ');
  if(!t) return '';
  // Se for tudo maiúsculo com mais de 4 letras, aplica title case
  return toTitleCase(t);
}

function clean(v){ return String(v||'').trim().replace(/\s+/g,' ').slice(0, 600); }

// CPF: 000.000.000-00 ou 11 dígitos
function extractCPF(text){
  const m = text.match(/CPF[:\s]*([0-9]{3}\.?[0-9]{3}\.?[0-9]{3}[- ]?[0-9]{2})/i);
  if(m) return m[1].replace(/\D/g,'').replace(/(\d{3})(\d{3})(\d{3})(\d{2})/,'$1.$2.$3-$4');
  const m2 = text.match(/\b([0-9]{3}\.[0-9]{3}\.[0-9]{3}-[0-9]{2})\b/);
  if(m2) return m2[1];
  const m3 = text.match(/\b([0-9]{11})\b/);
  if(m3){
    // evita confundir com processo
    const v = m3[1];
    if(!v.match(/^0+$/) && !v.match(/^1+$/)) return v.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/,'$1.$2.$3-$4');
  }
  return '';
}

function extractRG(text){
  const m = text.match(/R\.?G\.?[:\s]*([0-9\.\-xX\/]+)/i);
  if(m){
    const v = m[1].trim().split(/\s/)[0];
    if(v.length >= 4) return v;
  }
  // RG com órgão
  const m2 = text.match(/RG[:\s]*([0-9\.\-]+)\s*(?:SSP|SDS|PC|Detran)?/i);
  if(m2) return m2[1];
  return '';
}

function extractOrgao(text){
  const m = text.match(/(?:Órgão\s*Expedidor|Org[aã]o\s*expedidor|O\.?\s*Expedidor)[:\s]*([A-Za-z\/\-\s]+)/i);
  if(m) return clean(m[1].split('\n')[0].split(/CPF|Processo|Sexo|Data/i)[0]).slice(0,20);
  // SSP/CE, SDS etc
  const m2 = text.match(/\b(SSP[\/\-]?CE|SSP[\/\-]?PE|SDS|PCCE|PC\/CE)\b/i);
  if(m2) return m2[1].toUpperCase();
  return '';
}

function extractProcesso(text){
  // Padrão CNJ: 0000000-00.0000.0.00.0000 ou variações
  const m = text.match(/Processo(?:\s*N[ºo°\.]*)?[:\s]*([0-9]{7}[- ]?[0-9]{2}\.?[0-9]{4}\.?[0-9]\.?[0-9]{2}\.?[0-9]{4})/i);
  if(m) return m[1].trim();
  const m2 = text.match(/\b([0-9]{7}-[0-9]{2}\.[0-9]{4}\.[0-9]\.[0-9]{2}\.[0-9]{4})\b/);
  if(m2) return m2[1];
  const m3 = text.match(/Processo[:\s]*([0-9\.\-\/]+)/i);
  if(m3){
    const v = m3[1].trim().split(/\s/)[0];
    if(v.length >= 7) return v;
  }
  return '';
}

function extractProcessos(text){
  // tenta pegar todos os processos
  const all = [...text.matchAll(/\b[0-9]{7}-[0-9]{2}\.[0-9]{4}\.[0-9]\.[0-9]{2}\.[0-9]{4}\b/g)].map(m=>m[0]);
  if(all.length) return all.join(', ');
  return extractProcesso(text);
}

function extractNome(text){
  // Tenta vários rótulos
  const labels = [
    /Nome\s*do\s*monitorado[:\s]*([A-Za-zÀ-ú\s]+)/i,
    /Nome\s*completo[:\s]*([A-Za-zÀ-ú\s]+)/i,
    /Réu[:\s]*([A-Za-zÀ-ú\s]+)/i,
    /Acusado[:\s]*([A-Za-zÀ-ú\s]+)/i,
    /Apenado[:\s]*([A-Za-zÀ-ú\s]+)/i,
    /Autor[:\s]*([A-Za-zÀ-ú\s]+)/i
  ];
  for(const re of labels){
    const m = text.match(re);
    if(m){
      let v = m[1].split('\n')[0].split(/Vulgo|Mãe|Pai|Sexo|Data|CPF|RG|Processo/i)[0].trim();
      // remove coisas como "Sexo:" que possam ter sido capturadas
      if(v.length >= 4 && v.length < 80 && /^[A-Za-zÀ-ú\s]+$/.test(v)){
        return titleCaseField(v);
      }
    }
  }
  return '';
}

function extractVulgo(text){
  const m = text.match(/Vulgo[:\s]*([A-Za-zÀ-ú0-9\s,"'\-]+)/i);
  if(m){
    let v = m[1].split('\n')[0].split(/Nome|Mãe|Pai|Sexo|Data/i)[0].trim().replace(/^["']|["']$/g,'');
    if(v && !/^(não|nao|sem|nenhum)$/i.test(v)) return titleCaseField(v);
  }
  return '';
}

function extractMae(text){
  const m = text.match(/(?:Nome\s*da\s*m[ãa]e|Mãe|Mae|Filia[çc][ãa]o\s*materna)[:\s]*([A-Za-zÀ-ú\s]+)/i);
  if(m){
    let v = m[1].split('\n')[0].split(/Pai|Sexo|Data|CPF|RG|Processo|Nome/i)[0].trim();
    if(v.length >= 4 && v.length < 80) return titleCaseField(v);
  }
  // padrão "filho de X e Y"
  const m2 = text.match(/filho\s*de\s+([A-Za-zÀ-ú\s]+)\s+e\s+([A-Za-zÀ-ú\s]+)/i);
  if(m2) return titleCaseField(m2[1]);
  return '';
}

function extractPai(text){
  const m = text.match(/(?:Nome\s*do\s*pai|Pai|Filia[çc][ãa]o\s*paterna)[:\s]*([A-Za-zÀ-ú\s]+)/i);
  if(m){
    let v = m[1].split('\n')[0].split(/Sexo|Data|CPF|RG|Mãe|Mae|Processo/i)[0].trim();
    if(v.length >= 4 && v.length < 80) return titleCaseField(v);
  }
  const m2 = text.match(/filho\s*de\s+[A-Za-zÀ-ú\s]+\s+e\s+([A-Za-zÀ-ú\s]+)/i);
  if(m2){
    const v = m2[1].split(/,|\n|Sexo|Data/i)[0].trim();
    if(v.length >= 4 && v.length < 80) return titleCaseField(v);
  }
  return '';
}

function extractSexo(text){
  const m = text.match(/Sexo[:\s]*([A-Za-z]+)/i);
  if(m){
    const v = m[1].toLowerCase();
    if(/masc/.test(v)) return 'Masculino';
    if(/fem/.test(v)) return 'Feminino';
    if(v === 'm') return 'Masculino';
    if(v === 'f') return 'Feminino';
    return titleCaseField(v);
  }
  // tenta inferir por nome? deixa vazio
  return '';
}

function extractDataNascimento(text){
  const m = text.match(/(?:Data\s*de\s*nascimento|Nascimento|DN)[:\s]*([0-9]{2}[\/\-][0-9]{2}[\/\-][0-9]{4})/i);
  if(m) return normalizeDate(m[1]);
  // procura datas próximas a "nasc"
  const m2 = text.match(/nasc[^0-9]*([0-9]{2}[\/\-][0-9]{2}[\/\-][0-9]{4})/i);
  if(m2) return normalizeDate(m2[1]);
  return '';
}

function normalizeDate(s){
  if(!s) return '';
  const m = String(s).match(/([0-9]{2})[\/\-]([0-9]{2})[\/\-]([0-9]{4})/);
  if(!m) return '';
  // tenta validar e retorna yyyy-mm-dd
  const dd = m[1], mm = m[2], yyyy = m[3];
  if(Number(mm) < 1 || Number(mm) > 12 || Number(dd) < 1 || Number(dd) > 31) return '';
  return `${yyyy}-${mm}-${dd}`;
}

function extractDateLabel(text, labels){
  for(const lab of labels){
    const re = new RegExp(lab + '[^0-9]*([0-9]{2}[\\/\\-][0-9]{2}[\\/\\-][0-9]{4})','i');
    const m = text.match(re);
    if(m) return normalizeDate(m[1]);
  }
  return '';
}

function extractPerfil(text){
  const perfis = [
    'Fiscalização',
    'Medida Protetiva',
    'Prisão Domiciliar',
    'Prisão Domiciliar Com Estudo Externo',
    'Prisão Domiciliar Hc 143.641',
    'Saída Temporária',
    'Recolhimento Integral Aos Finais De Semana E Feriados',
    'Recolhimento Noturno E Integral Aos Finais De Semana E Feriados',
    'Recolhimento Noturno Ou Diurno',
    'Prisão Domiciliar Com Trabalho Externo'
  ];
  const lower = text.toLowerCase();
  for(const p of perfis){
    const key = p.toLowerCase().split(' ')[0];
    // busca exata ou parcial
    if(lower.includes(p.toLowerCase())) return p;
  }
  // tenta extrair linha "Perfil: X"
  const m = text.match(/Perfil[:\s]*([A-Za-zÀ-ú\s\-\/]+)/i);
  if(m){
    let v = m[1].split('\n')[0].split(/Artigos|Vara|Periculosidade/i)[0].trim();
    if(v.length >= 4) return titleCaseField(v).slice(0,80);
  }
  return '';
}

function extractArtigos(text){
  const m = text.match(/Artigos?[:\s]*([^\n]+)/i);
  if(m){
    let v = m[1].split(/Periculosidade|Vara|Isen/i)[0].trim();
    if(v.length < 200) return clean(v);
  }
  // procura leis: Art. 33, Art. 121 etc
  const arts = [...text.matchAll(/art\.?\s*([0-9]+[ºo°]?)/gi)].map(m=>'Art. '+m[1]);
  if(arts.length) return arts.slice(0,10).join(', ');
  return '';
}

function extractPericulosidade(text){
  const levels = ['Baixa','Média','Media','Alta','Altíssima','Altissima','Alta Repercussão'];
  const m = text.match(/Periculosidade[:\s]*([A-Za-zÀ-ú\s]+)/i);
  if(m){
    let v = clean(m[1].split('\n')[0].split(/Vara|Isen/i)[0]);
    for(const l of levels){
      if(v.toLowerCase().includes(l.toLowerCase())) return l.replace('Media','Média').replace('Altissima','Altíssima');
    }
    if(v.length < 30) return titleCaseField(v);
  }
  // busca solta
  for(const l of levels){
    if(text.toLowerCase().includes(l.toLowerCase())) return l.replace('Media','Média').replace('Altissima','Altíssima');
  }
  return '';
}

function extractVara(text){
  const m = text.match(/Vara[:\s]*([^\n]+)/i);
  if(m){
    let v = m[1].split(/Isen|Origem|Tipo|Data da prisão/i)[0].trim();
    if(v.length >= 3 && v.length < 120) return titleCaseField(v);
  }
  // padrão "Xª Vara ..."
  const m2 = text.match(/([0-9]+[ªa]?\s*Vara[^\n]*)/i);
  if(m2) return titleCaseField(m2[1].trim().slice(0,120));
  return '';
}

function extractIsencao(text){
  const opts = [
    'Isento (Assistido da Defensoria Pública)',
    'Isento (Beneficiário de Programa Social)',
    'Isento (Hipossuficiência)',
    'Não Isento (Contribuinte Mensal)',
    'Decisão Judicial'
  ];
  const lower = text.toLowerCase();
  for(const o of opts){
    if(lower.includes(o.toLowerCase().slice(0,15))) return o;
  }
  const m = text.match(/Isen[çc][ãa]o[:\s]*([^\n]+)/i);
  if(m) return titleCaseField(clean(m[1].split(/Origem|Tipo/i)[0]).slice(0,80));
  return '';
}

function extractOrigem(text){
  const m = text.match(/Origem[:\s]*([^\n]+)/i);
  if(m){
    let v = clean(m[1].split(/Tipo de Cumprimento|Data da prisão/i)[0]);
    if(v.length < 80) return titleCaseField(v);
  }
  return '';
}

function extractTipoCumprimento(text){
  const m = text.match(/Tipo\s*de\s*Cumprimento[:\s]*([^\n]+)/i);
  if(m){
    let v = clean(m[1].split(/Data da prisão|Início previsto/i)[0]);
    if(v.length < 80) return titleCaseField(v);
  }
  const m2 = text.match(/Regime[:\s]*([^\n]+)/i);
  if(m2) return titleCaseField(clean(m2[1].split('\n')[0]).slice(0,80));
  return '';
}

function extractTamanhoCinta(text){
  const m = text.match(/Tamanho\s*da\s*cinta[:\s]*([A-Za-z0-9\/\s]+)/i);
  if(m){
    let v = clean(m[1].split('\n')[0].split(/ORCRIM|Defici/i)[0]).trim();
    if(v.length < 20) return v.toUpperCase();
  }
  const m2 = text.match(/\b(PP|P|M|G|GG|XG|36|38|40|42|44|46)\b/);
  // cuidado para não pegar outras siglas, só se perto de "cinta"
  if(m && m2) return m2[1].toUpperCase();
  return '';
}

function extractORCRIM(text){
  const m = text.match(/ORCRIM[:\s]*([^\n]+)/i);
  if(m){
    let v = clean(m[1].split('\n')[0]).trim();
    if(/sim|não|nao|positivo|negativo/i.test(v)) return /sim|positivo/i.test(v) ? 'Sim' : 'Não';
    if(v.length < 20) return titleCaseField(v);
  }
  if(/ORCRIM/i.test(text) && /sim/i.test(text)) return 'Sim';
  return '';
}

function extractDeficiencia(text){
  const m = text.match(/Defici[êe]ncia[:\s]*([^\n]+)/i);
  if(m){
    let v = clean(m[1].split('\n')[0].split(/Tipo de defici|Etnia/i)[0]).trim();
    if(/sim|não|nao/i.test(v)) return /sim/i.test(v) ? 'Sim' : 'Não';
    if(v.length < 30) return titleCaseField(v);
  }
  return '';
}

function extractTipoDeficiencia(text){
  const m = text.match(/Tipo\s*de\s*defici[êe]ncia[:\s]*([^\n]+)/i);
  if(m) return titleCaseField(clean(m[1].split('\n')[0].split(/Descrição|Etnia/i)[0]).slice(0,80));
  return '';
}

function extractDescricaoDeficiencia(text){
  const m = text.match(/Descri[çc][ãa]o\s*da\s*defici[êe]ncia[:\s]*([^\n]+)/i);
  if(m) return clean(m[1].split('\n')[0].slice(0,200));
  return '';
}

function extractEtnia(text){
  const etnias = ['Branca','Preta','Parda','Amarela','Indígena','Indigena'];
  const m = text.match(/Etnia[:\s]*([A-Za-zÀ-ú\s]+)/i);
  if(m){
    let v = clean(m[1].split('\n')[0].split(/Grau|Naturalidade/i)[0]).trim();
    for(const e of etnias) if(v.toLowerCase().includes(e.toLowerCase())) return e.replace('Indigena','Indígena');
    if(v.length < 20) return titleCaseField(v);
  }
  for(const e of etnias) if(text.toLowerCase().includes(('etnia:'+e).toLowerCase())) return e;
  return '';
}

function extractEscolaridade(text){
  const m = text.match(/(?:Grau\s*de\s*Escolaridade|Escolaridade)[:\s]*([^\n]+)/i);
  if(m){
    let v = clean(m[1].split('\n')[0].split(/Naturalidade|Nacionalidade/i)[0]).trim();
    if(v.length < 80) return titleCaseField(v);
  }
  return '';
}

function extractNaturalidade(text){
  const m = text.match(/Naturalidade[:\s]*([^\n]+)/i);
  if(m) return titleCaseField(clean(m[1].split('\n')[0].split(/Nacionalidade|Religi/i)[0]).slice(0,60));
  // "Natural de X"
  const m2 = text.match(/Natural\s*de\s+([A-Za-zÀ-ú\s\/\-]+)/i);
  if(m2) return titleCaseField(m2[1].split(/,/)[0].trim().slice(0,60));
  return '';
}

function extractNacionalidade(text){
  const m = text.match(/Nacionalidade[:\s]*([^\n]+)/i);
  if(m) return titleCaseField(clean(m[1].split('\n')[0].split(/Religi|Estado civil/i)[0]).slice(0,40));
  if(/brasileir/i.test(text)) return 'Brasileira';
  return '';
}

function extractReligiao(text){
  const m = text.match(/Religi[ãa]o[:\s]*([^\n]+)/i);
  if(m){
    let v = clean(m[1].split('\n')[0].split(/Estado civil|Nome do c/i)[0]).trim();
    if(v.length < 40) return titleCaseField(v);
  }
  return '';
}

function extractEstadoCivil(text){
  const estados = ['Solteiro','Casado','Divorciado','Viúvo','Viuvo','União Estável','Uniao Estavel','Amasiado'];
  const m = text.match(/Estado\s*civil[:\s]*([^\n]+)/i);
  if(m){
    let v = clean(m[1].split('\n')[0].split(/Nome do c/i)[0]).trim();
    for(const e of estados) if(v.toLowerCase().includes(e.toLowerCase())) return e.replace('Viuvo','Viúvo').replace('Uniao Estavel','União Estável');
    if(v.length < 30) return titleCaseField(v);
  }
  for(const e of estados) if(text.toLowerCase().includes(e.toLowerCase())) return e;
  return '';
}

function extractConjuge(text){
  const m = text.match(/Nome\s*do\s*c[ôo]njuge[:\s]*([A-Za-zÀ-ú\s]+)/i);
  if(m){
    let v = clean(m[1].split('\n')[0].split(/Contatos|Endereço/i)[0]).trim();
    if(v.length >= 4 && v.length < 80) return titleCaseField(v);
  }
  return '';
}

function extractContatos(text){
  const tels = [...text.matchAll(/(?:\(?\d{2}\)?\s*9?\s*\d{4}[- ]?\d{4})/g)].map(m=>m[0].replace(/\s+/g,' ').trim());
  if(tels.length) return tels.slice(0,3).join(', ');
  const m = text.match(/Contatos?\s*priorit[áa]rios?[:\s]*([^\n]+)/i);
  if(m) return clean(m[1].split('\n')[0].slice(0,60));
  return '';
}

function extractEndereco(text){
  const m = text.match(/Endere[çc]o[:\s]*([^\n]+)/i);
  if(m){
    let v = clean(m[1].split(/Resid[êe]ncia|Bairro|Complemento|Ponto/i)[0].trim());
    if(v.length >= 6) return titleCaseField(v).slice(0,300);
  }
  // Rua, Av
  const m2 = text.match(/((?:Rua|Av\.?|Avenida|Travessa|R\.)\s+[^\n,]{5,80})/i);
  if(m2) return titleCaseField(m2[1].trim().slice(0,300));
  return '';
}

function extractComplemento(text){
  const m = text.match(/Complemento\s*:\s*([^\n]+)/i);
  if(m){
    let v = clean(m[1].split(/Ponto|Bairro|CEP|Estado|Cidade/i)[0].trim().slice(0,120));
    return titleCaseField(v);
  }
  return '';
}

function extractPontoReferencia(text){
  const m = text.match(/Ponto\s*de\s*Refer[êe]ncia\s*:\s*([^\n]+)/i);
  if(m){
    let v = clean(m[1].split(/Bairro|CEP|Estado|Cidade/i)[0].trim().slice(0,120));
    return titleCaseField(v);
  }
  return '';
}

function extractBairro(text){
  const m = text.match(/Bairro[:\s]*([^\n]+)/i);
  if(m) return titleCaseField(clean(m[1].split('\n')[0].split(/CEP|Estado|Cidade/i)[0]).slice(0,80));
  return '';
}

function extractCEP(text){
  const m = text.match(/CEP[:\s]*([0-9]{5}[- ]?[0-9]{3})/i);
  if(m) return m[1].replace(' ','-');
  const m2 = text.match(/\b([0-9]{5}-[0-9]{3})\b/);
  if(m2) return m2[1];
  return '';
}

function extractEstado(text){
  // Estado: CE  (não confundir com Estado civil)
  const m = text.match(/\bEstado\s*:\s*([A-Za-z]{2})\b/i);
  if(m) return m[1].toUpperCase();
  const m2 = text.match(/\bEstado\s*:\s*([A-Za-zÀ-ú\/\s]+)/i);
  if(m2){
    let v = clean(m2[1].split('\n')[0].split(/Cidade|CEP|Bairro/i)[0]).trim();
    const uf = v.match(/\b(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)\b/i);
    if(uf) return uf[1].toUpperCase();
    if(v.length < 30) return titleCaseField(v).slice(0,30);
  }
  const m3 = text.match(/\b([A-Z]{2})\b\s*CEP/i);
  if(m3) return m3[1].toUpperCase();
  return '';
}

function extractCidade(text){
  const m = text.match(/Cidade[:\s]*([^\n]+)/i);
  if(m) return titleCaseField(clean(m[1].split('\n')[0].split(/CEP|Estado/i)[0]).slice(0,60));
  return '';
}

function extractLei(text){
  const m = text.match(/Lei\s*:\s*([^\n]+)/i);
  if(m){
    let v = clean(m[1].split(/Militar|Código|Periculosidade|Vara/i)[0].trim().slice(0,120));
    if(v.length < 80) return v;
  }
  return '';
}

function extractMilitar(text){
  const m = text.match(/Militar\s*:\s*([^\n]+)/i);
  if(m){
    let v = clean(m[1].split(/Código|Periculosidade|Vara/i)[0].trim().slice(0,120));
    if(v.length < 80) return v;
  }
  return '';
}

function extractCodigoPenal(text){
  const m = text.match(/C[óo]digo\s*penal\s*:\s*([^\n]+)/i);
  if(m){
    let v = clean(m[1].split(/Periculosidade|Vara|Isen/i)[0].trim().slice(0,200));
    if(v.length < 120) return v;
  }
  return '';
}

function extractDias(text){
  const m = text.match(/Dias\s*=?\s*([0-9]+)/i);
  if(m) return m[1];
  const m2 = text.match(/([0-9]+)\s*dias/i);
  if(m2) return m2[1];
  return '';
}

function extractPeriodoReanalisar(text){
  const m = text.match(/Per[íi]odo\s*para\s*reanalisar\s*:\s*([^\n]+)/i);
  if(m){
    let v = clean(m[1].split(/Tamanho|ORCRIM|Defici|Etnia/i)[0].trim().slice(0,80));
    if(v.length < 60) return v;
  }
  return '';
}

function parseAtivacoes(textRaw){
  const text = String(textRaw || '');
  const get = (fn) => { try{ return fn(text) || ''; } catch{ return ''; } };
  const dias = get(extractDias);
  const inicioPrevisto = extractDateLabel(text, ['In[íi]cio\\s*previsto','Inicio previsto']);
  const terminoPrevisto = extractDateLabel(text, ['T[ée]rmino\\s*previsto','Termino previsto']);
  // Se tem dias e inicio, calcula término
  let terminoCalc = terminoPrevisto;
  if(!terminoCalc && inicioPrevisto && dias){
    try{
      const d = new Date(inicioPrevisto);
      d.setDate(d.getDate() + Number(dias));
      terminoCalc = d.toISOString().slice(0,10);
    }catch{}
  }

  const result = {
    // Dados Pessoais
    nomeMonitorado: get(extractNome),
    vulgo: get(extractVulgo),
    nomeMae: get(extractMae),
    nomePai: get(extractPai),
    sexo: get(extractSexo),
    dataNascimento: get(extractDataNascimento),
    // Documentação
    rg: get(extractRG),
    orgaoExpedidor: get(extractOrgao),
    cpf: get(extractCPF),
    processo: get(extractProcesso),
    processos: get(extractProcessos),
    perfil: get(extractPerfil),
    artigos: get(extractArtigos),
    lei: get(extractLei),
    militar: get(extractMilitar),
    codigoPenal: get(extractCodigoPenal),
    periculosidade: get(extractPericulosidade),
    vara: get(extractVara),
    isencao: get(extractIsencao),
    origem: get(extractOrigem),
    tipoCumprimento: get(extractTipoCumprimento),
    dataPrisao: extractDateLabel(text, ['Data\\s*da\\s*pris[ãa]o','Data da prisao']),
    inicioPrevisto: inicioPrevisto,
    terminoPrevisto: terminoCalc,
    dias: dias,
    periodoReanalisar: get(extractPeriodoReanalisar),
    tamanhoCinta: get(extractTamanhoCinta),
    orcrim: get(extractORCRIM),
    deficiencia: get(extractDeficiencia),
    tipoDeficiencia: get(extractTipoDeficiencia),
    descricaoDeficiencia: get(extractDescricaoDeficiencia),
    etnia: get(extractEtnia),
    grauEscolaridade: get(extractEscolaridade),
    naturalidade: get(extractNaturalidade),
    nacionalidade: get(extractNacionalidade),
    religiao: get(extractReligiao),
    estadoCivil: get(extractEstadoCivil),
    nomeConjuge: get(extractConjuge),
    contatosPrioritarios: get(extractContatos),
    // Endereço
    endereco: get(extractEndereco),
    residenciaComplemento: get(extractComplemento),
    residenciaPontoReferencia: get(extractPontoReferencia),
    bairro: get(extractBairro),
    cep: get(extractCEP),
    estado: get(extractEstado),
    cidade: get(extractCidade),
    // meta
    textoOriginal: text.slice(0, 15000)
  };

  // Aplica Title Case onde solicitado (enunciado: "Coloque com letra maiuscula panas a primeira letra da palavra")
  const titleFields = ['nomeMonitorado','vulgo','nomeMae','nomePai','vara','origem','tipoCumprimento','endereco','residenciaComplemento','residenciaPontoReferencia','bairro','cidade','nomeConjuge','naturalidade','nacionalidade','religiao','estadoCivil','grauEscolaridade','tipoDeficiencia','descricaoDeficiencia'];
  for(const k of titleFields){
    if(result[k]) result[k] = titleCaseField(result[k]);
  }

  // Normaliza alguns selects para valores esperados
  if(result.sexo){
    const s = result.sexo.toLowerCase();
    if(s.includes('masc')) result.sexo = 'Masculino';
    else if(s.includes('fem')) result.sexo = 'Feminino';
    else result.sexo = titleCaseField(result.sexo);
  }

  return result;
}

function scoreParse(result){
  const keys = Object.keys(result).filter(k=>k!=='textoOriginal' && !k.startsWith('_'));
  const filled = keys.filter(k=> result[k] && String(result[k]).trim()).length;
  return { filled, total: keys.length, percent: Math.round(filled/keys.length*100) };
}

// Validação cruzada + CPF/CEP/processo
function validarCPF(cpf){
  const d = String(cpf||'').replace(/\D/g,'');
  if(d.length!==11 || /^(\d)\1{10}$/.test(d)) return false;
  let s=0; for(let i=0;i<9;i++) s+=parseInt(d[i])*(10-i);
  let r=(s*10)%11; if(r===10) r=0; if(r!==parseInt(d[9])) return false;
  s=0; for(let i=0;i<10;i++) s+=parseInt(d[i])*(11-i);
  r=(s*10)%11; if(r===10) r=0; return r===parseInt(d[10]);
}
function crossValidate(text, parsed){
  const warnings=[];
  const add=(campo, msg, severidade='alerta')=> warnings.push({ campo, msg, severidade });
  // CPF
  const cpfs = [...new Set([...(text.matchAll(/\b\d{3}\.?\d{3}\.?\d{3}[- ]?\d{2}\b/g) || [])].map(m=>m[0].replace(/\D/g,'')))];
  if(cpfs.length>1) add('cpf', `Múltiplos CPFs no documento: ${cpfs.map(c=>c.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/,'$1.$2.$3-$4')).join(', ')} — conferir qual é do monitorado`, 'divergencia');
  if(parsed.cpf && !validarCPF(parsed.cpf)) add('cpf', `CPF ${parsed.cpf} com dígito verificador inválido`, 'erro');
  // Datas nascimento
  const dns = [...new Set([...(text.matchAll(/\b\d{2}[\/\-]\d{2}[\/\-]\d{4}\b/g) || [])].map(m=>m[0]))];
  // filtra só datas próximas de "nascimento"
  const dnsNasc = [...text.matchAll(/nascimento[^0-9]{0,40}(\d{2}[\/\-]\d{2}[\/\-]\d{4})/gi)].map(m=>m[1]);
  if(new Set(dnsNasc).size>1) add('dataNascimento', `Divergência de data de nascimento entre seções: ${[...new Set(dnsNasc)].join(' vs ')}`, 'divergencia');
  // Processos
  const procs = [...new Set([...(text.matchAll(/\b\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}\b/g) || [])].map(m=>m[0]))];
  if(procs.length>1) add('processo', `Múltiplos processos CNJ: ${procs.join(', ')} — ver campo Processos`, 'info');
  // Endereços
  const ends = [...text.matchAll(/Endere[çc]o\s*:\s*([^\n]+)/gi)].map(m=>m[1].trim().slice(0,60));
  if(new Set(ends).size>1) add('endereco', `Endereços diferentes entre seções: "${ends[0]}" vs "${ends[1]}"`, 'divergencia');
  // Nome mãe
  const maes = [...text.matchAll(/(?:mãe|mae|filia[çc][ãa]o materna)\s*:\s*([A-Za-zÀ-ú\s]{5,60})/gi)].map(m=>m[1].trim());
  if(new Set(maes.map(m=>m.toLowerCase())).size>1) add('nomeMae', `Nome da mãe divergente: "${maes[0]}" vs "${maes[1]}"`, 'divergencia');
  // CEP
  if(parsed.cep && !/^\d{5}-\d{3}$/.test(parsed.cep)) add('cep', `CEP ${parsed.cep} fora do formato 00000-000`, 'erro');
  // Sexo vs nome (heurística simples)
  // Período vs dias (coerência)
  if(parsed.inicioPrevisto && parsed.terminoPrevisto && parsed.dias){
    const d1=new Date(parsed.inicioPrevisto), d2=new Date(parsed.terminoPrevisto);
    const diff=Math.round((d2-d1)/86400000);
    if(!isNaN(diff) && Math.abs(diff - Number(parsed.dias))>2) add('dias', `Dias (${parsed.dias}) diverge do intervalo ${parsed.inicioPrevisto}→${parsed.terminoPrevisto} (${diff} dias)`, 'alerta');
  }
  return warnings;
}

function mergeWithLlm(regexData, llmData){
  if(!llmData) return regexData;
  const out = { ...regexData };
  const llmKeys = Object.keys(llmData);
  let llmFilled=0;
  for(const k of llmKeys){
    const rv = String(regexData[k]||'').trim();
    const lv = String(llmData[k]||'').trim();
    if(!rv && lv) { out[k]=lv; llmFilled++; }
    // se LLM corrige Title Case ou preenche campo vazio, prioriza LLM quando regex vazio
    // se ambos preenchidos e diferentes, mantém regex mas marca para validação
  }
  out._llmContrib = llmFilled;
  return out;
}

module.exports = { parseAtivacoes, toTitleCase, scoreParse, crossValidate, validarCPF, mergeWithLlm };

