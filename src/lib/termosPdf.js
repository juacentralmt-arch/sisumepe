const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const ROOT = path.join(__dirname, '..', '..');

// PDF Termos

function gerarTermoHTML(termo){
  const dataFmt = (()=>{ if(!termo.dataEnvio) return '_______/_______/________'; try{ const d=new Date(termo.dataEnvio); if(!isNaN(d)) return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`; }catch(e){} return String(termo.dataEnvio); })();
  const dest = termo.destinatario ? termo.destinatario : '_____________________________';
  const eq = Array.isArray(termo.equipamentos) ? termo.equipamentos : [];
  while(eq.length<5) eq.push({tzpr04:'',fonte04:'',cinta:'',trava:''});
  const rows = eq.slice(0,30).map(r=>`
      <tr>
        <td>${(r.tzpr04||'').toString().substring(0,20)}</td>
        <td>${(r.fonte04||'').toString().substring(0,20)}</td>
        <td>${(r.cinta||'').toString().substring(0,20)}</td>
        <td>${(r.trava||'').toString().substring(0,20)}</td>
      </tr>`).join('');
  const brasaoSvg = `PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj48Y2lyY2xlIGN4PSI1MCIgY3k9IjUwIiByPSI0NSIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjMDAwIiBzdHJva2Utd2lkdGg9IjIiLz48dGV4dCB4PSI1MCIgeT0iNTUiIGZvbnQtZmFtaWx5PSJTZXJpZiIgZm9udC1zaXplPSIxMCIgZmlsbD0iIzAwMCIgdGV4dC1hbmNob3I9Im1pZGRsZSI+QlJBU8ODTzwvdGV4dD48L3N2Zz4=`;
  // Brasão base64 simples (placeholder) - será substituído se logo_0.png existir, senão usa SVG
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<style>
  @page { size: A4; margin: 18mm 18mm 18mm 18mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Times New Roman', Times, serif; font-size: 12pt; color: #000; line-height: 1.25; margin: 0; padding: 0; }
  .header { text-align: center; margin-bottom: 10px; }
  .header img { width: 58px; height: 62px; display: block; margin: 0 auto 6px auto; }
  .header .gov1 { font-size: 11pt; font-weight: bold; margin: 0; line-height: 1.1; }
  .header .gov2 { font-size: 13pt; font-weight: bold; margin: 0; line-height: 1.1; }
  .header .sec { font-size: 9pt; font-weight: bold; margin-top: 4px; }
  .data-envio { text-align: left; font-size: 9pt; margin: 18px 0 14px 0; }
  .title { text-align: center; font-weight: bold; text-decoration: underline; font-size: 13pt; margin: 14px 0 14px 0; }
  .subtitle { text-align: center; font-weight: bold; font-size: 9pt; line-height: 1.3; }
  .subtitle span { font-weight: normal; }
  .destinatario { text-align: left; font-size: 11pt; margin: 14px 0 18px 0; padding-left: 40px; }
  .destinatario b { font-weight: bold; }
  .destinatario .linha { border-bottom: 1px solid #000; display: inline-block; min-width: 280px; margin-left: 4px; text-align: center; padding-bottom: 1px; }
  table { width: 100%; max-width: 440px; margin: 0 auto; border-collapse: collapse; }
  th { background-color: #FFE4CC; border: 1px solid #000; padding: 6px 4px; text-align: center; font-weight: bold; font-size: 10pt; }
  td { border: 1px solid #000; padding: 7px 4px; text-align: center; font-size: 9pt; height: 18px; }
  .assinatura { margin-top: 42px; text-align: center; }
  .assinatura hr { border: none; border-top: 2px solid #000; margin: 0 auto; width: 88%; }
  .assinatura .label { font-weight: bold; font-size: 10pt; margin-top: 6px; }
  .assinatura .sub { font-size: 9pt; margin-top: 2px; }
  .assinatura .nome { font-size: 9pt; margin-bottom: 6px; min-height: 14px; }
  .spacer { height: 18px; }
</style>
</head>
<body>
  <div class="header">
    <img src="data:image/svg+xml;base64,${brasaoSvg}" alt="Brasão">
    <div class="gov1">GOVERNO DO</div>
    <div class="gov2">ESTADO DO CEARÁ</div>
    <div class="sec">Secretaria Administração Penitenciária</div>
  </div>
  <div class="data-envio">Data de envio: ${hasData(termo) ? dataFmt : '_______/_______/________'}</div>
  <div class="title">LISTAGEM DE EQUIPAMENTOS</div>
  <div class="subtitle">
    <div>SECRETARIA DE ADMINISTRAÇÃO PENITENCIÁRIA/SAP – CE</div>
    <div><b>Remetente:</b> Rua das Flores, s/n, Bairro Santa Tereza, Juazeiro do Norte-CE</div>
    <div>CÉLULA DE MONITORAÇÃO ELETRÔNICA -<i>SECÇÃO CARIRI</i></div>
  </div>
  <div class="destinatario"><b>Destinatário:</b> <span class="linha">${dest}</span></div>
  <table>
    <thead><tr><th>TZPR04</th><th>FONTE04</th><th>CINTA</th><th>TRAVA</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="assinatura">
    <div class="nome">${termo.respEntrega ? termo.respEntrega : '&nbsp;'}</div>
    <hr>
    <div class="label">RESPONSÁVEL PELA ENTREGA</div>
    <div class="sub">(RG/CPF/MATRICULA)</div>
  </div>
  <div class="assinatura">
    <div class="nome">${termo.respRecebimento ? termo.respRecebimento : '&nbsp;'}</div>
    <hr>
    <div class="label">RESPONSÁVEL PELA RECEBIMENTO</div>
    <div class="sub">(RG/CPF/MATRICULA)</div>
  </div>
</body>
</html>`;
  function hasData(t){ return t.dataEnvio && String(t.dataEnvio).trim() && !String(t.dataEnvio).includes('_'); }
}

async function gerarTermoPDF(termo){
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.32, 841.92]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontTimes = await pdfDoc.embedFont(StandardFonts.TimesRoman);
  const fontTimesBold = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);
  // Logo oficial Governo do Ceará (brasão + texto) - arquivo local, sem depender de internet
  let logoImage = null;
  try{
    const logoPath = path.join(ROOT, 'public', 'logo-governo-ce.png');
    if(fs.existsSync(logoPath)){
      logoImage = await pdfDoc.embedPng(fs.readFileSync(logoPath));
    }
  }catch(e){}
  if(!logoImage){
    try{
      if(typeof fetch !== 'undefined'){
        const res = await fetch('https://upload.wikimedia.org/wikipedia/commons/thumb/9/9e/Bras%C3%A3o_do_Cear%C3%A1.svg/200px-Bras%C3%A3o_do_Cear%C3%A1.png').catch(()=>null);
        if(res && res.ok){
          const buf = await res.arrayBuffer();
          logoImage = await pdfDoc.embedPng(Buffer.from(buf));
        }
      }
    }catch(e){}
  }
  if(logoImage){
    // Logo 680x426 -> 130pt de largura, centralizada no topo
    const logoW = 130;
    const logoH = logoW * (logoImage.height / logoImage.width);
    page.drawImage(logoImage, { x: (595.32 - logoW)/2, y: 810 - logoH, width: logoW, height: logoH });
  }
  const secTxt = 'Secretaria Administração Penitenciária';
  const secW = fontTimes.widthOfTextAtSize(secTxt, 9);
  page.drawText(secTxt, { x: (595.32 - secW)/2, y: 712, size: 9, font: fontTimes, color: rgb(0,0,0) });
  // Data de envio - exato x=90.26, y=689.98
  let dataFmt = '_______/_______/________';
  let hasData = false;
  if(termo.dataEnvio){
    try{
      const d = new Date(termo.dataEnvio);
      if(!isNaN(d)){
        const dd = String(d.getDate()).padStart(2,'0');
        const mm = String(d.getMonth()+1).padStart(2,'0');
        const yyyy = String(d.getFullYear());
        dataFmt = `${dd}/${mm}/${yyyy}`;
        hasData = true;
      } else if(String(termo.dataEnvio).trim()){
        dataFmt = String(termo.dataEnvio).trim();
        hasData = true;
      }
    }catch(e){ dataFmt = String(termo.dataEnvio); hasData = true; }
  }
  page.drawText('Data de envio', { x: 90.26, y: 689.98, size: 9, font: fontTimes, color: rgb(0,0,0) });
  page.drawText(':', { x: 145.94, y: 689.98, size: 9, font: fontTimes, color: rgb(0,0,0) });
  page.drawText(hasData ? dataFmt : '_______/_______/________', { x: 150.86, y: 689.98, size: 9, font: fontTimes, color: rgb(0,0,0) });
  // Título - x=224.09, y=641.98, 12pt
  const title = 'LISTAGEM DE EQUIPAMENTOS';
  page.drawText(title, { x: 224.09, y: 641.98, size: 12, font: fontTimesBold, color: rgb(0,0,0) });
  const titleW = fontTimesBold.widthOfTextAtSize(title, 12);
  page.drawLine({ start: {x: 224.09, y: 639.5}, end: {x: 224.09 + titleW, y: 639.5}, thickness: 0.9, color: rgb(0,0,0) });
  // Subtítulos - exatos
  const sub1Full = 'SECRETARIA DE ADMINISTRAÇÃO PENITENCIÁRIA/SAP – CE';
  const sub1W = fontTimesBold.widthOfTextAtSize(sub1Full, 11);
  page.drawText(sub1Full, { x: (595.32 - sub1W)/2, y: 614.14, size: 11, font: fontTimesBold, color: rgb(0,0,0) });
  const remL = 'Remetente: ';
  const remR = 'Rua das Flores, s/n, Bairro Santa Tereza, Juazeiro do Norte-CE';
  const remW = fontTimesBold.widthOfTextAtSize(remL, 11) + fontTimes.widthOfTextAtSize(remR, 10.5);
  let remX = (595.32 - remW)/2;
  page.drawText(remL, { x: remX, y: 600.34, size: 11, font: fontTimesBold, color: rgb(0,0,0) });
  remX += fontTimesBold.widthOfTextAtSize(remL, 11);
  page.drawText(remR, { x: remX, y: 600.34, size: 10.5, font: fontTimes, color: rgb(0,0,0) });
  let fontItalic = fontTimesBold;
  try{ fontItalic = await pdfDoc.embedFont(StandardFonts.TimesRomanBoldItalic); }catch(e){}
  const celA = 'CÉLULA DE MONITORAÇÃO ELETRÔNICA ';
  const celB = '- ';
  const celC = 'SECÇÃO CARIRI';
  const celW = fontTimesBold.widthOfTextAtSize(celA, 11) + fontTimesBold.widthOfTextAtSize(celB, 11) + fontItalic.widthOfTextAtSize(celC, 11);
  let celX = (595.32 - celW)/2;
  page.drawText(celA, { x: celX, y: 586.54, size: 11, font: fontTimesBold, color: rgb(0,0,0) });
  celX += fontTimesBold.widthOfTextAtSize(celA, 11);
  page.drawText(celB, { x: celX, y: 586.54, size: 11, font: fontTimesBold, color: rgb(0,0,0) });
  celX += fontTimesBold.widthOfTextAtSize(celB, 11);
  page.drawText(celC, { x: celX, y: 586.54, size: 11, font: fontItalic, color: rgb(0,0,0) });
  // Destinatário - x=170.09, y=558.91 (com quebra de linha para textos longos)
  page.drawText('Destinatário', { x: 170.09, y: 558.91, size: 12, font: fontTimesBold, color: rgb(0,0,0) });
  const destVal = (termo.destinatario || '').trim();
  if(destVal){
    const maxW = 595.32 - 235.25 - 40;
    let dSize = 12;
    let dTxt = ': ' + destVal;
    while(dSize > 8 && fontTimes.widthOfTextAtSize(dTxt, dSize) > maxW){ dSize -= 0.5; }
    if(fontTimes.widthOfTextAtSize(dTxt, dSize) <= maxW){
      page.drawText(dTxt, { x: 235.25, y: 558.91, size: dSize, font: fontTimes, color: rgb(0,0,0) });
      const fullW = fontTimes.widthOfTextAtSize(dTxt, dSize);
      page.drawLine({ start: {x: 235.25, y: 556.5}, end: {x: 235.25 + fullW + 10, y: 556.5}, thickness: 0.6, color: rgb(0,0,0) });
    } else {
      // quebra em 2 linhas
      const words = destVal.split(/\s+/);
      let l1 = ': ', l2 = '';
      for(const w of words){
        if(fontTimes.widthOfTextAtSize(l1 === ': ' ? ': '+w : l1 + ' ' + w, 10) <= maxW) l1 = l1 === ': ' ? ': '+w : l1 + ' ' + w;
        else l2 += (l2 ? ' ' : '') + w;
      }
      page.drawText(l1, { x: 235.25, y: 558.91, size: 10, font: fontTimes, color: rgb(0,0,0) });
      page.drawLine({ start: {x: 235.25, y: 556.5}, end: {x: 235.25 + fontTimes.widthOfTextAtSize(l1, 10) + 10, y: 556.5}, thickness: 0.6, color: rgb(0,0,0) });
      if(l2){
        page.drawText(l2, { x: 235.25, y: 545.5, size: 10, font: fontTimes, color: rgb(0,0,0) });
        page.drawLine({ start: {x: 235.25, y: 543.5}, end: {x: 235.25 + fontTimes.widthOfTextAtSize(l2, 10) + 10, y: 543.5}, thickness: 0.6, color: rgb(0,0,0) });
      }
    }
  } else {
    page.drawText(': _____________________________', { x: 235.25, y: 558.91, size: 12, font: fontTimes, color: rgb(0,0,0) });
  }
  // Tabela - coordenadas exatas (modo TZPR); modo UPR usa 2 colunas (UPR04+FONTE04)
  const tableLeft = 110.42;
  const tableRight = 484.90;
  const storedEq = Array.isArray(termo.equipamentos) ? termo.equipamentos : [];
  const dadosT = (termo.dados && typeof termo.dados === 'object') ? termo.dados : {};
  const modeloExp = termo.modelo || dadosT.modelo;
  let isUPR = modeloExp === 'upr';
  if(modeloExp !== 'upr' && modeloExp !== 'tzpr'){
    // sem indicação explícita (termos antigos): infere pelas chaves das linhas
    isUPR = storedEq.some(r => r && r.upr04 && !r.tzpr04 && !r.cinta && !r.trava);
  }
  const rowKeys = isUPR ? ['upr04', 'fonte04'] : ['tzpr04', 'fonte04', 'cinta', 'trava'];
  const colBounds = isUPR
    ? [tableLeft, (tableLeft + tableRight) / 2, tableRight]
    : [110.42, 220.76, 310.42, 370.42, 484.90];
  const colCenters = colBounds.slice(0, -1).map((x, i) => (x + colBounds[i + 1]) / 2);
  const hdrCols = isUPR ? ['UPR04', 'FONTE04'] : ['TZPR04', 'FONTE04', 'CINTA', 'TRAVA'];
  const hdrBounds = colBounds.slice(0, -1).map((x, i) => [x, colBounds[i + 1]]);
  // Dados: até 5 linhas usa o layout clássico exato; acima disso, tabela
  // fluida com paginação (mesma geometria de colunas/fontes)
  const normEq = r => ({
    tzpr04: String((r && r.tzpr04) || '').trim().substring(0, 18),
    upr04: String((r && (r.upr04 ?? r.tzpr04)) || '').trim().substring(0, 18),
    fonte04: String((r && r.fonte04) || '').trim().substring(0, 18),
    cinta: String((r && r.cinta) || '').trim().substring(0, 18),
    trava: String((r && r.trava) || '').trim().substring(0, 18)
  });
  const isFilled = r => rowKeys.some(k => r[k]);
  const filledEq = storedEq.map(normEq).filter(isFilled).slice(0, 30);
  const useFlow = filledEq.length > 5;
  const drawSigBlock = (p, lineY) => {
    if(termo.respEntrega){
      const rw = fontTimes.widthOfTextAtSize(String(termo.respEntrega), 9);
      p.drawText(String(termo.respEntrega), { x: (595.32 - rw)/2, y: lineY + 10, size: 9, font: fontTimes, color: rgb(0,0,0) });
    }
    p.drawLine({ start: {x: 60, y: lineY}, end: {x: 535.32, y: lineY}, thickness: 0.9, color: rgb(0,0,0) });
    p.drawText('RESPONSÁVEL PELA ENTREGA', { x: 207.89, y: lineY - 14.63, size: 12, font: fontTimesBold, color: rgb(0,0,0) });
    p.drawText('(', { x: 236.81, y: lineY - 28.43, size: 12, font: fontTimes, color: rgb(0,0,0) });
    p.drawText('RG/CPF/MATRICULA', { x: 240.41, y: lineY - 28.43, size: 12, font: fontTimes, color: rgb(0,0,0) });
    p.drawText(')', { x: 354.79, y: lineY - 28.43, size: 12, font: fontTimes, color: rgb(0,0,0) });
    if(termo.respRecebimento){
      const rw = fontTimes.widthOfTextAtSize(String(termo.respRecebimento), 9);
      p.drawText(String(termo.respRecebimento), { x: (595.32 - rw)/2, y: lineY - 62, size: 9, font: fontTimes, color: rgb(0,0,0) });
    }
    p.drawLine({ start: {x: 60, y: lineY - 72}, end: {x: 535.32, y: lineY - 72}, thickness: 0.9, color: rgb(0,0,0) });
    p.drawText('RESPONSÁVEL PELA RECEBIMENTO', { x: 193.49, y: lineY - 86.06, size: 12, font: fontTimesBold, color: rgb(0,0,0) });
    p.drawText('(', { x: 236.81, y: lineY - 99.86, size: 12, font: fontTimes, color: rgb(0,0,0) });
    p.drawText('RG/CPF/MATRICULA', { x: 240.41, y: lineY - 99.86, size: 12, font: fontTimes, color: rgb(0,0,0) });
    p.drawText(')', { x: 354.79, y: lineY - 99.86, size: 12, font: fontTimes, color: rgb(0,0,0) });
  };
  if(!useFlow){
  // Grade clássica exata (só neste modo): header y=490.39,
  // row tops 496.39,478.39,458.39,438.39,418.39,398.39, bottom 378.39
  page.drawRectangle({ x: tableLeft, y: 478.39, width: tableRight-tableLeft, height: 18, color: rgb(0.996, 0.89, 0.78), borderColor: rgb(0,0,0), borderWidth: 0.6 });
  hdrCols.forEach((h, i) => {
    const hw = fontTimesBold.widthOfTextAtSize(h, 11);
    const hx = (hdrBounds[i][0] + hdrBounds[i][1]) / 2 - hw / 2;
    page.drawText(h, { x: hx, y: 484.5, size: 11, font: fontTimesBold, color: rgb(0,0,0) });
  });
  for(let i=0;i<colBounds.length;i++){
    const x = colBounds[i];
    page.drawLine({ start: {x, y: 496.39}, end: {x, y: 378.39}, thickness: 0.6, color: rgb(0,0,0) });
  }
  for(const y of [496.39, 478.39, 458.39, 438.39, 418.39, 398.39, 378.39]){
    page.drawLine({ start: {x: tableLeft, y}, end: {x: tableRight, y}, thickness: 0.6, color: rgb(0,0,0) });
  }
  // 5 linhas clássicas, y central 468.39,448.39,428.39,408.39,388.39
  // Usa a lista filtrada (sem vazios) para não perder linhas extras
  // quando há vazios intercalados (ex.: prévia com linhas em branco).
  const classicEq = filledEq.slice();
  while(classicEq.length<5) classicEq.push({ tzpr04:'', fonte04:'', cinta:'', trava:'' });
  const rowYs = [468.39, 448.39, 428.39, 408.39, 388.39];
  for(let r=0;r<5;r++){
    const row = classicEq[r] || {};
    const vals = rowKeys.map(k => row[k]||'');
    for(let c=0;c<rowKeys.length;c++){
      const txt = String(vals[c]).trim().substring(0,18);
      if(txt){
        const tw = fontTimes.widthOfTextAtSize(txt, 9);
        page.drawText(txt, { x: colCenters[c] - tw/2, y: rowYs[r], size: 9, font: fontTimes, color: rgb(0,0,0) });
      }
    }
  }
  // Rodapé - linhas y=310 e y=238, textos em y=295.37,281.57,223.94,210.14
  page.drawLine({ start: {x: 60, y: 310}, end: {x: 535.32, y: 310}, thickness: 0.9, color: rgb(0,0,0) });
  page.drawText('RESPONSÁVEL PELA ENTREGA', { x: 207.89, y: 295.37, size: 12, font: fontTimesBold, color: rgb(0,0,0) });
  page.drawText('(', { x: 236.81, y: 281.57, size: 12, font: fontTimes, color: rgb(0,0,0) });
  page.drawText('RG/CPF/MATRICULA', { x: 240.41, y: 281.57, size: 12, font: fontTimes, color: rgb(0,0,0) });
  page.drawText(')', { x: 354.79, y: 281.57, size: 12, font: fontTimes, color: rgb(0,0,0) });
  if(termo.respEntrega){
    const rw = fontTimes.widthOfTextAtSize(String(termo.respEntrega), 9);
    page.drawText(String(termo.respEntrega), { x: (595.32 - rw)/2, y: 320, size: 9, font: fontTimes, color: rgb(0,0,0) });
  }
  page.drawLine({ start: {x: 60, y: 238}, end: {x: 535.32, y: 238}, thickness: 0.9, color: rgb(0,0,0) });
  page.drawText('RESPONSÁVEL PELA RECEBIMENTO', { x: 193.49, y: 223.94, size: 12, font: fontTimesBold, color: rgb(0,0,0) });
  page.drawText('(', { x: 236.81, y: 210.14, size: 12, font: fontTimes, color: rgb(0,0,0) });
  page.drawText('RG/CPF/MATRICULA', { x: 240.41, y: 210.14, size: 12, font: fontTimes, color: rgb(0,0,0) });
  page.drawText(')', { x: 354.79, y: 210.14, size: 12, font: fontTimes, color: rgb(0,0,0) });
  if(termo.respRecebimento){
    const rw = fontTimes.widthOfTextAtSize(String(termo.respRecebimento), 9);
    page.drawText(String(termo.respRecebimento), { x: (595.32 - rw)/2, y: 248, size: 9, font: fontTimes, color: rgb(0,0,0) });
  }
  } else {
  // Tabela fluida com paginação
  const ROW_H = 20, BOTTOM = 70, NEWTOP = 760;
  const drawFlowHeader = (p, top) => {
    p.drawRectangle({ x: tableLeft, y: top - 18, width: tableRight - tableLeft, height: 18, color: rgb(0.996, 0.89, 0.78), borderColor: rgb(0,0,0), borderWidth: 0.6 });
    hdrCols.forEach((h, i) => {
      const hw = fontTimesBold.widthOfTextAtSize(h, 11);
      p.drawText(h, { x: (hdrBounds[i][0] + hdrBounds[i][1]) / 2 - hw / 2, y: top - 11.5, size: 11, font: fontTimesBold, color: rgb(0,0,0) });
    });
    p.drawLine({ start: {x: tableLeft, y: top}, end: {x: tableRight, y: top}, thickness: 0.6, color: rgb(0,0,0) });
  };
  const drawVerticals = (p, yTop, yBottom) => {
    for(const x of colBounds) p.drawLine({ start: {x, y: yTop}, end: {x, y: yBottom}, thickness: 0.6, color: rgb(0,0,0) });
  };
  let pg = page, top = 496.39, segTop = 496.39;
  drawFlowHeader(pg, top);
  top -= 18;
  for(const row of filledEq){
    if(top - ROW_H < BOTTOM){
      drawVerticals(pg, segTop, top);
      pg = pdfDoc.addPage([595.32, 841.92]);
      top = NEWTOP; segTop = NEWTOP;
      drawFlowHeader(pg, top);
      top -= 18;
    }
    const vals = rowKeys.map(k => row[k]);
    for(let c=0;c<rowKeys.length;c++){
      const txt = String(vals[c] || '').trim().substring(0, 24);
      if(txt){
        const tw = fontTimes.widthOfTextAtSize(txt, 9);
        pg.drawText(txt, { x: colCenters[c] - tw/2, y: top - 10, size: 9, font: fontTimes, color: rgb(0,0,0) });
      }
    }
    top -= ROW_H;
    pg.drawLine({ start: {x: tableLeft, y: top}, end: {x: tableRight, y: top}, thickness: 0.6, color: rgb(0,0,0) });
  }
  drawVerticals(pg, segTop, top);
  // Assinaturas na mesma página quando há espaço (bloco ocupa ~115pt
  // abaixo de sigY); só abre página nova se realmente não couber.
  let sigY = top - 48;
  if(sigY < 150){ pg = pdfDoc.addPage([595.32, 841.92]); sigY = 730; }
  drawSigBlock(pg, sigY);
  }
  const pdfBytes = await pdfDoc.save();
  return pdfBytes;
}

// PDF Termo de Recolhimento (unidades penais) - grade de cartoes 3 colunas
async function gerarTermoRecolhimentoPDF(termo){
  const d = (termo.dados && typeof termo.dados === 'object') ? termo.dados : {};
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const PW = 595.32, PH = 841.92;
  const M = 32;
  let logoPng = null;
  try{
    const logoPath = path.join(ROOT, 'public', 'logo-governo-ce.png');
    if(fs.existsSync(logoPath)) logoPng = await pdfDoc.embedPng(fs.readFileSync(logoPath));
  }catch(e){}
  const eqList = Array.isArray(d.equipamentos) ? d.equipamentos : [];
  const CHECKS = [
    ['ladoExterno', 'LADO EXTERNO'], ['cinta', 'CINTA'], ['travas', 'TRAVAS'],
    ['ladoInterno', 'LADO INTERNO'], ['abaDireita', 'ABA DIREITA'], ['abaEsquerda', 'ABA ESQUERDA']
  ];
  function drawCheckbox(pg, x, y, marked){
    const s = 8;
    pg.drawRectangle({ x, y: y - s, width: s, height: s, borderColor: rgb(0,0,0), borderWidth: 0.8, color: rgb(1,1,1) });
    if(marked){
      pg.drawLine({ start: {x: x+1.2, y: y-1.5}, end: {x: x+s-1.2, y: y-s+1.2}, thickness: 1.1, color: rgb(0,0,0) });
      pg.drawLine({ start: {x: x+1.2, y: y-s+1.2}, end: {x: x+s-1.2, y: y-1.5}, thickness: 1.1, color: rgb(0,0,0) });
    }
  }
  function drawCheckRow(pg, x, y, w, label, val){
    pg.drawText(label, { x, y: y - 7.5, size: 7, font: fontBold, color: rgb(0,0,0) });
    const simX = x + w - 62, naoX = x + w - 31;
    pg.drawText('SIM', { x: simX, y: y - 7.5, size: 6.5, font, color: rgb(0,0,0) });
    drawCheckbox(pg, simX + 15, y, val === true);
    pg.drawText('NÃO', { x: naoX, y: y - 7.5, size: 6.5, font, color: rgb(0,0,0) });
    drawCheckbox(pg, naoX + 16, y, val === false);
    const labelW = fontBold.widthOfTextAtSize(label, 7);
    const dotsW = simX - 3 - (x + labelW + 2);
    if(dotsW > 4){
      const dotW = font.widthOfTextAtSize('.', 7);
      const n = Math.floor(dotsW / dotW);
      pg.drawText('.'.repeat(n), { x: x + labelW + 2, y: y - 7.5, size: 7, font, color: rgb(0,0,0) });
    }
  }
  function drawCard(pg, x, yTop, w, ev){
    const h = 108;
    const yBot = yTop - h;
    pg.drawRectangle({ x, y: yBot, width: w, height: h, borderColor: rgb(0,0,0), borderWidth: 1, color: rgb(1,1,1) });
    const headTxt = 'N°:' + (ev.numero || '') + (ev.danificado ? ' DANIFICADO' : '');
    const headW = fontBold.widthOfTextAtSize(headTxt, 8);
    pg.drawText(headTxt, { x: x + (w - headW)/2, y: yTop - 13, size: 8, font: fontBold, color: rgb(0,0,0) });
    let ry = yTop - 24;
    CHECKS.forEach(([k, label])=>{
      const v = ev.checks ? ev.checks[k] : null;
      const vv = (v === true || v === 'sim') ? true : (v === false || v === 'nao') ? false : null;
      drawCheckRow(pg, x + 7, ry, w - 14, label, vv);
      ry -= 13.2;
    });
    return h;
  }
  function drawHeader(pg){
    let y = PH - 34;
    pg.drawText('POLÍCIA PENAL', { x: M, y, size: 13, font: fontBold, color: rgb(0,0,0) });
    pg.drawText('Coordenadoria de Monitoração', { x: M, y: y - 11, size: 7.5, font: fontBold, color: rgb(0,0,0) });
    pg.drawText('Eletrônica de Pessoas - COMEP', { x: M, y: y - 20, size: 7.5, font: fontBold, color: rgb(0,0,0) });
    if(logoPng){
      const lw = 58, lh = lw * (logoPng.height / logoPng.width);
      pg.drawImage(logoPng, { x: PW - M - 168, y: y - 4 - lh + 14, width: lw, height: lh });
    }
    const ceara = 'CEARÁ';
    const cearaW = fontBold.widthOfTextAtSize(ceara, 20);
    pg.drawText(ceara, { x: PW - M - cearaW, y, size: 20, font: fontBold, color: rgb(0.18,0.28,0.36) });
    const g1 = 'GOVERNO DO ESTADO';
    pg.drawText(g1, { x: PW - M - fontBold.widthOfTextAtSize(g1, 7.5), y: y - 11, size: 7.5, font: fontBold, color: rgb(0,0,0) });
    const g2 = 'SECRETARIA DA ADMINISTRAÇÃO';
    pg.drawText(g2, { x: PW - M - font.widthOfTextAtSize(g2, 6), y: y - 19, size: 6, font, color: rgb(0,0,0) });
    const g3 = 'PENITENCIÁRIA E RESSOCIALIZAÇÃO';
    pg.drawText(g3, { x: PW - M - font.widthOfTextAtSize(g3, 6), y: y - 26, size: 6, font, color: rgb(0,0,0) });
    y -= 44;
    const t1 = 'TERMO DE RECOLHIMENTO ENTREGUES PELAS UNIDADES PENAIS';
    pg.drawText(t1, { x: (PW - fontBold.widthOfTextAtSize(t1, 10.5))/2, y, size: 10.5, font: fontBold, color: rgb(0,0,0) });
    y -= 12;
    const t2 = 'UNIDADE DE MONITORAMENTO ELETRONICO DE PESSOAS – NUCLEO JUAZEIRO';
    pg.drawText(t2, { x: (PW - fontBold.widthOfTextAtSize(t2, 8))/2, y, size: 8, font: fontBold, color: rgb(0,0,0) });
    return y - 14;
  }
  const perFirst = 12, perNext = 15;
  const pages = [];
  let rest = eqList.slice();
  pages.push(rest.slice(0, perFirst)); rest = rest.slice(perFirst);
  while(rest.length){ pages.push(rest.slice(0, perNext)); rest = rest.slice(perNext); }
  if(!pages[0].length) pages[0] = [];
  const dh = d.dataHora ? new Date(d.dataHora) : new Date();
  const dhTxt = isNaN(dh) ? '' : dh.toLocaleDateString('pt-BR') + ' ' + String(dh.getHours()).padStart(2,'0') + ':' + String(dh.getMinutes()).padStart(2,'0') + 'h';
  for(let pi=0; pi<pages.length; pi++){
    const pg = pdfDoc.addPage([PW, PH]);
    const isLast = pi === pages.length - 1;
    let y = drawHeader(pg);
    if(pi === 0){
      const boxH = 26;
      const leftW = PW - 2*M - 150;
      pg.drawRectangle({ x: M, y: y - boxH, width: leftW, height: boxH, borderColor: rgb(0,0,0), borderWidth: 1, color: rgb(1,1,1) });
      pg.drawText('Itens Rebidos: ' + (d.itensRecebidos || ''), { x: M + 6, y: y - 17, size: 8.5, font, color: rgb(0,0,0) });
      pg.drawRectangle({ x: M + leftW + 8, y: y - boxH, width: 142, height: boxH, borderColor: rgb(0,0,0), borderWidth: 1, color: rgb(1,1,1) });
      const dhW = font.widthOfTextAtSize(dhTxt, 8.5);
      pg.drawText(dhTxt, { x: M + leftW + 8 + (142 - dhW)/2, y: y - 17, size: 8.5, font, color: rgb(0,0,0) });
      y -= boxH + 8;
      const barH = 20;
      pg.drawRectangle({ x: M, y: y - barH, width: PW - 2*M, height: barH, color: rgb(0.82,0.82,0.82), borderColor: rgb(0,0,0), borderWidth: 1 });
      const barT = 'DESCRIÇÃO DO EQUIPAMENTOS';
      pg.drawText(barT, { x: (PW - fontBold.widthOfTextAtSize(barT, 9.5))/2, y: y - 14, size: 9.5, font: fontBold, color: rgb(0,0,0) });
      y -= barH + 10;
    } else {
      y -= 4;
    }
    const gap = 10, cols = 3;
    const cardW = (PW - 2*M - gap*(cols-1)) / cols;
    const cardH = 108, rowGap = 10;
    const list = pages[pi];
    for(let i=0;i<list.length;i++){
      const c = i % cols, r = Math.floor(i / cols);
      const cx = M + c * (cardW + gap);
      const cyTop = y - r * (cardH + rowGap);
      drawCard(pg, cx, cyTop, cardW, list[i]);
    }
    const rowsUsed = Math.ceil(list.length / cols);
    y = y - rowsUsed * (cardH + rowGap);
    if(isLast){
      y -= 2;
      const descLines = d.descricao ? String(d.descricao).split('\n').slice(0,6) : [];
      const descH = 52;
      pg.drawRectangle({ x: M, y: y - descH, width: PW - 2*M, height: descH, borderColor: rgb(0,0,0), borderWidth: 1, color: rgb(1,1,1) });
      pg.drawText('Descrição:', { x: M + 6, y: y - 14, size: 8.5, font, color: rgb(0,0,0) });
      descLines.forEach((ln, i)=>{ pg.drawText(String(ln).slice(0,110), { x: M + 6, y: y - 26 - i*10, size: 8, font, color: rgb(0,0,0) }); });
      y -= descH + 18;
      pg.drawText('Assinatura:', { x: M, y, size: 8.5, font: fontBold, color: rgb(0,0,0) });
      const assW = fontBold.widthOfTextAtSize('Assinatura: ', 8.5);
      pg.drawLine({ start: {x: M + assW, y: y - 2}, end: {x: M + 400, y: y - 2}, thickness: 0.7, color: rgb(0,0,0) });
      y -= 34;
      const midX = M + (PW - 2*M)/2;
      pg.drawLine({ start: {x: M + 10, y}, end: {x: midX - 10, y}, thickness: 0.8, color: rgb(0,0,0) });
      pg.drawLine({ start: {x: midX + 10, y}, end: {x: PW - M - 10, y}, thickness: 0.8, color: rgb(0,0,0) });
      const pol = 'Policial penal / Mat.';
      const tec = 'Técnico / Mat.';
      pg.drawText(pol, { x: M + 10 + ((midX-20) - font.widthOfTextAtSize(pol, 7.5))/2, y: y - 11, size: 7.5, font, color: rgb(0,0,0) });
      pg.drawText(tec, { x: midX + 10 + ((PW-M-10-(midX+10)) - font.widthOfTextAtSize(tec, 7.5))/2, y: y - 11, size: 7.5, font, color: rgb(0,0,0) });
      if(d.policialNome || d.policialMat){
        const pn = [d.policialNome, d.policialMat].filter(Boolean).join(' - ').slice(0,45);
        pg.drawText(pn, { x: M + 10 + ((midX-20) - font.widthOfTextAtSize(pn, 7))/2, y: y + 9, size: 7, font, color: rgb(0,0,0) });
      }
      if(d.tecnicoNome || d.tecnicoMat){
        const tn = [d.tecnicoNome, d.tecnicoMat].filter(Boolean).join(' - ').slice(0,45);
        pg.drawText(tn, { x: midX + 10 + ((PW-M-10-(midX+10)) - font.widthOfTextAtSize(tn, 7))/2, y: y + 9, size: 7, font, color: rgb(0,0,0) });
      }
      y -= 26;
      const foot = 'Unidade de Monitoração Eletrônica – UMEP Rua das Flores, S/N - Santa Tereza, Juazeiro do Norte - CE, 63050-325 Contatos: (88)35115726 Email: comep.cariri@sap.ce.gov.br';
      const footW = fontBold.widthOfTextAtSize(foot, 5.5);
      pg.drawText(foot, { x: Math.max(M, (PW - footW)/2), y: Math.max(28, y), size: 5.5, font: fontBold, color: rgb(0,0,0) });
    }
  }
  const pdfBytes = await pdfDoc.save();
  return pdfBytes;
}
// PDF Termo de Recolhimento de Equipamento (UNEPE Juazeiro do Norte)
// Reproduz o layout do documento Word "TERMO DE RECOLHIMENTO DE EQUIPAMENTO 2025":
// caixas de cantos arredondados, faixas de título cinza (#C3C3C3 borda #A5A5A5 e #A0A0A0),
// caixas brancas com checkbox, logos e rodapé idênticos ao modelo.
async function gerarTermoRecolhimentoEquipamentoPDF(termo){
  const d = (termo.dados && typeof termo.dados === 'object') ? termo.dados : {};
  const eqs = Array.isArray(d.equipamentos) ? d.equipamentos : [];
  const eq0 = eqs[0] || {};
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const PW = 595.32, PH = 841.92;
  const BLACK = rgb(0,0,0);
  const GRAY_FILL = rgb(0xC3/255, 0xC3/255, 0xC3/255);
  const GRAY_LINE = rgb(0xA5/255, 0xA5/255, 0xA5/255);
  const TITLE_FILL = rgb(0xA0/255, 0xA0/255, 0xA0/255);
  let logoBadge = null, logoSpace = null;
  try{
    const p = path.join(ROOT, 'public', 'logo-policia-penal-badge.png');
    if(fs.existsSync(p)) logoBadge = await pdfDoc.embedPng(fs.readFileSync(p));
  }catch(e){}
  try{
    const p = path.join(ROOT, 'public', 'logo-spacecomm.png');
    if(fs.existsSync(p)) logoSpace = await pdfDoc.embedPng(fs.readFileSync(p));
  }catch(e){}
  const v = (x) => (x == null ? '' : String(x)).trim();
  const dataHoraTxt = (()=>{
    if(d.dataHora){
      const dt = new Date(d.dataHora);
      if(!isNaN(dt)){
        const p = n => String(n).padStart(2,'0');
        const ini = p(dt.getHours()) + ':' + p(dt.getMinutes());
        const fim = v(d.horaFim) || '____:____';
        return dt.toLocaleDateString('pt-BR') + '  De ' + ini + 'h às ' + fim + 'h';
      }
    }
    return '____/____/____  De ____:____h às ____:____h';
  })();
  const pg = pdfDoc.addPage([PW, PH]);
  const X = 16;                       // borda esquerda do formulário (como no modelo)
  const FR = PW - X;                  // borda direita
  const yTop = PH - 14;
  // ---------- Cabeçalho: logos + título ----------
  if(logoBadge){
    const h = 58, w = h * (logoBadge.width / logoBadge.height);
    pg.drawImage(logoBadge, { x: X + 2, y: yTop - h, width: w, height: h });
  }
  if(logoSpace){
    const w = 205, h = w * (logoSpace.height / logoSpace.width);
    pg.drawImage(logoSpace, { x: FR - w, y: yTop - h - 2, width: w, height: h });
  }
  const title = 'TERMO DE RECOLHIMENTO';
  pg.drawText(title, { x: (PW - fontBold.widthOfTextAtSize(title, 14))/2, y: yTop - 82, size: 14, font: fontBold, color: BLACK });
  // ---------- helpers ----------
  function rr(x, y, w, h, txt, o){
    o = o || {};
    pg.drawRectangle({ x, y, width: w, height: h, color: o.fill || rgb(1,1,1), borderColor: o.line || BLACK, borderWidth: o.lw == null ? 1 : o.lw });
    if(txt){
      const f = o.bold === false ? font : fontBold;
      const size = o.size || 8.5;
      const maxW = w - 7;
      const words = String(txt).split(' ');
      const lines = []; let ln = '';
      words.forEach(wd=>{
        const t2 = ln ? ln + ' ' + wd : wd;
        if(f.widthOfTextAtSize(t2, size) <= maxW || !ln) ln = t2;
        else { lines.push(ln); ln = wd; }
      });
      if(ln) lines.push(ln);
      const lh = size * 1.15;
      let ty = y + h/2 + (lines.length * lh)/2 - lh + size * 0.34;
      lines.forEach(l=>{
        pg.drawText(l, { x: o.align === 'left' ? x + 3.5 : x + (w - f.widthOfTextAtSize(l, size))/2, y: ty, size, font: f, color: BLACK });
        ty -= lh;
      });
    }
  }
  function ckbx(cx, cy, s, marked){
    pg.drawRectangle({ x: cx, y: cy, width: s, height: s, borderColor: BLACK, borderWidth: 0.9, color: rgb(1,1,1) });
    if(marked){
      pg.drawLine({ start: { x: cx+1.1, y: cy+s-1.4 }, end: { x: cx+s-1.3, y: cy+1.1 }, thickness: 1.05, color: BLACK });
      pg.drawLine({ start: { x: cx+1.1, y: cy+1.1 }, end: { x: cx+s-1.3, y: cy+s-1.4 }, thickness: 1.05, color: BLACK });
    }
  }
  const B = 8.6; // tamanho do quadrado do checkbox
  function snBox(x, y, w, h, label, marked){
    rr(x, y, w, h, '', {});
    const size = 8.5;
    const lw = fontBold.widthOfTextAtSize(label, size);
    const total = lw + 2.6 + B;
    const tx = x + (w - total)/2, ty = y + h/2 - size*0.34;
    pg.drawText(label, { x: tx, y: ty, size, font: fontBold, color: BLACK });
    ckbx(tx + lw + 2.6, y + h/2 - B/2, B, marked);
  }
  function chkBox(x, y, w, h, marked){
    rr(x, y, w, h, '', {});
    ckbx(x + w/2 - B/2, y + h/2 - B/2, B, marked);
  }
  // dados preenchidos
  const nomeMon = v(d.nomeMonitorado);
  const ck = (k) => { const val = eq0.checks ? eq0.checks[k] : null; return val === true || val === 'sim'; };
  // ---------- Faixas cinza superiores (#A0A0A0): MONITORADO(A) + Data/Hora ----------
  const bandH = 25, bandY = yTop - 108;
  const leftW = 356, gap = 8, rightW = FR - (X + leftW + gap);
  rr(X, bandY, leftW, bandH, '', { fill: TITLE_FILL, lw: 1 });
  {
    const size = 10;
    const label = 'MONITORADO(A): ';
    const nomeTxt = nomeMon || '_____________________________________';
    const full = label + nomeTxt;
    const wAll = fontBold.widthOfTextAtSize(full, size);
    const startX = X + (leftW - Math.min(wAll, leftW - 8))/2;
    if(wAll <= leftW - 8){
      pg.drawText(full, { x: startX, y: bandY + bandH/2 - size*0.34, size, font: fontBold, color: BLACK });
    } else {
      let nm = nomeTxt;
      while(nm.length > 4 && fontBold.widthOfTextAtSize(label + nm, size) > leftW - 8) nm = nm.slice(0, -1);
      pg.drawText(label + nm, { x: startX, y: bandY + bandH/2 - size*0.34, size, font: fontBold, color: BLACK });
    }
  }
  rr(X + leftW + gap, bandY, rightW, bandH, '', { fill: TITLE_FILL, lw: 1 });
  {
    const size = 10;
    const t = 'Data/Hora: ' + dataHoraTxt;
    pg.drawText(t, { x: X + leftW + gap + 5, y: bandY + bandH/2 - size*0.34, size, font: fontBold, color: BLACK });
  }
  // ---------- Linha 2: Nº do equipamento + Nº do termo ----------
  const numY = bandY - bandH - 4;
  const numH = 24;
  const nums = eqs.map(e=>v(e.numero)).filter(Boolean);
  const numTxt = 'Nº: ' + (nums.length ? nums.slice(0,3).join(', ') : '______________');
  const halfW = (FR - X - 8)/2;
  rr(X, numY, halfW, numH, '', { lw: 1 });
  {
    const size = 9;
    pg.drawText(numTxt, { x: X + (halfW - fontBold.widthOfTextAtSize(numTxt, size))/2, y: numY + numH/2 - size*0.34, size, font: fontBold, color: BLACK });
  }
  const num2Txt = 'Nº: ' + (v(d.numeroTermo) || '______________');
  rr(X + halfW + 8, numY, halfW, numH, '', { lw: 1 });
  {
    const size = 9;
    pg.drawText(num2Txt, { x: X + halfW + 8 + (halfW - fontBold.widthOfTextAtSize(num2Txt, size))/2, y: numY + numH/2 - size*0.34, size, font: fontBold, color: BLACK });
  }
  // ---------- Caixas de identificação (Id. monitorado / Perfil / Estabelecimento) ----------
  const idRows = [
    ['Id. monitorado:', v(d.idMonitorado)],
    ['Perfil:', v(d.perfil)],
    ['Estabelecimento:', v(d.estabelecimento)]
  ];
  const idH = 21, idGap = 2.5, idY0 = numY + numH + 4;
  idRows.forEach(([k, val], i)=>{
    const yy = idY0 - (i+1)*(idH + idGap) + idGap;
    rr(X + halfW + 8, yy, halfW, idH, '', { fill: TITLE_FILL, lw: 1 });
    const size = 7.8;
    pg.drawText(k, { x: X + halfW + 12, y: yy + idH/2 - size*0.34, size, font: fontBold, color: BLACK });
    const kx = X + halfW + 12 + fontBold.widthOfTextAtSize(k, size) + 3;
    pg.drawText(String(val || '').slice(0, 30), { x: kx, y: yy + idH/2 - size*0.34, size, font: fontBold, color: BLACK });
  });
  // ---------- 1) INSPEÇÃO NO DISPOSITIVO ----------
  let y = idY0 - 3*(idH + idGap) - 6;
  const secH = 21;
  const secW1 = 336;
  rr(X, y - secH, secW1, secH, '1)  INSPEÇÃO NO DISPOSITIVO', { fill: GRAY_FILL, line: GRAY_LINE, lw: 0.5, size: 9, align: 'left' });
  const secW2 = FR - X - secW1 - 4;
  rr(X + secW1 + 4, y - secH, secW2, secH, 'SISTEMA DE MONITORAÇÃO ELETRÔNICA', { fill: GRAY_FILL, line: GRAY_LINE, lw: 0.5, size: 9 });
  y -= secH;
  // linha: ANTES DA RETIRADA | Nº equipamento ☐
  const rowA = y - 2.5;
  rr(X, rowA - 21, 268, 21, ' ANTES DA RETIRADA', { fill: GRAY_FILL, line: GRAY_LINE, lw: 0.5, size: 9, align: 'left' });
  {
    const bw = 118, bh = 21;
    rr(X + 272, rowA - bh, bw, bh, v(eq0.numero) || 'SAC24 - CE02', { size: 8.5 });
    chkBox(X + 272 + bw + 4, rowA - bh, 56, bh, false);
  }
  y = rowA - 21;
  // linha: TZPR (LADO EXTERNO) + SIM/NÃO | Nº equipamento 2 ☐
  const rowB = y - 2.5;
  const lblW = 190, snW = 55;
  rr(X, rowB - 20, lblW, 20, 'TZPR (LADO EXTERNO)', { size: 8.5 });
  snBox(X + lblW + 4, rowB - 20, snW, 20, 'SIM', ck('ladoExterno'));
  snBox(X + lblW + 4 + snW + 4, rowB - 20, snW, 20, 'NÃO', !ck('ladoExterno'));
  const eq1 = eqs[1] || {};
  rr(X + 272, rowB - 20, 118, 20, v(eq1.numero) || 'SAC24 - CE01', { size: 8.5 });
  chkBox(X + 272 + 118 + 4, rowB - 20, 56, 20, false);
  y = rowB - 20;
  // linha: CINTA DE FIXAÇÃO + SIM/NÃO | ESTADO DE APRESENTAÇÃO DO EQUIPAMENTO
  const rowC = y - 2.5;
  rr(X, rowC - 20, lblW, 20, 'CINTA DE FIXAÇÃO', { size: 8.5 });
  snBox(X + lblW + 4, rowC - 20, snW, 20, 'SIM', ck('cinta'));
  snBox(X + lblW + 4 + snW + 4, rowC - 20, snW, 20, 'NÃO', !ck('cinta'));
  rr(X + 272, rowC - 20, secW2 + 4, 20, 'ESTADO DE APRESENTAÇÃO DO EQUIPAMENTO', { fill: GRAY_FILL, line: GRAY_LINE, lw: 0.5, size: 9 });
  y = rowC - 20;
  // linha: TRAVAS + SIM/NÃO | DESLIGADO ☐ LIGADO ☐ SEM EQUIP. ☐
  const rowD = y - 2.5;
  rr(X, rowD - 20, lblW, 20, 'TRAVAS', { size: 8.5 });
  snBox(X + lblW + 4, rowD - 20, snW, 20, 'SIM', ck('travas'));
  snBox(X + lblW + 4 + snW + 4, rowD - 20, snW, 20, 'NÃO', !ck('travas'));
  {
    const bw = (FR - X - 272 - 8)/3;
    [['DESLIGADO', false], ['LIGADO', false], ['SEM EQUIP.', false]].forEach(([t, m], i)=>{
      const bx = X + 272 + i*(bw + 4);
      rr(bx, rowD - 20, bw, 20, t, { size: 7.5 });
      ckbx(bx + bw - B - 3.5, rowD - 20 + 10 - B/2, B, m);
    });
  }
  y = rowD - 20;
  // linha: FONTE ) + SIM/NÃO | SIM ☐ NÃO ☐ (fonte)
  const rowE = y - 2.5;
  rr(X, rowE - 20, lblW, 20, 'FONTE )', { size: 8.5 });
  snBox(X + lblW + 4, rowE - 20, snW, 20, 'SIM', ck('fonte'));
  snBox(X + lblW + 4 + snW + 4, rowE - 20, snW, 20, 'NÃO', !ck('fonte'));
  {
    const bw = (FR - X - 272 - 8)/3;
    rr(X + 272, rowE - 20, bw, 20, 'SIM', { size: 8.5 });
    ckbx(X + 272 + bw - B - 3.5, rowE - 20 + 10 - B/2, B, ck('fonteCE01'));
    rr(X + 272 + bw + 4, rowE - 20, bw, 20, 'NÃO', { size: 8.5 });
    ckbx(X + 272 + bw + 4 + bw - B - 3.5, rowE - 20 + 10 - B/2, B, !ck('fonteCE01'));
  }
  y = rowE - 20;
  // ---------- DEPOIS DA RETIRADA ----------
  const rowF = y - 3;
  rr(X, rowF - 21, FR - X, 21, ' DEPOIS DA RETIRADA', { fill: GRAY_FILL, line: GRAY_LINE, lw: 0.5, size: 9, align: 'left' });
  y = rowF - 21;
  // ---------- 2) INSPECIONADO O EQUIPAMENTO | DANIFICADO ----------
  const rowG = y - 2.5;
  const gW = (FR - X - 4)/2;
  rr(X, rowG - 20, gW, 20, '2)  INSPECIONADO O EQUIPAMENTO', { fill: GRAY_FILL, line: GRAY_LINE, lw: 0.5, size: 9, align: 'left' });
  rr(X + gW + 4, rowG - 20, gW, 20, 'DANIFICADO', { fill: GRAY_FILL, line: GRAY_LINE, lw: 0.5, size: 9 });
  // linhas: TZPR (LADO INTERNO) / ABA DIREITA / ABA ESQUERDA com SIM/NÃO largos
  const lbl2W = 280, sn2W = 120;
  const eqCheck = (label, key, rowY)=>{
    rr(X, rowY - 20, lbl2W, 20, label, { size: 8.5 });
    snBox(X + lbl2W + 4, rowY - 20, sn2W, 20, 'SIM', ck(key));
    snBox(X + lbl2W + 4 + sn2W + 4, rowY - 20, sn2W, 20, 'NÃO', !ck(key));
  };
  eqCheck('TZPR (LADO INTERNO)', 'ladoInterno', rowG - 24);
  eqCheck('ABA DIREITA', 'abaDireita', rowG - 46);
  eqCheck('ABA ESQUERDA', 'abaEsquerda', rowG - 68);
  y = rowG - 92;
  // ---------- 2) DESCRIÇÃO DA DESATIVAÇÃO ----------
  const rowH = y - 3;
  rr(X, rowH - 21, FR - X, 21, '2)  DESCRIÇÃO DA DESATIVAÇÃO', { fill: GRAY_FILL, line: GRAY_LINE, lw: 0.5, size: 9, align: 'left' });
  y = rowH - 21;
  // linha de datas
  const dtsY = y - 13;
  const d1 = d.monitoradoDesde ? (()=>{ const dd = new Date(d.monitoradoDesde); return isNaN(dd) ? String(d.monitoradoDesde) : dd.toLocaleDateString('pt-BR'); })() : '____/____/_____';
  const d2 = d.desativadoDesde ? (()=>{ const dd = new Date(d.desativadoDesde); return isNaN(dd) ? String(d.desativadoDesde) : dd.toLocaleDateString('pt-BR'); })() : '____/____/_____';
  pg.drawText('Monitorado desde: ', { x: X + 6, y: dtsY, size: 9, font: fontBold, color: BLACK });
  let tx = X + 6 + fontBold.widthOfTextAtSize('Monitorado desde: ', 9);
  pg.drawText(d1, { x: tx, y: dtsY, size: 9, font, color: BLACK });
  tx += font.widthOfTextAtSize(d1, 9) + 12;
  pg.drawText('//', { x: tx, y: dtsY, size: 9, font, color: BLACK });
  tx += font.widthOfTextAtSize('//', 9) + 12;
  pg.drawText('Desativado desde: ', { x: tx, y: dtsY, size: 9, font: fontBold, color: BLACK });
  tx += fontBold.widthOfTextAtSize('Desativado desde: ', 9);
  pg.drawText(d2, { x: tx, y: dtsY, size: 9, font, color: BLACK });
  y = dtsY - 4;
  // caixa de descrição + caixinha de carimbo à direita
  const descH = 84;
  rr(X, y - descH, FR - X, descH, '', {});
  {
    const txt = v(d.descricao);
    const size = 9, maxW = FR - X - 90;
    const words = txt.split(' ').filter(Boolean);
    const lines = []; let ln = '';
    words.forEach(wd=>{
      const t2 = ln ? ln + ' ' + wd : wd;
      if(font.widthOfTextAtSize(t2, size) <= maxW || !ln) ln = t2;
      else { lines.push(ln); ln = wd; }
    });
    if(ln) lines.push(ln);
    lines.slice(0, 7).forEach((l, i)=>{
      pg.drawText(l, { x: X + 5, y: y - 12 - i * 10.5, size, font, color: BLACK });
    });
  }
  y -= descH;
  // linha CPF/RG + assinatura do monitorado
  const cpfY = y - 18;
  const cpfTxt = 'CPF/RG ' + (v(d.cpfRg) || '________________');
  pg.drawText(cpfTxt, { x: X + 340, y: cpfY, size: 9, font, color: BLACK });
  const assY = cpfY - 16;
  pg.drawText('ASSINATURA___________________________________________________', { x: X + 6, y: assY, size: 9, font, color: BLACK });
  // ---------- Assinaturas policial / técnico ----------
  const sy = assY - 38;
  const midX = PW/2;
  pg.drawLine({ start: { x: X + 10, y: sy }, end: { x: midX - 24, y: sy }, thickness: 0.8, color: BLACK });
  pg.drawLine({ start: { x: midX + 24, y: sy }, end: { x: FR - 10, y: sy }, thickness: 0.8, color: BLACK });
  const polName = [v(d.policialNome), v(d.policialMat) ? 'Mat ' + v(d.policialMat) : ''].filter(Boolean).join(' / ');
  const tecName = [v(d.tecnicoNome), v(d.tecnicoMat) ? 'Mat ' + v(d.tecnicoMat) : ''].filter(Boolean).join(' / ');
  if(polName) pg.drawText(polName, { x: X + 10 + ((midX - 34 - (X + 10)) - font.widthOfTextAtSize(polName, 8))/2, y: sy + 5, size: 8, font, color: BLACK });
  if(tecName) pg.drawText(tecName, { x: midX + 24 + ((FR - 10 - (midX + 24)) - font.widthOfTextAtSize(tecName, 8))/2, y: sy + 5, size: 8, font, color: BLACK });
  const polL = 'Policial penal Mat.';
  const tecL = 'Técnico responsável';
  pg.drawText(polL, { x: X + 10 + ((midX - 34 - (X + 10)) - fontBold.widthOfTextAtSize(polL, 8))/2, y: sy - 11, size: 8, font: fontBold, color: BLACK });
  pg.drawText(tecL, { x: midX + 24 + ((FR - 10 - (midX + 24)) - fontBold.widthOfTextAtSize(tecL, 8))/2, y: sy - 11, size: 8, font: fontBold, color: BLACK });
  // ---------- Rodapé (igual ao modelo) ----------
  const foot = 'Coordenadoria de Monitoração Eletrônica de Pessoas – COMEP';
  const foot2 = 'Rua Tenente Benévolo, 1055 – Meireles';
  const foot3 = 'CEP: 60.160-041 – Fortaleza – Ceará – Fone: (85) 98222-0029';
  const fy = Math.max(38, sy - 32);
  pg.drawText(foot, { x: (PW - fontBold.widthOfTextAtSize(foot, 8))/2, y: fy, size: 8, font: fontBold, color: BLACK });
  pg.drawText(foot2, { x: (PW - font.widthOfTextAtSize(foot2, 8))/2, y: fy - 10.5, size: 8, font, color: BLACK });
  pg.drawText(foot3, { x: (PW - font.widthOfTextAtSize(foot3, 8))/2, y: fy - 21, size: 8, font, color: BLACK });
  const pdfBytes = await pdfDoc.save();
  return pdfBytes;
}

// PDF Ofício de Mudança de Endereço (COMEP/SAP) - documento corrido 1 página
async function gerarTermoEnderecoPDF(termo){
  const d = (termo.dados && typeof termo.dados === 'object') ? termo.dados : {};
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontOb = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
  const PW = 595.32, PH = 841.92, M = 55;
  const W = PW - 2 * M;
  const BLACK = rgb(0, 0, 0);
  const GRAY = rgb(0.45, 0.45, 0.45);
  const GREEN = rgb(0.16, 0.5, 0.27);
  const SLATE = rgb(0.23, 0.32, 0.38);
  // Imagens do cabeçalho (fallbacks em texto quando ausentes)
  let brasao = null, badgePP = null;
  try{
    const bp = path.join(ROOT, 'public', 'brasao-ceara.png');
    if(fs.existsSync(bp)) brasao = await pdfDoc.embedPng(fs.readFileSync(bp));
  }catch(e){}
  try{
    const pp = path.join(ROOT, 'public', 'logo-policia-penal.png');
    if(fs.existsSync(pp)) badgePP = await pdfDoc.embedPng(fs.readFileSync(pp));
  }catch(e){}
  const has = v => v != null && String(v).trim() !== '';
  // Valor preenchido: preto normal; vazio: placeholder cinza itálico (como no modelo)
  const V = (v, ph) => has(v) ? { t: String(v).trim(), f: font, c: BLACK } : { t: ph, f: fontOb, c: GRAY };
  const S = (v, fb) => String((v == null || v === '') ? (fb == null ? '' : fb) : v);
  const dataOficio = d.dataOficio ? new Date(d.dataOficio + 'T12:00:00') : new Date();
  const dataExtenso = isNaN(dataOficio) ? '' : dataOficio.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
  const dataSolic = (()=>{ const s = String(d.dataSolicitacao || ''); const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : s; })();
  const cidade = S(d.cidade, 'Fortaleza');
  const ano = S(d.ano, String(new Date().getFullYear()));
  const numero = S(d.numero, '_______');
  let pg = pdfDoc.addPage([PW, PH]);
  // ---- Cabeçalho: esquerda Polícia Penal / direita brasão + CEARÁ ----
  const yTop = PH - 36;
  let txL = M;
  if(badgePP){
    const bh = 62, bw = bh * (badgePP.width / badgePP.height);
    pg.drawImage(badgePP, { x: M, y: yTop - bh, width: bw, height: bh });
    txL = M + bw + 8;
  }
  pg.drawText('POLÍCIA PENAL', { x: txL, y: yTop - 15, size: 15, font: fontBold, color: BLACK });
  pg.drawText('Coordenadoria de Monitoração', { x: txL, y: yTop - 28, size: 8, font: fontBold, color: BLACK });
  pg.drawText('Eletrônica de Pessoas - COMEP', { x: txL, y: yTop - 38, size: 8, font: fontBold, color: BLACK });
  const cea = 'CEARÁ';
  const ceaW = fontBold.widthOfTextAtSize(cea, 22);
  const g1 = 'GOVERNO DO ESTADO', g1W = fontBold.widthOfTextAtSize(g1, 9);
  const g2 = 'SECRETARIA DA ADMINISTRAÇÃO', g2W = font.widthOfTextAtSize(g2, 7);
  const g3 = 'PENITENCIÁRIA E RESSOCIALIZAÇÃO', g3W = font.widthOfTextAtSize(g3, 7);
  const txtW = Math.max(ceaW, g1W, g2W, g3W);
  if(brasao){
    const brH = 64, brW = brH * (brasao.width / brasao.height);
    pg.drawImage(brasao, { x: PW - M - txtW - 8 - brW, y: yTop - brH, width: brW, height: brH });
  }
  pg.drawText(cea, { x: PW - M - ceaW, y: yTop - 22, size: 22, font: fontBold, color: SLATE });
  pg.drawText(g1, { x: PW - M - g1W, y: yTop - 36, size: 9, font: fontBold, color: BLACK });
  pg.drawText(g2, { x: PW - M - g2W, y: yTop - 47, size: 7, font: font, color: BLACK });
  pg.drawText(g3, { x: PW - M - g3W, y: yTop - 57, size: 7, font: font, color: BLACK });
  // filete verde
  let y = 728;
  pg.drawLine({ start: { x: M, y }, end: { x: PW - M, y }, thickness: 1.3, color: GREEN });
  // Parágrafo com quebra automática e justificação (segmentos com estilo/cor)
  const drawPara = (segs, size, lh, indent, justify) => {
    indent = indent || 0;
    const words = [];
    segs.forEach(s => { String(s.t || '').split(/\s+/).filter(Boolean).forEach(w => words.push({ w, f: s.f || font, c: s.c || BLACK })); });
    const spW = font.widthOfTextAtSize(' ', size);
    const lines = [];
    let line = [], lw = 0, first = true;
    const avail = () => W - (first ? indent : 0);
    words.forEach(wd => {
      const ww = wd.f.widthOfTextAtSize(wd.w, size);
      if(line.length && lw + spW + ww > avail()){ lines.push(line); line = []; lw = 0; first = false; }
      if(line.length) lw += spW;
      line.push(wd); lw += ww;
    });
    if(line.length) lines.push(line);
    lines.forEach((ln, li) => {
      const isLast = li === lines.length - 1;
      const ind = (li === 0) ? indent : 0;
      let xx = M + ind;
      let gap = spW;
      if(justify && !isLast && ln.length > 1){
        let content = 0;
        ln.forEach(wd => { content += wd.f.widthOfTextAtSize(wd.w, size); });
        gap = (W - ind - content) / (ln.length - 1);
      }
      ln.forEach((wd, i) => {
        if(i > 0) xx += gap;
        pg.drawText(wd.w, { x: xx, y, size, font: wd.f, color: wd.c });
        xx += wd.f.widthOfTextAtSize(wd.w, size);
      });
      y -= lh;
    });
  };
  // estima altura (nº de linhas) para quebra de página preventiva
  const estLines = (segs, size, indent) => {
    let tot = 0;
    segs.forEach(s => { String(s.t || '').split(/\s+/).filter(Boolean).forEach(w => { tot += (s.f || font).widthOfTextAtSize(w, size) + font.widthOfTextAtSize(' ', size); }); });
    return Math.max(1, Math.ceil(tot / (W - (indent || 0))));
  };
  const ensure = (need) => { if(y - need < 120){ pg = pdfDoc.addPage([PW, PH]); y = PH - 48; } };
  // Linha do ofício + local/data
  y = 660;
  const ofTxt = `OFÍCIO COMEP/SAP Nº ${numero}/${ano} - WP`;
  const dtTxt = dataExtenso ? `${cidade}, ${dataExtenso}` : cidade;
  pg.drawText(ofTxt, { x: M, y, size: 12, font: fontBold, color: BLACK });
  const dtW = font.widthOfTextAtSize(dtTxt, 12);
  pg.drawText(dtTxt, { x: PW - M - dtW, y, size: 12, font: font, color: BLACK });
  y -= 52;
  drawPara([{ t: 'A SUA EXCELÊNCIA JUIZ(A) DE DIREITO', f: fontBold }], 12, 19, 0, false);
  drawPara([V(d.vara, 'VARA')], 12, 19, 0, false);
  drawPara([{ t: 'PROCESSO Nº ', f: fontBold }, V(d.processo, 'Processo')], 12, 19, 0, false);
  drawPara([{ t: 'Assunto: MUDANÇA DE ENDEREÇO', f: fontBold }], 12, 19, 0, false);
  y -= 46;
  drawPara([{ t: 'Meritíssimo(a) Juiz(a),' }], 12, 21, 70, false);
  y -= 4;
  const corpo = [
    { t: 'Com os cumprimentos de estilo, a Coordenadoria de Monitoração Eletrônica de Pessoas – COMEP informar que ' },
    V(d.nome, 'Nome da pessoa'),
    { t: ', portador do CPF Nº ' },
    V(d.cpf, '000.000.000-00'),
    { t: ', filho(a) de ' },
    V(d.mae, 'nome da mãe'),
    { t: ', efetuou solicitação de alteração de endereço em ' },
    V(dataSolic, 'dd/mm/aaaa'),
    { t: ', passando a residir a ' },
    V(d.endereco, 'endereço completo'),
    { t: ', como também alterou o contato para o número ' },
    V(d.contato, '(00)00000-0000'),
    { t: '. É pertinente ressaltar que a motivação alegada foi: ' },
    V(d.motivo, 'motivo'),
    { t: '.' }
  ];
  ensure(estLines(corpo, 12, 70) * 21 + 80);
  drawPara(corpo, 12, 21, 70, true);
  y -= 26;
  const fecho = [{ t: 'Sem mais para o momento, valho-me para apresentar protestos de elevada estima e real apreço.' }];
  ensure(estLines(fecho, 12, 70) * 21 + 40);
  drawPara(fecho, 12, 21, 70, true);
  y -= 70;
  drawPara([{ t: 'Respeitosamente,' }], 12, 21, 0, false);
  // Bloco de assinatura só desce de página se inteiro não couber (preserva 1 página do modelo)
  if(y - 44 < 110){ pg = pdfDoc.addPage([PW, PH]); y = PH - 80; }
  y -= 44;
  const sig1 = 'KAYROL GARCES COSTA';
  pg.drawText(sig1, { x: (PW - fontBold.widthOfTextAtSize(sig1, 12)) / 2, y, size: 12, font: fontBold, color: BLACK });
  y -= 16;
  const sig2 = 'Coordenador de Monitoração Eletrônica de Pessoas';
  pg.drawText(sig2, { x: (PW - font.widthOfTextAtSize(sig2, 11)) / 2, y, size: 11, font: font, color: BLACK });
  // Rodapé institucional ancorado na base da última página
  // (o encaixe da assinatura acima já garante que não há sobreposição)
  const foot = (txt, yy, fb) => {
    pg.drawText(txt, { x: M, y: yy, size: 10, font: fb ? fontBold : font, color: BLACK });
  };
  foot('Coordenadoria de Monitoração Eletrônica - COMEP', 80, true);
  foot('Rua Tenente Benévolo, 1055 – Meireles, CEP: 60.160-040 - Fortaleza–CE', 66, false);
  foot('Contatos: (85) 98139-5024 - (85) 99191-8937', 52, false);
  foot('Email: comep@sap.ce.gov.br', 38, false);
  const pdfBytes = await pdfDoc.save();
  return pdfBytes;
}

module.exports = { gerarTermoHTML, gerarTermoPDF, gerarTermoRecolhimentoPDF, gerarTermoRecolhimentoEquipamentoPDF,
gerarTermoEnderecoPDF, gerarDeclaracaoPDF, gerarRelFrequenciaPDF, gerarRelTecnicoPDF, gerarOficioEncaminhamentoPDF };

// =====================================================================
// Documentos psicossociais (UMEPE Juazeiro do Norte)
// =====================================================================
async function psiDocStart() {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontOb = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
  let brasao = null;
  try {
    const bp = path.join(ROOT, 'public', 'brasao-ceara.png');
    if (fs.existsSync(bp)) brasao = await pdfDoc.embedPng(fs.readFileSync(bp));
  } catch (e) {}
  const PW = 595.32, PH = 841.92, M = 60;
  const pg = pdfDoc.addPage([PW, PH]);
  const F = { font, fontBold, fontOb, PW, PH, M, W: PW - 2 * M };
  let yTop = PH - 40;
  let txX = M;
  if (brasao) {
    const bh = 46, bw = bh * (brasao.width / brasao.height);
    pg.drawImage(brasao, { x: M, y: yTop - bh, width: bw, height: bh });
    txX = M + bw + 10;
  }
  pg.drawText('UMEPE – UNIDADE DE MONITORAMENTO ELETRÔNICO DE PESSOAS', { x: txX, y: yTop - 13, size: 10.5, font: fontBold, color: rgb(0, 0, 0) });
  pg.drawText('Juazeiro do Norte – CE  •  Rua das Flores, s/n – Santa Teresa', { x: txX, y: yTop - 26, size: 8, font, color: rgb(0, 0, 0) });
  pg.drawText('(88) 3511-5726  •  monitoramento.cariri@sap.ce.gov.br', { x: txX, y: yTop - 36, size: 8, font, color: rgb(0, 0, 0) });
  const yRule = yTop - 48;
  pg.drawLine({ start: { x: M, y: yRule }, end: { x: PW - M, y: yRule }, thickness: 1.1, color: rgb(0.16, 0.5, 0.27) });
  return { pdfDoc, pg, F, brasao, y: yRule - 28 };
}
function psiTitle(pg, F, txt, y, sub) {
  const w = F.fontBold.widthOfTextAtSize(txt, 13.5);
  pg.drawText(txt, { x: (F.PW - w) / 2, y, size: 13.5, font: F.fontBold, color: rgb(0, 0, 0) });
  pg.drawLine({ start: { x: (F.PW - w) / 2, y: y - 2 }, end: { x: (F.PW + w) / 2, y: y - 2 }, thickness: 0.8, color: rgb(0, 0, 0) });
  y -= 20;
  if (sub) {
    const sw = F.fontOb.widthOfTextAtSize(sub, 9);
    pg.drawText(sub, { x: (F.PW - sw) / 2, y, size: 9, font: F.fontOb, color: rgb(0.4, 0.4, 0.4) });
    y -= 14;
  }
  return y - 8;
}
// Parágrafo simples justificado; retorna {pg, y} (troca de página quando preciso)
function psiPara(st, segs, size, lh, indent, justify) {
  let { pdfDoc, pg, F } = st;
  let y = st.y;
  indent = indent || 0;
  const words = [];
  segs.forEach(s => { String(s.t || '').split(/\s+/).filter(Boolean).forEach(w => words.push({ w, f: s.b ? F.fontBold : F.font, c: s.g ? rgb(0.45, 0.45, 0.45) : rgb(0, 0, 0) })); });
  if (!words.length) return st;
  const spW = F.font.widthOfTextAtSize(' ', size);
  const lines = [];
  let line = [], lw = 0, first = true;
  const avail = () => F.W - (first ? indent : 0);
  words.forEach(wd => {
    const ww = wd.f.widthOfTextAtSize(wd.w, size);
    if (line.length && lw + spW + ww > avail()) { lines.push(line); line = []; lw = 0; first = false; }
    if (line.length) lw += spW;
    line.push(wd); lw += ww;
  });
  if (line.length) lines.push(line);
  const need = lines.length * lh + 60;
  if (y - need < 60) { pg = pdfDoc.addPage([F.PW, F.PH]); y = F.PH - 60; }
  lines.forEach((ln, li) => {
    const isLast = li === lines.length - 1;
    const ind = (li === 0) ? indent : 0;
    let xx = F.M + ind, gap = spW;
    if (justify && !isLast && ln.length > 1) {
      let content = 0;
      ln.forEach(wd => { content += wd.f.widthOfTextAtSize(wd.w, size); });
      gap = (F.W - ind - content) / (ln.length - 1);
    }
    ln.forEach((wd, i) => {
      if (i > 0) xx += gap;
      pg.drawText(wd.w, { x: xx, y, size, font: wd.f, color: wd.c });
      xx += wd.f.widthOfTextAtSize(wd.w, size);
    });
    y -= lh;
  });
  st.pg = pg; st.y = y;
  return st;
}
function psiCampo(st, label, value, size, lh) {
  return psiPara(st, [{ t: label + ' ', b: true }, { t: value || '—' }], size || 11, lh || 16, 0, false);
}
function psiDataExtenso(iso) {
  if (!iso) return '';
  const dt = new Date(iso + 'T12:00:00');
  if (isNaN(dt)) return '';
  return dt.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
}
function psiDataBR(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso || '');
}
function psiAssinatura(st, nome, linha2) {
  let { pdfDoc, pg, F } = st;
  let y = st.y;
  if (y < 170) { pg = pdfDoc.addPage([F.PW, F.PH]); y = F.PH - 90; }
  y -= 46;
  if (nome) {
    const w = F.font.widthOfTextAtSize(nome, 10);
    pg.drawText(nome, { x: (F.PW - w) / 2, y: y + 11, size: 10, font: F.font, color: rgb(0, 0, 0) });
  }
  pg.drawLine({ start: { x: F.M + 40, y }, end: { x: F.PW - F.M - 40, y }, thickness: 0.9, color: rgb(0, 0, 0) });
  y -= 15;
  const l2 = linha2 || 'Psicólogo(a) – UMEPE Juazeiro do Norte/CE';
  const w2 = F.fontBold.widthOfTextAtSize(l2, 10);
  pg.drawText(l2, { x: (F.PW - w2) / 2, y, size: 10, font: F.fontBold, color: rgb(0, 0, 0) });
  st.pg = pg; st.y = y - 14;
  return st;
}
function psiLocalData(st, cidade, iso) {
  const txt = `${cidade || 'Juazeiro do Norte'}, ${psiDataExtenso(iso) || psiDataExtenso(new Date().toISOString().slice(0, 10))}.`;
  return psiPara(st, [{ t: txt }], 11, 16, 0, false);
}

