-- Módulo Assistidos (refeito): cadastro + comparecimentos + pendências de protocolação
create table if not exists assistidos (
  id serial primary key,
  vinculo text default '',
  nome text default '',
  processo text default '',
  vara text default '',
  local_assinatura text default '',
  data_inicio text default '',
  createdat timestamptz default now()
);

-- Comparecimentos (cada registro gera pendência de protocolação)
create table if not exists assistidos_comparecimentos (
  id serial primary key,
  assistido_id integer references assistidos(id) on delete cascade,
  data_comparecimento text default '',
  policial_plantao text default '',
  assinado_por text default '',
  protocolado boolean default false,
  data_protocolacao text default '',
  protocolado_por text default '',
  observacoes text default '',
  juntada text default '',
  createdat timestamptz default now()
);

-- Migração idempotente para bases existentes
alter table assistidos add column if not exists vinculo text default '';
alter table assistidos add column if not exists nome text default '';
alter table assistidos add column if not exists processo text default '';
alter table assistidos add column if not exists vara text default '';
alter table assistidos add column if not exists local_assinatura text default '';
alter table assistidos add column if not exists data_inicio text default '';
alter table assistidos add column if not exists frequencia text default 'mensal';
alter table assistidos add column if not exists status text default 'ativo';
alter table assistidos_comparecimentos add column if not exists protocolado_por text default '';
alter table assistidos_comparecimentos add column if not exists juntada text default '';
alter table assistidos_comparecimentos add column if not exists assinado_por text default '';

create index if not exists idx_assistidos_nome on assistidos (nome);
create index if not exists idx_assistidos_processo on assistidos (processo);
create index if not exists idx_assistidos_vinculo on assistidos (vinculo);
create index if not exists idx_assistidos_comp_assistido on assistidos_comparecimentos (assistido_id);
create index if not exists idx_assistidos_comp_pend on assistidos_comparecimentos (protocolado);