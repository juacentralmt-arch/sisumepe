// =====================================================================
//  SISUMEPE — camada de persistência (arquivo local OU Supabase)
//  Modo Supabase ativa com: SUPABASE_URL + SUPABASE_KEY no ambiente.
//  Sem elas, usa db.json local (comportamento original).
// =====================================================================
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const MODE = (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) ? 'supabase' : 'file';
const ROOT = path.join(__dirname);
const DB_FILE = path.join(ROOT, 'db.json');
const UPLOAD_DIR = path.join(ROOT, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const UNIDADES = ['UMEPE Juazeiro','UP-Juazeiro','UP-Cariri','UP-Crato','Fórum de Crato','Fórum de Jardim'];
const DEFAULT_UNIDADE = 'UMEPE Juazeiro';
const MATERIAIS = ['TZPR04','UPR04','FONTE04','CINTA','TRAVAS'];
// Materiais por sistema: Infinity trabalha só com TZPR (sem "04") + insumos —
// UPR04 não existe no Infinity. Spacecom mantém os 5 códigos originais.
const MATERIAIS_SPACECOM = ['TZPR04','UPR04','FONTE04','CINTA','TRAVAS'];
const MATERIAIS_INFINITY = ['TZPR','FONTE04','CINTA','TRAVAS'];
const MATERIAIS_COM_SERIAL = ['TZPR04','UPR04','TZPR'];
const ESTOQUE_LIMITES = { TZPR04: 5, TZPR: 5, UPR04: 5, FONTE04: 5, CINTA: 10, TRAVAS: 20 };
function materiaisDoSistema(sistema){
  const s = normalizeSistema(sistema);
  if(s==='infinity') return [...MATERIAIS_INFINITY];
  if(s==='spacecom') return [...MATERIAIS_SPACECOM];
  return [...new Set([...MATERIAIS_SPACECOM, ...MATERIAIS_INFINITY])];
}
// Serial 431xxx é TZPR04 no Spacecom e TZPR no Infinity; 471xxx é UPR04.
function materialDoSerial(serial, sistema){
  const v = String(serial || '');
  if(v.startsWith('431')) return normalizeSistema(sistema)==='infinity' ? 'TZPR' : 'TZPR04';
  if(v.startsWith('471')) return 'UPR04';
  return null;
}
const ESTOQUE_CONTRATOS = ['CE01','CE02'];
const CONTRATO_INFINITY = 'INF';
const CONTRATOS_SPACECOM = ['CE01','CE02'];
const SISTEMAS = ['spacecom','infinity'];
const DEFAULT_SISTEMA = 'spacecom';
function temSerial(material){ return MATERIAIS_COM_SERIAL.includes(String(material||'').toUpperCase()); }
function normalizeContrato(contrato, sistema){
  const raw=String(contrato||'').toUpperCase().trim();
  const sis=sistema ? normalizeSistema(sistema) : null;
  if(sis==='infinity'){
    // Infinity é estoque único: tudo vira INF (CE01/CE02 legados também)
    if(!raw) return CONTRATO_INFINITY;
    if(raw==='INF'||raw==='INFINITY'||raw==='ESTOQUE INFINITY'||raw==='ESTOQUEINFINITY') return CONTRATO_INFINITY;
    if(raw==='CE01'||raw==='CE02') return CONTRATO_INFINITY;
    return CONTRATO_INFINITY;
  }
  if(sis==='spacecom'){
    if(!raw) return null;
    if(raw==='CE01'||raw==='CE02') return raw;
    return raw; // validação posterior rejeita
  }
  // sistema null (admin vendo tudo): normaliza aliases
  if(!raw) return null;
  if(raw==='INF'||raw==='INFINITY'||raw==='ESTOQUE INFINITY'||raw==='ESTOQUEINFINITY') return CONTRATO_INFINITY;
  return raw;
}
function contratoLabel(contrato){
  const c=String(contrato||'').toUpperCase().trim();
  if(c==='INF'||c==='INFINITY') return 'Estoque Infinity';
  return c;
}
function contratosDoSistema(sistema){
  const sis=normalizeSistema(sistema);
  if(sis==='infinity') return [CONTRATO_INFINITY];
  if(sis==='spacecom') return [...CONTRATOS_SPACECOM];
  return [...CONTRATOS_SPACECOM, CONTRATO_INFINITY];
}
function normalizeSistema(s){
  const v=String(s||'').toLowerCase().trim();
  if(v==='infinity' || v==='inf' || v==='infinito') return 'infinity';
  if(v==='spacecom' || v==='space' || v==='spc') return 'spacecom';
  return null;
}
function getUserSistema(userObj){
  if(!userObj) return DEFAULT_SISTEMA;
  if(userObj.role==='admin') return null; // null = acesso a todos
  if(userObj.sistema) return normalizeSistema(userObj.sistema) || DEFAULT_SISTEMA;
  // fallback por usuário
  const u=normalizeUser(userObj.user||'');
  if(['julio','marcelo'].includes(u)) return 'infinity';
  if(['joanderson','adailton','secretaria'].includes(u)) return 'spacecom';
  return DEFAULT_SISTEMA;
}
function parseSeriaisInput(v){
  if(Array.isArray(v)) return v.map(s=> String(s).replace(/\D/g,'')).filter(s=> s.length===10);
  const s=String(v||'');
  const m=s.match(/\b\d{10}\b/g);
  if(m && m.length) return m;
  const m2=s.match(/\d{10}/g);
  return m2||[];
}
function normalizeUnidade(u){
  const s=String(u||'').trim();
  if(!s) return DEFAULT_UNIDADE;
  const found=UNIDADES.find(x=> x.toLowerCase()===s.toLowerCase() || x.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()===s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase());
  return found||s;
}
function isValidUnidade(u){ return UNIDADES.some(x=> x.toLowerCase()===String(u||'').trim().toLowerCase()); }
// Migração Infinity (TZPR): renomeia TZPR04→TZPR com merge de saldos e exclui
// UPR04 em definitivo (estoque + movimentações + seriais 471). Idempotente.
function migrarInfinityMateriais(){
  if(!mem || !Array.isArray(mem.estoque)) return false;
  if(!Array.isArray(mem.estoqueMov)) mem.estoqueMov = [];
  if(!Array.isArray(mem.estoqueSerial)) mem.estoqueSerial = [];
  let changed = false;
  const isInf = r => normalizeSistema(r.sistema || DEFAULT_SISTEMA)==='infinity';
  // 1. histórico: TZPR04 do infinity vira TZPR
  for(const m of mem.estoqueMov){
    if(isInf(m) && String(m.material).toUpperCase()==='TZPR04'){ m.material='TZPR'; changed=true; }
  }
  // 2. saldos: TZPR04 do infinity vira TZPR (soma se a linha TZPR já existir)
  for(const e of mem.estoque.filter(e=> isInf(e) && String(e.material).toUpperCase()==='TZPR04')){
    const exist = mem.estoque.find(x=> x!==e && isInf(x) && String(x.contrato).toUpperCase()===String(e.contrato).toUpperCase() && String(x.material).toUpperCase()==='TZPR' && x.unidade===e.unidade);
    if(exist){ exist.saldo=Number(exist.saldo||0)+Number(e.saldo||0); exist.updatedAt=new Date().toISOString(); mem.estoque.splice(mem.estoque.indexOf(e),1); }
    else { e.material='TZPR'; e.updatedAt=new Date().toISOString(); }
    changed=true;
  }
  // 3. UPR04 do infinity: exclusão definitiva
  const nE=mem.estoque.length, nM=mem.estoqueMov.length, nS=mem.estoqueSerial.length;
  mem.estoque=mem.estoque.filter(e=> !(isInf(e) && String(e.material).toUpperCase()==='UPR04'));
  mem.estoqueMov=mem.estoqueMov.filter(m=> !(isInf(m) && String(m.material).toUpperCase()==='UPR04'));
  mem.estoqueSerial=mem.estoqueSerial.filter(s=> !(isInf(s) && String(s.serial).startsWith('471')));
  if(mem.estoque.length!==nE || mem.estoqueMov.length!==nM || mem.estoqueSerial.length!==nS) changed=true;
  return changed;
}
function normalizeUser(u) {
  return String(u || '').toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '');
}

function seedUsers() {
  return [
    { user: 'recepcao', name: 'Recepção', role: 'recepcao', pass: 'recepcao123', active: true, sistema: 'spacecom' },
    { user: 'joanderson', name: 'Joanderson', role: 'tecnico', pass: 'joanderson123', active: true, sistema: 'spacecom' },
    { user: 'adailton', name: 'Adailton', role: 'tecnico', pass: 'adailton123', active: true, sistema: 'spacecom' },
    { user: 'julio', name: 'Júlio Cesar', role: 'tecnico', pass: 'julio123', active: true, sistema: 'infinity' },
    { user: 'marcelo', name: 'Marcelo', role: 'tecnico', pass: 'marcelo123', active: true, sistema: 'infinity' },
    { user: 'psicologo', name: 'Psicólogo', role: 'psico', pass: 'psicologo123', active: true, sistema: 'spacecom' },
    { user: 'secretaria', name: 'Secretária', role: 'tecnico', pass: 'secretaria123', active: true, sistema: 'spacecom' },
    { user: 'admin', name: 'Administrador', role: 'admin', pass: 'admin123', active: true, sistema: null }
  ];
}

