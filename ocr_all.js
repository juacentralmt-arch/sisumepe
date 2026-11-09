const Tesseract = require('tesseract.js');
const sharp = require('sharp');

const files = [
  'pagina-03_img1.jpg',
  'pagina-04_img1.jpg',
  'pagina-05_img1.jpg',
  'pagina-06_img1.jpg',
  'pagina-07_img1.jpg',
  'pagina-08_img1.jpg',
];

(async () => {
  const w = await Tesseract.createWorker('por', 1, { logger: ()=>{} });
  await w.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
  
  for (const f of files) {
    console.log('==================== ' + f + ' ====================');
    try {
      await sharp(f).resize({width:2560}).grayscale().normalize().sharpen().toFile('proc_'+f);
      const { data } = await w.recognize('proc_'+f);
      console.log('len', data.text.length, 'conf', (data.confidence||0).toFixed(1));
      console.log(data.text.slice(0,2000));
    } catch(e) {
      console.log('ERR', e.message);
    }
    console.log('');
  }
  await w.terminate();
})();
