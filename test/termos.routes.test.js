// =====================================================================
//  Testes de integração do módulo Termos — preview e PDF final
//  Foco: preview e PDF final devem produzir o MESMO documento (mesmo
//  caminho de geração + metadados determinísticos), e o PATCH/POST de
//  recolhimento deve manter dataEnvio em sincronia com dados.dataHora.
//  Script puro (sem framework), no estilo das demais suítes do projeto.
//  Sessão simulada via stub de shared.auth: sem tocar em db.json/Supabase.
// =====================================================================
let passed = 0, failed = 0;
const assert = (cond, msg) => {
  if (cond) { console.log('  ✅', msg); passed++; }
  else { console.log('  ❌', msg); failed++; }
};

process.env.SUPABASE_URL = '';
process.env.SUPABASE_KEY = '';

const express = require('express');
// Stub do middleware de sessão ANTES de carregar o router (o router captura
// auth por desestruturação no require). Preserva a checagem de papéis real:
// quem define a identidade é o header X-Test-Auth no middleware abaixo.
const shared = require('../src/lib/shared');
shared.auth = (roles) => (req, res, next) => {
  if (!req.auth) return res.status(401).json({ error: 'sem auth (teste)' });
  if (roles && roles.length && !roles.includes(req.auth.role)) return res.status(403).json({ error: 'Acesso restrito ao seu perfil.' });
  next();
};
const termosRouter = require('../src/routes/termos');

// ---------------------------------------------------------------- app mínimo
const app = express();
app.use(express.json({ limit: '2mb' }));
app.use((req, res, next) => {
  const raw = req.headers['x-test-auth'] || '';
  const [role, user, name] = raw.split('|');
  req.auth = { role: role || 'tecnico', user: user || 'tec1', name: name || 'Tec Um', sistema: 'spacecom', token: 't' };
  next();
});
app.use(termosRouter);

const server = app.listen(0);
const PORT = server.address().port;
const BASE = 'http://127.0.0.1:' + PORT;

async function call(method, path, body, auth) {
  return fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Test-Auth': auth || 'tecnico|tec1|Tec Um' },
    body: body ? JSON.stringify(body) : undefined
  });
}
async function json(method, path, body, auth) {
  const res = await call(method, path, body, auth);
  let j = null;
  try { j = await res.json(); } catch (e) { /* corpo não-JSON */ }
  return { status: res.status, body: j };
}
async function pdfOf(method, path, body, auth) {
  const res = await call(method, path, body, auth);
  const ct = res.headers.get('content-type') || '';
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, contentType: ct, buf };
}

