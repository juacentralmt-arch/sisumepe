const sharp=require('sharp');
const Tesseract = require('tesseract.js');
(async () => {
  // high-res grayscale normalize
  await sharp('extracted.jpg').resize({width:2560}).grayscale().normalize().sharpen().toFile('proc2.png');
  const w = await Tesseract.createWorker('por', 1, { logger: ()=>{} });
  for (const psm of ['3','4','6']) {
    await w.setParameters({ tessedit_pageseg_mode: psm, preserve_interword_spaces: '1' });
    const { data } = await w.recognize('proc2.png');
    console.log('===== PSM', psm, 'len', data.text.length, 'conf', (data.confidence||0).toFixed(1), '=====');
    console.log(data.text.slice(0,1200));
  }
  await w.terminate();
})();