// 1. Declaração de comparecimento
async function gerarDeclaracaoPDF(termo) {
  const d = (termo.dados && typeof termo.dados === 'object') ? termo.dados : {};
  const st = await psiDocStart();
  const { F } = st;
  let pg = st.pg;
  st.y = psiTitle(pg, F, 'DECLARAÇÃO DE COMPARECIMENTO', st.y);
  st.pg = pg;
  const foco = d.texto || 'atendimento psicossocial';
  psiPara(st, [
    { t: 'Declaramos, para os devidos fins, que ' },
    { t: d.nome || '_________________________', b: !d.nome, g: !d.nome },
    { t: ', portador(a) do CPF nº ' },
    { t: d.cpf || '_______________', b: !d.cpf, g: !d.cpf },
    { t: (d.processo ? `, processo nº ${d.processo},` : '') + ` compareceu a esta Unidade (UMEPE – Juazeiro do Norte/CE) no dia ${psiDataBR(d.data) || '__/__/____'}, no período ${d.periodo || '______'}, para ${foco}.` }
  ], 12, 20, 40, true);
  st.y -= 16;
  psiPara(st, [{ t: 'Por ser verdade, firmamos a presente.' }], 12, 20, 0, false);
  st.y -= 8;
  psiLocalData(st, d.cidade, d.dataDoc || d.data);
  psiAssinatura(st, d.psicologo, `Psicólogo(a)${d.crp ? ' – CRP ' + d.crp : ''} – UMEPE Juazeiro do Norte/CE`);
  return st.pdfDoc.save();
}