// ----------------------------- FILE ---------------------------------
let mem = null;
function loadFile() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      mem = { persons: [], tickets: [], chat: [], audit: [], users: seedUsers(), sessions: {}, agenda: [], googleTokens: {}, termos: [], seqPerson: 1, seqTicket: 1, seqChat: 1, seqAudit: 1, seqAgenda: 1, seqTermo: 1 };
      fs.writeFileSync(DB_FILE, JSON.stringify(mem, null, 2));
      return mem;
    }
    mem = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    if (!Array.isArray(mem.chat)) mem.chat = [];
    if (!mem.seqChat) mem.seqChat = mem.chat.length + 1;
    if (!Array.isArray(mem.audit)) mem.audit = [];
    if (!mem.seqAudit) mem.seqAudit = mem.audit.length + 1;
    if (!Array.isArray(mem.users) || !mem.users.length) mem.users = seedUsers();
    else seedUsers().forEach(s => { if (!mem.users.some(u => normalizeUser(u.user) === normalizeUser(s.user))) mem.users.push(Object.assign({}, s)); });
    // Migração: normaliza usuários com acento (ex: psicólogo -> psicologo) e remove duplicatas
    const seen = new Set();
    const deduped = [];
    for (const u of mem.users) {
      const norm = normalizeUser(u.user);
      // corrige nome de usuário acentuado para canônico sem acento
      if (norm !== u.user) u.user = norm;
      if (seen.has(norm)) continue;
      seen.add(norm);
      deduped.push(u);
    }
    mem.users = deduped;
    mem.users.forEach(u => { if (u.active === undefined) u.active = true; });
    // Migração sistema: garante campo sistema para controle Spacecom/Infinity
    mem.users.forEach(u=>{
      if(u.sistema===undefined){
        const s=getUserSistema(u);
        if(u.role==='admin') u.sistema=null;
        else u.sistema=s;
      } else if(u.sistema){
        u.sistema=normalizeSistema(u.sistema);
        if(u.role==='admin') u.sistema=null;
      } else if(u.role!=='admin' && !u.sistema){
        u.sistema=getUserSistema(u);
      }
    });
    if (!mem.sessions || typeof mem.sessions !== 'object') mem.sessions = {};
    if (!Array.isArray(mem.agenda)) mem.agenda = [];
    if (!mem.seqAgenda) mem.seqAgenda = mem.agenda.length ? Math.max(...mem.agenda.map(x=>x.id))+1 : 1;
    if (!mem.googleTokens || typeof mem.googleTokens !== 'object') mem.googleTokens = {};
    if (!Array.isArray(mem.termos)) mem.termos = [];
    if (!mem.seqTermo) mem.seqTermo = mem.termos.length ? Math.max(...mem.termos.map(x=>x.id))+1 : 1;
    if (!Array.isArray(mem.estoque)) mem.estoque = [];
    if (!mem.seqEstoque) mem.seqEstoque = mem.estoque.length ? Math.max(...mem.estoque.map(x=>x.id))+1 : 1;
    if (!Array.isArray(mem.estoqueMov)) mem.estoqueMov = [];
    if (!mem.seqEstoqueMov) mem.seqEstoqueMov = mem.estoqueMov.length ? Math.max(...mem.estoqueMov.map(x=>x.id))+1 : 1;
    if (!Array.isArray(mem.estoqueSerial)) mem.estoqueSerial = [];
    if (!mem.seqEstoqueSerial) mem.seqEstoqueSerial = mem.estoqueSerial.length ? Math.max(...mem.estoqueSerial.map(x=>x.id))+1 : 1;
     // inicializa estoque padrão: spacecom CE01/CE02 x 5 materiais x 6 unidades + infinity INF (Estoque Infinity) x 5 x 6
    // migração: garante campo unidade e sistema em registros antigos + unifica infinity CE01/CE02 em INF
    let needSave=false;
    mem.estoque.forEach(e=>{ if(!e.unidade){ e.unidade=DEFAULT_UNIDADE; needSave=true; } else e.unidade=normalizeUnidade(e.unidade); if(!e.sistema){ e.sistema=DEFAULT_SISTEMA; needSave=true; } else e.sistema=normalizeSistema(e.sistema)||DEFAULT_SISTEMA; });
    mem.estoqueMov.forEach(m=>{ if(!m.unidade){ m.unidade=DEFAULT_UNIDADE; needSave=true; } else m.unidade=normalizeUnidade(m.unidade); if(!m.sistema){ m.sistema=DEFAULT_SISTEMA; needSave=true; } else m.sistema=normalizeSistema(m.sistema)||DEFAULT_SISTEMA; });
    mem.estoqueSerial.forEach(s=>{ if(!s.unidade){ s.unidade=DEFAULT_UNIDADE; needSave=true; } else s.unidade=normalizeUnidade(s.unidade); if(!s.sistema){ s.sistema=DEFAULT_SISTEMA; needSave=true; } else s.sistema=normalizeSistema(s.sistema)||DEFAULT_SISTEMA; });
    // unifica infinity: CE01/CE02 legados viram INF (soma saldos por material/unidade)
    {
      const infRows=mem.estoque.filter(e=> e.sistema==='infinity' && String(e.contrato).toUpperCase()!=='INF');
      if(infRows.length){
        const sums=new Map();
        for(const e of infRows){
          const k=`${e.material}::${e.unidade}`;
          sums.set(k, (sums.get(k)||0)+Number(e.saldo||0));
        }
        // remove linhas legadas CE01/CE02 do infinity
        mem.estoque=mem.estoque.filter(e=> !(e.sistema==='infinity' && String(e.contrato).toUpperCase()!=='INF'));
        // soma nos INF existentes ou cria
        for(const [k, saldo] of sums){
          const [mat, uni]=k.split('::');
          const exist=mem.estoque.find(e=> e.sistema==='infinity' && e.contrato==='INF' && e.material===mat && e.unidade===uni);
          if(exist){ exist.saldo=Number(exist.saldo||0)+saldo; exist.updatedAt=new Date().toISOString(); }
          else { mem.estoque.push({ id: mem.seqEstoque++, sistema:'infinity', contrato:'INF', material:mat, unidade:uni, saldo, createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() }); }
        }
        needSave=true;
      }
      // histórico e seriais do infinity passam a INF
      let changedMov=false, changedSer=false;
      mem.estoqueMov.forEach(m=>{ if(normalizeSistema(m.sistema||DEFAULT_SISTEMA)==='infinity' && String(m.contrato).toUpperCase()!=='INF'){ m.contrato='INF'; changedMov=true; } });
      mem.estoqueSerial.forEach(s=>{ if(normalizeSistema(s.sistema||DEFAULT_SISTEMA)==='infinity' && String(s.contrato).toUpperCase()!=='INF'){ s.contrato='INF'; changedSer=true; } });
      if(changedMov||changedSer) needSave=true;
    }
    // migração Infinity: TZPR04→TZPR (merge) + exclusão definitiva da UPR04
    if(migrarInfinityMateriais()) needSave=true;
    const matsPorSistema = { spacecom: MATERIAIS_SPACECOM, infinity: MATERIAIS_INFINITY };
    const unidadesAll=UNIDADES;
    // deduplica estoque por (sistema,contrato,material,unidade) somando saldo
    const dedup=new Map();
    for(const e of mem.estoque){
      const c=normalizeContrato(e.contrato, e.sistema)||e.contrato;
      e.contrato=c;
      const k=`${e.sistema}::${e.contrato}::${e.material}::${e.unidade}`;
      if(!dedup.has(k)) dedup.set(k, e);
      else { dedup.get(k).saldo = Number(dedup.get(k).saldo||0)+Number(e.saldo||0); needSave=true; }
    }
    if(dedup.size !== mem.estoque.length){ mem.estoque=[...dedup.values()]; needSave=true; }
    // garante todas combinações existem: spacecom CE01/CE02, infinity INF
    let added=0;
    const ensureCombos=[
      ...CONTRATOS_SPACECOM.map(c=> ({sis:'spacecom', c})),
      {sis:'infinity', c:CONTRATO_INFINITY}
    ];
    ensureCombos.forEach(({sis, c})=> matsPorSistema[sis].forEach(m=> unidadesAll.forEach(u=>{
      if(!mem.estoque.some(e=> e.sistema===sis && e.contrato===c && e.material===m && e.unidade===u)){
        mem.estoque.push({ id: mem.seqEstoque++, sistema:sis, contrato:c, material:m, unidade:u, saldo:0, createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() });
        added++; needSave=true;
      }
    })));
    // remove combinações obsoletas: infinity CE01/CE02 zeradas (caso sobrem)
    // + UPR04/TZPR04 residuais zeradas no infinity (caso sobrem)
    {
      const before=mem.estoque.length;
      mem.estoque=mem.estoque.filter(e=> !(e.sistema==='infinity' && String(e.contrato).toUpperCase()!=='INF'));
      mem.estoque=mem.estoque.filter(e=> !(e.sistema==='infinity' && ['UPR04','TZPR04'].includes(String(e.material).toUpperCase()) && Number(e.saldo||0)===0));
      if(mem.estoque.length!==before) needSave=true;
    }
    if(!mem.estoque.length){
      ensureCombos.forEach(({sis, c})=> matsPorSistema[sis].forEach(m=> unidadesAll.forEach(u=> mem.estoque.push({ id: mem.seqEstoque++, sistema:sis, contrato:c, material:m, unidade:u, saldo:0, createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() }) )));
      needSave=true;
    }
    if(needSave||added) saveFile();
    return mem;
  } catch {
    mem = { persons: [], tickets: [], chat: [], audit: [], users: seedUsers(), sessions: {}, agenda: [], googleTokens: {}, termos: [], estoque: [], estoqueMov: [], estoqueSerial: [], seqPerson: 1, seqTicket: 1, seqChat: 1, seqAudit: 1, seqAgenda: 1, seqTermo: 1, seqEstoque: 1, seqEstoqueMov: 1, seqEstoqueSerial: 1 };
    const matsInit={ spacecom: MATERIAIS_SPACECOM, infinity: MATERIAIS_INFINITY };
    [...CONTRATOS_SPACECOM.map(c=> ({sis:'spacecom', c})), {sis:'infinity', c:CONTRATO_INFINITY}].forEach(({sis, c})=> matsInit[sis].forEach(m=> UNIDADES.forEach(u=> mem.estoque.push({ id: mem.seqEstoque++, sistema:sis, contrato:c, material:m, unidade:u, saldo:0, createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() }) )));
    return mem;
  }
}
// Escrita atômica: grava em arquivo temporário e renomeia por cima do db.json.
// Assim, um crash no meio da gravação nunca deixa o banco corrompido/truncado.
function saveFile() {
  try {
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(mem, null, 2));
    fs.renameSync(tmp, DB_FILE);
  } catch(e) {}
}
loadFile();
// garante estrutura para fallback mesmo em modo supabase (quando tabela ainda não existe)
if(!mem.agenda) mem.agenda = [];
if(!mem.seqAgenda) mem.seqAgenda = mem.agenda.length ? Math.max(...mem.agenda.map(x=>x.id))+1 : 1;
if(!mem.googleTokens) mem.googleTokens = {};
if(!mem.termos) mem.termos = [];
if(!mem.seqTermo) mem.seqTermo = mem.termos.length ? Math.max(...mem.termos.map(x=>x.id))+1 : 1;
if(!Array.isArray(mem.estoque)) mem.estoque=[];
if(!mem.seqEstoque) mem.seqEstoque = mem.estoque.length ? Math.max(...mem.estoque.map(x=>x.id))+1 : 1;
if(!Array.isArray(mem.estoqueMov)) mem.estoqueMov=[];
if(!mem.seqEstoqueMov) mem.seqEstoqueMov = mem.estoqueMov.length ? Math.max(...mem.estoqueMov.map(x=>x.id))+1 : 1;
if(!Array.isArray(mem.estoqueSerial)) mem.estoqueSerial=[];
if(!mem.seqEstoqueSerial) mem.seqEstoqueSerial = mem.estoqueSerial.length ? Math.max(...mem.estoqueSerial.map(x=>x.id))+1 : 1;
// fallback garante campo unidade/sistema e combinações (supabase sem tabela ainda) + unifica infinity em INF
(()=>{
  let need=false;
  mem.estoque.forEach(e=>{ if(!e.unidade){ e.unidade=DEFAULT_UNIDADE; need=true; } if(!e.sistema){ e.sistema=DEFAULT_SISTEMA; need=true; } else e.sistema=normalizeSistema(e.sistema)||DEFAULT_SISTEMA; });
  mem.estoqueMov.forEach(m=>{ if(!m.unidade){ m.unidade=DEFAULT_UNIDADE; need=true; } if(!m.sistema){ m.sistema=DEFAULT_SISTEMA; need=true; } else m.sistema=normalizeSistema(m.sistema)||DEFAULT_SISTEMA; });
  mem.estoqueSerial.forEach(s=>{ if(!s.unidade){ s.unidade=DEFAULT_UNIDADE; need=true; } if(!s.sistema){ s.sistema=DEFAULT_SISTEMA; need=true; } else s.sistema=normalizeSistema(s.sistema)||DEFAULT_SISTEMA; });
  // unifica infinity legado
  const infLegacy=mem.estoque.filter(e=> e.sistema==='infinity' && String(e.contrato).toUpperCase()!=='INF');
  if(infLegacy.length){
    const sums=new Map();
    for(const e of infLegacy){ const k=`${e.material}::${e.unidade}`; sums.set(k,(sums.get(k)||0)+Number(e.saldo||0)); }
    mem.estoque=mem.estoque.filter(e=> !(e.sistema==='infinity' && String(e.contrato).toUpperCase()!=='INF'));
    for(const [k, saldo] of sums){
      const [mat, uni]=k.split('::');
      const exist=mem.estoque.find(e=> e.sistema==='infinity' && e.contrato==='INF' && e.material===mat && e.unidade===uni);
      if(exist){ exist.saldo=Number(exist.saldo||0)+saldo; }
      else { mem.estoque.push({ id: mem.seqEstoque++, sistema:'infinity', contrato:'INF', material:mat, unidade:uni, saldo, createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() }); }
    }
    need=true;
  }
  mem.estoqueMov.forEach(m=>{ if(normalizeSistema(m.sistema||DEFAULT_SISTEMA)==='infinity' && String(m.contrato).toUpperCase()!=='INF'){ m.contrato='INF'; need=true; } });
  mem.estoqueSerial.forEach(s=>{ if(normalizeSistema(s.sistema||DEFAULT_SISTEMA)==='infinity' && String(s.contrato).toUpperCase()!=='INF'){ s.contrato='INF'; need=true; } });
  // migração Infinity: TZPR04→TZPR (merge) + exclusão definitiva da UPR04
  if(migrarInfinityMateriais()) need=true;
  const matsPorSis={ spacecom: MATERIAIS_SPACECOM, infinity: MATERIAIS_INFINITY };
  let added=0;
  const combos=[...CONTRATOS_SPACECOM.map(c=> ({sis:'spacecom', c})), {sis:'infinity', c:CONTRATO_INFINITY}];
  combos.forEach(({sis, c})=> matsPorSis[sis].forEach(m=> UNIDADES.forEach(u=>{
    if(!mem.estoque.some(e=> e.sistema===sis && e.contrato===c && e.material===m && e.unidade===u)){
      mem.estoque.push({ id: mem.seqEstoque++, sistema:sis, contrato:c, material:m, unidade:u, saldo:0, createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() });
      added++; need=true;
    }
  })));
  // remove obsoletos infinity CE01/CE02 + UPR04/TZPR04 residuais zeradas
  {
    const before=mem.estoque.length;
    mem.estoque=mem.estoque.filter(e=> !(e.sistema==='infinity' && String(e.contrato).toUpperCase()!=='INF'));
    mem.estoque=mem.estoque.filter(e=> !(e.sistema==='infinity' && ['UPR04','TZPR04'].includes(String(e.material).toUpperCase()) && Number(e.saldo||0)===0));
    if(mem.estoque.length!==before) need=true;
  }
  if(need) saveFile();
})();
if(!Array.isArray(mem.psi)) mem.psi = [];
if(!mem.seqPsi) mem.seqPsi = mem.psi.length ? Math.max(...mem.psi.map(x=>x.id))+1 : 1;

// ---------------------------- SUPABASE -------------------------------
let supa = null;
if (MODE === 'supabase') {
  const { createClient } = require('@supabase/supabase-js');
  supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
}
function must(res, what) {
  if (res.error) { const e = new Error(what + ': ' + res.error.message); e.status = 500; throw e; }
  return res.data;
}
const P = {
  id: 'id', nome: 'nome', cpf: 'cpf', cpfn: 'cpfn', rg: 'rg', nomeMae: 'nomemae',
  dataNascimento: 'datanascimento', modeloTornozeleira: 'modelotornozeleira', createdAt: 'createdat'
};
const T = {
  id: 'id', code: 'code', personId: 'personid', motivo: 'motivo', descricao: 'descricao',
  modeloTornozeleira: 'modelotornozeleira', prioridadeLegal: 'prioridadelegal', status: 'status',
  anexos: 'anexos', tecnicoRecepcao: 'tecnicorecepcao', tecnico: 'tecnico', tecnicoUser: 'tecnicouser',
  relatorio: 'relatorio', checklist: 'checklist', fotosPos: 'fotospos', createdBy: 'createdby',
  createdByName: 'createdbyname', called: 'called', calledAt: 'calledat', calledBy: 'calledby',
  createdAt: 'createdat', startedAt: 'startedat', finishedAt: 'finishedat', reopenedAt: 'reopenedat',
  cancelledAt: 'cancelledat', cancelledBy: 'cancelledby',
  transferredAt: 'transferredat', transferredBy: 'transferredby', transferredFrom: 'transferredfrom',
  returnedAt: 'returnedat', returnedBy: 'returnedby',
  setor: 'setor', visitante: 'visitante'
};
const A = {
  id: 'id', kind: 'kind', action: 'action', personId: 'personid', personName: 'personname',
  ticketId: 'ticketid', ref: 'ref', byUser: 'byuser', byName: 'byname', byRole: 'byrole',
  changes: 'changes', summary: 'summary', at: 'at'
};
const AG = {
  id: 'id', user: 'user', title: 'title', description: 'description', start: 'start', end: 'end',
  personId: 'personid', ticketId: 'ticketid', googleEventId: 'googleeventid', createdAt: 'createdat', updatedAt: 'updatedat'
};
const TM = {
  id: 'id', user: 'user', tipo: 'tipo', dataEnvio: 'dataenvio', destinatario: 'destinatario', equipamentos: 'equipamentos', respEntrega: 'respentrega', respRecebimento: 'resprecebimento', dados: 'dados', createdAt: 'createdat', updatedAt: 'updatedat'
};
// Psicossocial: kind = prontuario|evolucao|atendimento|grupo|encontro|encaminhamento|medida
const PSI = {
  id: 'id', user: 'user', kind: 'kind', personId: 'personid', personName: 'personname', grupoId: 'grupoid', data: 'data', dados: 'dados', createdAt: 'createdat', updatedAt: 'updatedat'
};
const EST = {
  id: 'id', sistema: 'sistema', contrato: 'contrato', material: 'material', unidade: 'unidade', saldo: 'saldo', createdAt: 'createdat', updatedAt: 'updatedat'
};
const ESTMOV = {
  id: 'id', sistema: 'sistema', contrato: 'contrato', material: 'material', unidade: 'unidade', tipo: 'tipo', qtd: 'qtd', saldoAntes: 'saldoantes', saldoDepois: 'saldodepois', motivo: 'motivo', user: 'user', userName: 'username', createdAt: 'createdat', seriais: 'seriais', unidadeDestino: 'unidadedestino'
};
const ESTSER = {
  id: 'id', sistema: 'sistema', contrato: 'contrato', serial: 'serial', unidade: 'unidade', status: 'status', createdAt: 'createdat', updatedAt: 'updatedat'
};
function toApp(row, map) {
  if (!row) return null;
  const o = {};
  for (const k of Object.keys(map)) o[k] = row[map[k]];
  return o;
}
function toRow(obj, map) {
  const o = {};
  for (const k of Object.keys(map)) if (obj[k] !== undefined) o[map[k]] = obj[k];
  return o;
}
const appP = r => toApp(r, P);
const appT = r => toApp(r, T);
const appA = r => toApp(r, A);
const appC = r => ({ id: r.id, user: r.user, name: r.name, role: r.role, to: r.to, text: r.text, anexos: r.anexos || [], at: r.at });
const appAG = r => toApp(r, AG);
const appTM = r => toApp(r, TM);
const appEST = r => toApp(r, EST);
const appESTMOV = r => toApp(r, ESTMOV);
const appESTSER = r => toApp(r, ESTSER);

