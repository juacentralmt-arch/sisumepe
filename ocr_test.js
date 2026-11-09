const fs=require('fs');
const { createCanvas } = require('canvas');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.mjs');

const f = process.argv[2];
(async () => {
  const buf = fs.readFileSync(f);
  const m = pdfjsLib.default || pdfjsLib;
  const pdf = await m.getDocument({ data: new Uint8Array(buf), disableWorker: true }).promise;
  console.log('pages', pdf.numPages);
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 1.5 });
  const canvas = createCanvas(Math.floor(viewport.width), Math.floor(viewport.height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0,0,canvas.width,canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  const imgBuf = canvas.toBuffer('image/png');
  fs.writeFileSync('rendered.png', imgBuf);
  console.log('saved', imgBuf.length, canvas.width, canvas.height);
})();