// 2. Relatório de frequência
async function gerarRelFrequenciaPDF(termo) {
  const d = (termo.dados && typeof termo.dados === 'object') ? termo.dados : {};
  const st = await psiDocStart();
  const { F } = st;
  st.y = psiTitle(st.pg, F, 'RELATÓRIO DE FREQUÊNCIA', st.y, 'Acompanhamento psicossocial');
  psiCampo(st, 'Nome:', d.nome, 11, 16);
  psiCampo(st, 'CPF:', d.cpf, 11, 16);
  psiCampo(st, 'Processo / Vara:', [d.processo, d.vara].filter(Boolean).join('  •  '), 11, 16);
  psiCampo(st, 'Medida:', d.medida, 11, 16);
  psiCampo(st, 'Período:', [psiDataBR(d.dataInicio), psiDataBR(d.dataFim)].filter(Boolean).join(' a '), 11, 16);
  st.y -= 10;
  const itens = Array.isArray(d.itens) ? d.itens : [];
  const L = F.M, R = F.PW - F.M;
  const cols = [[L, L + 92], [L + 92, R - 150], [R - 150, R - 42], [R - 42, R]];
  const head = ['DATA', 'LOCAL', 'SITUAÇÃO', 'OBS'];
  const drawHead = (pg, top) => {
    pg.drawRectangle({ x: L, y: top - 18, width: R - L, height: 18, color: rgb(0.93, 0.94, 0.96), borderColor: rgb(0, 0, 0), borderWidth: 0.6 });
    head.forEach((h, i) => {
      const w = F.fontBold.widthOfTextAtSize(h, 9.5);
      pg.drawText(h, { x: (cols[i][0] + cols[i][1]) / 2 - w / 2, y: top - 12.5, size: 9.5, font: F.fontBold, color: rgb(0, 0, 0) });
    });
    pg.drawLine({ start: { x: L, y: top }, end: { x: R, y: top }, thickness: 0.6, color: rgb(0, 0, 0) });
  };
  let pg = st.pg, top = st.y;
  const newPage = () => { pg = st.pdfDoc.addPage([F.PW, F.PH]); top = F.PH - 60; drawHead(pg, top); top -= 18; };
  drawHead(pg, top); top -= 18;
  const RH = 17;
  if (!itens.length) {
    pg.drawRectangle({ x: L, y: top - RH, width: R - L, height: RH, borderColor: rgb(0, 0, 0), borderWidth: 0.6, color: rgb(1, 1, 1) });
    const t = 'Sem registros no período.';
    pg.drawText(t, { x: (F.PW - F.font.widthOfTextAtSize(t, 10)) / 2, y: top - 12, size: 10, font: F.fontOb, color: rgb(0.45, 0.45, 0.45) });
    top -= RH;
  }
  let nP = 0, nF = 0, nJ = 0;
  for (const r of itens) {
    if (top - RH < 60) {
      for (const x of [L, ...cols.map(c => c[1])]) pg.drawLine({ start: { x, y: top + 18 + (F.PH - 60 - (top + 18)) * 0 }, end: { x, y: top }, thickness: 0.6, color: rgb(0, 0, 0) });
      newPage();
    }
    const s = String(r.status || '').toLowerCase();
    if (s.includes('just')) nJ++; else if (s.includes('falta')) nF++; else nP++;
    const vals = [psiDataBR(r.data) || '—', String(r.local || '—').slice(0, 34), String(r.status || '—').slice(0, 16), String(r.obs || '').slice(0, 22)];
    vals.forEach((v, i) => {
      pg.drawText(v, { x: cols[i][0] + 4, y: top - 12, size: 9, font: F.font, color: rgb(0, 0, 0) });
    });
    top -= RH;
    pg.drawLine({ start: { x: L, y: top }, end: { x: R, y: top }, thickness: 0.6, color: rgb(0, 0, 0) });
  }
  for (const x of [L, ...cols.map(c => c[1])]) pg.drawLine({ start: { x, y: top + 18 + (st.y - top - 18) * 0 }, end: { x, y: top }, thickness: 0.6, color: rgb(0, 0, 0) });
  st.pg = pg; st.y = top - 14;
  psiPara(st, [{ t: `Total: ${itens.length} registro(s) — ${nP} presença(s), ${nF} falta(s), ${nJ} falta(s) justificada(s).`, b: true }], 11, 16, 0, false);
  if (d.texto) { st.y -= 6; psiPara(st, [{ t: d.texto }], 11, 17, 0, true); }
  st.y -= 6;
  psiLocalData(st, d.cidade, d.dataDoc);
  psiAssinatura(st, d.psicologo, `Psicólogo(a)${d.crp ? ' – CRP ' + d.crp : ''} – UMEPE Juazeiro do Norte/CE`);
  return st.pdfDoc.save();
}

