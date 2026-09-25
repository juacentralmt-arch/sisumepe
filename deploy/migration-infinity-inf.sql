-- =====================================================================
--  MIGRAÇÃO: Unifica estoque Infinity em contrato único INF
--  Projeto: SISUMEPE Juazeiro
--  Data: 2026-09-25
--
--  O que faz:
--   1. Soma saldos CE01/CE02 legados do sistema Infinity em INF
--   2. Migra histórico (estoque_mov) e seriais (estoque_serial) para INF
--   3. Garante linhas INF para todas as combinações (5 materiais x 6 unidades)
--
--  COMO RODAR:
--   Supabase → SQL Editor → New query → cole TODO este arquivo → Run
--
--  SEGURANÇA: Idempotente — pode rodar mais de uma vez sem duplicar nada.
--  NÃO é necessário rodar o supabase-schema.sql inteiro (ele pode ser
--  destrutivo em banco já populado).
-- =====================================================================

do $$ begin
  -- 1) achata infinity para INF (CE01/CE02 legados somam em INF)
  with sums as (
    select material, unidade, sum(saldo)::int as soma
    from estoque where sistema='infinity' and contrato in ('CE01','CE02') group by material, unidade
  )
  insert into estoque (sistema, contrato, material, unidade, saldo)
    select 'infinity','INF',material,unidade,0 from sums
    on conflict (sistema, contrato, material, unidade) do nothing;

  update estoque e set saldo = e.saldo + s.soma, updatedat = now()
    from sums s where e.sistema='infinity' and e.contrato='INF' and e.material=s.material and e.unidade=s.unidade;

  delete from estoque where sistema='infinity' and contrato in ('CE01','CE02');

  -- 2) histórico e seriais passam a INF
  update estoque_mov set contrato='INF' where sistema='infinity' and contrato in ('CE01','CE02');
  update estoque_serial set contrato='INF' where sistema='infinity' and contrato in ('CE01','CE02');

  -- 3) garante linhas INF para todas as combinações (5 materiais x 6 unidades)
  insert into estoque (sistema, contrato, material, unidade, saldo)
    select 'infinity','INF',m.material,u.unidade,0
    from (values ('TZPR04'),('UPR04'),('FONTE04'),('CINTA'),('TRAVAS')) as m(material),
         (values ('UMEPE Juazeiro'),('UP-Juazeiro'),('UP-Cariri'),('UP-Crato'),('Fórum de Crato'),('Fórum de Jardim')) as u(unidade)
    on conflict (sistema, contrato, material, unidade) do nothing;
end $$;

-- Verificação (opcional, rode à parte para conferir o resultado):
--   select sistema, contrato, material, sum(saldo) from estoque group by 1,2,3 order by 1,2,3;
--   select sistema, contrato, count(*) from estoque_mov group by 1,2;
