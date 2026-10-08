// =====================================================================
//  Testes das regras de edição de tickets (src/lib/ticketEdicao.js):
//  recepção edita AGUARDANDO, técnico edita EM_ATENDIMENTO (só o dono),
//  e toda alteração registra quem + o quê no ticket (edicoes).
//  Script puro (sem framework), no estilo das demais suítes do projeto.
// =====================================================================
let passed = 0, failed = 0;
const assert = (cond, msg) => {
  if (cond) { console.log('  ✅', msg); passed++; }
  else { console.log('  ❌', msg); failed++; }
};

const ed = require('../src/lib/ticketEdicao');

console.log('\n=== TICKETS — permissão recepção (aguardando) ===');
assert(ed.checarPermissao({ role: 'recepcao', status: 'aguardando' }) === null, 'recepcao pode em aguardando');
{
  const r = ed.checarPermissao({ role: 'recepcao', status: 'em_atendimento' });
  assert(r && r.status === 400, 'recepcao bloqueada em atendimento');
}
{
  const r = ed.checarPermissao({ role: 'recepcao', status: 'finalizado' });
  assert(r && r.status === 400, 'recepcao bloqueada em finalizado');
}

console.log('\n=== TICKETS — permissão técnico (em_atendimento, dono) ===');
assert(ed.checarPermissao({ role: 'tecnico', status: 'em_atendimento', dono: 'tec1', user: 'tec1' }) === null, 'tecnico dono pode em atendimento');
assert(ed.checarPermissao({ role: 'tecnico', status: 'em_atendimento', dono: 'TEC1', user: 'tec1' }) === null, 'dono case-insensitive');
{
  const r = ed.checarPermissao({ role: 'tecnico', status: 'em_atendimento', dono: 'tec2', user: 'tec1' });
  assert(r && r.status === 403, 'tecnico não-dono bloqueado (403)');
}
{
  const r = ed.checarPermissao({ role: 'tecnico', status: 'aguardando', dono: 'tec1', user: 'tec1' });
  assert(r && r.status === 400, 'tecnico bloqueado em aguardando');
}
{
  const r = ed.checarPermissao({ role: 'tecnico', status: 'em_atendimento', dono: '', user: 'tec1' });
  assert(r && r.status === 403, 'sem dono definido bloqueia (403)');
}

console.log('\n=== TICKETS — admin e outros ===');
assert(ed.checarPermissao({ role: 'admin', status: 'aguardando' }) === null, 'admin pode em aguardando');
assert(ed.checarPermissao({ role: 'admin', status: 'em_atendimento' }) === null, 'admin pode em atendimento');
{
  const r = ed.checarPermissao({ role: 'admin', status: 'finalizado' });
  assert(r && r.status === 400, 'admin bloqueado em finalizado');
}
{
  const r = ed.checarPermissao({ role: 'psico', status: 'aguardando' });
  assert(r && r.status === 403, 'psico sem permissão (403)');
}

console.log('\n=== TICKETS — campos por perfil ===');
assert(ed.camposPermitidos('tecnico').join(',') === 'descricao', 'tecnico: só descricao');
assert(ed.camposPermitidos('recepcao').includes('motivo'), 'recepcao: inclui motivo');
assert(ed.camposPermitidos('admin').includes('prioridadeLegal'), 'admin: inclui prioridade');

console.log('\n=== TICKETS — histórico edicoes (quem + o quê) ===');
{
  const e = ed.montarEdicao({ user: 'rec1', name: 'Rec Um', role: 'recepcao' },
    [{ field: 'motivo', label: 'Motivo', from: 'A', to: 'B' }]);
  assert(e.byUser === 'rec1', 'edicao registra user');
  assert(e.byName === 'Rec Um', 'edicao registra nome');
  assert(e.byRole === 'recepcao', 'edicao registra perfil');
  assert(e.changes[0].from === 'A' && e.changes[0].to === 'B', 'edicao registra de→para');
  assert(typeof e.at === 'string' && !isNaN(new Date(e.at)), 'edicao registra quando');
}
{
  const t = { edicoes: [{ at: 'x' }] };
  const out = ed.aplicarEdicao(t, { at: 'y' });
  assert(out.length === 2 && out[1].at === 'y', 'edicao anexada ao histórico');
  assert(t.edicoes.length === 1, 'não muta o ticket original');
}
{
  const many = Array.from({ length: 60 }, (_, i) => ({ at: String(i) }));
  const out = ed.aplicarEdicao({ edicoes: many }, { at: 'novo' });
  assert(out.length === 50 && out[49].at === 'novo', 'histórico limitado a 50 (mantém recentes)');
}

console.log('\n=== TICKETS — anexos (adicionar/remover) ===');
{
  const r = ed.validarAdicao([1, 2], [3]);
  assert(r === null, 'abaixo do teto permite');
}
{
  const atual = Array.from({ length: 19 }, (_, i) => ({ url: '/u/' + i, name: i + '.pdf' }));
  const r = ed.validarAdicao(atual, [{ name: 'a.pdf' }, { name: 'b.pdf' }]);
  assert(r && r.status === 400, 'teto de 20 anexos bloqueia');
}
{
  // Marcadores expirados (arquivo já apagado) não ocupam vaga no teto.
  const atual = Array.from({ length: 20 }, (_, i) => ({ name: 'a' + i + '.webm', expired: true }));
  const r = ed.validarAdicao(atual, [{ name: 'novo.pdf' }]);
  assert(r === null, 'fantasmas expirados não contam no teto');
}
{
  const anx = [{ url: '/u/a', name: 'a.pdf' }, { url: '/u/b', name: 'b.pdf' }];
  const { mantidos, removidos } = ed.separarAnexos(anx, ['/u/a', '/u/inexistente']);
  assert(mantidos.length === 1 && mantidos[0].url === '/u/b', 'remove só os indicados');
  assert(removidos.length === 1 && removidos[0].name === 'a.pdf', 'retorna removidos p/ auditoria');
}

console.log(`\n=== RESULTADO: ${passed} passed, ${failed} failed ===`);
process.exit(failed ? 1 : 0);
