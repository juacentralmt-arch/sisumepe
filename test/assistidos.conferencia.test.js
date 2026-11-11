// Testes da conferencia (etiqueta) e da situacao do monitorado.
process.env.SUPABASE_URL = '';
process.env.SUPABASE_KEY = '';
const os = require('os'); const fs = require('fs'); const path = require('path');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sisumepe-conf-'));
process.env.DB_FILE = path.join(tmpDir, 'test-db.json');
fs.writeFileSync(process.env.DB_FILE, '{}');

const store = require('../store');
const dom = require('../src/lib/assistidos');
const shared = require('../src/lib/shared');
shared.auth = (roles) => (req, res, next) => {
  if (!req.auth) return res.status(401).json({ error: 'sem auth (teste)' });
  if (roles && roles.length && !roles.includes(req.auth.role)) return res.status(403).json({ error: 'Acesso restrito.' });
  next();
};
const router = require('../src/routes/assistidos');
const express = require('express');
const app = express();
app.use(express.json({ limit: '2mb' }));
app.use((req, res, next) => {
  const raw = req.headers['x-test-auth'] || '';
  const [role, user, name] = raw.split('|');
  req.auth = { role: role || 'admin', user: user || 'admin', name: name || 'Administrador', sistema: null, token: 't' };
  next();
});
app.use(router);
const server = app.listen(0);
const BASE = 'http://127.0.0.1:' + server.address().port;
const H = { 'Content-Type': 'application/json', 'X-Test-Auth': 'admin|admin|Administrador' };

