-- =====================================================================
-- SISUMEPE — Módulo Psicossocial (prontuário, evoluções, grupos, etc.)
-- Rode UMA VEZ no SQL Editor do Supabase (idempotente).
-- =====================================================================

create table if not exists psi_records (
  id serial primary key,
  "user" text default '',
  kind text not null,
  personid text default '',
  personname text default '',
  grupoid text default '',
  data date,
  dados jsonb default '{}'::jsonb,
  createdat timestamptz default now(),
  updatedat timestamptz default now()
);

-- kind: prontuario | evolucao | atendimento | grupo | encontro | encaminhamento | medida
create index if not exists idx_psi_kind on psi_records (kind);
create index if not exists idx_psi_person on psi_records (personid);
create index if not exists idx_psi_grupo on psi_records (grupoid);
create index if not exists idx_psi_data on psi_records (data);

-- Perfil do psicólogo passa a ser dedicado (sigilo do prontuário)
update users set role = 'psico' where "user" = 'psicologo';

-- Reajuste de sequência passa a incluir psi_records
create or replace function reset_sequences() returns void language plpgsql as $$
begin
  perform setval(pg_get_serial_sequence('persons', 'id'), coalesce((select max(id) from persons), 0) + 1, false);
  perform setval(pg_get_serial_sequence('tickets', 'id'), coalesce((select max(id) from tickets), 0) + 1, false);
  perform setval(pg_get_serial_sequence('chat', 'id'), coalesce((select max(id) from chat), 0) + 1, false);
  perform setval(pg_get_serial_sequence('audit', 'id'), coalesce((select max(id) from audit), 0) + 1, false);
  perform setval(pg_get_serial_sequence('agenda', 'id'), coalesce((select max(id) from agenda), 0) + 1, false);
  perform setval(pg_get_serial_sequence('termos', 'id'), coalesce((select max(id) from termos), 0) + 1, false);
  perform setval(pg_get_serial_sequence('psi_records', 'id'), coalesce((select max(id) from psi_records), 0) + 1, false);
end $$;
