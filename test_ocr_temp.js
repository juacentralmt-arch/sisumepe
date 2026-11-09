const fs=require('fs');
const path=require('path');
const os=require('os');
const FormData=require('form-data');
const fetch=require('node-fetch');
const sharp=require('sharp');

const OCR_SPACE_KEY=process.env.OCR_SPACE_KEY;
const OCR_SPACE_URL='https://api.ocr.space/parse/image';

async function testWithTempFile(f) {
  if(!fs.existsSync(f)) return console.log(f+': nao encontrado');
  console.log('\n===== '+f+' =====');
  const buf=fs.readFileSync(f);
  let img=sharp(buf);
  const meta=await img.metadata();
  if(meta.width>1400) img=img.resize({width:1400});
  const out=await img.jpeg({quality:70}).toBuffer();
  console.log('Sending:', out.length, 'bytes');
  
  // Write to temp file
  const tmp=path.join(os.tmpdir(), 'ocr-'+Date.now()+'.jpg');
  fs.writeFileSync(tmp, out);
  
  const fd=new FormData();
  fd.append('apikey', OCR_SPACE_KEY);
  fd.append('language', 'por');
  fd.append('OCREngine', '2');
  fd.append('scale', 'true');
  fd.append('isOverlayRequired', 'false');
  fd.append('file', fs.createReadStream(tmp), {filename:'pagina.jpg', contentType:'image/jpeg'});
  
  const res=await fetch(OCR_SPACE_URL, {method:'POST', body:fd});
  console.log('HTTP:', res.status);
  const json=await res.json();
  console.log('ParsedText:', json.ParsedResults?.[0]?.ParsedText?.slice(0,500));
  
  fs.unlinkSync(tmp);
}

require('dotenv').config();
const files=['pagina-03_img0.jpg','pagina-04_img0.jpg','pagina-05_img0.jpg','pagina-06_img0.jpg','pagina-07_img0.jpg','pagina-08_img0.jpg'];
(async()=>{ for(const f of files) await testWithTempFile(f); })();