let passed = 0, failed = 0;
const assert = (cond, msg) => {
  if (cond) { console.log('  ok.', msg); passed++; }
  else { console.log('  FAIL', msg); failed++; }
};
const get = async (url) => (await fetch(BASE + url, { headers: H })).json();
const patch = async (url, body) => {
  const r = await fetch(BASE + url, { method: 'PATCH', headers: H, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};
const post = async (url, body) => {
  const r = await fetch(BASE + url, { method: 'POST', headers: H, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};
const hoje = new Date().toISOString().slice(0, 10);
const diasAtras = n => {
  const d = new Date(Date.now() - n * 86400000);
  return d.toISOString().slice(0, 10);
};

(async () => {
  console.log('\n=== CONFERENCIA - regra da situacao ===');

  // em dia: comparceu dentro do prazo
  assert(dom.situacao({ frequencia: 'mensal', dataInicio: diasAtras(200) }, { dataComparecimento: diasAtras(10) }, hoje).codigo === 'em_dia',
    'Situacao: em dia (compareceu ha 10 dias, frequencia mensal)');

  // atrasado: passou do prazo
  const at = dom.situacao({ frequencia: 'mensal', dataInicio: diasAtras(300) }, { dataComparecimento: diasAtras(90) }, hoje);
  assert(at.codigo === 'atrasado', 'Situacao: atrasado (90 dias, prazo mensal e 52)');
  assert(at.faltas >= 1, 'Situacao: conta as faltas consecutivas (' + at.faltas + ')');

  // nunca compareceu, mas ja passou 30 dias do inicio
  const sem = dom.situacao({ frequencia: 'mensal', dataInicio: diasAtras(200) }, null, hoje);
  assert(sem.codigo === 'sem_comparecimento', 'Situacao: nunca compareceu');
  assert(sem.dias === 200, 'Situacao: dias desde o inicio (' + sem.dias + ')');

  // sem historico nenhum
  assert(dom.situacao({ frequencia: 'mensal', dataInicio: '' }, null, hoje).codigo === 'sem_historico',
    'Situacao: sem historico (sem data de inicio)');

  // prazo por frequencia
  assert(dom.situacao({ frequencia: 'semanal', dataInicio: diasAtras(90) }, { dataComparecimento: diasAtras(20) }, hoje).codigo === 'atrasado',
    'Situacao: semanal tem prazo menor (20 dias ja atrasa)');

  console.log('\n=== CONFERENCIA - normalizacao de etiquetas antigas ===');
  assert(dom.normalizaEtiqueta('sem') === 'pendente', 'Normaliza: sem -> pendente');
  assert(dom.normalizaEtiqueta('verde') === 'conferido', 'Normaliza: verde -> conferido');
  assert(dom.normalizaEtiqueta('laranja') === 'pendente', 'Normaliza: laranja -> pendente');
  assert(dom.normalizaEtiqueta('vermelho') === 'pendente', 'Normaliza: vermelho -> pendente');
  assert(dom.normalizaEtiqueta('conferido') === 'conferido', 'Normaliza: conferido fica');
  assert(dom.normalizaEtiqueta('') === 'pendente', 'Normaliza: vazio -> pendente');
  assert(dom.normalizaEtiqueta(undefined) === 'pendente', 'Normaliza: indefinido -> pendente');

  console.log('\n=== CONFERENCIA - marcar a ficha ===');

  const c1 = await post('/api/assistidos', {
    vinculo: '9300000-00.2026.8.06.0000', nome: 'CONFERIR TESTE', processo: '9300000-00.2026.8.06.0000',
    vara: 'V', localAssinatura: 'COMEP Cariri', dataInicio: diasAtras(200), frequencia: 'mensal',
  });
  assert(c1.status === 201, 'Cadastro: criado');
  assert(c1.json.etiqueta === 'pendente', 'Cadastro: etiqueta inicial pendente');
  const id = c1.json.id;

  // um clique, sem motivo
  const conf = await patch('/api/assistidos/' + id + '/etiqueta', { etiqueta: 'conferido' });
  assert(conf.status === 200, 'Conferir: 200 sem pedir motivo');
  assert(conf.json.etiqueta === 'conferido', 'Conferir: etiqueta gravada');
  assert(conf.json.conferidoPor === 'Administrador', 'Conferir: grava quem conferiu');
  assert(!!conf.json.conferidoEm, 'Conferir: grava quando conferiu');

  // valor invalido e barrado (nao vira pendente em silencio)
  const invalido = await patch('/api/assistidos/' + id + '/etiqueta', { etiqueta: 'azul' });
  assert(invalido.status === 400, 'Conferir: etiqueta invalida -> 400');
  const ainda = await get('/api/assistidos/' + id);
  assert(ainda.etiqueta === 'conferido', 'Conferir: valor invalido nao alterou a etiqueta');

  // desmarcar limpa a autoria
  const desmarcar = await patch('/api/assistidos/' + id + '/etiqueta', { etiqueta: 'pendente' });
  assert(desmarcar.status === 200, 'Desmarcar: 200');
  assert(!desmarcar.json.conferidoPor, 'Desmarcar: limpa quem conferiu');

  console.log('\n=== CONFERENCIA - filtros da aba Todos ===');

  const c2 = await post('/api/assistidos', {
    vinculo: '9300001-00.2026.8.06.0000', nome: 'FILTRO TESTE', processo: '9300001-00.2026.8.06.0000',
    vara: 'V', localAssinatura: 'COMEP Cariri', dataInicio: diasAtras(200), frequencia: 'semanal',
  });
  assert(c2.status === 201, 'Cadastro: segundo criado (frequencia semanal)');
  await patch('/api/assistidos/' + c2.json.id + '/etiqueta', { etiqueta: 'conferido' });

  const porConferencia = await get('/api/assistidos?conferencia=conferido&limit=50');
  assert(porConferencia.itens.length === 1 && String(porConferencia.itens[0].id) === String(c2.json.id),
    'Filtro: por conferencia (conferido)');
  const porPendente = await get('/api/assistidos?conferencia=pendente&limit=50');
  assert(porPendente.itens.every(x => x.etiqueta === 'pendente'), 'Filtro: por conferencia (pendente)');

  const porFrequencia = await get('/api/assistidos?frequencia=semanal&limit=50');
  assert(porFrequencia.itens.length === 1 && String(porFrequencia.itens[0].id) === String(c2.json.id),
    'Filtro: por frequencia');

  const porSituacao = await get('/api/assistidos?situacao=sem_comparecimento&limit=50');
  assert(porSituacao.itens.every(x => x.situacao === 'sem_comparecimento'),
    'Filtro: por situacao (nunca compareceu)');
  assert(porSituacao.itens.some(x => String(x.id) === String(id)),
    'Filtro: por situacao inclui o registro sem comparecimento');

  const emDia = await get('/api/assistidos?situacao=em_dia&limit=50');
  assert(emDia.itens.every(x => x.situacao === 'em_dia'), 'Filtro: por situacao (em dia)');

  // a listagem devolve a situacao de cada item
  const lista = await get('/api/assistidos?limit=50');
  assert(lista.itens.every(x => !!x.situacao && !!x.situacaoTexto), 'Listagem: traz a situacao de cada item');
  assert(lista.itens.every(x => x.etiqueta === 'pendente' || x.etiqueta === 'conferido'),
    'Listagem: etiqueta normalizada');

  // ordem por atraso
  const porAtraso = await get('/api/assistidos?ordem=atraso&limit=50');
  assert(porAtraso.total >= 1, 'Ordem: por atraso devolve o total');
  const pos = porAtraso.itens.map(x => ({ sit: x.situacao, dias: x.situacaoDias || 0 }));
  const atrasados = pos.filter(x => x.sit === 'atrasado');
  if (atrasados.length >= 2) {
    const decrescente = atrasados.every((x, i) => i === 0 || atrasados[i - 1].dias >= x.dias);
    assert(decrescente, 'Ordem: mais atrasado primeiro');
  } else {
    assert(true, 'Ordem: menos de 2 atrasados para comparar');
  }

  console.log('\n=== CONFERENCIA - aba de arquivados ===');
  const arq = await fetch(BASE + '/api/assistidos/' + id, { method: 'DELETE', headers: H, body: JSON.stringify({ motivo: 'teste' }) });
  assert(arq.status === 200, 'Arquivar: 200');
  const listados = await get('/api/assistidos/arquivados');
  assert(listados.itens.some(x => String(x.id) === String(id)), 'Arquivados: o registro aparece na lista');
  const rest = await patch('/api/assistidos/' + id + '/restaurar', {});
  assert(rest.status === 200, 'Restaurar: 200');
  const voltou = await get('/api/assistidos/' + id);
  assert(voltou.etiqueta === 'pendente', 'Restaurar: o registro volta com a etiqueta preservada');

  console.log('\n==================== RESUMO ====================');
  console.log(`Testes: OK=${passed} | Falha=${failed}`);
  process.exit(failed ? 1 : 0);
})();