// 3. Relatório técnico psicológico
async function gerarRelTecnicoPDF(termo) {
  const d = (termo.dados && typeof termo.dados === 'object') ? termo.dados : {};
  const st = await psiDocStart();
  st.y = psiTitle(st.pg, st.F, 'RELATÓRIO TÉCNICO PSICOLÓGICO', st.y, '— Documento sigiloso —');
  const sec = (t) => { psiPara(st, [{ t, b: true }], 11.5, 18, 0, false); st.y -= 2; };
  sec('1. IDENTIFICAÇÃO');
  psiCampo(st, 'Nome:', d.nome, 11, 16);
  psiCampo(st, 'CPF:', d.cpf, 11, 16);
  psiCampo(st, 'Processo / Vara:', [d.processo, d.vara].filter(Boolean).join('  •  '), 11, 16);
  psiCampo(st, 'Medida:', d.medida, 11, 16);
  st.y -= 8;
  sec('2. HISTÓRICO E ACOMPANHAMENTO');
  psiPara(st, [{ t: d.resumo || '—' }], 11, 17, 0, true);
  st.y -= 8;
  sec('3. PARECER TÉCNICO');
  psiPara(st, [{ t: d.parecer || '—' }], 11, 17, 0, true);
  st.y -= 8;
  sec('4. PLANO / RECOMENDAÇÕES');
  psiPara(st, [{ t: d.plano || '—' }], 11, 17, 0, true);
  st.y -= 8;
  psiLocalData(st, d.cidade, d.dataDoc);
  psiAssinatura(st, d.psicologo, `Psicólogo(a)${d.crp ? ' – CRP ' + d.crp : ''} – UMEPE Juazeiro do Norte/CE`);
  return st.pdfDoc.save();
}

