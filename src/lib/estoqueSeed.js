// =====================================================================
//  Gerador de histórico massivo de estoque (até 60 dias).
//  Usado pelo script scripts/seed-estoque-60d.js e pelo endpoint
//  admin POST /api/estoque/seed — uma única implementação para os dois,
//  valendo tanto em modo arquivo (db.json) quanto no Supabase.
//
//  Cobre as três combinações sistema/contrato (Spacecom CE01, CE02 e
//  Infinity INF), os 5 materiais e os 6 locais, com:
//    • adições (recebimento de lote) por local;
//    • transferências entre locais (com seriais quando o material tem);
//    • saídas (instalação, troca, uso em manutenção);
//    • datas históricas gravadas via store.estoque.adjust/transferir
//      ({ at, skipAudit }) — a trilha de auditoria real não é poluída.
//
//  É repetível: continua a numeração de serial existente e nunca deixa
//  saldo negativo (operações sem lastro são contadas como "puladas").
// =====================================================================
const store = require('../../store');

const UNIDADES = store.unidades;
const MATERIAIS = store.materiais;
const COM_SERIAL = ['TZPR04', 'UPR04'];
const COMBOS = [
  { sistema: 'spacecom', contrato: 'CE01' },
  { sistema: 'spacecom', contrato: 'CE02' },
  { sistema: 'infinity', contrato: 'INF' },
];
const BASES_SERIAL = {
  TZPR04: { base: 4315025365, prefixo: '431' },
  UPR04: { base: 4714235689, prefixo: '471' },
};
const QTD_ENTRADA = { TZPR04: [8, 14], UPR04: [5, 10], FONTE04: [10, 20], CINTA: [15, 30], TRAVAS: [20, 45] };
const QTD_SAIDA = { TZPR04: [1, 3], UPR04: [1, 3], FONTE04: [2, 6], CINTA: [3, 8], TRAVAS: [4, 10] };
const QTD_TRANSF = { TZPR04: [2, 6], UPR04: [2, 5], FONTE04: [3, 10], CINTA: [5, 15], TRAVAS: [8, 20] };
const MOTIVO_SAIDA = {
  TZPR04: 'Instalação de tornozeleira', UPR04: 'Instalação de unidade portátil',
  FONTE04: 'Uso em manutenção', CINTA: 'Troca de cinta', TRAVAS: 'Aplicação de travas',
};

