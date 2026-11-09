const fs=require('fs');
const zlib=require('zlib');
const f=process.argv[2];
const buf=fs.readFileSync(f);
const s=buf.toString('latin1');
// find image XObject stream: look for /Subtype /Image then stream
const idx=s.indexOf('/Subtype /Image');
console.log('image dict at', idx);
// find 'stream' after idx
const streamIdx=s.indexOf('stream', idx);
console.log('stream keyword at', streamIdx);
// stream data starts after 'stream\n' or 'stream\r\n'
let dataStart=streamIdx+6;
if (buf[dataStart]===0x0d) dataStart++; // \r
if (buf[dataStart]===0x0a) dataStart++; // \n
// find 'endstream'
const endIdx=s.indexOf('endstream', dataStart);
console.log('endstream at', endIdx);
const raw=buf.slice(dataStart, endIdx);
console.log('raw stream len', raw.length);
// try inflate
try {
  const inflated=zlib.inflateSync(raw);
  console.log('inflated len', inflated.length);
  fs.writeFileSync('extracted.jpg', inflated);
  console.log('wrote extracted.jpg');
} catch(e) {
  console.log('inflate failed:', e.message);
  // maybe stored as raw jpeg (DCTDecode only)? try write raw
  fs.writeFileSync('extracted_raw.bin', raw);
  console.log('wrote raw');
}
