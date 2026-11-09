const fs=require('fs');
let c=fs.readFileSync('src/lib/autoRenomear.js','utf8');
const oldStr = "chaves: ['relatorio']";
const newStr = "chaves: ['relatorio', 'inspecao', 'evolucao', 'dados da inspecao', 'ficha de evolucao', 'relatorio de inspecao', 'relatorio de evolucao', 'auto de inspecao']";
console.log('Before:', c.includes(oldStr));
c = c.replace(oldStr, newStr);
console.log('After:', c.includes(newStr));
fs.writeFileSync('src/lib/autoRenomear.js', c, 'utf8');