// PRNG com semente: o mesmo --seed gera exatamente o mesmo histórico.
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const chave = (sistema, contrato, material, unidade) => `${sistema}::${contrato}::${material}::${unidade}`;
function materialDoSerial(serial) {
  const v = String(serial || '');
  for (const m of COM_SERIAL) if (v.startsWith(BASES_SERIAL[m].prefixo)) return m;
  return null;
}
function proximoNumero(material, seriaisExistentes) {
  const { base, prefixo } = BASES_SERIAL[material];
  let max = base - 1;
  for (const s of seriaisExistentes) {
    const v = String(s);
    if (v.length !== 10 || !v.startsWith(prefixo)) continue;
    const n = Number(v);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
}

async function popularEstoque(opts = {}) {
  const dias = Math.min(Math.max(Math.round(Number(opts.dias) || 60), 1), 60);
  const semLote = !!opts.semLote;
  const dry = !!opts.dry;
  const user = opts.user || 'seed-60d';
  const userName = opts.userName || 'Seed 60 dias';
  const log = typeof opts.log === 'function' ? opts.log : () => {};
  const rnd = mulberry32(Math.round(Number(opts.semente) || 20260925));
  const randInt = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const pick = arr => arr[Math.floor(rnd() * arr.length)];

  log(`Seed de estoque — ${dias} dias | ${UNIDADES.length} locais | ${COMBOS.length} sistema/contrato | ${MATERIAIS.length} materiais`);
  log(`modo: ${store.mode}${dry ? ' | DRY-RUN (nada é gravado)' : ''}`);

  // ---- espelho do estado atual: evita saldo negativo e serial repetido ----
  const saldos = new Map();
  const disponiveis = new Map();
  for (const e of await store.estoque.all()) {
    saldos.set(chave(e.sistema, e.contrato, e.material, e.unidade), Number(e.saldo || 0));
  }
  // limit:'all' — o espelho precisa ver a tabela inteira, senão seriais antigos
  // ficam fora do cálculo e o seed geraria números já existentes (skip em massa).
  const seriaisAntes = await store.estoqueSerial.all({ limit: 'all' });
  for (const s of seriaisAntes) {
    if (String(s.status) !== 'disponivel') continue;
    const mat = materialDoSerial(s.serial);
    if (!mat) continue;
    const k = chave(s.sistema || 'spacecom', s.contrato, mat, s.unidade);
    if (!disponiveis.has(k)) disponiveis.set(k, []);
    disponiveis.get(k).push(String(s.serial));
  }
  const contadorSerial = {};
  for (const m of COM_SERIAL) contadorSerial[m] = proximoNumero(m, seriaisAntes.map(s => s.serial));

  const stats = { adicoes: 0, saidas: 0, transferencias: 0, puladas: 0, falhas: 0 };
  const falhas = new Map();
  const datas = [];
  const porPar = new Map();
  const registrarFalha = (e, desc) => {
    stats.falhas++;
    const k = `${desc}: ${String((e && e.message) || e).slice(0, 90)}`;
    falhas.set(k, (falhas.get(k) || 0) + 1);
  };
  const tirarSeriais = (k, n) => {
    const lista = disponiveis.get(k) || [];
    if (lista.length < n) return null;
    return lista.splice(lista.length - n, n); // LIFO: usa os últimos recebidos
  };
  const devolverSeriais = (k, lista) => {
    if (!lista || !lista.length) return;
    if (!disponiveis.has(k)) disponiveis.set(k, []);
    disponiveis.get(k).push(...lista);
  };
  const quandoDoDia = (diasAtras, hora, minuto) => {
    const d = new Date();
    d.setDate(d.getDate() - diasAtras);
    d.setHours(hora, minuto, Math.floor(rnd() * 60), 0);
    return d.toISOString();
  };
  const horaDoDia = diasAtras => {
    const h = randInt(7, 18);
    return diasAtras > 0 ? h : Math.max(7, Math.min(h, new Date().getHours()));
  };

  async function adicao(combo, unidade, material, qtd, quando) {
    const novos = [];
    if (COM_SERIAL.includes(material)) {
      for (let i = 0; i < qtd; i++) novos.push(String(contadorSerial[material]++).padStart(10, '0'));
    }
    const motivo = COM_SERIAL.includes(material)
      ? `Recebimento de lote ${material} (${qtd} un.) — ${unidade}`
      : `Recebimento de lote ${material} — ${unidade}`;
    if (!dry) {
      try {
        await store.estoque.adjust({
          sistema: combo.sistema, contrato: combo.contrato, material, unidade, qtd,
          motivo, seriais: novos, user, userName, at: quando, skipAudit: true,
        });
      } catch (e) {
        if (novos.length) contadorSerial[material] -= qtd; // devolve a numeração não usada
        registrarFalha(e, `adicao ${material} ${unidade}`);
        return false;
      }
    }
    const k = chave(combo.sistema, combo.contrato, material, unidade);
    saldos.set(k, (saldos.get(k) || 0) + qtd);
    devolverSeriais(k, novos);
    stats.adicoes++; datas.push(quando);
    return true;
  }

  async function saida(combo, unidade, material, qtd, quando) {
    const k = chave(combo.sistema, combo.contrato, material, unidade);
    if ((saldos.get(k) || 0) < qtd) { stats.puladas++; return false; }
    let seriais = [];
    if (COM_SERIAL.includes(material)) {
      seriais = tirarSeriais(k, qtd);
      if (!seriais) { stats.puladas++; return false; }
    }
    if (!dry) {
      try {
        await store.estoque.adjust({
          sistema: combo.sistema, contrato: combo.contrato, material, unidade, qtd: -qtd,
          motivo: `${MOTIVO_SAIDA[material]} — ${unidade}`, seriais,
          user, userName, at: quando, skipAudit: true,
        });
      } catch (e) {
        devolverSeriais(k, seriais);
        registrarFalha(e, `saida ${material} ${unidade}`);
        return false;
      }
    }
    saldos.set(k, (saldos.get(k) || 0) - qtd);
    stats.saidas++; datas.push(quando);
    return true;
  }

  async function transferencia(combo, material, origem, destino, qtd, quando) {
    if (origem === destino) return false;
    const ko = chave(combo.sistema, combo.contrato, material, origem);
    const kd = chave(combo.sistema, combo.contrato, material, destino);
    if ((saldos.get(ko) || 0) < qtd) { stats.puladas++; return false; }
    let seriais = [];
    if (COM_SERIAL.includes(material)) {
      seriais = tirarSeriais(ko, qtd);
      if (!seriais) { stats.puladas++; return false; }
    }
    if (!dry) {
      try {
        await store.estoque.transferir({
          sistema: combo.sistema, contrato: combo.contrato, material, qtd,
          unidadeOrigem: origem, unidadeDestino: destino,
          motivo: `Transferência ${material}`, seriais,
          user, userName, at: quando, skipAudit: true,
        });
      } catch (e) {
        devolverSeriais(ko, seriais);
        registrarFalha(e, `transferencia ${material} ${origem}->${destino}`);
        return false;
      }
    }
    saldos.set(ko, (saldos.get(ko) || 0) - qtd);
    saldos.set(kd, (saldos.get(kd) || 0) + qtd);
    devolverSeriais(kd, seriais);
    const par = `${origem} → ${destino}`;
    porPar.set(par, (porPar.get(par) || 0) + 1);
    stats.transferencias++; datas.push(quando);
    return true;
  }

  // --------- lote inicial em cada (combo, material, local) ---------
  if (!semLote) {
    let i = 0;
    for (const combo of COMBOS) {
      for (const unidade of UNIDADES) {
        for (const material of MATERIAIS) {
          const d = Math.max(dias - 1 - ((i++) % 4), 0);
          await adicao(combo, unidade, material, randInt(QTD_ENTRADA[material][0], QTD_ENTRADA[material][1]),
            quandoDoDia(d, horaDoDia(d), randInt(0, 59)));
        }
      }
    }
    log(`Lote inicial: ${stats.adicoes} adições (${COMBOS.length} contratos × ${UNIDADES.length} locais × ${MATERIAIS.length} materiais).`);
  }

  // ---- dias de movimentação, com cobertura de todos os pares de locais ----
  // Fila determinística: cada material sai de cada local para o próximo da
  // lista, garantindo tráfego entre TODOS os 6 locais (inclusive volta).
  const fila = [];
  for (const combo of COMBOS) {
    for (const material of MATERIAIS) {
      for (let i = 0; i < UNIDADES.length; i++) {
        fila.push({ combo, material, origem: UNIDADES[i], destino: UNIDADES[(i + 1) % UNIDADES.length], tentativas: 0 });
      }
    }
  }
  const primeiroDia = Math.max(dias - 5, 0);
  const transfPorDia = Math.max(1, Math.ceil(fila.length / (primeiroDia + 1)));

  for (let d = primeiroDia; d >= 0; d--) {
    const hora = horaDoDia(d);
    const quando = () => quandoDoDia(d, hora, randInt(0, 59));

    for (let i = 0, n = randInt(1, 2); i < n; i++) {
      const material = pick(MATERIAIS);
      await adicao(pick(COMBOS), pick(UNIDADES), material, randInt(QTD_ENTRADA[material][0], QTD_ENTRADA[material][1]), quando());
    }
    for (let i = 0; i < transfPorDia && fila.length; i++) {
      const t = fila.shift();
      const qtd = randInt(QTD_TRANSF[t.material][0], QTD_TRANSF[t.material][1]);
      const ok = await transferencia(t.combo, t.material, t.origem, t.destino, qtd, quando());
      if (!ok && ++t.tentativas < 2) fila.push(t);
    }
    for (let i = 0, n = randInt(1, 2); i < n; i++) {
      const material = pick(MATERIAIS);
      const origem = pick(UNIDADES);
      const destino = pick(UNIDADES.filter(u => u !== origem));
      await transferencia(pick(COMBOS), material, origem, destino, randInt(QTD_TRANSF[material][0], QTD_TRANSF[material][1]), quando());
    }
    for (let i = 0, n = randInt(1, 3); i < n; i++) {
      const material = pick(MATERIAIS);
      await saida(pick(COMBOS), pick(UNIDADES), material, randInt(QTD_SAIDA[material][0], QTD_SAIDA[material][1]), quando());
    }
  }

  // ------------------------------ relatório ------------------------------
  const resumoCombos = [];
  for (const combo of COMBOS) {
    const r = await store.estoque.resumo({ contrato: combo.contrato, sistema: combo.sistema });
    resumoCombos.push({ sistema: combo.sistema, contrato: combo.contrato, total: r.total, porMaterial: r.porMaterial || {} });
  }
  const porUnidade = new Map();
  let negativos = 0;
  for (const e of await store.estoque.all()) {
    porUnidade.set(e.unidade, (porUnidade.get(e.unidade) || 0) + Number(e.saldo || 0));
    if (Number(e.saldo || 0) < 0) negativos++;
  }
  const janela = datas.filter(Boolean).sort();

  log(`Operações: ${stats.adicoes} adições | ${stats.saidas} saídas | ${stats.transferencias} transferências entre locais`);
  log(`Puladas por falta de saldo/serial: ${stats.puladas} | falhas: ${stats.falhas}`);
  for (const [k, v] of [...falhas.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)) log(`  ${v}× ${k}`);
  if (janela.length) log(`Janela: ${janela[0].slice(0, 10)} .. ${janela[janela.length - 1].slice(0, 10)}`);
  resumoCombos.forEach(r => log(`  ${r.sistema}/${r.contrato}: ${r.total} un.`));
  [...porUnidade.entries()].sort((a, b) => b[1] - a[1]).forEach(([u, v]) => log(`  ${u}: ${v} un.`));
  log(`Saldos negativos: ${negativos}`);

  return {
    ok: true, dry, dias, stats,
    janela: janela.length ? { de: janela[0].slice(0, 10), ate: janela[janela.length - 1].slice(0, 10) } : null,
    resumo: resumoCombos,
    porUnidade: [...porUnidade.entries()].map(([unidade, total]) => ({ unidade, total })).sort((a, b) => b.total - a.total),
    transferenciasPorPar: [...porPar.entries()].map(([par, total]) => ({ par, total })).sort((a, b) => b.total - a.total),
    locaisComSaldo: [...porUnidade.values()].filter(v => v > 0).length,
    negativos,
    falhas: [...falhas.entries()].map(([motivo, total]) => ({ motivo, total })),
  };
}

module.exports = { popularEstoque, COMBOS, UNIDADES, MATERIAIS };