// Fallback em memória (se a tabela sessions ainda não existir no Supabase)
const memSessions = new Map();
let warnedSessions = false;
function warnSessions(e) {
  if (!warnedSessions) {
    warnedSessions = true;
    console.warn('sessions: usando memória volátil — rode o SQL da tabela sessions no Supabase.', e && e.message);
  }
}

// ------------------------------ API ----------------------------------
const eqi = (a, b) => String(a) === String(b);

const store = {
  mode: MODE,

  persons: {
    async all() {
      if (MODE === 'file') return mem.persons;
      return must(await supa.from('persons').select('*').order('id'), 'persons.all').map(appP);
    },
    async search(q, limit) {
      const n = Math.min(Math.max(Number(limit) || 50, 1), 50);
      q = (q || '').trim().slice(0, 60);
      // evita dump completo sem query
      if (!q || q.length < 2) {
        const list = await store.persons.all();
        return list.slice(-n).reverse();
      }
      if (MODE === 'supabase' && q) {
        try {
          const digits = q.replace(/\D/g, '');
          let query = supa.from('persons').select('*').order('id', { ascending: false }).limit(n);
          const esc = s => String(s).replace(/[%_]/g, m=>`\\${m}`).replace(/[,()"]/g, m=>`\\${m}`);
          if (digits && digits.length >= 3 && /^[\d.\-/ ]+$/.test(q)) {
            query = query.ilike('cpf', `%${esc(digits)}%`);
          } else {
            const e = esc(q);
            query = query.or(`nome.ilike.%${e}%,cpf.ilike.%${e}%,rg.ilike.%${e}%`);
          }
          const r = await query;
          if (!r.error) return r.data.map(appP);
        } catch {}
        // fallback para filtro em memória abaixo
      }
      const list = await store.persons.all();
      const ql = q.toLowerCase();
      const out = !ql ? [...list].reverse() : list.filter(p =>
        (p.nome || '').toLowerCase().includes(ql) ||
        (p.cpf || '').toLowerCase().includes(ql) ||
        (p.rg || '').toLowerCase().includes(ql)
      ).reverse();
      return out.slice(0, n);
    },
    async byId(id) {
      if (MODE === 'file') return mem.persons.find(x => eqi(x.id, id)) || null;
      const r = must(await supa.from('persons').select('*').eq('id', Number(id)).limit(1), 'persons.byId');
      return r.length ? appP(r[0]) : null;
    },
    async insert(p) {
      if (MODE === 'file') {
        const row = { id: mem.seqPerson++, ...p };
        mem.persons.push(row); saveFile();
        return row;
      }
      const r = must(await supa.from('persons').insert(toRow(p, P)).select().single(), 'persons.insert');
      return appP(r);
    },
    async patch(id, fields) {
      if (MODE === 'file') {
        const p = mem.persons.find(x => eqi(x.id, id));
        if (!p) return null;
        Object.assign(p, fields); saveFile();
        return p;
      }
      const r = must(await supa.from('persons').update(toRow(fields, P)).eq('id', Number(id)).select(), 'persons.patch');
      return r.length ? appP(r[0]) : null;
    },
    async remove(id) {
      if (MODE === 'file') {
        mem.persons = mem.persons.filter(x => !eqi(x.id, id)); saveFile();
        return;
      }
      must(await supa.from('persons').delete().eq('id', Number(id)), 'persons.remove');
    }
  },

  tickets: {
    async all() {
      if (MODE === 'file') return mem.tickets;
      return must(await supa.from('tickets').select('*').order('id'), 'tickets.all').map(appT);
    },
    async byId(id) {
      if (MODE === 'file') return mem.tickets.find(x => eqi(x.id, id)) || null;
      const r = must(await supa.from('tickets').select('*').eq('id', Number(id)).limit(1), 'tickets.byId');
      return r.length ? appT(r[0]) : null;
    },
    async insert(t) {
      if (MODE === 'file') {
        const row = { id: mem.seqTicket++, ...t };
        row.code = 'TK-' + String(row.id).padStart(4, '0');
        mem.tickets.push(row); saveFile();
        return row;
      }
      try{
        const row = must(await supa.from('tickets').insert(toRow({ ...t, code: '' }, T)).select().single(), 'tickets.insert');
        const code = 'TK-' + String(row.id).padStart(4, '0');
        const upd = must(await supa.from('tickets').update({ code }).eq('id', row.id).select().single(), 'tickets.code');
        return appT(upd);
      }catch(e){
        // Fallback se colunas setor/visitante ainda não existem no Supabase (sem migração)
        if(e && e.message && /setor|visitante/i.test(e.message)){
          console.warn('tickets.insert fallback sem setor/visitante', e.message);
          const { setor, visitante, ...rest } = t;
          const row = must(await supa.from('tickets').insert(toRow({ ...rest, code: '' }, T)).select().single(), 'tickets.insert');
          const code = 'TK-' + String(row.id).padStart(4, '0');
          const upd = must(await supa.from('tickets').update({ code }).eq('id', row.id).select().single(), 'tickets.code');
          // guarda setor/visitante em memória para exibir até migração (não persiste)
          const out = appT(upd);
          out.setor = setor; out.visitante = visitante;
          return out;
        }
        throw e;
      }
    },
    async patch(id, fields) {
      if (MODE === 'file') {
        const t = mem.tickets.find(x => eqi(x.id, id));
        if (!t) return null;
        Object.assign(t, fields); saveFile();
        return t;
      }
      try{
        const r = must(await supa.from('tickets').update(toRow(fields, T)).eq('id', Number(id)).select(), 'tickets.patch');
        return r.length ? appT(r[0]) : null;
      }catch(e){
        if(e && e.message && /setor|visitante/i.test(e.message)){
          console.warn('tickets.patch fallback sem setor/visitante', e.message);
          const { setor, visitante, ...rest } = fields;
          const r = must(await supa.from('tickets').update(toRow(rest, T)).eq('id', Number(id)).select(), 'tickets.patch');
          return r.length ? appT(r[0]) : null;
        }
        throw e;
      }
    },
    async remove(id) {
      if (MODE === 'file') {
        mem.tickets = mem.tickets.filter(x => !eqi(x.id, id)); saveFile();
        return;
      }
      must(await supa.from('tickets').delete().eq('id', Number(id)), 'tickets.remove');
    }
  },

  chat: {
    async list() {
      if (MODE === 'file') return mem.chat;
      return must(await supa.from('chat').select('*').order('id').limit(2000), 'chat.list').map(appC);
    },
    // Mensagens com id > afterId (mais recentes), limitadas às `limit` últimas.
    // Empurra o filtro ao Supabase (gt + order desc + limit) em vez de baixar tudo.
    async listSince(afterId, limit) {
      const after = Number(afterId) || 0;
      const n = Math.min(Math.max(Number(limit) || 100, 1), 500);
      if (MODE === 'file') return mem.chat.filter(m => Number(m.id) > after).slice(-n);
      const r = must(await supa.from('chat').select('*').gt('id', after).order('id', { ascending: false }).limit(n), 'chat.listSince');
      return r.map(appC).reverse();
    },
    async insert(m) {
      if (MODE === 'file') {
        const row = { id: mem.seqChat++, ...m };
        mem.chat.push(row);
        if (mem.chat.length > 2000) mem.chat = mem.chat.slice(-2000);
        saveFile();
        return row;
      }
      const r = must(await supa.from('chat').insert({ user: m.user, name: m.name, role: m.role, to: m.to, text: m.text, anexos: m.anexos || [] }).select().single(), 'chat.insert');
      const old = must(await supa.from('chat').select('id').order('id', { ascending: false }).range(2000, 10000), 'chat.trim');
      if (old.length) must(await supa.from('chat').delete().in('id', old.map(x => x.id)), 'chat.trimdel');
      return appC(r);
    }
  },

  audit: {
    async insert(e) {
      if (MODE === 'file') {
        const row = { id: mem.seqAudit++, kind: 'ticket', changes: [], ...e, at: new Date().toISOString() };
        mem.audit.push(row);
        if (mem.audit.length > 500) mem.audit = mem.audit.slice(-500);
        saveFile();
        return row;
      }
      const body = { kind: 'cadastro', changes: [], ...e };
      const r = must(await supa.from('audit').insert({
        kind: body.kind, action: body.action || '', personid: body.personId ?? null,
        personname: body.personName || '', ticketid: body.ticketId ?? null, ref: body.ref || '',
        byuser: body.byUser || '', byname: body.byName || '', byrole: body.byRole || '',
        changes: body.changes || [], summary: body.summary || ''
      }).select().single(), 'audit.insert');
      const old = must(await supa.from('audit').select('id').order('id', { ascending: false }).range(500, 5000), 'audit.trim');
      if (old.length) must(await supa.from('audit').delete().in('id', old.map(x => x.id)), 'audit.trimdel');
      return appA(r);
    },
    async byPerson(pid) {
      if (MODE === 'file') return mem.audit.filter(a => eqi(a.personId, pid)).sort((a, b) => new Date(b.at) - new Date(a.at));
      return must(await supa.from('audit').select('*').eq('personid', Number(pid)).order('at', { ascending: false }).limit(200), 'audit.byPerson').map(appA);
    },
    async recent(limit) {
      const n = Math.min(Number(limit) || 50, 200);
      if (MODE === 'file') return [...mem.audit].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, n);
      return must(await supa.from('audit').select('*').order('at', { ascending: false }).limit(n), 'audit.recent').map(appA);
    },
    async search({ q, user, action, kind, from, to, limit, offset } = {}) {
      const n = Math.min(Math.max(Number(limit)||50,1),200);
      const off = Math.max(Number(offset)||0,0);
      const ql = String(q||'').toLowerCase().trim();
      const u = String(user||'').toLowerCase().trim();
      const a = String(action||'').toLowerCase().trim();
      const k = String(kind||'').toLowerCase().trim();
      const dFrom = from ? new Date(from) : null;
      const dTo = to ? new Date(to) : null;
      if(MODE==='file'){
        let list=[...mem.audit].sort((a,b)=> new Date(b.at)-new Date(a.at));
        if(u) list=list.filter(x=> String(x.byUser||'').toLowerCase().includes(u));
        if(a) list=list.filter(x=> String(x.action||'').toLowerCase()===a);
        if(k) list=list.filter(x=> String(x.kind||'').toLowerCase()===k);
        if(dFrom && !isNaN(dFrom)) list=list.filter(x=> new Date(x.at) >= dFrom);
        if(dTo && !isNaN(dTo)){ const t=new Date(dTo); t.setHours(23,59,59,999); list=list.filter(x=> new Date(x.at) <= t); }
        if(ql) list=list.filter(x=> (x.personName||'').toLowerCase().includes(ql) || (x.summary||'').toLowerCase().includes(ql) || (x.ref||'').toLowerCase().includes(ql) || String(x.ticketId||'').includes(ql));
        const total=list.length;
        return { total, items: list.slice(off, off+n) };
      }
      // Supabase: filtra via query builder
      let query=supa.from('audit').select('*', {count:'exact'}).order('at', {ascending:false}).range(off, off+n-1);
      if(u) query=query.ilike('byuser', `%${u}%`);
      if(a) query=query.eq('action', a);
      if(k) query=query.eq('kind', k);
      if(dFrom && !isNaN(dFrom)) query=query.gte('at', dFrom.toISOString());
      if(dTo && !isNaN(dTo)){ const t=new Date(dTo); t.setHours(23,59,59,999); query=query.lte('at', t.toISOString()); }
      if(ql) query=query.or(`personname.ilike.%${ql}%,summary.ilike.%${ql}%,ref.ilike.%${ql}%`);
      const r=must(await query, 'audit.search');
      // Supabase não retorna count com range, pega total via head
      let total=0;
      try{
        const c=must(await supa.from('audit').select('id', {count:'exact', head:true}), 'audit.count');
        total=c.count||r.length;
      }catch(e){ total=r.length; }
      return { total, items: r.map(appA) };
    }
  },

  users: {
    async all() {
      if (MODE === 'file') return mem.users;
      return must(await supa.from('users').select('*').order('user'), 'users.all');
    },
    async byName(u) {
      const id = normalizeUser(u);
      if (MODE === 'file') return mem.users.find(x => normalizeUser(x.user) === id) || null;
      // Supabase: tenta exato primeiro, depois busca normalizada (acentos)
      let r = must(await supa.from('users').select('*').eq('user', id).limit(1), 'users.byName');
      if (r.length) return r[0];
      // fallback: busca todos e compara normalizado (cobre psicólogo vs psicologo)
      const all = must(await supa.from('users').select('*'), 'users.byName.all');
      return all.find(x => normalizeUser(x.user) === id) || null;
    },
    async insert(u) {
      if (MODE === 'file') { mem.users.push(u); saveFile(); return u; }
      return must(await supa.from('users').insert(u).select().single(), 'users.insert');
    },
    async patch(user, fields) {
      const norm = normalizeUser(user);
      if (MODE === 'file') {
        const u = mem.users.find(x => normalizeUser(x.user) === norm);
        if (!u) return null;
        Object.assign(u, fields); saveFile();
        return u;
      }
      // Supabase: tenta canônico, senão busca registro real para patch exato
      let r = must(await supa.from('users').update(fields).eq('user', norm).select(), 'users.patch');
      if (r.length) return r[0];
      const all = must(await supa.from('users').select('*'), 'users.patch.all');
      const found = all.find(x => normalizeUser(x.user) === norm);
      if (!found) return null;
      r = must(await supa.from('users').update(fields).eq('user', found.user).select(), 'users.patch2');
      return r.length ? r[0] : null;
    },
    async remove(user) {
      const norm = normalizeUser(user);
      if (MODE === 'file') { mem.users = mem.users.filter(x => normalizeUser(x.user) !== norm); saveFile(); return; }
      let res = await supa.from('users').delete().eq('user', norm);
      if (!res.error) return;
      // fallback acentuado
      const all = must(await supa.from('users').select('user'), 'users.remove.all');
      const found = all.find(x => normalizeUser(x.user) === norm);
      if (found) must(await supa.from('users').delete().eq('user', found.user), 'users.remove2');
    },
    // Auto-seed no Supabase: cria os usuários padrão AUSENTES (recepcao, técnicos,
    // psicologo, secretaria, admin). NUNCA altera quem já existe (não sobrescreve
    // senha/perfil de ninguém). Roda uma vez a cada boot do servidor.
    async ensureSeeded() {
      if (MODE === 'file') return { created: [] }; // loadFile() já semeia
      let existing = [];
      try {
        existing = must(await supa.from('users').select('user'), 'users.ensureSeeded.list').map(r => r.user);
      } catch (e) {
        console.warn('seed: tabela users inacessível — pulando auto-seed.', e.message);
        return { created: [] };
      }
      const created = [];
      const existingNorm = existing.map(u => normalizeUser(u));
      for (const s of seedUsers()) {
        if (existingNorm.includes(normalizeUser(s.user))) continue;
        try {
          const bcrypt = require('bcryptjs');
          must(await supa.from('users').insert({
            user: s.user, name: s.name, role: s.role,
            pass: await bcrypt.hash(String(s.pass), 10), active: true
          }), 'users.ensureSeeded.insert');
          created.push(s.user);
        } catch (e) {
          console.warn('seed: não foi possível criar @' + s.user + ':', e.message);
        }
      }
      return { created };
    }
  },

  agenda: {
    async allByUser(user){
      if(MODE==='file') return mem.agenda.filter(x=>x.user===user).sort((a,b)=> new Date(a.start)-new Date(b.start));
      try{ return must(await supa.from('agenda').select('*').eq('user', user).order('start'), 'agenda.allByUser').map(appAG); }catch(e){ console.warn('agenda.allByUser fallback (tabela não existe?)', e.message); return mem.agenda.filter(x=>x.user===user).sort((a,b)=> new Date(a.start)-new Date(b.start)); }
    },
    async all(){
      if(MODE==='file') return mem.agenda;
      try{ return must(await supa.from('agenda').select('*').order('start'), 'agenda.all').map(appAG); }catch(e){ console.warn('agenda.all fallback', e.message); return mem.agenda; }
    },
    async byId(id){
      if(MODE==='file') return mem.agenda.find(x=>eqi(x.id,id))||null;
      try{ const r=must(await supa.from('agenda').select('*').eq('id', Number(id)).limit(1),'agenda.byId'); return r.length?appAG(r[0]):null; }catch(e){ console.warn('agenda.byId fallback', e.message); return mem.agenda.find(x=>eqi(x.id,id))||null; }
    },
    async insert(ev){
      if(MODE==='file'){
        const row={ id: mem.seqAgenda++, ...ev, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        mem.agenda.push(row); saveFile(); return row;
      }
      try{
        const r=must(await supa.from('agenda').insert(toRow(ev, AG)).select().single(),'agenda.insert');
        return appAG(r);
      }catch(e){
        console.warn('agenda.insert fallback para file', e.message);
        const row={ id: mem.seqAgenda++, ...ev, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        mem.agenda.push(row); saveFile(); return row;
      }
    },
    async patch(id, fields){
      if(MODE==='file'){
        const e=mem.agenda.find(x=>eqi(x.id,id)); if(!e) return null;
        Object.assign(e, fields, { updatedAt: new Date().toISOString() }); saveFile(); return e;
      }
      try{
        const r=must(await supa.from('agenda').update(toRow({...fields, updatedAt: new Date().toISOString()}, AG)).eq('id', Number(id)).select(),'agenda.patch');
        return r.length?appAG(r[0]):null;
      }catch(e){
        console.warn('agenda.patch fallback', e.message);
        const ee=mem.agenda.find(x=>eqi(x.id,id)); if(!ee) return null;
        Object.assign(ee, fields, { updatedAt: new Date().toISOString() }); return ee;
      }
    },
    async remove(id){
      if(MODE==='file'){ mem.agenda=mem.agenda.filter(x=>!eqi(x.id,id)); saveFile(); return; }
      try{ must(await supa.from('agenda').delete().eq('id', Number(id)),'agenda.remove'); }catch(e){ console.warn('agenda.remove fallback', e.message); mem.agenda=mem.agenda.filter(x=>!eqi(x.id,id)); }
    }
  },

  googleTokens: {
    async get(user){
      const id=normalizeUser(user);
      if(MODE==='file') return mem.googleTokens[id]||null;
      try{
        const r=must(await supa.from('google_tokens').select('*').eq('user', id).limit(1),'googleTokens.get');
        return r.length?r[0]:null;
      }catch(e){ console.warn('googleTokens.get fallback (tabela não existe?)', e.message); return null; }
    },
    async set(user, tokens){
      const id=normalizeUser(user);
      const row={ user:id, access_token: tokens.access_token||tokens.accessToken||'', refresh_token: tokens.refresh_token||tokens.refreshToken||'', expiry_date: tokens.expiry_date||tokens.expiryDate||null, scope: tokens.scope||'', token_type: tokens.token_type||tokens.tokenType||'Bearer' };
      if(MODE==='file'){ mem.googleTokens[id]=row; saveFile(); return row; }
      try{
        const r=must(await supa.from('google_tokens').upsert(row, {onConflict:'user'}).select(),'googleTokens.set');
        return r.length?r[0]:row;
      }catch(e){ console.warn('googleTokens.set fallback', e.message); mem.googleTokens[id]=row; return row; }
    },
    async del(user){
      const id=normalizeUser(user);
      if(MODE==='file'){ delete mem.googleTokens[id]; saveFile(); return; }
      try{ must(await supa.from('google_tokens').delete().eq('user', id),'googleTokens.del'); }catch(e){ console.warn('googleTokens.del fallback', e.message); delete mem.googleTokens[id]; }
    }
  },

  termos: {
    async allByUser(user){
      if(MODE==='file') return mem.termos.filter(x=>x.user===user).sort((a,b)=> new Date(b.createdAt)-new Date(a.createdAt));
      try{ return must(await supa.from('termos').select('*').eq('user', user).order('createdat', {ascending:false}), 'termos.allByUser').map(appTM); }catch(e){ console.warn('termos.allByUser fallback', e.message); return mem.termos.filter(x=>x.user===user).sort((a,b)=> new Date(b.createdAt)-new Date(a.createdAt)); }
    },
    async all(){
      if(MODE==='file') return mem.termos;
      try{ return must(await supa.from('termos').select('*').order('createdat', {ascending:false}), 'termos.all').map(appTM); }catch(e){ console.warn('termos.all fallback', e.message); return mem.termos; }
    },
    async byId(id){
      if(MODE==='file') return mem.termos.find(x=>eqi(x.id,id))||null;
      try{ const r=must(await supa.from('termos').select('*').eq('id', Number(id)).limit(1),'termos.byId'); return r.length?appTM(r[0]):null; }catch(e){ console.warn('termos.byId fallback', e.message); return mem.termos.find(x=>eqi(x.id,id))||null; }
    },
    async insert(t){
      if(MODE==='file'){
        const row={ id: mem.seqTermo++, ...t, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        mem.termos.push(row); saveFile(); return row;
      }
      try{
        const r=must(await supa.from('termos').insert(toRow(t, TM)).select().single(),'termos.insert');
        return appTM(r);
      }catch(e){
        console.warn('termos.insert fallback', e.message);
        const row={ id: mem.seqTermo++, ...t, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        mem.termos.push(row); return row;
      }
    },
    async patch(id, fields){
      if(MODE==='file'){
        const e=mem.termos.find(x=>eqi(x.id,id)); if(!e) return null;
        Object.assign(e, fields, { updatedAt: new Date().toISOString() }); saveFile(); return e;
      }
      try{
        const r=must(await supa.from('termos').update(toRow({...fields, updatedAt: new Date().toISOString()}, TM)).eq('id', Number(id)).select(),'termos.patch');
        return r.length?appTM(r[0]):null;
      }catch(e){
        console.warn('termos.patch fallback', e.message);
        const ee=mem.termos.find(x=>eqi(x.id,id)); if(!ee) return null;
        Object.assign(ee, fields, { updatedAt: new Date().toISOString() }); return ee;
      }
    },
    async remove(id){
      if(MODE==='file'){ mem.termos=mem.termos.filter(x=>!eqi(x.id,id)); saveFile(); return; }
      try{ must(await supa.from('termos').delete().eq('id', Number(id)),'termos.remove'); }catch(e){ console.warn('termos.remove fallback', e.message); mem.termos=mem.termos.filter(x=>!eqi(x.id,id)); }
    }
  },

  // Psicossocial (sigilo: rotas restritas a psico/admin)
  psi: {
    async all(){
      if(MODE==='file') return mem.psi;
      try{ return must(await supa.from('psi_records').select('*').order('id', {ascending:false}).limit(2000), 'psi.all').map(r=>toApp(r, PSI)); }catch(e){ console.warn('psi.all fallback', e.message); return mem.psi; }
    },
    async byPerson(personId){
      const all = await store.psi.all();
      return all.filter(x=>String(x.personId)===String(personId)).sort((a,b)=> new Date(a.createdAt)-new Date(b.createdAt));
    },
    async byKind(kind){
      const all = await store.psi.all();
      return all.filter(x=>x.kind===kind);
    },
    async byId(id){
      if(MODE==='file') return mem.psi.find(x=>eqi(x.id,id))||null;
      try{ const r=must(await supa.from('psi_records').select('*').eq('id', Number(id)).limit(1),'psi.byId'); return r.length?toApp(r[0],PSI):null; }catch(e){ console.warn('psi.byId fallback', e.message); return mem.psi.find(x=>eqi(x.id,id))||null; }
    },
    async prontuario(personId){
      const all = await store.psi.all();
      return all.find(x=>x.kind==='prontuario' && String(x.personId)===String(personId))||null;
    },
    async insert(p){
      const row = { ...p, createdAt: p.createdAt||new Date().toISOString(), updatedAt: new Date().toISOString() };
      if(MODE==='file'){
        row.id = mem.seqPsi++;
        mem.psi.push(row); saveFile(); return row;
      }
      try{
        const r=must(await supa.from('psi_records').insert(toRow(row, PSI)).select().single(),'psi.insert');
        return toApp(r, PSI);
      }catch(e){
        console.warn('psi.insert fallback', e.message);
        row.id = mem.seqPsi++;
        mem.psi.push(row); return row;
      }
    },
    async patch(id, fields){
      if(MODE==='file'){
        const e=mem.psi.find(x=>eqi(x.id,id)); if(!e) return null;
        Object.assign(e, fields, { updatedAt: new Date().toISOString() }); saveFile(); return e;
      }
      try{
        const r=must(await supa.from('psi_records').update(toRow({...fields, updatedAt: new Date().toISOString()}, PSI)).eq('id', Number(id)).select(),'psi.patch');
        return r.length?toApp(r[0],PSI):null;
      }catch(e){
        console.warn('psi.patch fallback', e.message);
        const ee=mem.psi.find(x=>eqi(x.id,id)); if(!ee) return null;
        Object.assign(ee, fields, { updatedAt: new Date().toISOString() }); return ee;
      }
    },
    async remove(id){
      if(MODE==='file'){ mem.psi=mem.psi.filter(x=>!eqi(x.id,id)); saveFile(); return; }
      try{ must(await supa.from('psi_records').delete().eq('id', Number(id)),'psi.remove'); }catch(e){ console.warn('psi.remove fallback', e.message); mem.psi=mem.psi.filter(x=>!eqi(x.id,id)); }
    }
  },

  // Unidades disponíveis — fonte única
  unidades: UNIDADES,
  materiais: MATERIAIS,
  estoqueLimites: ESTOQUE_LIMITES,
  estoque: {
    async all(sistema){
      let list;
      if(MODE==='file') list=[...mem.estoque];
      else {
        try{ list=must(await supa.from('estoque').select('*').order('contrato').order('material').order('unidade'), 'estoque.all').map(appEST); }catch(e){ console.warn('estoque.all fallback', e.message); list=[...mem.estoque]; }
      }
      // filtra por sistema se informado
      if(sistema) {
        const sis=normalizeSistema(sistema);
        if(sis) list=list.filter(e=> normalizeSistema(e.sistema||DEFAULT_SISTEMA)===sis);
      }
      return list;
    },
    async byContrato(contrato, sistema){
      const all=await store.estoque.all(sistema);
      const c=normalizeContrato(contrato, sistema);
      if(!c) return all;
      return all.filter(e=> String(e.contrato).toUpperCase()===c);
    },
    async byUnidade(unidade, sistema){
      const all=await store.estoque.all(sistema);
      const u=normalizeUnidade(unidade);
      return all.filter(e=> String(e.unidade)===u);
    },
    async byContratoUnidade(contrato, unidade, sistema){
      const all=await store.estoque.all(sistema);
      const c=normalizeContrato(contrato, sistema);
      const u=normalizeUnidade(unidade);
      if(!c) return all.filter(e=> String(e.unidade)===u);
      return all.filter(e=> String(e.contrato).toUpperCase()===c && String(e.unidade)===u);
    },
    async get(contrato, material, unidade, sistema){
      const all=await store.estoque.all(sistema);
      const u=unidade ? normalizeUnidade(unidade) : null;
      const sis=sistema ? normalizeSistema(sistema) : null;
      const c=normalizeContrato(contrato, sistema) || String(contrato||'').toUpperCase().trim();
      return all.find(e=> String(e.contrato).toUpperCase()===c && String(e.material).toUpperCase()===String(material).toUpperCase() && (u? String(e.unidade)===u : true) && (!sis || normalizeSistema(e.sistema||DEFAULT_SISTEMA)===sis))||null;
    },
    async resumo({ contrato, unidade, sistema }={}){
      let all=await store.estoque.all(sistema);
      const c=contrato ? normalizeContrato(contrato, sistema) : null;
      if(c) all=all.filter(e=> String(e.contrato).toUpperCase()===c);
      if(unidade) all=all.filter(e=> String(e.unidade)===normalizeUnidade(unidade));
      const porContrato={}, porUnidade={}, porMaterial={}, total=all.reduce((s,x)=>s+Number(x.saldo||0),0);
      all.forEach(e=>{ porContrato[e.contrato]=(porContrato[e.contrato]||0)+Number(e.saldo||0); porUnidade[e.unidade]=(porUnidade[e.unidade]||0)+Number(e.saldo||0); porMaterial[e.material]=(porMaterial[e.material]||0)+Number(e.saldo||0); });
      const alertas=await store.estoque.alertas({ contrato, unidade, sistema });
      return { total, porContrato, porUnidade, porMaterial, itens: all, alertas, limites: ESTOQUE_LIMITES, geradoEm: new Date().toISOString(), sistema: sistema||null };
    },
    async alertas({ contrato, unidade, limite, sistema }={}){
      let all=await store.estoque.all(sistema);
      const c=contrato ? normalizeContrato(contrato, sistema) : null;
      if(c) all=all.filter(e=> String(e.contrato).toUpperCase()===c);
      if(unidade) all=all.filter(e=> String(e.unidade)===normalizeUnidade(unidade));
      const baixos=all.filter(e=>{ const thr=(limite!=null? Number(limite): ESTOQUE_LIMITES[e.material]||5); return Number(e.saldo||0) < thr; }).map(e=>({ ...e, limite: (limite!=null? Number(limite): ESTOQUE_LIMITES[e.material]||5), deficit: (limite!=null? Number(limite): ESTOQUE_LIMITES[e.material]||5)-Number(e.saldo||0) })).sort((a,b)=> a.deficit - b.deficit || a.saldo - b.saldo);
      const criticos=baixos.filter(e=> Number(e.saldo||0)===0);
      return { total: baixos.length, criticos: criticos.length, itens: baixos, criticosItens: criticos };
    },
    async adjust({ contrato, material, unidade, qtd, motivo, user, userName, seriais, sistema, at, skipAudit }){
      // `at`: grava a movimentação com data histórica (usado pelos seeds de 60 dias).
      // `skipAudit`: não escreve na trilha de auditoria — dados de demonstração não
      // podem empurrar os registros reais para fora do limite de 500.
      const quando=(at && !isNaN(new Date(at))) ? new Date(at).toISOString() : new Date().toISOString();
      const auditar=e=> skipAudit ? Promise.resolve(null) : store.audit.insert(e);
      sistema=normalizeSistema(sistema)||DEFAULT_SISTEMA;
      if(!SISTEMAS.includes(sistema)) throw Object.assign(new Error('Sistema inválido (spacecom/infinity)'),{status:400});
      contrato=normalizeContrato(contrato, sistema);
      material=String(material||'').toUpperCase().trim();
      unidade=normalizeUnidade(unidade||DEFAULT_UNIDADE);
      if(sistema==='infinity'){
        if(contrato!==CONTRATO_INFINITY) throw Object.assign(new Error('Contrato inválido para Infinity (use Estoque Infinity)'),{status:400});
      } else {
        if(!CONTRATOS_SPACECOM.includes(contrato)) throw Object.assign(new Error('Contrato inválido (CE01/CE02)'),{status:400});
      }
      const matsValidos = materiaisDoSistema(sistema);
      if(!matsValidos.includes(material)) throw Object.assign(new Error('Material inválido para '+sistema+': '+matsValidos.join(', ')),{status:400});
      if(!UNIDADES.includes(unidade)) throw Object.assign(new Error('Unidade inválida: '+UNIDADES.join(', ')),{status:400});
      qtd=Number(qtd); if(!Number.isFinite(qtd) || qtd===0) throw Object.assign(new Error('Quantidade deve ser diferente de zero'),{status:400});
      if(Math.abs(qtd)>500) throw Object.assign(new Error('Lote máximo 500 unidades por movimentação'),{status:400});
      if(motivo!=null && String(motivo).trim() && String(motivo).trim().length < 3) throw Object.assign(new Error('Motivo deve ter ao menos 3 caracteres'),{status:400});
      let serialList=[];
      if(temSerial(material)){
        serialList=parseSeriaisInput(seriais);
        if(serialList.length !== Math.abs(qtd)) throw Object.assign(new Error(`${material} exige ${Math.abs(qtd)} seriais de 10 dígitos (recebido ${serialList.length}) — verifique se colou 10 dígitos por linha`),{status:400});
        if(new Set(serialList).size !== serialList.length) throw Object.assign(new Error('Seriais duplicados na lista'),{status:400});
      }
      // garante linha existe (por sistema)
      let row=await store.estoque.get(contrato, material, unidade, sistema);
      if(!row){
        if(MODE==='file'){
          row={ id: mem.seqEstoque++, sistema, contrato, material, unidade, saldo:0, createdAt:quando, updatedAt:quando };
          mem.estoque.push(row); saveFile();
        } else {
          try{
            const r=must(await supa.from('estoque').insert({ sistema, contrato, material, unidade, saldo:0 }).select().single(),'estoque.insert');
            row=appEST(r);
          }catch(e){
            row={ id: mem.seqEstoque++, sistema, contrato, material, unidade, saldo:0, createdAt:quando, updatedAt:quando };
            mem.estoque.push(row);
          }
        }
      }
      const saldoAntes=Number(row.saldo||0);
      const saldoDepois=saldoAntes+qtd;
      if(saldoDepois<0) throw Object.assign(new Error(`Saldo insuficiente em ${unidade} (${saldoAntes} disponível)`),{status:400});
      if(temSerial(material) && serialList.length){
        if(qtd>0){
          for(const s of serialList){
            const existsFile = (MODE==='file' ? mem.estoqueSerial.find(x=> String(x.contrato).toUpperCase()===contrato && String(x.serial)===s && normalizeSistema(x.sistema||DEFAULT_SISTEMA)===sistema) : null);
            if(existsFile){
              if(existsFile.status==='disponivel') throw Object.assign(new Error(`Serial ${s} já está em estoque em ${existsFile.unidade||'outra unidade'}`),{status:400});
              if(existsFile.status==='em_uso'){
                // reativação: permitir retorno ao estoque — será reativado abaixo em vez de inserir
                continue;
              }
            }
            if(MODE==='supabase'){
              try{
                const r=must(await supa.from('estoque_serial').select('id,unidade,status').eq('contrato',contrato).eq('serial',s).eq('sistema',sistema).limit(1),'estoqueSerial.check');
                if(r.length){
                  if(r[0].status==='disponivel') throw Object.assign(new Error(`Serial ${s} já está em estoque em ${r[0].unidade||'outra unidade'}`),{status:400});
                  // em_uso será reativado
                }
              }catch(e){ if(e.status===400) throw e; }
            }
          }
        } else {
          for(const s of serialList){
            const exists = (MODE==='file' ? mem.estoqueSerial.find(x=> String(x.contrato).toUpperCase()===contrato && String(x.serial)===s && x.status==='disponivel' && String(x.unidade)===unidade) : null);
            let found=!!exists;
            if(!found && MODE==='supabase'){
              try{
                const r=must(await supa.from('estoque_serial').select('id').eq('contrato',contrato).eq('serial',s).eq('status','disponivel').eq('unidade',unidade).limit(1),'estoqueSerial.check');
                found = r.length>0;
              }catch(e){}
            }
            if(!found) throw Object.assign(new Error(`Serial ${s} não está disponível em ${unidade}`),{status:400});
          }
        }
      }
      // atualiza saldo
      if(MODE==='file'){
        row.saldo=saldoDepois; row.updatedAt=new Date().toISOString(); saveFile();
      } else {
        try{
          const r=must(await supa.from('estoque').update({ saldo: saldoDepois, updatedat: new Date().toISOString() }).eq('id', Number(row.id)).select().single(),'estoque.patch');
          row=appEST(r);
        }catch(e){
          console.warn('estoque.patch fallback', e.message);
          row.saldo=saldoDepois; row.updatedAt=new Date().toISOString();
          const idx=mem.estoque.findIndex(x=>String(x.id)===String(row.id));
          if(idx>=0) mem.estoque[idx]=row;
        }
      }
      if(temSerial(material) && serialList.length){
        if(qtd>0){
          for(const s of serialList){
            const idxExist = MODE==='file' ? mem.estoqueSerial.findIndex(x=> String(x.contrato).toUpperCase()===contrato && String(x.serial)===s && normalizeSistema(x.sistema||DEFAULT_SISTEMA)===sistema) : -1;
            if(idxExist>=0 && mem.estoqueSerial[idxExist].status==='em_uso'){
              // reativação de serial previamente baixado
              mem.estoqueSerial[idxExist].status='disponivel';
              mem.estoqueSerial[idxExist].unidade=unidade;
              mem.estoqueSerial[idxExist].sistema=sistema;
              mem.estoqueSerial[idxExist].updatedAt=new Date().toISOString();
              if(MODE==='supabase'){
                try{ must(await supa.from('estoque_serial').update({ status:'disponivel', unidade, sistema, updatedat: new Date().toISOString() }).eq('contrato',contrato).eq('serial',s).eq('status','em_uso').eq('sistema',sistema),'estoqueSerial.reativar'); }catch(e){}
              }
              continue;
            }
            if(MODE==='supabase'){
              // tenta reativar no supabase se estiver em_uso
              try{
                const r=must(await supa.from('estoque_serial').select('id,status').eq('contrato',contrato).eq('serial',s).eq('sistema',sistema).limit(1),'estoqueSerial.checkReativar');
                if(r.length && r[0].status==='em_uso'){
                  must(await supa.from('estoque_serial').update({ status:'disponivel', unidade, sistema, updatedat: new Date().toISOString() }).eq('id', r[0].id),'estoqueSerial.reativar2');
                  continue;
                }
              }catch(e){}
            }
            if(MODE==='file'){
              mem.estoqueSerial.push({ id: mem.seqEstoqueSerial++, sistema, contrato, serial: s, unidade, status: 'disponivel', createdAt: quando, updatedAt: quando });
            } else {
              try{ must(await supa.from('estoque_serial').insert({ sistema, contrato, serial: s, unidade, status: 'disponivel', createdat: quando, updatedat: quando }).select().single(),'estoqueSerial.insert'); }catch(e){ mem.estoqueSerial.push({ id: mem.seqEstoqueSerial++, sistema, contrato, serial: s, unidade, status: 'disponivel', createdAt: quando, updatedAt: quando }); }
            }
          }
          if(MODE==='file') saveFile();
        } else {
          for(const s of serialList){
            if(MODE==='file'){
              const idx=mem.estoqueSerial.findIndex(x=> String(x.contrato).toUpperCase()===contrato && String(x.serial)===s && x.status==='disponivel' && String(x.unidade)===unidade && normalizeSistema(x.sistema||DEFAULT_SISTEMA)===sistema);
              if(idx>=0){ mem.estoqueSerial[idx].status='em_uso'; mem.estoqueSerial[idx].updatedAt=new Date().toISOString(); }
            } else {
              try{ must(await supa.from('estoque_serial').update({ status: 'em_uso', updatedat: new Date().toISOString() }).eq('contrato',contrato).eq('serial',s).eq('status','disponivel').eq('unidade',unidade).eq('sistema',sistema),'estoqueSerial.patch'); }catch(e){ const idx=mem.estoqueSerial.findIndex(x=> String(x.contrato).toUpperCase()===contrato && String(x.serial)===s && x.status==='disponivel' && String(x.unidade)===unidade && normalizeSistema(x.sistema||DEFAULT_SISTEMA)===sistema); if(idx>=0){ mem.estoqueSerial[idx].status='em_uso'; } }
            }
          }
          if(MODE==='file') saveFile();
        }
      }
      const mov={ sistema, contrato, material, unidade, tipo: qtd>0?'entrada':'saida', qtd: Math.abs(qtd), motivo: motivo||null, seriais: serialList, user: user||null, userName: userName||null, createdAt: quando, unidadeDestino: null };
      const auditRef=`${contrato}/${material}/${unidade} ${qtd>0?'+':''}${qtd}`;
      if(MODE==='file'){
        const m={ id: mem.seqEstoqueMov++, ...mov, saldoAntes, saldoDepois };
        mem.estoqueMov.push(m); saveFile();
        await auditar({ kind:'estoque', action: mov.tipo, personName: `${contrato} ${material} ${unidade}`, ticketId: null, ref: auditRef, byUser: user, byName: userName, byRole: 'tecnico', summary: motivo, changes: [{ field:'saldo', label:`Saldo ${unidade}`, from: String(saldoAntes), to: String(saldoDepois)}] });
        return { row, mov: appESTMOV(m) };
      } else {
        try{
          const r=must(await supa.from('estoque_mov').insert(toRow({...mov, saldoAntes, saldoDepois}, ESTMOV)).select().single(),'estoqueMov.insert');
          await auditar({ kind:'estoque', action: mov.tipo, personName: `${contrato} ${material} ${unidade}`, ticketId: null, ref: auditRef, byUser: user, byName: userName, byRole: 'tecnico', summary: motivo, changes: [{ field:'saldo', label:`Saldo ${unidade}`, from: String(saldoAntes), to: String(saldoDepois)}] });
          return { row, mov: appESTMOV(r) };
        }catch(e){
          console.warn('estoqueMov.insert fallback', e.message);
          const m={ id: mem.seqEstoqueMov++, ...mov, saldoAntes, saldoDepois };
          mem.estoqueMov.push(m); saveFile();
          await auditar({ kind:'estoque', action: mov.tipo, personName: `${contrato} ${material} ${unidade}`, ticketId: null, ref: auditRef, byUser: user, byName: userName, byRole: 'tecnico', summary: motivo, changes: [{ field:'saldo', label:`Saldo ${unidade}`, from: String(saldoAntes), to: String(saldoDepois)}] });
          return { row, mov: appESTMOV(m) };
        }
      }
    },
    async transferir({ contrato, material, qtd, unidadeOrigem, unidadeDestino, motivo, seriais, user, userName, sistema, at, skipAudit }){
      // `at`/`skipAudit`: mesmo sentido do adjust (usado pelos seeds históricos).
      const quando=(at && !isNaN(new Date(at))) ? new Date(at).toISOString() : new Date().toISOString();
      const auditar=e=> skipAudit ? Promise.resolve(null) : store.audit.insert(e);
      sistema=normalizeSistema(sistema)||DEFAULT_SISTEMA;
      if(!SISTEMAS.includes(sistema)) throw Object.assign(new Error('Sistema inválido'),{status:400});
      contrato=normalizeContrato(contrato, sistema);
      material=String(material||'').toUpperCase().trim();
      unidadeOrigem=normalizeUnidade(unidadeOrigem);
      unidadeDestino=normalizeUnidade(unidadeDestino);
      if(unidadeOrigem===unidadeDestino) throw Object.assign(new Error('Origem e destino devem ser diferentes'),{status:400});
      if(sistema==='infinity'){
        if(contrato!==CONTRATO_INFINITY) throw Object.assign(new Error('Contrato inválido para Infinity (use Estoque Infinity)'),{status:400});
      } else {
        if(!CONTRATOS_SPACECOM.includes(contrato)) throw Object.assign(new Error('Contrato inválido (CE01/CE02)'),{status:400});
      }
      const matsValidosTransf = materiaisDoSistema(sistema);
      if(!matsValidosTransf.includes(material)) throw Object.assign(new Error('Material inválido para '+sistema),{status:400});
      if(!UNIDADES.includes(unidadeOrigem)) throw Object.assign(new Error('Unidade origem inválida'),{status:400});
      if(!UNIDADES.includes(unidadeDestino)) throw Object.assign(new Error('Unidade destino inválida'),{status:400});
      qtd=Math.abs(Number(qtd));
      if(!qtd) throw Object.assign(new Error('Quantidade inválida'),{status:400});
      if(qtd>500) throw Object.assign(new Error('Lote máximo 500 unidades por transferência'),{status:400});
      let serialList=[];
      if(temSerial(material)){
        serialList=parseSeriaisInput(seriais);
        if(serialList.length !== qtd) throw Object.assign(new Error(`${material} exige ${qtd} seriais (recebido ${serialList.length}) — verifique o lote`),{status:400});
        if(new Set(serialList).size !== serialList.length) throw Object.assign(new Error('Seriais duplicados na transferência'),{status:400});
      }
      // verifica saldo origem antes para falhar rápido
      const rowOrig = await store.estoque.get(contrato, material, unidadeOrigem, sistema);
      if(!rowOrig || Number(rowOrig.saldo||0) < qtd) throw Object.assign(new Error(`Saldo insuficiente em ${unidadeOrigem} (${rowOrig?rowOrig.saldo:0} disponível)`),{status:400});
      // saida origem
      const out = await store.estoque.adjust({ sistema, contrato, material, unidade: unidadeOrigem, qtd: -qtd, motivo: motivo ? `${motivo} → transf. p/ ${unidadeDestino}` : `Transferência p/ ${unidadeDestino}`, user, userName, seriais: serialList, at: quando, skipAudit });
      // Para materiais com serial (TZPR04/UPR04), os seriais saíram como em_uso; reativar diretamente em destino:
      // faz update direto de unidade/status para evitar re-inserção bloqueada
      let inn;
      if(temSerial(material) && serialList.length){
        // saldo já ajustado na saída; agora ajusta saldo destino manualmente e move seriais
        let rowDest=await store.estoque.get(contrato, material, unidadeDestino, sistema);
        if(!rowDest){
          if(MODE==='file'){ rowDest={ id: mem.seqEstoque++, sistema, contrato, material, unidade: unidadeDestino, saldo:0, createdAt:quando, updatedAt:quando }; mem.estoque.push(rowDest); }
          else { try{ const r=must(await supa.from('estoque').insert({ sistema, contrato, material, unidade: unidadeDestino, saldo:0 }).select().single(),'estoque.insertDest'); rowDest=appEST(r);}catch(e){ rowDest={ id: mem.seqEstoque++, sistema, contrato, material, unidade: unidadeDestino, saldo:0, createdAt:quando, updatedAt:quando }; mem.estoque.push(rowDest); } }
        }
        const saldoAntes=Number(rowDest.saldo||0);
        const saldoDepois=saldoAntes+qtd;
        if(MODE==='file'){ rowDest.saldo=saldoDepois; rowDest.updatedAt=new Date().toISOString(); }
        else { try{ const r=must(await supa.from('estoque').update({ saldo: saldoDepois, updatedat: new Date().toISOString() }).eq('id', Number(rowDest.id)).select().single(),'estoque.patchDest'); rowDest=appEST(r);}catch(e){ rowDest.saldo=saldoDepois; const idx=mem.estoque.findIndex(x=>String(x.id)===String(rowDest.id)); if(idx>=0) mem.estoque[idx]=rowDest; }}
        // move seriais: em_uso -> disponivel + unidadeDestino (por sistema)
        for(const s of serialList){
          if(MODE==='file'){
            const idx=mem.estoqueSerial.findIndex(x=> String(x.contrato).toUpperCase()===contrato && String(x.serial)===s && x.status==='em_uso' && normalizeSistema(x.sistema||DEFAULT_SISTEMA)===sistema);
            if(idx>=0){ mem.estoqueSerial[idx].status='disponivel'; mem.estoqueSerial[idx].unidade=unidadeDestino; mem.estoqueSerial[idx].sistema=sistema; mem.estoqueSerial[idx].updatedAt=new Date().toISOString(); }
            else {
              mem.estoqueSerial.push({ id: mem.seqEstoqueSerial++, sistema, contrato, serial: s, unidade: unidadeDestino, status:'disponivel', createdAt:quando, updatedAt:quando });
            }
          } else {
            try{ must(await supa.from('estoque_serial').update({ status:'disponivel', unidade: unidadeDestino, sistema, updatedat: new Date().toISOString() }).eq('contrato',contrato).eq('serial',s).eq('status','em_uso').eq('sistema',sistema),'estoqueSerial.move'); }catch(e){ mem.estoqueSerial.push({ id: mem.seqEstoqueSerial++, sistema, contrato, serial: s, unidade: unidadeDestino, status:'disponivel', createdAt:quando, updatedAt:quando }); }
          }
        }
        if(MODE==='file') saveFile();
        const mov={ sistema, contrato, material, unidade: unidadeDestino, tipo:'entrada', qtd, motivo: motivo ? `${motivo} ← transf. de ${unidadeOrigem}` : `Transferência de ${unidadeOrigem}`, seriais: serialList, user: user||null, userName: userName||null, createdAt: quando, unidadeDestino: unidadeOrigem };
        const auditRef=`${sistema}/${contrato}/${material}/${unidadeDestino} +${qtd} (de ${unidadeOrigem})`;
        let movRow;
        if(MODE==='file'){ movRow={ id: mem.seqEstoqueMov++, ...mov, saldoAntes, saldoDepois }; mem.estoqueMov.push(movRow); saveFile(); await auditar({ kind:'estoque', action:'entrada', personName:`${contrato} ${material} ${unidadeDestino}`, ticketId:null, ref:auditRef, byUser:user, byName:userName, byRole:'tecnico', summary: mov.motivo, changes:[{ field:'saldo', label:`Saldo ${unidadeDestino}`, from:String(saldoAntes), to:String(saldoDepois)}]}); }
        else { try{ const r=must(await supa.from('estoque_mov').insert(toRow({...mov, saldoAntes, saldoDepois}, ESTMOV)).select().single(),'estoqueMov.insertDest'); movRow=appESTMOV(r); await auditar({ kind:'estoque', action:'entrada', personName:`${contrato} ${material} ${unidadeDestino}`, ticketId:null, ref:auditRef, byUser:user, byName:userName, byRole:'tecnico', summary: mov.motivo, changes:[{ field:'saldo', label:`Saldo ${unidadeDestino}`, from:String(saldoAntes), to:String(saldoDepois)}]});}catch(e){ movRow={ id: mem.seqEstoqueMov++, ...mov, saldoAntes, saldoDepois }; mem.estoqueMov.push(movRow); } }
        inn={ row: rowDest, mov: movRow };
      } else {
        try{
          inn = await store.estoque.adjust({ sistema, contrato, material, unidade: unidadeDestino, qtd, motivo: motivo ? `${motivo} ← transf. de ${unidadeOrigem}` : `Transferência de ${unidadeOrigem}`, user, userName, seriais: serialList, at: quando, skipAudit });
        }catch(e){
          try{ await store.estoque.adjust({ sistema, contrato, material, unidade: unidadeOrigem, qtd, motivo: `Rollback transferência falha: ${e.message}`, user, userName, seriais: serialList, sistema, at: quando, skipAudit }); }catch(_){}
          throw e;
        }
      }
      // atualiza mov de saída com destino
      if(MODE==='file'){
        const lastMov=mem.estoqueMov.find(x=> x.id===out.mov.id);
        if(lastMov) { lastMov.unidadeDestino=unidadeDestino; saveFile(); }
      } else {
        try{ must(await supa.from('estoque_mov').update({ unidadedestino: unidadeDestino }).eq('id', Number(out.mov.id)),'estoqueMov.patchDestino'); }catch(e){}
      }
      return { origem: out, destino: inn };
    },
    async atDate(contrato, dateStr, unidade, sistema){
      let target;
      if(dateStr && /^\d{4}-\d{2}-\d{2}$/.test(String(dateStr).trim())){
        target = new Date(String(dateStr).trim() + 'T23:59:59.999Z');
      } else {
        target = dateStr ? new Date(dateStr) : new Date();
        if(!isNaN(target)) target.setUTCHours(23,59,59,999);
      }
      if(isNaN(target)) throw Object.assign(new Error('Data inválida'),{status:400});
      const c=normalizeContrato(contrato, sistema) || String(contrato||'').toUpperCase().trim();
      const allMov = await store.estoqueMov.all({ sistema: sistema || undefined, limit: 'all' });
      let filtered = allMov.filter(m=> String(m.contrato).toUpperCase()===c && new Date(m.createdAt) <= target);
      if(sistema){ const sis=normalizeSistema(sistema); filtered=filtered.filter(m=> normalizeSistema(m.sistema||DEFAULT_SISTEMA)===sis); }
      // aplica filtros de data: ignora movimentos futuros já filtrado, mas garante ordenação cronológica
      const unidadeFiltro = unidade ? normalizeUnidade(unidade) : null;
      const mats=materiaisDoSistema(sistema);
      if(unidadeFiltro){
        const result=[];
        for(const mat of mats){
          const movsUnidade = filtered.filter(m=> String(m.unidade)===unidadeFiltro && m.material===mat).sort((a,b)=> new Date(a.createdAt)-new Date(b.createdAt));
          const saldo=movsUnidade.reduce((acc,m)=> acc + (m.tipo==='entrada'? Number(m.qtd): -Number(m.qtd)), 0);
          let seriais=[];
          if(temSerial(mat)){
            const active=new Map();
            for(const m of movsUnidade){
              const list=Array.isArray(m.seriais)? m.seriais : [];
              for(const s of list){
                if(m.tipo==='entrada') active.set(String(s), true);
                else active.delete(String(s));
              }
            }
            seriais=[...active.keys()].sort();
          }
          result.push({ sistema: sistema?normalizeSistema(sistema):null, contrato: c, material: mat, unidade: unidadeFiltro, saldo, seriais, data: target.toISOString().slice(0,10) });
        }
        return result;
      }
      const result=[];
      for(const mat of mats){
        const movs=filtered.filter(m=> m.material===mat).sort((a,b)=> new Date(a.createdAt)-new Date(b.createdAt));
        const saldo=movs.reduce((acc,m)=> acc + (m.tipo==='entrada'? Number(m.qtd): -Number(m.qtd)), 0);
        let seriais=[];
        if(temSerial(mat)){
          const active=new Map();
          for(const m of movs){
            const list=Array.isArray(m.seriais)? m.seriais : [];
            for(const s of list){
              if(m.tipo==='entrada') active.set(String(s), true);
              else active.delete(String(s));
            }
          }
          seriais=[...active.keys()].sort();
        }
        result.push({ sistema: sistema?normalizeSistema(sistema):null, contrato: c, material: mat, unidade: 'TOTAL', saldo, seriais, data: target.toISOString().slice(0,10) });
      }
      return result;
    },
    async atDateDetailed(contrato, dateStr, sistema){
      const target = (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(String(dateStr).trim())) ? new Date(String(dateStr).trim() + 'T23:59:59.999Z') : new Date(dateStr||Date.now());
      if(isNaN(target)) throw Object.assign(new Error('Data inválida'),{status:400});
      const c=normalizeContrato(contrato, sistema) || String(contrato||'').toUpperCase().trim();
      const allMov = await store.estoqueMov.all({ sistema: sistema || undefined, limit: 'all' });
      let filtered = allMov.filter(m=> String(m.contrato).toUpperCase()===c && new Date(m.createdAt) <= target);
      if(sistema){ const sis=normalizeSistema(sistema); filtered=filtered.filter(m=> normalizeSistema(m.sistema||DEFAULT_SISTEMA)===sis); }
      const mats=materiaisDoSistema(sistema);
      const porUnidade=[];
      for(const u of UNIDADES){
        for(const mat of mats){
          const movsU=filtered.filter(m=> String(m.unidade)===u && m.material===mat).sort((a,b)=> new Date(a.createdAt)-new Date(b.createdAt));
          const saldo=movsU.reduce((acc,m)=> acc + (m.tipo==='entrada'? Number(m.qtd): -Number(m.qtd)), 0);
          let seriais=[];
          if(temSerial(mat)){
            const active=new Map();
            for(const m of movsU){
              const list=Array.isArray(m.seriais)? m.seriais : [];
              for(const s of list){
                if(m.tipo==='entrada') active.set(String(s), true);
                else active.delete(String(s));
              }
            }
            seriais=[...active.keys()].sort();
          }
          porUnidade.push({ sistema: sistema?normalizeSistema(sistema):null, contrato: c, material: mat, unidade: u, saldo, seriais, data: target.toISOString().slice(0,10) });
        }
      }
      return porUnidade;
    },
    async estornar(movId, { motivo, user, userName }){
      const id=Number(movId);
      if(!id) throw Object.assign(new Error('ID da movimentação inválido'),{status:400});
      if(!motivo || String(motivo).trim().length < 3) throw Object.assign(new Error('Motivo do estorno obrigatório (mín. 3 caracteres)'),{status:400});
      const all=await store.estoqueMov.all();
      const mov=all.find(m=> Number(m.id)===id);
      if(!mov) throw Object.assign(new Error('Movimentação não encontrada'),{status:404});
      // estorno é operação inversa - preserva sistema original
      const qtdEstorno = mov.tipo==='entrada' ? -Number(mov.qtd) : Number(mov.qtd);
      const res=await store.estoque.adjust({ sistema: mov.sistema||DEFAULT_SISTEMA, contrato: mov.contrato, material: mov.material, unidade: mov.unidade, qtd: qtdEstorno, motivo: `ESTORNO #${mov.id}: ${motivo}`, user, userName, seriais: mov.seriais });
      // marca mov original como estornada (audit trail)
      if(MODE==='file'){
        const orig=mem.estoqueMov.find(m=> Number(m.id)===id);
        if(orig) { orig.estornado=true; orig.estornadoAt=new Date().toISOString(); orig.estornadoBy=user; }
        saveFile();
      } else {
        try{ must(await supa.from('estoque_mov').update({ estornado: true }).eq('id', id),'estoqueMov.estornar'); }catch(e){}
      }
      await store.audit.insert({ kind:'estoque', action:'estorno', personName:`${mov.contrato} ${mov.material} ${mov.unidade}`, ticketId:null, ref:`ESTORNO #${mov.id} ${mov.contrato}/${mov.material}`, byUser:user, byName:userName, byRole:'tecnico', summary: motivo, changes:[{ field:'estorno', label:'Estorno mov #'+mov.id, from: String(mov.id), to: String(res.mov.id)}]});
      return { original: mov, estorno: res };
    }
  },
  estoqueMov: {
    async all(opts){
      let limit=500, contrato, unidade, material, sistema;
      if(opts && typeof opts==='object' && !Array.isArray(opts)){ limit=opts.limit!=null? opts.limit : 500; contrato=opts.contrato; unidade=opts.unidade; material=opts.material; sistema=opts.sistema; }
      else if(typeof opts==='number'){ limit=opts; }
      // limit: 'all' | 0 | negativo => histórico completo. Necessário para o
      // snapshot por data e para os relatórios: sem isso o corte de 500/1000
      // descarta o passado e o histórico volta com saldo errado.
      const tudo = limit==='all' || limit===Infinity || !(Number(limit)>0);
      const n = tudo ? Infinity : Math.min(Math.max(Number(limit),1),1000);
      const sisNorm = sistema ? normalizeSistema(sistema) : null;
      const cNorm = contrato ? (normalizeContrato(contrato, sisNorm||sistema) || String(contrato).toUpperCase()) : null;
      if(MODE==='file'){
        let list=[...mem.estoqueMov].sort((a,b)=> new Date(b.createdAt)-new Date(a.createdAt));
        if(sisNorm) list=list.filter(m=> normalizeSistema(m.sistema||DEFAULT_SISTEMA)===sisNorm);
        if(cNorm) list=list.filter(m=> String(m.contrato).toUpperCase()===cNorm);
        if(unidade){ const u=normalizeUnidade(unidade); list=list.filter(m=> String(m.unidade)===u || String(m.unidadeDestino)===u); }
        if(material) list=list.filter(m=> String(m.material).toUpperCase()===String(material).toUpperCase());
        return tudo ? list : list.slice(0,n);
      }
      try{
        const aplicar=q=>{
          if(sisNorm) q=q.eq('sistema', sisNorm);
          if(cNorm) q=q.eq('contrato', cNorm);
          if(unidade) q=q.or(`unidade.eq.${normalizeUnidade(unidade)},unidadedestino.eq.${normalizeUnidade(unidade)}`);
          if(material) q=q.eq('material', String(material).toUpperCase());
          return q;
        };
        if(!tudo) return must(await aplicar(supa.from('estoque_mov').select('*').order('createdat',{ascending:false}).limit(n)),'estoqueMov.all').map(appESTMOV);
        // Histórico completo: o PostgREST devolve no máximo 1000 linhas por request,
        // então pagina com range() até esgotar.
        const out=[]; const passo=1000;
        for(let from=0;; from+=passo){
          const r=must(await aplicar(supa.from('estoque_mov').select('*').order('createdat',{ascending:false}).order('id',{ascending:false}).range(from, from+passo-1)),'estoqueMov.all.pagina');
          out.push(...r.map(appESTMOV));
          if(r.length < passo) break;
        }
        return out;
      }catch(e){ console.warn('estoqueMov.all fallback',e.message); let list=[...mem.estoqueMov].sort((a,b)=> new Date(b.createdAt)-new Date(a.createdAt)); if(sisNorm) list=list.filter(m=> normalizeSistema(m.sistema||DEFAULT_SISTEMA)===sisNorm); if(cNorm) list=list.filter(m=> String(m.contrato).toUpperCase()===cNorm); if(unidade){ const u=normalizeUnidade(unidade); list=list.filter(m=> String(m.unidade)===u || String(m.unidadeDestino)===u); } if(material) list=list.filter(m=> String(m.material).toUpperCase()===String(material).toUpperCase()); return tudo ? list : list.slice(0,n); }
    },
    async byContrato(contrato){
      const all=await store.estoqueMov.all();
      return all.filter(m=> String(m.contrato).toUpperCase()===String(contrato).toUpperCase());
    },
    async byUnidade(unidade){
      const u=normalizeUnidade(unidade);
      const all=await store.estoqueMov.all();
      return all.filter(m=> String(m.unidade)===u || String(m.unidadeDestino)===u);
    },
    async byContratoUnidade(contrato, unidade){
      const u=normalizeUnidade(unidade);
      const c=String(contrato||'').toUpperCase();
      const all=await store.estoqueMov.all();
      return all.filter(m=> String(m.contrato).toUpperCase()===c && (String(m.unidade)===u || String(m.unidadeDestino)===u));
    }
  },
  estoqueSerial: {
    async all(opts){
      let contrato, unidade, status, sistema, limit;
      if(opts && typeof opts==='object'){ contrato=opts.contrato; unidade=opts.unidade; status=opts.status; sistema=opts.sistema; limit=opts.limit; }
      // limit:'all' => tabela inteira (paginada no Supabase, que devolve no
      // máximo 1000 linhas por request). Padrão: 1000, como antes.
      const tudo = limit==='all' || limit===Infinity || Number(limit)<0;
      const sisNorm = sistema ? normalizeSistema(sistema) : null;
      const cNorm = contrato ? (normalizeContrato(contrato, sisNorm||sistema) || String(contrato).toUpperCase()) : null;
      if(MODE==='file'){
        let list=[...mem.estoqueSerial].sort((a,b)=> String(a.unidade).localeCompare(String(b.unidade)) || String(a.serial).localeCompare(String(b.serial)));
        if(sisNorm) list=list.filter(s=> normalizeSistema(s.sistema||DEFAULT_SISTEMA)===sisNorm);
        if(cNorm) list=list.filter(s=> String(s.contrato).toUpperCase()===cNorm);
        if(unidade) list=list.filter(s=> String(s.unidade)===normalizeUnidade(unidade));
        if(status) list=list.filter(s=> String(s.status)===String(status));
        return list;
      }
      try{
        const aplicar=q=>{
          if(sisNorm) q=q.eq('sistema', sisNorm);
          if(cNorm) q=q.eq('contrato', cNorm);
          if(unidade) q=q.eq('unidade', normalizeUnidade(unidade));
          if(status) q=q.eq('status', String(status));
          return q;
        };
        if(!tudo) return must(await aplicar(supa.from('estoque_serial').select('*').order('unidade').order('serial').limit(1000)),'estoqueSerial.all').map(appESTSER);
        const out=[]; const passo=1000;
        for(let from=0;; from+=passo){
          const r=must(await aplicar(supa.from('estoque_serial').select('*').order('unidade').order('serial').order('id').range(from, from+passo-1)),'estoqueSerial.all.pagina');
          out.push(...r.map(appESTSER));
          if(r.length < passo) break;
        }
        return out;
      }catch(e){ console.warn('estoqueSerial.all fallback', e.message); let list=[...mem.estoqueSerial]; if(sisNorm) list=list.filter(s=> normalizeSistema(s.sistema||DEFAULT_SISTEMA)===sisNorm); if(cNorm) list=list.filter(s=> String(s.contrato).toUpperCase()===cNorm); return list; }
    },
    async byContrato(contrato){
      const all=await store.estoqueSerial.all();
      return all.filter(s=> String(s.contrato).toUpperCase()===String(contrato||'').toUpperCase());
    },
    async byUnidade(unidade){
      const u=normalizeUnidade(unidade);
      const all=await store.estoqueSerial.all();
      return all.filter(s=> String(s.unidade)===u);
    },
    async byContratoUnidade(contrato, unidade){
      const u=normalizeUnidade(unidade);
      const c=String(contrato||'').toUpperCase();
      const all=await store.estoqueSerial.all();
      return all.filter(s=> String(s.contrato).toUpperCase()===c && String(s.unidade)===u);
    }
  },

  // Sessões persistentes (sobrevivem a restart do servidor)
  sessions: {
    async insert(token, row) {
      if (MODE === 'file') { mem.sessions[token] = row; saveFile(); return; }
      try {
        const r = await supa.from('sessions').upsert({ token, user: row.user, role: row.role, name: row.name, sistema: row.sistema||null, exp: new Date(row.exp).toISOString() }, { onConflict: 'token' });
        if (r.error) throw r.error;
      } catch (e) { warnSessions(e); memSessions.set(token, row); }
    },
    async get(token) {
      if (!token) return null;
      if (MODE === 'file') return mem.sessions[token] || null;
      try {
        const r = await supa.from('sessions').select('*').eq('token', token).limit(1);
        if (r.error) throw r.error;
        if (!r.data.length) return memSessions.get(token) || null;
        const s = r.data[0];
        return { user: s.user, role: s.role, name: s.name, sistema: s.sistema||null, exp: new Date(s.exp).getTime() };
      } catch (e) { warnSessions(e); return memSessions.get(token) || null; }
    },
    async del(token) {
      if (!token) return;
      if (MODE === 'file') { delete mem.sessions[token]; saveFile(); return; }
      try {
        const r = await supa.from('sessions').delete().eq('token', token);
        if (r.error) throw r.error;
      } catch (e) { warnSessions(e); }
      memSessions.delete(token);
    },
    // Invalida todas as sessões de um usuário (reset de senha, desativação, remoção).
    // exceptToken preserva a sessão atual (ex.: usuário trocando a própria senha).
    async delByUser(user, exceptToken) {
      const id = normalizeUser(user);
      if (!id) return;
      if (MODE === 'file') {
        let ch = false;
        for (const [tok, s] of Object.entries(mem.sessions)) {
          if (normalizeUser(s.user) === id && tok !== exceptToken) { delete mem.sessions[tok]; ch = true; }
        }
        if (ch) saveFile();
        return;
      }
      try {
        let q = supa.from('sessions').delete().eq('user', id);
        if (exceptToken) q = q.neq('token', exceptToken);
        const r = await q;
        if (r.error) throw r.error;
        // também remove variantes acentuadas
        const allSess = await supa.from('sessions').select('user,token');
        if (!allSess.error) {
          for (const row of allSess.data || []) {
            if (normalizeUser(row.user) === id && row.token !== exceptToken) {
              await supa.from('sessions').delete().eq('token', row.token);
            }
          }
        }
      } catch (e) { warnSessions(e); }
      for (const [tok, s] of memSessions) if (normalizeUser(s.user) === id && tok !== exceptToken) memSessions.delete(tok);
    },
    async cleanup() {
      const now = Date.now();
      if (MODE === 'file') {
        let ch = false;
        for (const k of Object.keys(mem.sessions)) if (mem.sessions[k].exp < now) { delete mem.sessions[k]; ch = true; }
        if (ch) saveFile();
        return;
      }
      try {
        const r = await supa.from('sessions').delete().lt('exp', new Date(now).toISOString());
        if (r.error) throw r.error;
      } catch (e) { warnSessions(e); }
      for (const [k, s] of memSessions) if (s.exp < now) memSessions.delete(k);
    }
  },

  async backup() {
    const [persons, tickets, chat, audit, users, agenda, termos, psi] = await Promise.all([
      store.persons.all(), store.tickets.all(), store.chat.list(),
      store.audit.recent(500), store.users.all(), store.agenda.all().catch(()=>[]), store.termos.all().catch(()=>[]), store.psi.all().catch(()=>[])
    ]);
    const mx = a => a.reduce((m, x) => Math.max(m, Number(x.id) || 0), 0);
    return {
      persons, tickets, chat: chat.slice(-200), audit: audit.slice(-500), users, agenda: agenda.slice(-500), termos: termos.slice(-500), psi: psi.slice(-2000),
      seqPerson: mx(persons) + 1, seqTicket: mx(tickets) + 1,
      seqChat: mx(chat) + 1, seqAudit: mx(audit) + 1, seqAgenda: mx(agenda) + 1, seqTermo: mx(termos) + 1, seqPsi: mx(psi) + 1
    };
  },

  async restore(dump) {
    if (!dump || !Array.isArray(dump.persons) || !Array.isArray(dump.tickets) || !Array.isArray(dump.users))
      throw Object.assign(new Error('Arquivo inválido'), { status: 400 });
    if (!dump.users.some(u => u.role === 'admin' && u.active !== false))
      throw Object.assign(new Error('Arquivo inválido ou sem administrador ativo'), { status: 400 });
    dump.users.forEach(u => { if (u.active === undefined) u.active = true; });
    if (MODE === 'file') {
      const keepSessions = (mem && mem.sessions) || {};
      const keepAgenda = (mem && mem.agenda) || [];
      const keepTokens = (mem && mem.googleTokens) || {};
      const keepTermos = (mem && mem.termos) || [];
      const keepPsi = (mem && mem.psi) || [];
      const keepSeqAgenda = (mem && mem.seqAgenda) || 1;
      const keepSeqTermo = (mem && mem.seqTermo) || 1;
      const keepSeqPsi = (mem && mem.seqPsi) || 1;
      mem = {
        persons: dump.persons, tickets: dump.tickets,
        chat: Array.isArray(dump.chat) ? dump.chat.slice(-200) : [],
        audit: Array.isArray(dump.audit) ? dump.audit.slice(-500) : [],
        users: dump.users, sessions: keepSessions,
        agenda: Array.isArray(dump.agenda) ? dump.agenda.slice(-500) : keepAgenda,
        googleTokens: keepTokens,
        termos: Array.isArray(dump.termos) ? dump.termos.slice(-500) : keepTermos,
        psi: Array.isArray(dump.psi) ? dump.psi.slice(-2000) : keepPsi,
        seqPerson: dump.seqPerson || 1, seqTicket: dump.seqTicket || 1,
        seqChat: dump.seqChat || 1, seqAudit: dump.seqAudit || 1, seqAgenda: dump.seqAgenda || keepSeqAgenda, seqTermo: dump.seqTermo || keepSeqTermo, seqPsi: dump.seqPsi || keepSeqPsi
      };
      saveFile();
      return { persons: mem.persons.length, tickets: mem.tickets.length, users: mem.users.length };
    }
    for (const t of ['audit', 'chat', 'tickets', 'persons']) {
      const all = must(await supa.from(t).select('id').limit(10000), 'restore.list');
      for (let i = 0; i < all.length; i += 200) {
        must(await supa.from(t).delete().in('id', all.slice(i, i + 200).map(x => x.id)), 'restore.del');
      }
    }
    // agenda (opcional)
    if (Array.isArray(dump.agenda) && dump.agenda.length) {
      try{
        const allA = must(await supa.from('agenda').select('id').limit(10000), 'restore.agenda.list');
        for (let i = 0; i < allA.length; i += 200) {
          must(await supa.from('agenda').delete().in('id', allA.slice(i, i + 200).map(x => x.id)), 'restore.agenda.del');
        }
      }catch(e){}
    }
    if (Array.isArray(dump.termos) && dump.termos.length) {
      try{
        const allT = must(await supa.from('termos').select('id').limit(10000), 'restore.termos.list');
        for (let i = 0; i < allT.length; i += 200) {
          must(await supa.from('termos').delete().in('id', allT.slice(i, i + 200).map(x => x.id)), 'restore.termos.del');
        }
      }catch(e){}
    }
    if (Array.isArray(dump.psi) && dump.psi.length) {
      try{
        const allP = must(await supa.from('psi_records').select('id').limit(10000), 'restore.psi.list');
        for (let i = 0; i < allP.length; i += 200) {
          must(await supa.from('psi_records').delete().in('id', allP.slice(i, i + 200).map(x => x.id)), 'restore.psi.del');
        }
      }catch(e){}
    }
    const cur = await supa.from('users').select('user');
    if (!cur.error && cur.data.length) must(await supa.from('users').delete().neq('user', '__impossivel__'), 'restore.usersdel');
    const chunk = async (table, rows, map) => {
      for (let i = 0; i < rows.length; i += 100) {
        must(await supa.from(table).insert(rows.slice(i, i + 100).map(r => toRow(r, map))), 'restore.' + table);
      }
    };
    await chunk('persons', dump.persons, P);
    await chunk('tickets', dump.tickets, T);
    await chunk('chat', (dump.chat || []).slice(-200).map(m => ({ id: m.id, user: m.user, name: m.name, role: m.role, to: m.to, text: m.text, anexos: m.anexos || [] })), { id: 'id', user: 'user', name: 'name', role: 'role', to: 'to', text: 'text', anexos: 'anexos' });
    await chunk('audit', (dump.audit || []).slice(-500), A);
    await chunk('users', dump.users, { user: 'user', name: 'name', role: 'role', pass: 'pass', active: 'active' });
    if (Array.isArray(dump.agenda) && dump.agenda.length) {
      try{ await chunk('agenda', dump.agenda.slice(-500), AG); }catch(e){}
    }
    if (Array.isArray(dump.termos) && dump.termos.length) {
      try{ await chunk('termos', dump.termos.slice(-500), TM); }catch(e){}
    }
    if (Array.isArray(dump.psi) && dump.psi.length) {
      try{ await chunk('psi_records', dump.psi.slice(-2000), PSI); }catch(e){}
    }
    try{ must(await supa.rpc('reset_sequences'), 'restore.seq'); }catch(e){}
    return { persons: dump.persons.length, tickets: dump.tickets.length, users: dump.users.length };
  },

  // Arquivos: disco local (file) ou Supabase Storage (supabase)
  // Só tipos seguros (nada de .svg/.html que executam código no navegador)
  async saveFileUpload(file) {
    const orig = String(file.originalname || 'arquivo').slice(0, 120);
    const parts = orig.split('.');
    const ext = (parts.pop() || '').toLowerCase();
    // Bloqueia extensão dupla disfarçada (ex.: laudo.pdf.html, foto.jpg.svg, shell.php.jpg)
    const dangerous = ['html', 'htm', 'svg', 'js', 'exe', 'bat', 'cmd', 'sh', 'php', 'phtml', 'phar'];
    const allParts = orig.toLowerCase().split('.');
    if (allParts.some((p,i) => i < allParts.length-1 && dangerous.includes(p)) || dangerous.includes(ext)) {
      const e = new Error('Tipo de arquivo não permitido: ' + orig);
      e.status = 400;
      throw e;
    }
    // Checagem de assinatura mágica (mime pode ser forjado) - cobre todos os tipos permitidos
    const buf = file.buffer || Buffer.alloc(0);
    const head = buf.slice(0, 12).toString('latin1');
    const isJpg = buf[0] === 0xFF && buf[1] === 0xD8;
    const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47;
    const isGif = head.startsWith('GIF8');
    const isPdf = head.startsWith('%PDF');
    const isWebp = head.startsWith('RIFF') && buf.slice(8,12).toString() === 'WEBP';
    const isZip = buf[0] === 0x50 && buf[1] === 0x4B; // docx/xlsx
    const isMp3 = head.startsWith('ID3') || (buf[0] === 0xFF && (buf[1] & 0xE0) === 0xE0);
    const isWav = head.startsWith('RIFF') && buf.slice(8,12).toString() === 'WAVE';
    const isWebm = buf[0] === 0x1A && buf[1] === 0x45 && buf[2] === 0xDF && buf[3] === 0xA3;
    const isOgg = head.startsWith('OggS');
    if (['jpg', 'jpeg'].includes(ext) && !isJpg) { const e = new Error('Arquivo JPG inválido: ' + orig); e.status = 400; throw e; }
    if (ext === 'png' && !isPng) { const e = new Error('Arquivo PNG inválido: ' + orig); e.status = 400; throw e; }
    if (ext === 'gif' && !isGif) { const e = new Error('Arquivo GIF inválido: ' + orig); e.status = 400; throw e; }
    if (ext === 'pdf' && !isPdf) { const e = new Error('Arquivo PDF inválido: ' + orig); e.status = 400; throw e; }
    if (ext === 'webp' && !isWebp) { const e = new Error('Arquivo WEBP inválido: ' + orig); e.status = 400; throw e; }
    if (['docx','xlsx'].includes(ext) && !isZip) { const e = new Error('Arquivo Office inválido: ' + orig); e.status = 400; throw e; }
    if (ext === 'mp3' && !isMp3) { const e = new Error('Arquivo MP3 inválido: ' + orig); e.status = 400; throw e; }
    if (ext === 'wav' && !isWav) { const e = new Error('Arquivo WAV inválido: ' + orig); e.status = 400; throw e; }
    if (ext === 'webm' && !isWebm) { const e = new Error('Arquivo WEBM inválido: ' + orig); e.status = 400; throw e; }
    if (['ogg','oga','m4a'].includes(ext) && !(isOgg || isMp3 || isWebm || head.startsWith('ftyp'))) { /* m4a é MP4 */ }
    // bloqueia imagens muito grandes (DoS via decompressão)
    if (['jpg','jpeg','png','webp','gif'].includes(ext) && file.size > 8*1024*1024) { const e=new Error('Imagem muito grande (máx 8MB)'); e.status=400; throw e; }
    const okExt = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'txt', 'csv', 'webm', 'mp3', 'ogg', 'm4a', 'mp4', 'wav', 'oga'];
    const okMime = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf',
      'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain', 'text/csv', 'audio/webm', 'audio/mpeg', 'audio/ogg', 'audio/mp4', 'audio/x-m4a', 'audio/wav', 'audio/wave', 'audio/x-wav'];
    if (!okExt.includes(ext) || !okMime.includes(file.mimetype)) {
      const e = new Error('Tipo de arquivo não permitido: ' + orig);
      e.status = 400;
      throw e;
    }
    const safe = Date.now() + '-' + Math.round(Math.random() * 1e9) + '-' + orig.replace(/[^a-zA-Z0-9._-]/g, '_');
    if (MODE === 'file') {
      fs.writeFileSync(path.join(UPLOAD_DIR, safe), file.buffer);
      return { url: '/uploads/' + safe, name: file.originalname, size: file.size, mimetype: file.mimetype };
    }
    const up = await supa.storage.from('anexos').upload(safe, file.buffer, { contentType: file.mimetype || 'application/octet-stream', upsert: false });
    if (up.error) throw new Error('upload: ' + up.error.message);
    const pub = supa.storage.from('anexos').getPublicUrl(safe);
    return { url: pub.data.publicUrl, name: file.originalname, size: file.size, mimetype: file.mimetype };
  },

  // Apaga o arquivo físico de um anexo (ignora erros: pode já ter sumido)
  async deleteStoredFile(url) {
    const u = String(url || '');
    try {
      if (MODE === 'file') {
        const m = u.match(/\/uploads\/([^/?#]+)$/);
        if (!m) return;
        await fs.promises.unlink(path.join(UPLOAD_DIR, path.basename(m[1]))).catch(() => {});
        return;
      }
      const key = decodeURIComponent(u.split('/anexos/')[1] || '').split('?')[0];
      if (!key) return;
      await supa.storage.from('anexos').remove([key]);
    } catch {}
  },

  // Expira anexos de tickets fechados e de chat com mais de maxAgeMs (padrão 24h, via FILES_TTL_HOURS).
  // Apaga o arquivo físico e deixa um marcador {expired:true} no lugar.
  // Tickets ativos (aguardando/em_atendimento) NUNCA são tocados; chat expira todo anexo > TTL.
  async cleanupExpiredFiles(maxAgeMs) {
    const ttl = typeof maxAgeMs === 'number' ? maxAgeMs : (Number(process.env.FILES_TTL_HOURS) || 24) * 3600e3;
    const now = Date.now();
    let filesRemoved = 0, ticketsTouched = 0, chatsTouched = 0;
    const tickets = await store.tickets.all();
    for (const t of tickets) {
      if (!['finalizado', 'cancelado'].includes(t.status)) continue;
      const ref = t.finishedAt || t.cancelledAt || t.createdAt;
      if (!ref || now - new Date(ref).getTime() < ttl) continue;
      const cleanList = async (list) => {
        if (!Array.isArray(list)) return list;
        const out = [];
        for (const a of list) {
          if (!a || a.expired || !a.url) { out.push(a); continue; }
          await store.deleteStoredFile(a.url);
          filesRemoved++;
          out.push({ name: a.name || 'arquivo', expired: true, expiredAt: new Date().toISOString() });
        }
        return out;
      };
      const before = JSON.stringify([t.anexos, t.fotosPos]);
      const anexos = await cleanList(t.anexos);
      const fotosPos = await cleanList(t.fotosPos);
      if (JSON.stringify([anexos, fotosPos]) !== before) {
        await store.tickets.patch(t.id, { anexos, fotosPos });
        ticketsTouched++;
      }
    }
    // Chat: todo anexo com mais de 24h expira (independente de status)
    try{
      const chats = await store.chat.list();
      for(const m of chats){
        if(!m || !Array.isArray(m.anexos) || !m.anexos.length) continue;
        const ref = m.at || m.createdAt;
        if(!ref || now - new Date(ref).getTime() < ttl) continue;
        const hasActive = m.anexos.some(a=> a && a.url && !a.expired);
        if(!hasActive) continue;
        const cleaned=[];
        for(const a of m.anexos){
          if(!a || a.expired || !a.url){ cleaned.push(a); continue; }
          await store.deleteStoredFile(a.url);
          filesRemoved++;
          cleaned.push({ name: a.name||'arquivo', expired:true, expiredAt: new Date().toISOString() });
        }
        // atualiza no store (suporta file e supabase via patch direto na lista)
        if(JSON.stringify(cleaned)!==JSON.stringify(m.anexos)){
          if(MODE==='file'){
            const idx=mem.chat.findIndex(x=> String(x.id)===String(m.id));
            if(idx>=0){ mem.chat[idx].anexos=cleaned; chatsTouched++; }
          } else {
            try{ must(await supa.from('chat').update({ anexos: cleaned }).eq('id', Number(m.id)), 'chat.expire'); chatsTouched++; }catch(e){}
          }
        }
      }
      if(chatsTouched && MODE==='file') saveFile();
    }catch(e){}
    return { filesRemoved, ticketsTouched, chatsTouched };
  }
};

module.exports = store;
module.exports.normalizeSistema = normalizeSistema;
module.exports.normalizeContrato = normalizeContrato;
module.exports.contratoLabel = contratoLabel;
module.exports.contratosDoSistema = contratosDoSistema;
module.exports.getUserSistema = getUserSistema;
module.exports.normalizeUnidade = normalizeUnidade;
module.exports.SISTEMAS = SISTEMAS;
module.exports.CONTRATO_INFINITY = CONTRATO_INFINITY;
module.exports.CONTRATOS_SPACECOM = CONTRATOS_SPACECOM;
module.exports.MATERIAIS = MATERIAIS;
module.exports.MATERIAIS_SPACECOM = MATERIAIS_SPACECOM;
module.exports.MATERIAIS_INFINITY = MATERIAIS_INFINITY;
module.exports.MATERIAIS_COM_SERIAL = MATERIAIS_COM_SERIAL;
module.exports.materiaisDoSistema = materiaisDoSistema;
module.exports.materialDoSerial = materialDoSerial;
