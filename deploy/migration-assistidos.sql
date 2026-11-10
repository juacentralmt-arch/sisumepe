-- =====================================================================
-- SISUMEPE — Módulo Assistidos (monitorados com tornozeleira eletrônica)
-- 3 abas: Todos | Juntada | Concluídos
-- Rode UMA VEZ no SQL Editor do Supabase (idempotente).
-- =====================================================================

create table if not exists assistidos (
  id serial primary key,
  vinculo text not null unique,
  nome text not null,
  processo text not null,
  vara text not null,
  local_assinatura text not null,
  data_inicio text not null,
  frequencia text not null default 'mensal',
  etiqueta text default 'sem', -- 'verde' | 'laranja' | 'vermelho' | 'sem'
  status text default 'ativo', -- 'ativo' | 'concluido'
  deleted_at timestamptz default null,
  createdat timestamptz default now(),
  updatedat timestamptz default now()
);

alter table assistidos add column if not exists vinculo text not null default '';
alter table assistidos add column if not exists nome text not null default '';
alter table assistidos add column if not exists processo text not null default '';
alter table assistidos add column if not exists vara text not null default '';
alter table assistidos add column if not exists local_assinatura text default '';
alter table assistidos add column if not exists data_inicio text default '';
alter table assistidos add column if not exists frequencia text default 'mensal';
alter table assistidos add column if not exists etiqueta text default 'sem';
alter table assistidos add column if not exists status text default 'ativo';
alter table assistidos add column if not exists deleted_at timestamptz default null;
alter table assistidos add column if not exists createdat timestamptz default now();
alter table assistidos add column if not exists updatedat timestamptz default now();

create index if not exists idx_assistidos_vinculo on assistidos (vinculo);
create index if not exists idx_assistidos_nome on assistidos (nome);
create index if not exists idx_assistidos_status on assistidos (status);
create index if not exists idx_assistidos_etiqueta on assistidos (etiqueta);
create index if not exists idx_assistidos_deleted on assistidos (deleted_at);
create unique index if not exists idx_assistidos_vinculo_unique on assistidos (vinculo) where deleted_at is null;

-- =====================================================================
-- Tabela assistidos_comparecimentos
-- =====================================================================

create table if not exists assistidos_comparecimentos (
  id serial primary key,
  assistido_id integer references assistidos(id) on delete cascade,
  data_comparecimento text not null,
  pp_plantao text default '',
  observacao text default '',
  juntada text default '',
  protocolado boolean default false,
  data_protocolacao text default '',
  deleted_at timestamptz default null,
  createdat timestamptz default now(),
  updatedat timestamptz default now()
);

alter table assistidos_comparecimentos add column if not exists assistido_id integer references assistidos(id) on delete cascade;
alter table assistidos_comparecimentos add column if not exists data_comparecimento text default '';
alter table assistidos_comparecimentos add column if not exists pp_plantao text default '';
alter table assistidos_comparecimentos add column if not exists observacao text default '';
alter table assistidos_comparecimentos add column if not exists juntada text default '';
alter table assistidos_comparecimentos add column if not exists protocolado boolean default false;
alter table assistidos_comparecimentos add column if not exists data_protocolacao text default '';
alter table assistidos_comparecimentos add column if not exists deleted_at timestamptz default null;
alter table assistidos_comparecimentos add column if not exists createdat timestamptz default now();
alter table assistidos_comparecimentos add column if not exists updatedat timestamptz default now();

create index if not exists idx_assistidos_comp_assistido on assistidos_comparecimentos (assistido_id);
create index if not exists idx_assistidos_comp_data on assistidos_comparecimentos (data_comparecimento);
create index if not exists idx_assistidos_comp_deleted on assistidos_comparecimentos (deleted_at);

-- =====================================================================
-- Função de reajuste de sequencias
-- =====================================================================
create or replace function reset_sequences() returns void language plpgsql as $$
begin
  perform setval(pg_get_serial_sequence('persons', 'id'), coalesce((select max(id) from persons), 0) + 1, false);
  perform setval(pg_get_serial_sequence('tickets', 'id'), coalesce((select max(id) from tickets), 0) + 1, false);
  perform setval(pg_get_serial_sequence('chat', 'id'), coalesce((select max(id) from chat), 0) + 1, false);
  perform setval(pg_get_serial_sequence('audit', 'id'), coalesce((select max(id) from audit), 0) + 1, false);
  perform setval(pg_get_serial_sequence('agenda', 'id'), coalesce((select max(id) from agenda), 0) + 1, false);
  perform setval(pg_get_serial_sequence('termos', 'id'), coalesce((select max(id) from termos), 0) + 1, false);
  perform setval(pg_get_serial_sequence('assistidos', 'id'), coalesce((select max(id) from assistidos), 0) + 1, false);
  perform setval(pg_get_serial_sequence('assistidos_comparecimentos', 'id'), coalesce((select max(id) from assistidos_comparecimentos), 0) + 1, false);
end $$;
