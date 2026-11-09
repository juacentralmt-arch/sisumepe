const fs = require('fs');
const { ocrImagemNuvem, chaveConfigurada, enquadrarGratuito } = require('./src/lib/ocrNuvem');

const files = [
  'pagina-03_img1.jpg',
  'pagina-04_img1.jpg',
  'pagina-05_img1.jpg',
  'pagina-06_img1.jpg',
  'pagina-07_img1.jpg',
  'pagina-08_img1.jpg',
];

(async () => {
  console.log('Chave configurada:', chaveConfigurada());
  if (!chaveConfigurada()) {
    console.log('\n⚠️  Configure OCR_SPACE_KEY no ambiente primeiro:');
    console.log('   $env:OCR_SPACE_KEY="sua_chave"');
    console.log('   ou edite .env');
    process.exit(1);
  }

  for (const f of files) {
    if (!fs.existsSync(f)) {
      console.log(`\n${f}: NÃO ENCONTRADO`);
      continue;
    }
    console.log(`\n==================== ${f} ====================`);
    const buf = fs.readFileSync(f);
    try {
      const texto = await ocrImagemNuvem(buf);
      console.log('Texto extraído (len=' + texto.length + '):');
      console.log(texto.slice(0, 2000));
      console.log('\n---');
    } catch (e) {
      console.log('ERRO:', e.message);
    }
  }
})();
EOF