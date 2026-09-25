// =====================================================================
//  Seed massivo de estoque — 60 dias de movimentações em TODAS as
//  unidades (6 locais) nos dois sistemas: Spacecom (CE01/CE02) e
//  Infinity (INF, estoque unificado).
//  TZPR04: seriais sequenciais a partir de 4315025365
//  UPR04 : seriais sequenciais a partir de 4714235689
//
//  IMPORTANTE: pare o servidor antes de rodar (o db.json é escrito
//  aqui e o servidor em memória sobrescreveria as datas):
//    node scripts/seed-estoque-60d.js
//  Repetível: os seriais continuam a partir do último usado das bases.
// =====================================================================
const fs = require('fs');
const path = require('path');
const store = require('../store');

const DB_FILE = path.join(__dirname, '..', 'db.json');
const TZPR_BASE = 4315025365;
const UPR_BASE = 4714235689;
const SEED_USER = 'seed-60d';

const UNIDADES = ['UMEPE Juazeiro','UP-Juazeiro','UP-Cariri','UP-Crato','Fórum de Crato','Fórum de Jardim'];
const MATS = ['TZPR04','UPR04','FONTE04','CINTA','TRAVAS'];
const LIMITES = { TZPR04: 5, UPR04: 5, FONTE04: 5, CINTA: 10, TRAVAS: 20 };
const COMBOS = [
  { sistema: 'spacecom', contrato: 'CE01' },
  { sistema: 'spacecom', contrato: 'CE02' },
  { sistema: 'infinity', contrato: 'INF' },
];

const rnd = n => Math.floor(Math.random() * n);
const pick = arr => arr[rnd(arr.length)];
const saldoKey = (combo, material, unidade) => `${combo.sistema}::${combo.contrato}::${material}::${unidade}`;
function dataAtras(dias, hora) {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  d.setHours(hora != null ? hora : 8 + rnd(10), rnd(60), rnd(60), 0);
  return d.toISOString();
}

// ---------------- estado local (espelha as validações do store) ------
// Snapshot de auditoria ANTES do seed: o store limita audit a 500 e o
// seed empurraria registros reais para fora — ao final eles são restaurados.
const pre = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
const auditAntes = Array.isArray(pre.audit) ? pre.audit : [];

const saldos = new Map();   // saldoKey -> Number
const seriais = new Map();  // serial -> { sistema, contrato, unidade, status }
for (const e of (pre.estoque || [])) saldos.set(saldoKey(e, e.material, e.unidade), Number(e.saldo || 0));
for (const s of (pre.estoqueSerial || [])) seriais.set(String(s.serial), { sistema: s.sistema, contrato: s.contrato, unidade: s.unidade, status: s.status });

let tzprNext = TZPR_BASE, uprNext = UPR_BASE;
function proximoSerial(material) {
  // avança até achar serial que nunca existiu (evita colisão em re-runs)
  while (true) {
    const n = material === 'TZPR04' ? tzprNext : uprNext;
    const s = String(n).padStart(10, '0');
    if (material === 'TZPR04') tzprNext++; else uprNext++;
    if (!seriais.has(s)) return s;
  }
}
function pegarDisponiveis(combo, unidade, n) {
  const out = [];
  for (const [serial, st] of seriais) {
    if (st.status === 'disponivel' && st.sistema === combo.sistema && st.contrato === combo.contrato && st.unidade === unidade) {
      out.push(serial);
      if (out.length >= n) break;
    }
  }
  return out;
}

// ---------------- geração das operações ------------------------------
const ops = [];        // { dateISO, run() }
const movDatas = [];   // { id, createdAt } para o patch final de datas
const serialEntradas = []; // { serial, createdAt } idem

