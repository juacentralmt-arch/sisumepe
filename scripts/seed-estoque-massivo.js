const store = require('../store');
function genSeriais(base, qtd){
  const start = Number(base);
  return Array.from({length: qtd}, (_,i)=> String(start+i).padStart(10,'0'));
}
function daysAgoISO(n, hour=10){
  const d=new Date();
  d.setDate(d.getDate()-n);
  d.setHours(hour, Math.floor(Math.random()*60),0,0);
  return d.toISOString();
}
// Unidades e materiais
const UNIDADES = ['UMEPE Juazeiro','UP-Juazeiro','UP-Cariri','UP-Crato','Fórum de Crato','Fórum de Jardim'];
const MATS = ['TZPR04','UPR04','FONTE04','CINTA','TRAVAS'];

async function run(){
  console.log('Seeding MASSIVO historico estoque (60+ dias)...');
  // Bases já usadas: TZPR 4315023568-3609, UPR 4714569895-9927
  // Novas bases para não colidir
  let tzprNext = 4315023610;
  let uprNext = 4714569930;
  const ops = [];

  // Gera histórico denso: últimos 60 dias, 1-2 movimentações por dia
  for(let d=60; d>=1; d--){
    const isWeekend = (new Date(Date.now() - d*86400000).getDay()===0);
    if(isWeekend && Math.random()<0.6) continue; // menos mov no domingo
    const unidade = UNIDADES[Math.floor(Math.random()*UNIDADES.length)];
    const contrato = Math.random()<0.8 ? 'CE01' : 'CE02';
    // Escolhe material com pesos
    const r=Math.random();
    let material, qtd, seriais=[];
    if(r<0.25){
      material='TZPR04'; qtd= 1+Math.floor(Math.random()*4); // 1-4
      // 70% entrada, 30% saída
      const isEntrada = Math.random()<0.7 || d>50; // mais entradas no início
      if(!isEntrada) qtd=-qtd;
      seriais = genSeriais(String(tzprNext), Math.abs(qtd));
      tzprNext+=Math.abs(qtd);
    } else if(r<0.45){
      material='UPR04'; qtd= 1+Math.floor(Math.random()*3);
      const isEntrada = Math.random()<0.65 || d>50;
      if(!isEntrada) qtd=-qtd;
      seriais = genSeriais(String(uprNext), Math.abs(qtd));
      uprNext+=Math.abs(qtd);
    } else if(r<0.65){
      material='FONTE04'; qtd= 2+Math.floor(Math.random()*6);
      if(Math.random()<0.3) qtd=-qtd;
    } else if(r<0.82){
      material='CINTA'; qtd= 5+Math.floor(Math.random()*10);
      if(Math.random()<0.25) qtd=-qtd;
    } else {
      material='TRAVAS'; qtd= 8+Math.floor(Math.random()*12);
      if(Math.random()<0.25) qtd=-qtd;
    }
    // Evita saída impossível: garante saldo suficiente? Deixa o store validar, se falhar pula
    const motivoBase = qtd>0 ? `Recebimento ${d}d atrás` : `Saída ${d}d atrás - uso`;
    const motivos = {
      'TZPR04': qtd>0 ? `Lote TZPR ${d}d - ${unidade}` : `Instalação TZPR ${unidade}`,
      'UPR04': qtd>0 ? `Lote UPR ${d}d - ${unidade}` : `Instalação UPR ${unidade}`,
      'FONTE04': qtd>0 ? `FONTE lote ${d}d` : `Uso FONTE ${unidade}`,
      'CINTA': qtd>0 ? `CINTA lote ${d}d` : `Troca CINTA ${unidade}`,
      'TRAVAS': qtd>0 ? `TRAVAS lote ${d}d` : `Uso TRAVAS ${unidade}`,
    };
    ops.push({ dias:d, contrato, material, unidade, qtd, motivo: motivos[material], seriais });
    // Adiciona segunda movimentação em 30% dos dias
    if(Math.random()<0.3){
      const unidade2 = UNIDADES[Math.floor(Math.random()*UNIDADES.length)];
      const mat2 = MATS[Math.floor(Math.random()*MATS.length)];
      let q2 = mat2==='TRAVAS'? 5+Math.floor(Math.random()*8) : mat2==='CINTA'? 4+Math.floor(Math.random()*6) : 1+Math.floor(Math.random()*3);
      if(MATS.indexOf(mat2)<2 && Math.random()<0.3) q2=-q2;
      let ser2=[];
      if(mat2==='TZPR04'){ ser2=genSeriais(String(tzprNext), Math.abs(q2)); tzprNext+=Math.abs(q2); }
      if(mat2==='UPR04'){ ser2=genSeriais(String(uprNext), Math.abs(q2)); uprNext+=Math.abs(q2); }
      ops.push({ dias:d, contrato: Math.random()<0.7?'CE01':'CE02', material:mat2, unidade:unidade2, qtd: mat2==='TZPR04'||mat2==='UPR04' ? (Math.random()<0.6?q2:q2) : q2, motivo: `Extra ${d}d ${mat2} ${unidade2}`, seriais: ser2 });
    }
  }

  // Ordena por dias decrescente (mais antigo primeiro) para saldo fazer sentido
  ops.sort((a,b)=> b.dias - a.dias);

  let ok=0, err=0;
  for(const op of ops){
    try{
      const res = await store.estoque.adjust({
        contrato: op.contrato,
        material: op.material,
        unidade: op.unidade,
        qtd: op.qtd,
        motivo: op.motivo,
        seriais: op.seriais,
        user: 'admin',
        userName: 'Seed Massivo'
      });
      // backdate
      const pastISO = daysAgoISO(op.dias);
      // patch mem directly
      const fs=require('fs');
      // atualiza mem via require cache
      const dbPath='./db.json';
      let j=JSON.parse(fs.readFileSync(dbPath,'utf8'));
      let mov=j.estoqueMov.find(m=> m.id===res.mov.id);
      if(mov) mov.createdAt=pastISO;
      // serials
      if(op.seriais && op.seriais.length && op.qtd>0){
        j.estoqueSerial.forEach(s=>{
          if(op.seriais.includes(s.serial) && s.contrato===op.contrato){
            s.createdAt=pastISO;
          }
        });
      }
      fs.writeFileSync(dbPath, JSON.stringify(j,null,2));
      ok++;
      if(ok%20===0) console.log(`... ${ok}/${ops.length}`);
    }catch(e){
      // saldo insuficiente para saída - ignora
      err++;
    }
  }
  console.log(`Seed massivo: ${ok} ok, ${err} skips (saldo insuficiente) de ${ops.length} tentativas`);

  // Re-patch final para garantir datas corretas (caso overwrites)
  const fs=require('fs');
  let j=JSON.parse(fs.readFileSync('./db.json','utf8'));
  // Reaplica datas baseado no motivo dias
  function parseDias(motivo){
    const m=String(motivo).match(/(\d+)d/);
    return m? Number(m[1]) : null;
  }
  let now=new Date(); now.setHours(10,0,0,0);
  j.estoqueMov.forEach(m=>{
    const d=parseDias(m.motivo||'');
    if(d!==null){
      const dd=new Date(now);
      dd.setDate(dd.getDate()-d);
      // adiciona jitter de minutos para ordenar
      dd.setMinutes(Math.floor(Math.random()*60));
      m.createdAt=dd.toISOString();
    }
  });
  // ajusta serial createdAt para entrada
  j.estoqueSerial.forEach(s=>{
    const mov=j.estoqueMov.find(mm=> mm.tipo==='entrada' && mm.seriais && mm.seriais.includes(s.serial) && mm.contrato===s.contrato);
    if(mov) s.createdAt=mov.createdAt;
  });
  fs.writeFileSync('./db.json', JSON.stringify(j,null,2));
  console.log('Re-patch datas concluído');

  const resumoCE01 = await store.estoque.resumo({contrato:'CE01'});
  const resumoCE02 = await store.estoque.resumo({contrato:'CE02'});
  console.log('Resumo CE01', resumoCE01.total, resumoCE01.porMaterial);
  console.log('Resumo CE02', resumoCE02.total, resumoCE02.porMaterial);
  console.log('Total movs', j.estoqueMov.length, 'seriais', j.estoqueSerial.length);
  console.log('Exemplo TZPR seriais', j.estoqueSerial.filter(s=> s.contrato==='CE01').slice(0,3).map(s=> s.serial).join(', '));
  console.log('Exemplo UPR seriais', j.estoqueSerial.filter(s=> s.contrato==='CE01' && Number(s.serial)>=4714569895).slice(0,3).map(s=> s.serial).join(', '));
}
run().catch(e=>{ console.error(e); process.exit(1); });
