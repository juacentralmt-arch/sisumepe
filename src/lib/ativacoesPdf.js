const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const ROOT = path.join(__dirname, '..', '..');

async function gerarAtivacaoPDF(termo){
  const d = (termo.dados && typeof termo.dados === 'object') ? termo.dados : {};
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontOb = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
  const PW = 595.32, PH = 841.92, M = 42;
  const W = PW - 2*M;
  const BLACK = rgb(0,0,0);
  const GRAY = rgb(0.45,0.45,0.45);
  let brasao=null, badgePP=null;
  try{ const bp=path.join(ROOT,'public','brasao-ceara.png'); if(fs.existsSync(bp)) brasao=await pdfDoc.embedPng(fs.readFileSync(bp)); }catch{}
  try{ const pp=path.join(ROOT,'public','logo-policia-penal.png'); if(fs.existsSync(pp)) badgePP=await pdfDoc.embedPng(fs.readFileSync(pp)); }catch{}
  let yTop = PH-36;
  let pages=[]; let pg = pdfDoc.addPage([PW,PH]); pages.push(pg);
  let y = yTop;
  const GREEN = rgb(0.16,0.5,0.27);
  const SLATE = rgb(0.23,0.32,0.38);
  // header
  let txL = M;
  if(badgePP){
    const bh=58, bw=bh*(badgePP.width/badgePP.height);
    pg.drawImage(badgePP,{x:M,y:yTop-bh,width:bw,height:bh});
    txL = M+bw+8;
  }
  pg.drawText('POLÍCIA PENAL',{x:txL,y:yTop-15,size:14,font:fontBold,color:BLACK});
  pg.drawText('Coordenadoria de Monitoração',{x:txL,y:yTop-28,size:7.5,font:fontBold,color:BLACK});
  pg.drawText('Eletrônica de Pessoas - COMEP',{x:txL,y:yTop-38,size:7.5,font:fontBold,color:BLACK});
  const cea='CEARÁ'; const ceaW=fontBold.widthOfTextAtSize(cea,22);
  const g1='GOVERNO DO ESTADO', g1W=fontBold.widthOfTextAtSize(g1,9);
  const g2='SECRETARIA DA ADMINISTRAÇÃO', g2W=font.widthOfTextAtSize(g2,7);
  const g3='PENITENCIÁRIA E RESSOCIALIZAÇÃO', g3W=font.widthOfTextAtSize(g3,7);
  const txtW=Math.max(ceaW,g1W,g2W,g3W);
  if(brasao){
    const brH=62, brW=brH*(brasao.width/brasao.height);
    pg.drawImage(brasao,{x:PW-M-txtW-8-brW,y:yTop-brH,width:brW,height:brH});
  }
  pg.drawText(cea,{x:PW-M-ceaW,y:yTop-22,size:22,font:fontBold,color:SLATE});
  pg.drawText(g1,{x:PW-M-g1W,y:yTop-36,size:9,font:fontBold,color:BLACK});
  pg.drawText(g2,{x:PW-M-g2W,y:yTop-47,size:7,font:font,color:BLACK});
  pg.drawText(g3,{x:PW-M-g3W,y:yTop-57,size:7,font:font,color:BLACK});
  y = 728;
  pg.drawLine({start:{x:M,y},end:{x:PW-M,y},thickness:1.2,color:GREEN});
  y = 708;
  const title='FICHA DE ATIVAÇÃO - MONITORADO';
  const tW=fontBold.widthOfTextAtSize(title,13);
  pg.drawText(title,{x:(PW-tW)/2,y,size:13,font:fontBold,color:BLACK});
  pg.drawLine({start:{x:(PW-tW)/2,y:y-2},end:{x:(PW+tW)/2,y:y-2},thickness:0.7,color:BLACK});
  y -= 18;
  const sub = d.processo ? ('Processo: '+d.processo) : (d.processo || '');
  if(sub){
    const sW=font.widthOfTextAtSize(sub,9);
    pg.drawText(sub,{x:(PW-sW)/2,y,size:9,font:font,color:GRAY});
    y -= 14;
  } else y -= 6;

  function ensure(h){
    if(y - h < 55){
      pg = pdfDoc.addPage([PW,PH]);
      pages.push(pg);
      y = PH - 48;
    }
  }
  function field(label, value, size){
    size=size||9;
    const lh=12;
    const labW=fontBold.widthOfTextAtSize(label+': ', size);
    const val = String(value||'—').trim() || '—';
    // quebra de linha se valor muito longo
    const maxW = W - labW;
    const words = val.split(/\s+/);
    let line='', lines=[];
    for(const w of words){
      const t = line ? line+' '+w : w;
      if(font.widthOfTextAtSize(t,size) > maxW && line){ lines.push(line); line=w; } else line=t;
    }
    if(line) lines.push(line);
    if(!lines.length) lines=['—'];
    ensure(lines.length*lh+6);
    let yy=y;
    lines.forEach((ln,i)=>{
      if(i===0){
        pg.drawText(label+': ',{x:M,y:yy,size,font:fontBold,color:BLACK});
        pg.drawText(ln,{x:M+labW,y:yy,size,font:font,color:BLACK});
      } else {
        pg.drawText(ln,{x:M+labW,y:yy,size,font:font,color:BLACK});
      }
      yy-=lh;
    });
    y = yy - 2;
  }
  function section(t){
    ensure(20);
    y-=4;
    pg.drawRectangle({x:M,y:y-10,width:W,height:14,color:rgb(0.93,0.94,0.96),borderColor:rgb(0.2,0.2,0.2),borderWidth:0.4});
    const w=fontBold.widthOfTextAtSize(t,9);
    pg.drawText(t,{x:M+6,y:y-2,size:9,font:fontBold,color:BLACK});
    y-=16;
  }
  function twoCols(aLabel,aVal,bLabel,bVal){
    ensure(14);
    const half = W/2;
    pg.drawText(aLabel+': ',{x:M,y,size:8.5,font:fontBold,color:BLACK});
    const aw=fontBold.widthOfTextAtSize(aLabel+': ',8.5);
    pg.drawText(String(aVal||'—').slice(0,50),{x:M+aw,y,size:8.5,font:font,color:BLACK});
    pg.drawText(bLabel+': ',{x:M+half,y,size:8.5,font:fontBold,color:BLACK});
    const bw=fontBold.widthOfTextAtSize(bLabel+': ',8.5);
    pg.drawText(String(bVal||'—').slice(0,50),{x:M+half+bw,y,size:8.5,font:font,color:BLACK});
    y-=12;
  }

  // Dados Pessoais
  section('DADOS PESSOAIS');
  field('Nome do monitorado', d.nomeMonitorado || d.nome || '—');
  twoCols('Vulgo', d.vulgo, 'Sexo', d.sexo);
  twoCols('Data de nascimento', d.dataNascimento ? String(d.dataNascimento).slice(0,10).split('-').reverse().join('/') : '', 'Estado civil', d.estadoCivil);
  field('Nome da mãe', d.nomeMae);
  field('Nome do pai', d.nomePai || '—');
  twoCols('Naturalidade', d.naturalidade, 'Nacionalidade', d.nacionalidade);
  twoCols('Etnia', d.etnia, 'Grau de escolaridade', d.grauEscolaridade);
  twoCols('Religião', d.religiao, 'Nome do cônjuge', d.nomeConjuge);
  field('Contatos prioritários', d.contatosPrioritarios);

  section('DOCUMENTAÇÃO');
  twoCols('RG', d.rg, 'Órgão expedidor', d.orgaoExpedidor);
  field('CPF', d.cpf);

  section('PROCESSO E MEDIDA');
  field('Processo', d.processo);
  if(d.processos && d.processos!==d.processo) field('Processos', d.processos);
  field('Perfil', d.perfil);
  field('Artigos', d.artigos || [d.lei,d.militar,d.codigoPenal].filter(Boolean).join(' | ') || '—');
  if(d.lei) field('Lei', d.lei);
  if(d.militar) field('Militar', d.militar);
  if(d.codigoPenal) field('Código penal', d.codigoPenal);
  twoCols('Periculosidade', d.periculosidade, 'Vara', d.vara);
  field('Isenção', d.isencao);
  twoCols('Origem', d.origem, 'Tipo de cumprimento', d.tipoCumprimento);
  twoCols('Data da prisão', d.dataPrisao ? String(d.dataPrisao).slice(0,10).split('-').reverse().join('/') : '', 'Início previsto', d.inicioPrevisto ? String(d.inicioPrevisto).slice(0,10).split('-').reverse().join('/') : '');
  twoCols('Término previsto', d.terminoPrevisto ? String(d.terminoPrevisto).slice(0,10).split('-').reverse().join('/') : '', 'Dias', d.dias);
  field('Período para reanalisar', d.periodoReanalisar);
  twoCols('Tamanho da cinta', d.tamanhoCinta, 'ORCRIM', d.orcrim);
  section('DEFICIÊNCIA');
  twoCols('Deficiência', d.deficiencia, 'Tipo', d.tipoDeficiencia);
  field('Descrição', d.descricaoDeficiencia);

  section('ENDEREÇO');
  field('Endereço', d.endereco);
  field('Complemento', d.residenciaComplemento);
  field('Ponto de referência', d.residenciaPontoReferencia);
  twoCols('Bairro', d.bairro, 'CEP', d.cep);
  twoCols('Estado', d.estado, 'Cidade', d.cidade);

  // Rodapé e assinatura
  ensure(90);
  y-=16;
  pg.drawLine({start:{x:M,y},end:{x:PW-M,y},thickness:0.6,color:BLACK});
  y-=14;
  const sig1='Responsável pela ativação';
  const w1=font.widthOfTextAtSize(sig1,9);
  pg.drawText(sig1,{x:(PW-w1)/2,y,size:9,font:font,color:BLACK});
  y-=12;
  const dataStr = new Date().toLocaleDateString('pt-BR');
  const foot='Documento gerado pelo Sistema SISUMEPE Juazeiro — '+dataStr;
  const fw=fontOb.widthOfTextAtSize(foot,7);
  if(pages[pages.length-1]===pg){
    pg.drawText(foot,{x:(PW-fw)/2,y:32,size:7,font:fontOb,color:GRAY});
  } else {
    const last=pages[pages.length-1];
    last.drawText(foot,{x:(PW-fw)/2,y:32,size:7,font:fontOb,color:GRAY});
  }

  // Numeração de páginas
  pages.forEach((p,i)=>{
    const t=`Página ${i+1} de ${pages.length}`;
    const tw=font.widthOfTextAtSize(t,7);
    p.drawText(t,{x:PW-M-tw,y:20,size:7,font:font,color:GRAY});
  });

  return await pdfDoc.save();
}

module.exports = { gerarAtivacaoPDF };