function addMov(dateISO, combo, unidade, material, qtd, motivo) {
  ops.push({
    dateISO,
    run: async () => {
      const seriaisOp = [];
      if (material === 'TZPR04' || material === 'UPR04') {
        if (qtd > 0) {
          for (let i = 0; i < qtd; i++) seriaisOp.push(proximoSerial(material));
        } else {
          const disp = pegarDisponiveis(combo, unidade, -qtd);
          if (disp.length < -qtd) return null; // sem serial disponível nesta unidade: pula
          seriaisOp.push(...disp);
        }
      }
      const key = saldoKey(combo, material, unidade);
      const atual = saldos.get(key) || 0;
      if (qtd < 0 && atual + qtd < 0) return null; // saldo insuficiente: pula
      const res = await store.estoque.adjust({
        sistema: combo.sistema, contrato: combo.contrato, material, unidade,
        qtd, motivo, seriais: seriaisOp, user: SEED_USER, userName: 'Seed 60 dias'
      });
      // espelha o efeito no estado local
      saldos.set(key, atual + qtd);
      if (seriaisOp.length) {
        if (qtd > 0) {
          for (const s of seriaisOp) {
            seriais.set(s, { sistema: combo.sistema, contrato: combo.contrato, unidade, status: 'disponivel' });
            serialEntradas.push({ serial: s, createdAt: dateISO });
          }
        } else {
          for (const s of seriaisOp) { const st = seriais.get(s); if (st) st.status = 'em_uso'; }
        }
      }
      movDatas.push({ id: res.mov.id, createdAt: dateISO });
      return res;
    },
    desc: `${combo.contrato} ${material} ${unidade} ${qtd > 0 ? '+' : ''}${qtd}`
  });
}

// Fase 1 — lote inicial em cada (sistema, contrato, material, unidade), dias 56–60
const qtdLote = {
  TZPR04: () => 10 + rnd(7),   // com seriais
  UPR04: () => 6 + rnd(7),     // com seriais
  FONTE04: () => 10 + rnd(10),
  CINTA: () => 15 + rnd(15),
  TRAVAS: () => 25 + rnd(25),
};
COMBOS.forEach((combo, ci) => UNIDADES.forEach((unidade, ui) => MATS.forEach((material, mi) => {
  const dias = 60 - ((ci * 6 + ui + mi) % 5); // 56..60, datas escalonadas
  const qtd = qtdLote[material]();
  const motivo = material === 'TZPR04' || material === 'UPR04'
    ? `Lote inicial ${combo.contrato} ${material} — ${unidade}`
    : `Recebimento lote inicial ${material} — ${unidade}`;
  addMov(dataAtras(dias, 9 + rnd(6)), combo, unidade, material, qtd, motivo);
})));

// Fase 2 — movimentações diárias (dias 54..1) espalhadas por todas as unidades
const MOTIVO_ENTRADA = {
  TZPR04: u => `Recebimento lote TZPR04 — ${u}`, UPR04: u => `Recebimento lote UPR04 — ${u}`,
  FONTE04: u => `Recebimento fontes — ${u}`, CINTA: u => `Recebimento cintas — ${u}`, TRAVAS: u => `Recebimento travas — ${u}`,
};
const MOTIVO_SAIDA = {
  TZPR04: u => `Instalação TZPR04 — ${u}`, UPR04: u => `Instalação UPR04 — ${u}`,
  FONTE04: u => `Uso em manutenção — ${u}`, CINTA: u => `Troca de cinta — ${u}`, TRAVAS: u => `Uso/aplicação travas — ${u}`,
};
const QTD = {
  TZPR04: () => 1 + rnd(4), UPR04: () => 1 + rnd(3),
  FONTE04: () => 2 + rnd(5), CINTA: () => 4 + rnd(7), TRAVAS: () => 6 + rnd(9),
};
for (let dias = 54; dias >= 1; dias--) {
  const nOps = 3 + rnd(3); // 3–5 ops por dia
  for (let k = 0; k < nOps; k++) {
    const combo = pick(COMBOS);
    const unidade = pick(UNIDADES);
    const material = pick(MATS);
    const saida = Math.random() < 0.45;
    const qtd = QTD[material]() * (saida ? -1 : 1);
    const motivo = (saida ? MOTIVO_SAIDA : MOTIVO_ENTRADA)[material](unidade);
    addMov(dataAtras(dias), combo, unidade, material, qtd, motivo);
  }
}

