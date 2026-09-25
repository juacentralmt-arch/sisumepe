const store = require('../store');
function genSeriais(base, qtd){
  const start = Number(base);
  return Array.from({length: qtd}, (_,i)=> String(start+i).padStart(10,'0'));
}
function daysAgo(n){
  const d=new Date();
  d.setDate(d.getDate()-n);
  d.setHours(10,0,0,0);
  return d.toISOString();
}
async function run(){
  console.log('Seeding historico estoque...');
  // limpa alertas: nada
  const ops = [
    { dias:30, contrato:'CE01', material:'FONTE04', unidade:'UMEPE Juazeiro', qtd:15, motivo:'Recebimento 30d atrás - FONTE04 lote inicial' },
    { dias:28, contrato:'CE01', material:'CINTA', unidade:'UMEPE Juazeiro', qtd:30, motivo:'Recebimento 28d atrás - CINTA' },
    { dias:25, contrato:'CE01', material:'TRAVAS', unidade:'UMEPE Juazeiro', qtd:40, motivo:'Recebimento 25d atrás - TRAVAS' },
    { dias:21, contrato:'CE01', material:'FONTE04', unidade:'UP-Cariri', qtd:10, motivo:'Recebimento 21d atrás - FONTE04 UP-Cariri' },
    { dias:18, contrato:'CE01', material:'CINTA', unidade:'UP-Cariri', qtd:20, motivo:'Recebimento 18d atrás - CINTA UP-Cariri' },
    { dias:14, contrato:'CE01', material:'UPR04', unidade:'UMEPE Juazeiro', qtd:12, motivo:'Recebimento 14d atrás - UPR04 lote', seriais: genSeriais('4714569895',12) },
    { dias:10, contrato:'CE01', material:'UPR04', unidade:'UP-Cariri', qtd:6, motivo:'Recebimento 10d atrás - UPR04 UP-Cariri', seriais: genSeriais('4714569907',6) },
    { dias:7, contrato:'CE01', material:'TZPR04', unidade:'UMEPE Juazeiro', qtd:15, motivo:'Recebimento 7d atrás - TZPR04 lote', seriais: genSeriais('4315023568',15) },
    { dias:5, contrato:'CE01', material:'TZPR04', unidade:'UP-Cariri', qtd:8, motivo:'Recebimento 5d atrás - TZPR04 UP-Cariri', seriais: genSeriais('4315023583',8) },
    { dias:4, contrato:'CE01', material:'TZPR04', unidade:'UP-Crato', qtd:6, motivo:'Recebimento 4d atrás - TZPR04 UP-Crato', seriais: genSeriais('4315023591',6) },
    { dias:3, contrato:'CE01', material:'UPR04', unidade:'UP-Crato', qtd:4, motivo:'Recebimento 3d atrás - UPR04 UP-Crato', seriais: genSeriais('4714569913',4) },
    // saidas (uso)
    { dias:2, contrato:'CE01', material:'TZPR04', unidade:'UMEPE Juazeiro', qtd:-3, motivo:'Saída 2d atrás - instalação', seriais: genSeriais('4315023568',3) },
    { dias:1, contrato:'CE01', material:'UPR04', unidade:'UMEPE Juazeiro', qtd:-2, motivo:'Saída 1d atrás - instalação UPR', seriais: genSeriais('4714569895',2) },
    { dias:1, contrato:'CE01', material:'FONTE04', unidade:'UMEPE Juazeiro', qtd:-4, motivo:'Saída 1d atrás - uso FONTE' },
    // CE02 também para comparativo
    { dias:12, contrato:'CE02', material:'TZPR04', unidade:'UMEPE Juazeiro', qtd:10, motivo:'CE02 - TZPR 12d atrás', seriais: genSeriais('4315023600',10) },
    { dias:8, contrato:'CE02', material:'UPR04', unidade:'UMEPE Juazeiro', qtd:8, motivo:'CE02 - UPR 8d atrás', seriais: genSeriais('4714569920',8) },
  ];

  for(const op of ops){
    const qtd = op.qtd;
    const seriais = op.seriais || [];
    try{
      const res = await store.estoque.adjust({
        contrato: op.contrato,
        material: op.material,
        unidade: op.unidade,
        qtd: qtd,
        motivo: op.motivo,
        seriais: seriais,
        user: 'admin',
        userName: 'Seed Histórico'
      });
      // backdate the mov
      const pastISO = daysAgo(op.dias);
      // patch mov createdAt
      const mode = store.mode;
      if(mode==='file'){
        const fs=require('fs');
        // mem is internal, but we can patch via direct db.json
        const db=require('fs').readFileSync('./db.json','utf8');
        let j=JSON.parse(db);
        let mov=j.estoqueMov.find(m=> m.id===res.mov.id);
        if(mov){ mov.createdAt=pastISO; require('fs').writeFileSync('./db.json', JSON.stringify(j,null,2)); }
        // also patch estoqueSerial createdAt for those seriais
        if(seriais.length){
          let j2=JSON.parse(require('fs').readFileSync('./db.json','utf8'));
          j2.estoqueSerial.forEach(s=>{
            if(seriais.includes(s.serial) && s.contrato===op.contrato){
              // only for entrada, the serial was just created
              if(qtd>0) s.createdAt=pastISO;
            }
          });
          require('fs').writeFileSync('./db.json', JSON.stringify(j2,null,2));
        }
      } else {
        // supabase: try to update via supa (fallback to mem)
        try{ const {createClient}=require('@supabase/supabase-js'); }catch(e){}
      }
      console.log(`OK ${op.dias}d ${op.contrato} ${op.material} ${op.unidade} ${qtd>0?'+':''}${qtd} ${seriais.length?` seriais ${seriais[0]}...`:''}`);
    }catch(e){
      console.error(`ERR ${op.material} ${e.message}`);
    }
  }
  console.log('Seed concluído');
  // mostra resumo
  const resumo = await store.estoque.resumo({contrato:'CE01'});
  console.log('Resumo CE01 total', resumo.total, resumo.porMaterial);
}
run().catch(e=>{ console.error(e); process.exit(1); });
