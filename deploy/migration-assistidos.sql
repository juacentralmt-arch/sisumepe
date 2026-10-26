create table if not exists assistidos (
  id serial primary key,
  statusgrupo text default '',
  processo text default '',
  vara text default '',
  nome text default '',
  vinculo text default '',
  sitjuridico text default '',
  inicio text default '',
  status text default '',
  observacao text default '',
  proximajuntada text default '',
  dias text default '',
  alerta text default '',
  extras jsonb default '{}'::jsonb,
  createdat timestamptz default now()
);
create index if not exists idx_assistidos_nome on assistidos (nome);
create index if not exists idx_assistidos_processo on assistidos (processo);
create index if not exists idx_assistidos_statusgrupo on assistidos (statusgrupo);