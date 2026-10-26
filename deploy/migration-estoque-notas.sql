create table if not exists estoque_notas (
  id serial primary key,
  modulo text not null default 'estoque',
  sistema text not null default 'spacecom',
  contrato text not null,
  unidade text not null default 'UMEPE Juazeiro',
  texto text default '',
  createdat timestamptz default now(),
  updatedat timestamptz default now(),
  unique(modulo, sistema, contrato, unidade)
);
create index if not exists idx_estoque_notas_lookup on estoque_notas (modulo, sistema, contrato, unidade);