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
  // Tabela - coordenadas exatas
  const tableLeft = 110.42;
  const tableRight = 484.90;
  const colBounds = [110.42, 220.76, 310.42, 370.42, 484.90];
  const colCenters = [(110.42+220.76)/2, (220.76+310.42)/2, (310.42+370.42)/2, (370.42+484.90)/2];
  // Header y=490.39, row tops 496.39,478.39,458.39,438.39,418.39,398.39, bottom 378.39
  // Header background
  page.drawRectangle({ x: tableLeft, y: 478.39, width: tableRight-tableLeft, height: 18, color: rgb(0.996, 0.89, 0.78), borderColor: rgb(0,0,0), borderWidth: 0.6 });
  const hdrCols = ['TZPR04', 'FONTE04', 'CINTA', 'TRAVA'];
  const hdrBounds = [[110.42, 220.76], [220.76, 310.42], [310.42, 370.42], [370.42, 484.90]];
  hdrCols.forEach((h, i) => {
    const hw = fontTimesBold.widthOfTextAtSize(h, 11);
    const hx = (hdrBounds[i][0] + hdrBounds[i][1]) / 2 - hw / 2;
    page.drawText(h, { x: hx, y: 484.5, size: 11, font: fontTimesBold, color: rgb(0,0,0) });
  });
  // Grid vertical
  for(let i=0;i<colBounds.length;i++){
    const x = colBounds[i];
    page.drawLine({ start: {x, y: 496.39}, end: {x, y: 378.39}, thickness: 0.6, color: rgb(0,0,0) });
  }
  // Grid horizontal
  const hLines = [496.39, 478.39, 458.39, 438.39, 418.39, 398.39, 378.39];
  for(const y of hLines){
    page.drawLine({ start: {x: tableLeft, y}, end: {x: tableRight, y}, thickness: 0.6, color: rgb(0,0,0) });
  }
  // Dados: até 5 linhas usa o layout clássico exato; acima disso, tabela
  // fluida com paginação (mesma geometria de colunas/fontes)
  const storedEq = Array.isArray(termo.equipamentos) ? termo.equipamentos : [];
  const normEq = r => ({
    tzpr04: String((r && r.tzpr04) || '').trim().substring(0, 18),
    fonte04: String((r && r.fonte04) || '').trim().substring(0, 18),
    cinta: String((r && r.cinta) || '').trim().substring(0, 18),
    trava: String((r && r.trava) || '').trim().substring(0, 18)
  });
  const isFilled = r => r.tzpr04 || r.fonte04 || r.cinta || r.trava;
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
  // 5 linhas clássicas, y central 468.39,448.39,428.39,408.39,388.39
  // Usa a lista filtrada (sem vazios) para não perder linhas extras
  // quando há vazios intercalados (ex.: prévia com linhas em branco).
  const classicEq = filledEq.slice();
  while(classicEq.length<5) classicEq.push({ tzpr04:'', fonte04:'', cinta:'', trava:'' });
  const rowYs = [468.39, 448.39, 428.39, 408.39, 388.39];
  for(let r=0;r<5;r++){
    const row = classicEq[r] || {};
    const vals = [row.tzpr04||'', row.fonte04||'', row.cinta||'', row.trava||''];
    for(let c=0;c<4;c++){
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
    const vals = [row.tzpr04, row.fonte04, row.cinta, row.trava];
    for(let c=0;c<4;c++){
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
  let sigY = top - 48;
  if(sigY < 260){ pg = pdfDoc.addPage([595.32, 841.92]); sigY = 730; }
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

module.exports = { gerarTermoHTML, gerarTermoPDF, gerarTermoRecolhimentoPDF };