// Recolhimento canônico (2 equipamentos, checks mistos)
const recBody = () => ({
  tipo: 'recolhimento',
  dados: {
    itensRecebidos: '1 tornozeleira, 2 travas',
    dataHora: '2026-09-28T14:33:00.000Z',
    equipamentos: [
      { numero: '4315023610', danificado: false, checks: { ladoExterno: true, cinta: true, travas: true, fonte: true, ladoInterno: true, abaDireita: true, abaEsquerda: true } },
      { numero: '4315023611', danificado: true, checks: { ladoExterno: false, cinta: null, travas: false, fonte: null, ladoInterno: false, abaDireita: null, abaEsquerda: null } }
    ],
    descricao: 'Equipamento rasgado na aba direita',
    policialNome: 'Carlos Nunes', policialMat: '12345',
    tecnicoNome: 'Tec Um', tecnicoMat: '999'
  }
});
const endBody = () => ({
  tipo: 'endereco',
  dados: {
    numero: '012', ano: '2026', cidade: 'Juazeiro do Norte',
    dataOficio: '2026-09-01', vara: '2ª Vara Criminal', processo: '0001234-56.2026.8.06.0192',
    nome: 'Fulano De Tal', cpf: '000.111.222-33', mae: 'Mae De Tal',
    dataSolicitacao: '2026-08-30', endereco: 'Rua X, 123, Bairro Y', contato: '(88) 99999-0000',
    motivo: 'Mudança de endereço comunicada pelo monitorado'
  }
});
const recEqBody = () => ({
  tipo: 'recEquip',
  dados: {
    nomeMonitorado: 'Fulano De Tal', numeroTermo: 'T-2026/045', idMonitorado: 'MG-777',
    perfil: 'Prisão preventiva', estabelecimento: 'UP-Juazeiro', cpfRg: 'RG 1.111.222',
    monitoradoDesde: '2026-01-10', desativadoDesde: '2026-09-28', dataHora: '2026-09-28T10:00:00.000Z',
    descricao: 'Devolução de kit completo',
    equipamentos: [
      { numero: '4315023610', danificado: false, checks: { ladoExterno: true, cinta: true, travas: true, fonte: true, fonteCE01: true, ladoInterno: true, abaDireita: true, abaEsquerda: true } }
    ]
  }
});
const atvBody = () => ({
  tipo: 'ativacao',
  dados: {
    nomeMonitorado: 'Maria Souza', nomeMae: 'Antônia Souza', processo: '0009999-77.2026.8.06.0192',
    vara: 'Vara de Execução Penal', sexo: 'Feminino', dataNascimento: '1990-05-12',
    religiao: 'Católica', cidade: 'Juazeiro do Norte'
  }
});
const psiBody = () => ({
  tipo: 'declaracao',
  dados: {
    nome: 'Joana Lima', cpf: '222.333.444-55', processo: '0005555-11.2026.8.06.0192',
    vara: '2ª Vara Criminal', medida: 'Monitoração eletrônica', periodo: '2026',
    data: '2026-09-28', cidade: 'Juazeiro do Norte', endereco: 'Rua Z, 10',
    contato: '(88) 98888-7777', destino: 'Fórum', motivo: 'Solicitação da vara',
    psicologo: 'Psic. Ana', crp: 'CRP 06/00000', texto: 'Declaro para os devidos fins.'
  }
});
const listBody = () => ({
  tipo: 'listagem', dataEnvio: '2026-09-28', destinatario: 'UP-Cariri',
  equipamentos: [
    { upr04: '4714569930', fonte04: 'F-001' },
    { upr04: '4714569931', fonte04: 'F-002' },
    { upr04: '4714569932', fonte04: 'F-003' },
    { upr04: '4714569933', fonte04: 'F-004' },
    { upr04: '4714569934', fonte04: 'F-005' },
    { upr04: '4714569935', fonte04: 'F-006' }
  ],
  respEntrega: 'Tec Um', respRecebimento: 'Serv Uphold', modelo: 'upr'
});

// helper: gera preview e cria termo, compara os bytes
async function mesmosBytes(tipo, bodyFn, criar, auth) {
  const prev = await pdfOf('POST', '/api/termos/pdf-preview', bodyFn(), auth);
  assert(prev.status === 200 && prev.contentType === 'application/pdf', tipo + ': preview 200 application/pdf');
  const criado = await json('POST', '/api/termos', criar, auth);
  assert(criado.status === 201 && criado.body && criado.body.id, tipo + ': termo criado (id=' + (criado.body && criado.body.id) + ')');
  const final = await pdfOf('GET', '/api/termos/' + criado.body.id + '/pdf', null, auth);
  assert(final.status === 200 && final.contentType === 'application/pdf', tipo + ': PDF final 200 application/pdf');
  const iguais = prev.buf.equals(final.buf);
  assert(iguais, tipo + ': preview e PDF final com bytes idênticos (' + prev.buf.length + ' vs ' + final.buf.length + ')');
  if (!iguais) {
    const a = prev.buf.toString('latin1'), b = final.buf.toString('latin1');
    let i = 0; while (i < a.length && a[i] === b[i]) i++;
    console.log('      primeira divergência no byte', i, JSON.stringify(a.slice(Math.max(0, i - 30), i + 30)), 'vs', JSON.stringify(b.slice(Math.max(0, i - 30), i + 30)));
  }
  return criado.body;
}

