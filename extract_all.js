const fs=require('fs');
const zlib=require('zlib');
const path=require('path');

const files = [
  'D:/Pasta Download Disco D/Para renomear/PARA RENOMEAR/pagina-03.pdf',
  'D:/Pasta Download Disco D/Para renomear/PARA RENOMEAR/pagina-04.pdf',
  'D:/Pasta Download Disco D/Para renomear/PARA RENOMEAR/pagina-05.pdf',
  'D:/Pasta Download Disco D/Para renomear/PARA RENOMEAR/pagina-06.pdf',
  'D:/Pasta Download Disco D/Para renomear/PARA RENOMEAR/pagina-07.pdf',
  'D:/Pasta Download Disco D/Para renomear/PARA RENOMEAR/pagina-08.pdf',
];

for (const f of files) {
  const buf=fs.readFileSync(f);
  const s=buf.toString('latin1');
  let idx=s.indexOf('/Subtype /Image');
  let count=0;
  while(idx!==-1) {
    const streamIdx=s.indexOf('stream', idx);
    let dataStart=streamIdx+6;
    if (buf[dataStart]===0x0d) dataStart++;
    if (buf[dataStart]===0x0a) dataStart++;
    const endIdx=s.indexOf('endstream', dataStart);
    const raw=buf.slice(dataStart, endIdx);
    try {
      const inflated=zlib.inflateSync(raw);
      const outName=path.basename(f,'.pdf')+'_img'+count+'.jpg';
      fs.writeFileSync(outName, inflated);
      console.log(f, '->', outName, inflated.length);
    } catch(e) {
      fs.writeFileSync(path.basename(f,'.pdf')+'_img'+count+'_raw.bin', raw);
    }
    count++;
    idx=s.indexOf('/Subtype /Image', idx+1);
  }
}
EOF