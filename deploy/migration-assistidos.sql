-- Módulo Assistidos (refeito): cadastro + comparecimentos + pendências de protocolação
create table if not exists assistidos (
  id serial primary key,
  vinculo text default '',
  nome text default '',
  cpf text default '',
  telefone text default '',
  endereco text default '',
  processo text default '',
  vara text default '',
  situacao_juridica text default '',
  local_assinatura text default '',
  data_inicio text default '',
  data_fim text default '',
  frequencia text default 'mensal',
  etiqueta text default '',
  etiqueta_texto text default '',
  etiqueta_cor text default '#4f46e5',
  status text default 'ativo',
  deleted_at timestamptz default null,
  createdat timestamptz default now(),
  updatedat timestamptz default now()
);

create table if not exists assistidos_alertas (
  id serial primary key,
  assistido_id integer references assistidos(id) on delete cascade,
  tipo text default '',
  descricao text default '',
  data_alerta text default '',
  data_resolucao text default '',
  resolvido boolean default false,
  createdat timestamptz default now()
);

create table if not exists assistidos_eventos (
  id serial primary key,
  assistido_id integer references assistidos(id) on delete cascade,
  tipo text default '',
  descricao text default '',
  origem text default '',
  usuario text default '',
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
alter table assistidos add column if not exists deleted_at timestamptz default null;
alter table assistidos add column if not exists updatedat timestamptz default now();
alter table assistidos_comparecimentos add column if not exists protocolado_por text default '';
alter table assistidos_comparecimentos add column if not exists juntada text default '';
alter table assistidos_comparecimentos add column if not exists assinado_por text default '';

create index if not exists idx_assistidos_nome on assistidos (nome);
create index if not exists idx_assistidos_processo on assistidos (processo);
create index if not exists idx_assistidos_vinculo on assistidos (vinculo);
create index if not exists idx_assistidos_local on assistidos (local_assinatura);
create index if not exists idx_assistidos_status on assistidos (status);
create index if not exists idx_assistidos_frequencia on assistidos (frequencia);
create index if not exists idx_assistidos_etiqueta on assistidos (etiqueta);
create index if not exists idx_assistidos_deleted on assistidos (deleted_at);
create index if not exists idx_assistidos_comp_assistido on assistidos_comparecimentos (assistido_id);
create index if not exists idx_assistidos_comp_pend on assistidos_comparecimentos (protocolado);