async function main() {
  console.log('\n=== TERMOS — preview idêntico ao PDF final ===');

  await mesmosBytes('recolhimento', recBody, recBody(), 'tecnico|tec1|Tec Um');
  await mesmosBytes('endereco', endBody, endBody(), 'tecnico|tec1|Tec Um');
  await mesmosBytes('recEquip', recEqBody, recEqBody(), 'tecnico|tec1|Tec Um');
  await mesmosBytes('ativacao', atvBody, atvBody(), 'tecnico|tec1|Tec Um');
  await mesmosBytes('declaracao (psi)', psiBody, psiBody(), 'psico|psi1|Psic. Ana');
  await mesmosBytes('listagem upr', listBody, listBody(), 'tecnico|tec1|Tec Um');

  console.log('\n=== TERMOS — dataEnvio de recolhimento acompanha dados.dataHora ===');

  // Datas LOCAIS (2026-09-20 12:00 no fuso -03) para o slice(0,10) do ISO
  // refletir o mesmo dia em qualquer TZ de CI.
  {
    const d1 = new Date(2026, 8, 20, 12, 0, 0); // 20/09/2026 local
    const d2 = new Date(2026, 8, 25, 15, 45, 0); // 25/09/2026 local
    const body = recBody();
    body.dados.dataHora = d1.toISOString();
    const criado = await json('POST', '/api/termos', body, 'tecnico|tec1|Tec Um');
    assert(criado.status === 201, 'POST recolhimento: termo criado');
    const dia1 = d1.toISOString().slice(0, 10);
    const dia2 = d2.toISOString().slice(0, 10);
    assert(criado.body.dataEnvio === dia1, 'POST recolhimento: dataEnvio deriva de dados.dataHora — "' + criado.body.dataEnvio + '"');

    const patchBody = { dados: Object.assign({}, body.dados, { dataHora: d2.toISOString() }) };
    const upd = await json('PATCH', '/api/termos/' + criado.body.id, patchBody, 'tecnico|tec1|Tec Um');
    assert(upd.status === 200, 'PATCH recolhimento: PATCH 200');
    assert(upd.body.dados && upd.body.dados.dataHora === d2.toISOString(), 'PATCH recolhimento: dados.dataHora atualizado');
    assert(upd.body.dataEnvio === dia2, 'PATCH recolhimento: dataEnvio acompanha dados.dataHora — "' + upd.body.dataEnvio + '"');

    // dataEnvio explícito ainda vence (compatibilidade com clientes antigos)
    const body3 = recBody();
    body3.dados.dataHora = d2.toISOString();
    body3.dataEnvio = '2026-01-15';
    const c3 = await json('POST', '/api/termos', body3, 'tecnico|tec1|Tec Um');
    assert(c3.status === 201 && c3.body.dataEnvio === '2026-01-15', 'POST recolhimento: dataEnvio explícito vence — "' + (c3.body && c3.body.dataEnvio) + '"');
  }

  console.log('\n=== TERMOS — auth e isolamento por dono (regressão) ===');

  {
    // tecnico não cria documentos psi
    const r = await json('POST', '/api/termos', psiBody(), 'tecnico|tec1|Tec Um');
    assert(r.status === 403, 'auth: tecnico não cria documento psi (403)');
    // psico não vê termo do tecnico
    const rec = await json('POST', '/api/termos', recBody(), 'tecnico|tec1|Tec Um');
    const outro = await json('GET', '/api/termos/' + rec.body.id, null, 'psico|psi1|Psic. Ana');
    assert(outro.status === 403, 'auth: dono diferente não lê termo (403)');
    // papel sem permissão (admin fora da rota) não lista
    const lista = await json('GET', '/api/termos', null, 'admin|adm1|Admin');
    assert(lista.status === 403, 'auth: admin não lista termos (rota é tecnico/psico)');
  }
}

main().then(() => {
  console.log(`\n=== RESULTADO: ${passed} passed, ${failed} failed ===`);
  server.close();
  process.exitCode = failed > 0 ? 1 : 0;
}).catch(e => {
  console.error(e);
  try { server.close(); } catch (_) {}
  process.exit(1);
});
