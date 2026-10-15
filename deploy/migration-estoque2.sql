-- Estoque 2 (módulo independente): mesmas colunas do Estoque, tabelas próprias.
-- Idempotente: rode no SQL Editor do Supabase. Sem ela, o Estoque 2 funciona
-- em memória (modo arquivo) com aviso de fallback, igual aos demais módulos.
create table if not exists estoque2 (
  id serial primary key,
  sistema text not null default 'spacecom',
  contrato text not null,
  material text not null,
  unidade text not null default 'UMEPE Juazeiro',
  saldo int not null default 0,
  createdat timestamptz default now(),
  updatedat timestamptz default now(),
  unique(sistema, contrato, material, unidade)
);
create table if not exists estoque2_mov (
  id serial primary key,
  sistema text not null default 'spacecom',
  contrato text not null,
  material text not null,
  unidade text not null default 'UMEPE Juazeiro',
  tipo text not null, -- entrada/saida
  qtd int not null,
  saldoantes int not null,
  saldodepois int not null,
  motivo text default '',
  "user" text default '',
  username text default '',
  seriais jsonb default '[]'::jsonb,
  unidadedestino text default null,
  createdat timestamptz default now()
);
create table if not exists estoque2_serial (
  id serial primary key,
  sistema text not null default 'spacecom',
  contrato text not null,
  serial text not null,
  unidade text not null default 'UMEPE Juazeiro',
  status text not null default 'disponivel',
  createdat timestamptz default now(),
  updatedat timestamptz default now(),
  unique(sistema, contrato, serial)
);
create index if not exists idx_estoque2_contrato on estoque2 (contrato);
create index if not exists idx_estoque2_unidade on estoque2 (unidade);
create index if not exists idx_estoque2_sistema on estoque2 (sistema);
create index if not exists idx_estoque2_mov_contrato on estoque2_mov (contrato);
create index if not exists idx_estoque2_mov_unidade on estoque2_mov (unidade);
create index if not exists idx_estoque2_mov_sistema on estoque2_mov (sistema);
create index if not exists idx_estoque2_mov_data on estoque2_mov (createdat);
create index if not exists idx_estoque2_serial_contrato on estoque2_serial (contrato);
create index if not exists idx_estoque2_serial_unidade on estoque2_serial (unidade);
-- trilha de estorno (audit trail da correção; sem ela o app segue com fallback)
alter table estoque2_mov add column if not exists estornado boolean default false;
alter table estoque2_mov add column if not exists estornadoat timestamptz default null;
alter table estoque2_mov add column if not exists estornadoby text default null;
