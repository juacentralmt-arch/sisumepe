const UNIDADES = ['UMEPE Juazeiro','UP-Juazeiro','UP-Cariri','UP-Crato','Fórum de Crato','Fórum de Jardim'];
const MATERIAIS = ['TZPR04','UPR04','FONTE04','CINTA','TRAVAS'];
const MATERIAIS_SERIAL = ['TZPR04','UPR04'];
const LIMITES = { TZPR04: 5, UPR04: 5, FONTE04: 5, CINTA: 10, TRAVAS: 20 };

function norm(s){ return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim(); }
function extractContrato(q){
  const m=String(q).toUpperCase().match(/\bCE0[12]\b/);
  return m?m[0]:null;
}
function extractMaterial(q){
  const up=String(q).toUpperCase();
  for(const m of MATERIAIS) if(up.includes(m)) return m;
  // aliases
  if(/\btornozeleira\b|\btzpr\b/i.test(q)) return 'TZPR04';
  if(/\bupr\b/i.test(q)) return 'UPR04';
  if(/\bfonte\b/i.test(q)) return 'FONTE04';
  if(/\bcinta\b/i.test(q)) return 'CINTA';
  if(/\btrava\b/i.test(q)) return 'TRAVAS';
  return null;
}
function extractUnidade(q){
  const n=norm(q);
  for(const u of UNIDADES){
    if(n.includes(norm(u))) return u;
  }
  if(n.includes('umepe')) return 'UMEPE Juazeiro';
  if(n.includes('up juazeiro')||n.includes('up-juazeiro')) return 'UP-Juazeiro';
  if(n.includes('up cariri')||n.includes('up-cariri')) return 'UP-Cariri';
  if(n.includes('up crato')||n.includes('up-crato')) return 'UP-Crato';
  if(n.includes('forum de crato')||n.includes('forum crato')) return 'Fórum de Crato';
  if(n.includes('forum de jardim')||n.includes('forum jardim')||n.includes('jardim')) return 'Fórum de Jardim';
  return null;
}
function extractData(q){
  const m=String(q).match(/(\d{4}-\d{2}-\d{2})/);
  if(m) return m[1];
  const m2=String(q).match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if(m2) return `${m2[3]}-${m2[2]}-${m2[1]}`;
  // relativos
  const n=norm(q);
  const hoje=new Date().toISOString().slice(0,10);
  if(/\bhoje\b/.test(n)) return hoje;
  if(/\bontem\b/.test(n)){ const d=new Date(); d.setDate(d.getDate()-1); return d.toISOString().slice(0,10); }
  if(/\banteontem\b/.test(n)){ const d=new Date(); d.setDate(d.getDate()-2); return d.toISOString().slice(0,10); }
  return null;
}
function extractPeriodo(q){
  const n=norm(q);
  if(/ultimos?\s*7\s*dias|uma semana/.test(n)) return 7;
  if(/ultimos?\s*15\s*dias/.test(n)) return 15;
  if(/ultimos?\s*30\s*dias|um mes/.test(n)) return 30;
  if(/esta semana/.test(n)) return 7;
  if(/este mes/.test(n)) return 30;
  return null;
}
function extractSerial(q){
  const m=String(q).match(/\b\d{10}\b/);
  if(m) return m[0];
  // parcial 4+ digitos para busca aproximada
  const m2=String(q).match(/\b\d{4,9}\b/);
  return m2?m2[0]:null;
}
function extractThreshold(q, material){
  const m=String(q).match(/(abaixo de|menor que|<)\s*(\d+)/i);
  if(m) return Number(m[2]);
  if(/baixo|critico|alerta|zerado/.test(norm(q))){
    if(material && LIMITES[material]) return LIMITES[material];
    return null;
  }
  return null;
}
function fmtSaldo(n){ return Number(n||0).toLocaleString('pt-BR'); }