// ---------------- execução (mais antigo primeiro) ---------------------
(async () => {
  console.log(`Seed 60 dias — ${ops.length} operações planejadas em ${UNIDADES.length} unidades x ${COMBOS.length} sistema/contrato`);
  if (store.mode !== 'file') console.warn('AVISO: modo', store.mode, '— o backdate de datas só funciona em modo arquivo (db.json).');
  ops.sort((a, b) => a.dateISO < b.dateISO ? -1 : 1);
  let ok = 0, skip = 0;
  for (const op of ops) {
    try {
      const r = await op.run();
      if (r === null) skip++; else ok++;
    } catch (e) {
      skip++;
      if (String(e.message).includes('exige') || String(e.message).includes('inválid')) console.warn('SKIP:', op.desc, '—', e.message);
    }
  }
  console.log(`Ajustes: ${ok} aplicados, ${skip} ignorados (saldo/serial indisponível) de ${ops.length}`);

  // Patch final de datas (uma única escrita, sem risco de saveFile sobrescrever)
  const j = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  const byId = new Map(movDatas.map(m => [String(m.id), m.createdAt]));
  let patchMov = 0;
  for (const m of (j.estoqueMov || [])) { const d = byId.get(String(m.id)); if (d) { m.createdAt = d; patchMov++; } }
  const entBySerial = new Map(serialEntradas.map(s => [s.serial, s.createdAt]));
  let patchSer = 0;
  for (const s of (j.estoqueSerial || [])) { const d = entBySerial.get(String(s.serial)); if (d) { s.createdAt = d; patchSer++; } }
  // Auditoria: remove as entradas do seed e restaura as antigas empurradas para fora do cap 500
  const idsAtuais = new Set((j.audit || []).map(a => a.id));
  const restaurar = auditAntes.filter(a => !idsAtuais.has(a.id));
  j.audit = (j.audit || [])
    .filter(a => String(a.byUser) !== SEED_USER)
    .concat(restaurar)
    .sort((a, b) => a.id - b.id)
    .slice(-500);
  fs.writeFileSync(DB_FILE, JSON.stringify(j, null, 2));
  console.log(`Datas aplicadas: ${patchMov} movimentações, ${patchSer} seriais | auditoria restaurada (${restaurar.length} entradas antigas)`);

  // Resumo
  for (const combo of COMBOS) {
    const r = await store.estoque.resumo({ contrato: combo.contrato, sistema: combo.sistema });
    console.log(`Resumo ${combo.sistema}/${combo.contrato}: total ${r.total} | por material:`, r.porMaterial);
  }
  const ser = j.estoqueSerial || [];
  const tz = ser.filter(s => Number(s.serial) >= TZPR_BASE && Number(s.serial) < TZPR_BASE + 5000);
  const up = ser.filter(s => Number(s.serial) >= UPR_BASE && Number(s.serial) < UPR_BASE + 5000);
  console.log(`Seriais TZPR04 (base ${TZPR_BASE}): ${tz.length} | exemplo: ${tz.slice(0, 3).map(s => s.serial).join(', ')}`);
  console.log(`Seriais UPR04 (base ${UPR_BASE}): ${up.length} | exemplo: ${up.slice(0, 3).map(s => s.serial).join(', ')}`);
  const datas = movDatas.map(m => m.createdAt).sort();
  console.log(`Janela de datas: ${datas[0].slice(0, 10)} .. ${datas[datas.length - 1].slice(0, 10)} | movs totais: ${(j.estoqueMov || []).length} | seriais totais: ${ser.length}`);
})().catch(e => { console.error(e); process.exit(1); });
