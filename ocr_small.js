const Tesseract = require('tesseract.js');
const sharp = require('sharp');

const files = [
  'pagina-03_img0.jpg',
  'pagina-04_img0.jpg',
  'pagina-05_img0.jpg',
  'pagina-06_img0.jpg',
  'pagina-07_img0.jpg',
  'pagina-08_img0.jpg',
];

(async () => {
  const w = await Tesseract.createWorker('por', 1, { logger: m => { if(m.status === 'recognizing text') console.log('  progress:', Math.round(m.progress*100)+'%'); } });
  await w.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
  
  for (const f of files) {
    console.log('==================== ' + f + ' ====================');
    try {
      await sharp(f).resize({width:2000}).grayscale().normalize().sharpen({sigma:1, flat:1, jagged:2}).toFile('p1_'+f);
      await sharp(f).resize({width:2000}).grayscale().normalize().threshold(128).toFile('p2_'+f);
      await sharp(f).resize({width:2000}).grayscale().normalize().modulate({brightness:1.2, saturation:0}).sharpen().toFile('p3_'+f);
      
      for (const [label, img] of [['norm', 'p1_'+f], ['thresh', 'p2_'+f], ['mod', 'p3_'+f]]) {
        const { data } = await w.recognize(img);
        if (data.text.length > 50) {
          console.log('--- ' + label + ' (len=' + data.text.length + ', conf=' + data.confidence.toFixed(1) + ') ---');
          console.log(data.text.slice(0,1500));
          console.log('');
        }
      }
    } catch(e) {
      console.log('ERR', e.message);
    }
  }
  await w.terminate();
})();