async function answer(query, store){
  const qRaw=String(query||'').trim();
  if(!qRaw) return { intent:'vazio', text:'Digite um comando. Ex: “saldo TZPR04 em UMEPE Juazeiro CE01”', suggestions:['saldo TZPR04 UMEPE Juazeiro CE01','histórico ontem','seriais disponíveis','ranking CINTA','reposição CE01','comparar UMEPE vs UP-Cariri'] };
  const q=norm(qRaw);
  const contrato=extractContrato(qRaw);
  const material=extractMaterial(qRaw);
  const unidade=extractUnidade(qRaw);
  const data=extractData(qRaw);
  const periodo=extractPeriodo(qRaw);
  const serial=extractSerial(qRaw);

  // HELP
  if(/ajuda|help|como usar|comandos|o que voce faz/.test(q)){
    return {
      intent:'help',
      text:`🤖 **Chat IA Estoque — Comandos** (100% on-prem, sem dados externos)

**📦 Saldo**
• \`saldo [material] [unidade] [CE01/CE02]\` — ex: “saldo TZPR04 UMEPE Juazeiro CE01”
• \`saldo total CE01\` / \`saldo por unidade\`

**📊 Visão geral**
• \`resumo [CE01/CE02] [unidade]\` — consolidado com alertas
• \`alertas / estoque baixo / zerado\` — abaixo do mínimo (TZPR04=5, UPR04=5, FONTE04=5, CINTA=10, TRAVAS=20)
• \`reposição / comprar / o que falta [CE01]\` — lista de compra sugerida
• \`comparar UMEPE vs UP-Cariri CE01\` — comparativo entre unidades
• \`ranking [material] CE01\` — onde tem mais estoque

**📅 Histórico**
• \`histórico [data] [unidade]\` — ex: “histórico ontem UMEPE” / “2026-09-24”
• \`evolução 7 dias TZPR04 CE01\` — tendência recente
• \`movimentações [hoje|últimos 7 dias]\` — últimas 20

**🔢 Seriais (TZPR04/UPR04)**
• \`seriais [CE01] [unidade]\` — disponíveis por unidade
• \`buscar serial 1234567890\` — rastreio exato ou parcial

**📍 Outros**
• \`unidades\` — lista localidades
• \`tendência / evolução\` — consumo recente`,
      data:null,
      suggestions:['saldo total CE01','resumo CE01','reposição CE01','alertas CE01','comparar UMEPE vs UP-Cariri','histórico ontem','seriais UPR04 CE01','ranking CINTA','evolução 7 dias','estoque baixo']
    };
  }

  // REPOSIÇÃO / COMPRAR
  if(/reposic|repor|comprar|o que falta|precisa comprar|lista de compra|pedido/.test(q)){
    const res=await store.estoque.alertas({ contrato, unidade, limite: undefined });
    let itens=res.itens;
    if(material) itens=itens.filter(e=> String(e.material).toUpperCase()===material);
    if(unidade) itens=itens.filter(e=> String(e.unidade)===unidade);
    // se contrato filtrado, já veio filtrado
    if(!itens.length) return { intent:'reposicao', text:`✅ Nenhuma reposição necessária${contrato?' em '+contrato:''}${unidade?' • '+unidade:''}. Tudo acima do mínimo.`, data:{ itens:[] }, suggestions:['saldo total '+(contrato||'CE01'),'ranking TZPR04'] };
    // calcula sugestão: levar até limite + 50% de margem (ex: TZPR04 de 0/5 sugere 8)
    const sug=itens.map(r=>{ const alvo=Math.ceil(r.limite*1.5); const qtd=Math.max(0, alvo - Number(r.saldo||0)); return { ...r, alvo, qtdSugerida: qtd }; }).sort((a,b)=> b.qtdSugerida - a.qtdSugerida);
    const totalPecas=sug.reduce((s,x)=>s+x.qtdSugerida,0);
    const txt=`🛒 **Reposição sugerida${contrato?' '+contrato:''}${unidade?' • '+unidade:''}** — ${sug.length} itens abaixo do mínimo (total ${totalPecas} peças para atingir 150% do mínimo)\n` + sug.map(r=> `• ${r.contrato} ${r.material} em ${r.unidade}: ${r.saldo}/${r.limite} → comprar **${r.qtdSugerida}** (alvo ${r.alvo})${r.saldo===0?' 🔴 ZERADO':''}`).join('\n') + `\n\n💡 Mínimos: TZPR04=5, UPR04=5, FONTE04=5, CINTA=10, TRAVAS=20`;
    return { intent:'reposicao', text: txt, data:{ itens: sug, totalPecas }, suggestions:['alertas '+(contrato||'CE01'),'comparar UMEPE vs UP-Cariri','saldo total '+(contrato||'CE01')] };
  }

  // COMPARAR
  if(/comparar| vs | versus |comparativo/.test(q)){
    const c=contrato||'CE01';
    const mats=material? [material] : MATERIAIS;
    const todas=await store.estoque.all();
    const filtradas=todas.filter(e=> String(e.contrato).toUpperCase()===c);
    // tenta extrair duas unidades do texto
    const partes=qRaw.split(/vs|versus|comparar/i).map(s=> s.trim()).filter(Boolean);
    let u1=null,u2=null;
    if(partes.length>=2){ u1=extractUnidade(partes[0])||extractUnidade(qRaw); 
      // segunda unidade: pega após vs
      const aposVs = qRaw.split(/vs|versus/i)[1]||'';
      u2=extractUnidade(aposVs);
    }
    if(!u1) u1=unidade||'UMEPE Juazeiro';
    if(!u2) u2=UNIDADES.find(u=> u!==u1) || 'UP-Cariri';
    const getSaldo=(u,mat)=>{ const r=filtradas.find(e=> e.unidade===u && e.material===mat); return r?Number(r.saldo||0):0; };
    const linhas=mats.map(m=>{ const a=getSaldo(u1,m), b=getSaldo(u2,m); const diff=a-b; return { material:m, u1:a, u2:b, diff, vencedor: diff>0?u1: diff<0?u2:'empate' }; });
    const txt=`⚖️ **Comparativo ${c}: ${u1} vs ${u2}**\n` + linhas.map(l=> `• ${l.material}: ${u1} **${l.u1}** vs ${u2} **${l.u2}** ${l.diff!==0?`(${l.diff>0?'+':''}${l.diff})`:''} → ${l.vencedor}`).join('\n');
    return { intent:'comparar', text: txt, data:{ contrato:c, u1, u2, linhas }, suggestions:[`saldo ${u1} ${c}`,`saldo ${u2} ${c}`,'ranking TZPR04 '+c] };
  }

  // TENDÊNCIA / EVOLUÇÃO
  if(/tendencia|evolucao|evolução|variacao/.test(q) || periodo){
    const c=contrato||'CE01';
    const mat=material||'TZPR04';
    const dias=periodo||7;
    const hoje=new Date();
    const pontos=[];
    for(let i=dias-1;i>=0;i--){
      const d=new Date(hoje); d.setDate(d.getDate()-i);
      const ds=d.toISOString().slice(0,10);
      try{
        const list=unidade? await store.estoque.atDate(c, ds, unidade) : await store.estoque.atDate(c, ds);
        const tot=list.filter(x=> x.material===mat).reduce((s,x)=>s+Number(x.saldo||0),0);
        pontos.push({ data:ds, saldo:tot });
      }catch(e){ pontos.push({ data: ds.slice(5), saldo: 0 }); }
    }
    const primeiro=pontos[0]?.saldo||0; const ultimo=pontos[pontos.length-1]?.saldo||0; const variacao=ultimo-primeiro;
    const txt=`📈 **Evolução ${mat} ${c}${unidade?' • '+unidade:''} — últimos ${dias} dias**\n` + pontos.map(p=> `${p.data.slice(5)}: ${p.saldo}`).join(' → ') + `\nVariação: ${variacao>0?'+':''}${variacao} (${primeiro} → ${ultimo})${variacao>0?' 📈': variacao<0?' 📉':' ➡️'}`;
    return { intent:'tendencia', text: txt, data:{ contrato:c, material:mat, unidade:unidade||null, dias, pontos, variacao }, suggestions:['histórico hoje '+c,'movimentações '+c,'alertas '+c] };
  }

  // SERIAL BUSCA - exata ou parcial
  if(serial){
    const qSer=String(serial).replace(/\D/g,'');
    const isExata=qSer.length===10;
    const allSer=await store.estoqueSerial.all(contrato? { contrato }: undefined);
    if(isExata){
      const found=allSer.find(s=> String(s.serial)===qSer);
      if(!found){
        // busca aproximada: contém substring
        const aprox=allSer.filter(s=> String(s.serial).includes(qSer)).slice(0,5);
        if(aprox.length) return { intent:'serial', text:`Serial ${qSer} não encontrado exato. Aproximados:\n` + aprox.map(s=> `• ${s.serial} — ${s.unidade} (${s.contrato}) ${s.status}`).join('\n'), data:{ serial:qSer, found:false, aprox }, suggestions:['seriais '+(contrato||'CE01'),'saldo TZPR04'] };
        return { intent:'serial', text:`Serial ${qSer} não encontrado em estoque${contrato?' em '+contrato:''}.`, data:{ serial:qSer, found:false }, suggestions:['seriais TZPR04 CE01','saldo TZPR04'] };
      }
      const statusTxt=found.status==='disponivel' ? `✅ disponível em **${found.unidade}** (${found.contrato})` : `📦 em uso (baixa) — último registro **${found.unidade}** (${found.contrato})`;
      return { intent:'serial', text:`Serial ${qSer}: ${statusTxt}.`, data:{ serial:qSer, found:true, row: found }, suggestions:['saldo TZPR04 '+found.unidade,'histórico '+found.unidade] };
    } else {
      // busca parcial
      const matches=allSer.filter(s=> String(s.serial).includes(qSer)).slice(0,20);
      if(!matches.length) return { intent:'serial', text:`Nenhum serial contém "${qSer}"${contrato?' em '+contrato:''}. Tente 10 dígitos completos.`, data:{ serial:qSer, found:false }, suggestions:['seriais UPR04 CE01'] };
      const txt=`🔍 Seriais contendo "${qSer}" — ${matches.length} encontrados (mostrando 20):\n` + matches.map(s=> `• ${s.serial} — ${s.unidade} (${s.contrato}) ${s.status==='disponivel'?'✅':'📦'}`).join('\n');
      return { intent:'serial', text: txt, data:{ serial:qSer, found:false, matches }, suggestions:['buscar serial 1234567890'] };
    }
  }

  // HISTÓRICO
  if(/historico|como estava|em\s+\d{4}-\d{2}-\d{2}|em\s+\d{2}\/\d{2}\/\d{4}/.test(q) || data){
    const c=contrato||'CE01';
    const d=data||new Date().toISOString().slice(0,10);
    try{
      let list;
      if(unidade) list=await store.estoque.atDate(c, d, unidade);
      else if(/detalhado|por unidade/.test(q)) list=await store.estoque.atDateDetailed(c, d);
      else list=await store.estoque.atDate(c, d);
      const total=list.reduce((s,x)=>s+Number(x.saldo||0),0);
      const detalhe=list.map(r=> `${r.material}${r.unidade&&r.unidade!=='TOTAL'?' ('+r.unidade+')':''}: ${r.saldo}${MATERIAIS_SERIAL.includes(r.material)&&r.seriais&&r.seriais.length?' ['+r.seriais.length+' seriais]':''}`).join('\n');
      const titulo=unidade?`Histórico ${c} em ${d} — ${unidade}`:`Histórico ${c} em ${d} — total geral`+ (/detalhado/.test(q)?' (detalhado por unidade)':'');
      return { intent:'historico', text:`📅 ${titulo} — Total: **${total}** unidades\n${detalhe}`, data:{ contrato:c, data:d, unidade:unidade||null, total, itens:list }, suggestions:['saldo atual '+c, 'movimentações '+c, 'evolução 7 dias '+c] };
    }catch(e){ return { intent:'erro', text:'Erro ao buscar histórico: '+e.message } }
  }

  // MOVIMENTAÇÕES
  if(/movimentac|ultimas|recentes|hoje|ontem|esta semana/.test(q)){
    let movs=await store.estoqueMov.all({ limit: 50, contrato, unidade, material });
    if(/hoje/.test(q)){
      const hoje=new Date().toISOString().slice(0,10);
      movs=movs.filter(m=> String(m.createdAt).slice(0,10)===hoje);
    } else if(/ontem/.test(q)){
      const d=new Date(); d.setDate(d.getDate()-1); const ds=d.toISOString().slice(0,10);
      movs=movs.filter(m=> String(m.createdAt).slice(0,10)===ds);
    } else if(/esta semana|ultimos 7/.test(q)){
      const lim=new Date(); lim.setDate(lim.getDate()-7);
      movs=movs.filter(m=> new Date(m.createdAt) >= lim);
    }
    movs=movs.slice(0, 20);
    if(!movs.length) return { intent:'movs', text:'Nenhuma movimentação encontrada para o filtro.', data:{ movs:[] }, suggestions:['histórico hoje','alertas'] };
    const txt=movs.map(m=> `${new Date(m.createdAt).toLocaleString('pt-BR')} — ${m.tipo.toUpperCase()} ${m.qtd}x ${m.material} em ${m.unidade}${m.unidadeDestino?' → '+m.unidadeDestino:''} (${m.contrato}) | ${m.motivo||''} | ${m.userName||m.user} [${m.saldoAntes}→${m.saldoDepois}]${m.seriais&&m.seriais.length?' | seriais: '+m.seriais.slice(0,2).join(', ')+(m.seriais.length>2?' +'+(m.seriais.length-2):''):''}${m.estornado?' (ESTORNADO)':''}`).join('\n');
    return { intent:'movs', text:`📋 Últimas ${movs.length} movimentações${contrato?' '+contrato:''}${unidade?' em '+unidade:''}${material?' '+material:''}:\n${txt}`, data:{ movs }, suggestions:['histórico '+ (contrato||'CE01'),'reposição '+(contrato||'CE01')] };
  }

  // SERIAIS LISTAGEM
  if(/seriais|serial/.test(q) && !serial){
    let ser=await store.estoqueSerial.all({ contrato, unidade });
    const matSerial = material && MATERIAIS_SERIAL.includes(material) ? material : null;
    if(material && !MATERIAIS_SERIAL.includes(material)) return { intent:'erro', text:`Apenas ${MATERIAIS_SERIAL.join('/')} possuem seriais rastreados (10 dígitos).` };
    let serFiltrado = ser;
    const disponiveis=serFiltrado.filter(s=> s.status==='disponivel');
    const emUso=serFiltrado.filter(s=> s.status==='em_uso');
    const porUnidade={};
    disponiveis.forEach(s=>{ porUnidade[s.unidade]=(porUnidade[s.unidade]||0)+1; });
    const total=disponiveis.length;
    const detalhe=Object.entries(porUnidade).map(([u,c])=> `${u}: ${c}`).join('\n') || 'nenhum';
    const lista=disponiveis.slice(0,30).map(s=> `${s.serial} — ${s.unidade} (${s.contrato})`).join('\n');
    const label=matSerial||'TZPR04/UPR04';
    return { intent:'seriais', text:`🔢 Seriais ${label} disponíveis — Total **${total}** (em uso: ${emUso.length})\nPor unidade:\n${detalhe}${lista?'\n\nExemplos:\n'+lista:''}`, data:{ total, emUso: emUso.length, porUnidade, seriais: disponiveis.slice(0,100) }, suggestions:['buscar serial 1234567890','saldo '+label] };
  }

  // RANKING
  if(/ranking|qual unidade.*mais|maior estoque|onde tem mais|top/.test(q)){
    const mat=material||'TZPR04';
    const c=contrato||'CE01';
    const all=await store.estoque.all();
    const rows=all.filter(e=> String(e.contrato).toUpperCase()===c && String(e.material).toUpperCase()===mat);
    if(!rows.length) return { intent:'ranking', text:`Sem dados para ${mat} ${c}` };
    const sorted=[...rows].sort((a,b)=> Number(b.saldo)-Number(a.saldo));
    const top=sorted[0];
    const txt=sorted.map((r,i)=> `${i===0?'🥇':i===1?'🥈':i===2?'🥉':'•'} ${r.unidade}: ${r.saldo}`).join('\n');
    return { intent:'ranking', text:`🏆 Ranking ${mat} ${c} — maior: **${top.unidade}** com ${top.saldo} unidades\n\n${txt}`, data:{ material:mat, contrato:c, ranking:sorted }, suggestions:['comparar UMEPE vs UP-Cariri','alertas '+c] };
  }

  // ESTOQUE BAIXO / ALERTAS
  if(/baixo|critico|alerta|abaixo|zerado/.test(q)){
    const thrOverride=extractThreshold(qRaw, material);
    const res=await store.estoque.alertas({ contrato, unidade, limite: thrOverride||undefined });
    let baixos=res.itens;
    if(material) baixos=baixos.filter(e=> String(e.material).toUpperCase()===material);
    if(!baixos.length) return { intent:'baixo', text:`✅ Nenhum item abaixo do mínimo${contrato?' em '+contrato:''}${unidade?' em '+unidade:''}${material?' ('+material+')':''}.`, data:{ threshold: thrOverride, baixos:[], ...res } };
    const txt=baixos.map(r=> `${r.contrato} ${r.material} em ${r.unidade}: ${r.saldo}/${r.limite} (faltam ${r.deficit})${r.saldo===0?' 🔴 ZERADO':''}`).join('\n');
    const thrInfo = thrOverride ? `abaixo de ${thrOverride}` : 'abaixo do mínimo configurado';
    return { intent:'baixo', text:`⚠️ Itens ${thrInfo} (${baixos.length}${res.criticos?`, ${res.criticos} zerados`:''}):\n${txt}\n\n💡 Dica: digite “reposição ${contrato||'CE01'}” para ver o que comprar.`, data:{ threshold: thrOverride, baixos, ...res }, suggestions:['reposição '+(contrato||'CE01'),'ranking TZPR04'] };
  }

  // UNIDADES
  if(/unidades|localidades/.test(q)){
    return { intent:'unidades', text:`📍 Unidades cadastradas (${UNIDADES.length}):\n${UNIDADES.join('\n')}`, data:{ unidades: UNIDADES } };
  }

  // SALDO - expandido com sinônimos
  if(/saldo|estoque|quantos|quanto tem|qtd|total|tem quantos|quantidade/.test(q) || material || unidade || contrato){
    let all=await store.estoque.all();
    let filtroDesc=[];
    if(contrato){ all=all.filter(e=> String(e.contrato).toUpperCase()===contrato); filtroDesc.push(contrato); }
    if(unidade){ all=all.filter(e=> String(e.unidade)===unidade); filtroDesc.push(unidade); }
    if(material){ all=all.filter(e=> String(e.material).toUpperCase()===material); filtroDesc.push(material); }
    if(!contrato && !unidade && !material){
      const porContrato={};
      all.forEach(e=>{ porContrato[e.contrato]=(porContrato[e.contrato]||0)+Number(e.saldo||0); });
      const total=all.reduce((s,x)=>s+Number(x.saldo||0),0);
      const txt=Object.entries(porContrato).map(([c,v])=> `${c}: ${v}`).join('\n');
      const porUnidade={};
      all.forEach(e=>{ porUnidade[e.unidade]=(porUnidade[e.unidade]||0)+Number(e.saldo||0); });
      const txtU=Object.entries(porUnidade).map(([u,v])=> `${u}: ${v}`).join('\n');
      return { intent:'saldo', text:`📦 Saldo total geral: **${fmtSaldo(total)}** unidades\nPor contrato:\n${txt}\n\nPor unidade:\n${txtU}`, data:{ total, porContrato, porUnidade, itens: all } };
    }
    const total=all.reduce((s,x)=>s+Number(x.saldo||0),0);
    let detalhe='';
    if(unidade && contrato && !material){
      detalhe=all.map(e=> `${e.material}: ${e.saldo} ${Number(e.saldo||0) < (LIMITES[e.material]||5)?'⚠️':''}`).join('\n');
    } else if(material && unidade){
      const row=all[0];
      detalhe=row?`${row.material} em ${row.unidade} (${row.contrato}): **${row.saldo}** unidades`:`Sem registro para ${material} em ${unidade}`;
      if(row && MATERIAIS_SERIAL.includes(material)){
        const serAll=await store.estoqueSerial.byContratoUnidade(row.contrato, row.unidade);
        const disp=serAll.filter(s=> s.status==='disponivel');
        detalhe+=`\nSeriais ${material} disponíveis: ${disp.length}${disp.length?'\n'+disp.slice(0,10).map(s=>s.serial).join(', ')+(disp.length>10?' +'+(disp.length-10):''):''}`;
      }
    } else {
      detalhe=all.map(e=> `${e.contrato} ${e.material} em ${e.unidade}: ${e.saldo} ${Number(e.saldo||0) < (LIMITES[e.material]||5)?'⚠️':''}`).join('\n');
    }
    const titulo=filtroDesc.length?`Saldo ${filtroDesc.join(' ')}`:'Saldo';
    return { intent:'saldo', text:`📦 ${titulo} — Total: **${fmtSaldo(total)}** unidades\n${detalhe}`, data:{ total, itens: all, contrato, unidade, material }, suggestions:['alertas '+(contrato||'CE01'),'ranking '+(material||'TZPR04')] };
  }

  // fallback
  return { intent:'nao_entendi', text:`🤔 Não entendi: “${qRaw}”.\nTente:\n• “saldo TZPR04 UMEPE Juazeiro CE01”\n• “reposição CE01” — o que comprar\n• “comparar UMEPE vs UP-Cariri”\n• “histórico ontem” / “evolução 7 dias TZPR04”\n• “seriais disponíveis” / “buscar serial 1234”\n• “ranking CINTA” / “estoque baixo”`, suggestions:['saldo total CE01','reposição CE01','comparar UMEPE vs UP-Cariri','histórico ontem','seriais UPR04','ranking CINTA'] };
}

module.exports={ answer, UNIDADES, MATERIAIS };