// 4. Ofício de encaminhamento à rede de apoio
async function gerarOficioEncaminhamentoPDF(termo) {
  const d = (termo.dados && typeof termo.dados === 'object') ? termo.dados : {};
  const st = await psiDocStart();
  const { F } = st;
  const anoDoc = (d.dataDoc || new Date().toISOString().slice(0, 10)).slice(0, 4);
  psiPara(st, [{ t: `OFÍCIO UMEPE/JUAZEIRO Nº ${d.numero || '_______'}/${anoDoc}`, b: true }], 12, 18, 0, false);
  st.y -= 4;
  psiPara(st, [{ t: `Ao(À) ${d.destino || '_________________________'}`, b: true }], 11, 17, 0, false);
  st.y -= 2;
  psiPara(st, [{ t: `Assunto: Encaminhamento para acompanhamento – ${d.nome || '_________________________'}`, b: true }], 11, 17, 0, false);
  st.y -= 12;
  if (d.texto) {
    String(d.texto).split('\n').forEach(p => { if (p.trim()) { psiPara(st, [{ t: p.trim() }], 11, 17, 30, true); st.y -= 6; } });
  } else {
    psiPara(st, [
      { t: 'Encaminhamos ' },
      { t: d.nome || '_________________________', b: !d.nome, g: !d.nome },
      { t: `, CPF nº ${d.cpf || '_______________'}, para ${d.motivo || 'avaliação e acompanhamento'} junto a ${d.destino || 'esta instituição'}. Contato: ${d.contato || '(  ) _____-____'}. Endereço: ${d.endereco || '_________________________'}. Solicitamos, sempre que possível, a contra-referência (retorno sobre o atendimento efetivado) a esta Unidade.` }
    ], 11, 17, 30, true);
  }
  st.y -= 8;
  psiLocalData(st, d.cidade, d.dataDoc);
  psiAssinatura(st, d.psicologo, `Psicólogo(a)${d.crp ? ' – CRP ' + d.crp : ''} – UMEPE Juazeiro do Norte/CE`);
  return st.pdfDoc.save();
}
