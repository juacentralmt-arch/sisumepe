-- =====================================================================
-- SISUMEPE — Módulo Assistidos (monitorados com tornozeleira eletrônica)
-- Rode UMA VEZ no SQL Editor do Supabase (idempotente).
-- =====================================================================

create table if not exists assistidos (
  id serial primary key,
  vinculo text not null unique,
  nome text not null,
  processo text not null,
  vara text not null,
  cpf text default '',
  telefone text default '',
  endereco text default '',
  situacao_juridica text default '',
  local_assinatura text not null,
  data_inicio text not null,
  data_fim text default '',
  frequencia text default 'mensal',
  etiqueta text default '',
  etiqueta_texto text default '',
  etiqueta_cor text default '#4f46e5',
  status text default 'ativo',
  responsavel_tecnico text default '', -- user do tecnico responsavel
  deleted_at timestamptz default null,
  createdat timestamptz default now(),
  updatedat timestamptz default now()
);

alter table assistidos add column if not exists vinculo text not null default '';
alter table assistidos add column if not exists nome text not null default '';
alter table assistidos add column if not exists processo text not null default '';
alter table assistidos add column if not exists vara text not null default '';
alter table assistidos add column if not exists cpf text default '';
alter table assistidos add column if not exists telefone text default '';
alter table assistidos add column if not exists endereco text default '';
alter table assistidos add column if not exists situacao_juridica text default '';
alter table assistidos add column if not exists local_assinatura text default '';
alter table assistidos add column if not exists data_inicio text default '';
alter table assistidos add column if not exists data_fim text default '';
alter table assistidos add column if not exists frequencia text default 'mensal';
alter table assistidos add column if not exists etiqueta text default '';
alter table assistidos add column if not exists etiqueta_texto text default '';
alter table assistidos add column if not exists etiqueta_cor text default '#4f46e5';
alter table assistidos add column if not exists status text default 'ativo';
alter table assistidos add column if not exists responsavel_tecnico text default '';
alter table assistidos add column if not exists deleted_at timestamptz default null;
alter table assistidos add column if not exists createdat timestamptz default now();
alter table assistidos add column if not exists updatedat timestamptz default now();

-- Índices
create index if not exists idx_assistidos_vinculo on assistidos (vinculo);
create index if not exists idx_assistidos_nome on assistidos (nome);
create index if not exists idx_assistidos_processo on assistidos (processo);
create index if not exists idx_assistidos_vara on assistidos (vara);
create index if not exists idx_assistidos_local on assistidos (local_assinatura);
create index if not exists idx_assistidos_status on assistidos (status);
create index if not exists idx_assistidos_deleted on assistidos (deleted_at);
create index if not exists idx_assistidos_responsavel on assistidos (responsavel_tecnico);
create unique index if not exists idx_assistidos_vinculo_unique on assistidos (vinculo) where deleted_at is null;

-- =====================================================================
-- Tabela assistidos_comparecimentos (soft-delete aplicavel)
-- =====================================================================

create table if not exists assistidos_comparecimentos (
  id serial primary key,
  assistido_id integer references assistidos(id) on delete cascade,
  data_comparecimento text not null,
  policial_plantao text default '',
  assinado_por text default '',
  protocolado boolean default false,
  data_protocolacao text default '',
  protocolado_por text default '',
  observacoes text default '',
  juntada text default '',
  deleted_at timestamptz default null,
  createdat timestamptz default now(),
  updatedat timestamptz default now()
);

alter table assistidos_comparecimentos add column if not exists assistido_id integer references assistidos(id) on delete cascade;
alter table assistidos_comparecimentos add column if not exists data_comparecimento text default '';
alter table assistidos_comparecimentos add column if not exists policial_plantao text default '';
alter table assistidos_comparecimentos add column if not exists assinado_por text default '';
alter table assistidos_comparecimentos add column if not exists protocolado boolean default false;
alter table assistidos_comparecimentos add column if not exists data_protocolacao text default '';
alter table assistidos_comparecimentos add column if not exists protocolado_por text default '';
alter table assistidos_comparecimentos add column if not exists observacoes text default '';
alter table assistidos_comparecimentos add column if not exists juntada text default '';
alter table assistidos_comparecimentos add column if not exists deleted_at timestamptz default null;
alter table assistidos_comparecimentos add column if not exists createdat timestamptz default now();
alter table assistidos_comparecimentos add column if not exists updatedat timestamptz default now();

-- Índices
create index if not exists idx_assistidos_comp_assistido on assistidos_comparecimentos (assistido_id);
create index if not exists idx_assistidos_comp_pend on assistidos_comparecimentos (protocolado);
create index if not exists idx_assistidos_comp_data on assistidos_comparecimentos (data_comparecimento);
create index if not exists idx_assistidos_comp_deleted on assistidos_comparecimentos (deleted_at);

-- =====================================================================
-- Função de reajuste de sequencias (incluir nas migrations existentes)
-- =====================================================================
create or replace function reset_sequences() returns void language plpgsql as $$
begin
  perform setval(pg_get_serial_sequence('assistidos', 'id'), coalesce((select max(id) from assistidos), 0) + 1, false);
  perform setval(pg_get_serial_sequence('assistidos_comparecimentos', 'id'), coalesce((select max(id) from assistidos_comparecimentos), 0) + 1, false);
end $$;
