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
  return null;
}
function extractUnidade(q){
  const n=norm(q);
  for(const u of UNIDADES){
    if(n.includes(norm(u))) return u;
  }
  // alias sem acento / abrev
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
  return null;
}
function extractSerial(q){
  const m=String(q).match(/\b\d{10}\b/);
  return m?m[0]:null;
}
function extractThreshold(q, material){
  const m=String(q).match(/(abaixo de|menor que|<)\s*(\d+)/i);
  if(m) return Number(m[2]);
  if(/baixo|critico|alerta/.test(norm(q))){
    if(material && LIMITES[material]) return LIMITES[material];
    return null; // usa limite por material no store
  }
  return null;
}

async function answer(query, store){
  const qRaw=String(query||'').trim();
  if(!qRaw) return { intent:'vazio', text:'Digite um comando. Ex: “saldo TZPR04 em UMEPE Juazeiro CE01”', suggestions:['saldo TZPR04 UMEPE Juazeiro CE01','histórico 2026-09-20','seriais disponíveis','ranking CINTA','movimentações hoje'] };
  const q=norm(qRaw);
  const contrato=extractContrato(qRaw);
  const material=extractMaterial(qRaw);
  const unidade=extractUnidade(qRaw);
  const data=extractData(qRaw);
  const serial=extractSerial(qRaw);

  // HELP
  if(/ajuda|help|como usar|comandos/.test(q)){
    return {
      intent:'help',
      text:`Comandos disponíveis (on-prem, sem IA externa):\n• saldo [material] [unidade] [CE01/CE02] — ex: “saldo TZPR04 UMEPE Juazeiro CE01”\n• resumo [CE01/CE02] [unidade] — visão consolidada\n• alertas / estoque baixo / abaixo de N — itens críticos (limites: TZPR04=5, UPR04=5, FONTE04=5, CINTA=10, TRAVAS=20)\n• histórico [data YYYY-MM-DD] [unidade] — reconstrução até 23:59\n• movimentações [hoje|últimas] — últimas 20\n• seriais [material] / buscar serial 1234567890\n• ranking [material] — unidade com mais estoque\n• unidades — lista localidades`,
      data:null,
      suggestions:['saldo total CE01','resumo CE01','alertas CE01','saldo TZPR04 UMEPE Juazeiro','histórico 2026-09-24 UMEPE Juazeiro','últimas movimentações','seriais TZPR04 CE01','ranking CINTA','estoque baixo']
    };
  }

  // RESUMO
  if(/resumo|consolidado|visao geral/.test(q)){
    const res=await store.estoque.resumo({ contrato, unidade });
    const txt=`Resumo ${contrato||'geral'}${unidade?' em '+unidade:''} — Total: ${res.total} unidades\nPor contrato: ${Object.entries(res.porContrato).map(([c,v])=>c+': '+v).join(', ')}\nPor unidade: ${Object.entries(res.porUnidade).map(([u,v])=>u+': '+v).join(', ')}\nPor material: ${Object.entries(res.porMaterial).map(([m,v])=>m+': '+v).join(', ')}${res.alertas && res.alertas.total?'\n⚠️ Alertas: '+res.alertas.total+' itens abaixo do mínimo ('+res.alertas.criticos+' zerados)':''}`;
    return { intent:'resumo', text: txt, data: res, suggestions:['alertas'+(contrato?' '+contrato:''),'saldo total'+(contrato?' '+contrato:''),'ranking CINTA'] };
  }

  // SERIAL BUSCA
  if(serial){
    const allSer=await store.estoqueSerial.all(contrato? { contrato }: undefined);
    const found=allSer.find(s=> String(s.serial)===serial);
    if(!found) return { intent:'serial', text:`Serial ${serial} não encontrado em estoque${contrato?' em '+contrato:''}.`, data:{ serial, found:false }, suggestions:['seriais TZPR04 CE01','saldo TZPR04'] };
    const statusTxt=found.status==='disponivel' ? `disponível em ${found.unidade} (${found.contrato})` : `em uso (baixa) — último registro ${found.unidade} (${found.contrato})`;
    return { intent:'serial', text:`Serial ${serial}: ${statusTxt}.`, data:{ serial, found:true, row: found }, suggestions:['saldo TZPR04 '+found.unidade,'histórico '+found.unidade] };
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
      return { intent:'historico', text:`${titulo} — Total: ${total} unidades\n${detalhe}`, data:{ contrato:c, data:d, unidade:unidade||null, total, itens:list }, suggestions:['saldo atual '+c, 'movimentações '+c] };
    }catch(e){ return { intent:'erro', text:'Erro ao buscar histórico: '+e.message } }
  }

  // MOVIMENTAÇÕES
  if(/movimentac|ultimas|recentes|hoje/.test(q)){
    let movs=await store.estoqueMov.all({ limit: 50, contrato, unidade, material });
    if(/hoje/.test(q)){
      const hoje=new Date().toISOString().slice(0,10);
      movs=movs.filter(m=> String(m.createdAt).slice(0,10)===hoje);
    }
    movs=movs.slice(0, 20);
    if(!movs.length) return { intent:'movs', text:'Nenhuma movimentação encontrada para o filtro.', data:{ movs:[] } };
    const txt=movs.map(m=> `${new Date(m.createdAt).toLocaleString('pt-BR')} — ${m.tipo.toUpperCase()} ${m.qtd}x ${m.material} em ${m.unidade}${m.unidadeDestino?' → '+m.unidadeDestino:''} (${m.contrato}) | ${m.motivo||''} | ${m.userName||m.user} [${m.saldoAntes}→${m.saldoDepois}]${m.seriais&&m.seriais.length?' | seriais: '+m.seriais.slice(0,3).join(', ')+(m.seriais.length>3?' +'+(m.seriais.length-3):''):''}${m.estornado?' (ESTORNADO)':''}`).join('\n');
    return { intent:'movs', text:`Últimas ${movs.length} movimentações${contrato?' '+contrato:''}${unidade?' em '+unidade:''}${material?' '+material:''}:\n${txt}`, data:{ movs } };
  }

  // SERIAIS LISTAGEM
  if(/seriais|serial/.test(q) && !serial){
    let ser=await store.estoqueSerial.all({ contrato, unidade });
    const matSerial = material && MATERIAIS_SERIAL.includes(material) ? material : null;
    if(material && !MATERIAIS_SERIAL.includes(material)) return { intent:'erro', text:`Apenas ${MATERIAIS_SERIAL.join('/')} possuem seriais rastreados (10 dígitos).` };
    let serFiltrado = ser;
    if(matSerial){
      // filtra por material implícito via saldo? Serial store não guarda material, mas separa por contrato/unidade; assume TZPR04/UPR04 compartilham pool mas exibimos total
    }
    const disponiveis=serFiltrado.filter(s=> s.status==='disponivel');
    const emUso=serFiltrado.filter(s=> s.status==='em_uso');
    const porUnidade={};
    disponiveis.forEach(s=>{ porUnidade[s.unidade]=(porUnidade[s.unidade]||0)+1; });
    const total=disponiveis.length;
    const detalhe=Object.entries(porUnidade).map(([u,c])=> `${u}: ${c}`).join('\n') || 'nenhum';
    const lista=disponiveis.slice(0,30).map(s=> `${s.serial} — ${s.unidade} (${s.contrato})`).join('\n');
    const label=matSerial||'TZPR04/UPR04';
    return { intent:'seriais', text:`Seriais ${label} disponíveis — Total ${total} (em uso: ${emUso.length})\nPor unidade:\n${detalhe}${lista?'\n\nExemplos:\n'+lista:''}`, data:{ total, emUso: emUso.length, porUnidade, seriais: disponiveis.slice(0,100) } };
  }

  // RANKING
  if(/ranking|qual unidade.*mais|maior estoque|onde tem mais/.test(q)){
    const mat=material||'TZPR04';
    const c=contrato||'CE01';
    const all=await store.estoque.all();
    const rows=all.filter(e=> String(e.contrato).toUpperCase()===c && String(e.material).toUpperCase()===mat);
    if(!rows.length) return { intent:'ranking', text:`Sem dados para ${mat} ${c}` };
    const sorted=[...rows].sort((a,b)=> Number(b.saldo)-Number(a.saldo));
    const top=sorted[0];
    const txt=sorted.map(r=> `${r.unidade}: ${r.saldo}`).join('\n');
    return { intent:'ranking', text:`Ranking ${mat} ${c} — maior: ${top.unidade} com ${top.saldo} unidades\n\n${txt}`, data:{ material:mat, contrato:c, ranking:sorted } };
  }

  // ESTOQUE BAIXO / ALERTAS
  if(/baixo|critico|alerta|abaixo|zerado/.test(q)){
    const thrOverride=extractThreshold(qRaw, material);
    const res=await store.estoque.alertas({ contrato, unidade, limite: thrOverride||undefined });
    // se filtro material específico, refina
    let baixos=res.itens;
    if(material) baixos=baixos.filter(e=> String(e.material).toUpperCase()===material);
    if(!baixos.length) return { intent:'baixo', text:`✅ Nenhum item abaixo do mínimo${contrato?' em '+contrato:''}${unidade?' em '+unidade:''}${material?' ('+material+')':''}.`, data:{ threshold: thrOverride, baixos:[], ...res } };
    const txt=baixos.map(r=> `${r.contrato} ${r.material} em ${r.unidade}: ${r.saldo}/${r.limite} (faltam ${r.deficit})${r.saldo===0?' 🔴 ZERADO':''}`).join('\n');
    const thrInfo = thrOverride ? `abaixo de ${thrOverride}` : 'abaixo do mínimo configurado';
    return { intent:'baixo', text:`⚠️ Itens ${thrInfo} (${baixos.length}${res.criticos?`, ${res.criticos} zerados`:''}):\n${txt}`, data:{ threshold: thrOverride, baixos, ...res } };
  }

  // UNIDADES
  if(/unidades|localidades/.test(q)){
    return { intent:'unidades', text:`Unidades cadastradas (${UNIDADES.length}):\n${UNIDADES.join('\n')}`, data:{ unidades: UNIDADES } };
  }

  // SALDO (default quando menciona saldo/estoque/quantos/quanto tem)
  if(/saldo|estoque|quantos|quanto tem|qtd|total/.test(q) || material || unidade || contrato){
    // saldo por material/unidade/contrato
    let all=await store.estoque.all();
    let filtroDesc=[];
    if(contrato){ all=all.filter(e=> String(e.contrato).toUpperCase()===contrato); filtroDesc.push(contrato); }
    if(unidade){ all=all.filter(e=> String(e.unidade)===unidade); filtroDesc.push(unidade); }
    if(material){ all=all.filter(e=> String(e.material).toUpperCase()===material); filtroDesc.push(material); }
    // se filtro muito amplo (sem nada), mostra total geral
    if(!contrato && !unidade && !material){
      // total geral por contrato
      const porContrato={};
      all.forEach(e=>{ porContrato[e.contrato]=(porContrato[e.contrato]||0)+Number(e.saldo||0); });
      const total=all.reduce((s,x)=>s+Number(x.saldo||0),0);
      const txt=Object.entries(porContrato).map(([c,v])=> `${c}: ${v}`).join('\n');
      // por unidade agregado
      const porUnidade={};
      all.forEach(e=>{ porUnidade[e.unidade]=(porUnidade[e.unidade]||0)+Number(e.saldo||0); });
      const txtU=Object.entries(porUnidade).map(([u,v])=> `${u}: ${v}`).join('\n');
      return { intent:'saldo', text:`Saldo total geral: ${total} unidades\nPor contrato:\n${txt}\n\nPor unidade:\n${txtU}`, data:{ total, porContrato, porUnidade, itens: all } };
    }
    // com filtros
    const total=all.reduce((s,x)=>s+Number(x.saldo||0),0);
    // detalhe por material se unidade+contrato filtrados
    let detalhe='';
    if(unidade && contrato && !material){
      detalhe=all.map(e=> `${e.material}: ${e.saldo}`).join('\n');
    } else if(material && unidade){
      const row=all[0];
      detalhe=row?`${row.material} em ${row.unidade} (${row.contrato}): ${row.saldo} unidades`:`Sem registro para ${material} em ${unidade}`;
      if(row && MATERIAIS_SERIAL.includes(material)){
        const serAll=await store.estoqueSerial.byContratoUnidade(row.contrato, row.unidade);
        const disp=serAll.filter(s=> s.status==='disponivel');
        detalhe+=`\nSeriais ${material} disponíveis: ${disp.length}${disp.length?'\n'+disp.slice(0,10).map(s=>s.serial).join(', ')+(disp.length>10?' +'+(disp.length-10):''):''}`;
      }
    } else {
      detalhe=all.map(e=> `${e.contrato} ${e.material} em ${e.unidade}: ${e.saldo}`).join('\n');
    }
    const titulo=filtroDesc.length?`Saldo ${filtroDesc.join(' ')}`:'Saldo';
    return { intent:'saldo', text:`${titulo} — Total: ${total} unidades\n${detalhe}`, data:{ total, itens: all, contrato, unidade, material } };
  }

  // fallback
  return { intent:'nao_entendi', text:`Não entendi: “${qRaw}”.\nTente: “saldo TZPR04 UMEPE Juazeiro CE01”, “resumo CE01”, “alertas CE01”, “histórico 2026-09-24”, “seriais disponíveis”, “ranking CINTA”, “estoque baixo”, “últimas movimentações”.`, suggestions:['saldo total CE01','resumo CE01','alertas CE01','saldo TZPR04 UMEPE Juazeiro CE01','histórico 2026-09-24','seriais TZPR04','ranking CINTA'] };
}

module.exports={ answer, UNIDADES, MATERIAIS };
