-- =====================================================================
--  SISUMEPE Juazeiro — schema Supabase (Postgres)
--  Rode este script UMA VEZ no SQL Editor do Supabase (projeto criado).
-- =====================================================================

create table if not exists persons (
  id serial primary key,
  nome text not null,
  cpf text default '',
  cpfn text default '',
  rg text default '',
  nomemae text default '',
  datanascimento text default '',
  modelotornozeleira text default '',
  createdat timestamptz default now()
);

create table if not exists tickets (
  id serial primary key,
  code text default '',
  personid int default null,
  motivo text default '',
  descricao text default '',
  modelotornozeleira text default '',
  prioridadelegal boolean default false,
  status text default 'aguardando',
  anexos jsonb default '[]'::jsonb,
  tecnicorecepcao text default '',
  tecnico text default '',
  tecnicouser text default '',
  relatorio text default '',
  checklist jsonb default null,
  fotospos jsonb default '[]'::jsonb,
  createdby text default '',
  createdbyname text default '',
  called boolean default false,
  calledat timestamptz default null,
  calledby text default '',
  createdat timestamptz default now(),
  startedat timestamptz default null,
  finishedat timestamptz default null,
  reopenedat timestamptz default null,
  cancelledat timestamptz default null,
  cancelledby text default '',
  transferredat timestamptz default null,
  transferredby text default '',
  transferredfrom text default '',
  returnedat timestamptz default null,
  returnedby text default '',
  setor text default '',
  visitante boolean default false
);
-- Migração para bases já existentes (idempotente)
alter table tickets add column if not exists transferredat timestamptz default null;
alter table tickets add column if not exists transferredby text default '';
alter table tickets add column if not exists transferredfrom text default '';
alter table tickets add column if not exists returnedat timestamptz default null;
alter table tickets add column if not exists returnedby text default '';
alter table tickets add column if not exists setor text default '';
alter table tickets add column if not exists visitante boolean default false;

create table if not exists chat (
  id serial primary key,
  "user" text default '',
  name text default '',
  role text default '',
  "to" text default 'todos',
  text text default '',
  anexos jsonb default '[]'::jsonb,
  at timestamptz default now()
);

create table if not exists audit (
  id serial primary key,
  kind text default 'cadastro',
  action text default '',
  personid int default null,
  personname text default '',
  ticketid int default null,
  ref text default '',
  byuser text default '',
  byname text default '',
  byrole text default '',
  changes jsonb default '[]'::jsonb,
  summary text default '',
  at timestamptz default now()
);

create table if not exists users (
  "user" text primary key,
  name text default '',
  role text default 'recepcao',
  pass text default '',
  active boolean default true,
  sistema text default 'spacecom'
);
alter table users add column if not exists sistema text default 'spacecom';

-- Índices úteis
create index if not exists idx_tickets_status on tickets (status);
create index if not exists idx_tickets_person on tickets (personid);
create index if not exists idx_audit_person on audit (personid);
create index if not exists idx_chat_users on chat ("user", "to");

-- Sessões de login (12h, sobrevivem a restart do servidor)
create table if not exists sessions (
  token text primary key,
  "user" text,
  role text,
  name text,
  sistema text,
  exp timestamptz
);
alter table sessions add column if not exists sistema text;

-- Agenda do técnico (com Google Calendar opcional)
create table if not exists agenda (
  id serial primary key,
  "user" text not null,
  title text not null,
  description text default '',
  start timestamptz not null,
  "end" timestamptz not null,
  personid int default null,
  ticketid int default null,
  googleeventid text default '',
  createdat timestamptz default now(),
  updatedat timestamptz default now()
);
create index if not exists idx_agenda_user on agenda ("user");
create index if not exists idx_agenda_start on agenda (start);
-- Migração idempotente para bases já existentes
alter table agenda add column if not exists googleeventid text default '';

create table if not exists google_tokens (
  "user" text primary key,
  access_token text,
  refresh_token text,
  expiry_date bigint,
  scope text,
  token_type text
);

create table if not exists termos (
  id serial primary key,
  "user" text not null,
  tipo text default 'listagem',
  dataenvio date,
  destinatario text default '',
  equipamentos jsonb default '[]'::jsonb,
  respentrega text default '',
  resprecebimento text default '',
  dados jsonb default '{}'::jsonb,
  createdat timestamptz default now(),
  updatedat timestamptz default now()
);
alter table termos add column if not exists tipo text default 'listagem';
alter table termos add column if not exists dados jsonb default '{}'::jsonb;
create index if not exists idx_termos_user on termos ("user");
create index if not exists idx_termos_data on termos (dataenvio);

-- Estoque por contrato (CE01/CE02) x material (TZPR04/UPR04/FONTE04/CINTA/TRAVAS) x unidade (UMEPE Juazeiro / UP-Juazeiro / UP-Cariri / UP-Crato / Fórum de Crato / Fórum de Jardim) x sistema (spacecom/infinity)
create table if not exists estoque (
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
create table if not exists estoque_mov (
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
create table if not exists estoque_serial (
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
create index if not exists idx_estoque_contrato on estoque (contrato);
create index if not exists idx_estoque_unidade on estoque (unidade);
create index if not exists idx_estoque_sistema on estoque (sistema);
create index if not exists idx_estoque_mov_contrato on estoque_mov (contrato);
create index if not exists idx_estoque_mov_unidade on estoque_mov (unidade);
create index if not exists idx_estoque_mov_sistema on estoque_mov (sistema);
create index if not exists idx_estoque_mov_data on estoque_mov (createdat);
create index if not exists idx_estoque_serial_contrato on estoque_serial (contrato);
create index if not exists idx_estoque_serial_unidade on estoque_serial (unidade);
create index if not exists idx_estoque_serial_sistema on estoque_serial (sistema);
create index if not exists idx_estoque_serial_status on estoque_serial (status);
create index if not exists idx_users_sistema on users (sistema);
-- colunas para compatibilidade (caso tabela já exista sem seriais/unidade/sistema)
alter table estoque add column if not exists unidade text not null default 'UMEPE Juazeiro';
alter table estoque add column if not exists sistema text not null default 'spacecom';
alter table estoque drop constraint if exists estoque_contrato_material_key;
alter table estoque drop constraint if exists estoque_contrato_material_unidade_key;
alter table estoque add constraint estoque_sistema_contrato_material_unidade_key unique(sistema, contrato, material, unidade);
alter table estoque_mov add column if not exists seriais jsonb default '[]'::jsonb;
alter table estoque_mov add column if not exists unidade text not null default 'UMEPE Juazeiro';
alter table estoque_mov add column if not exists sistema text not null default 'spacecom';
alter table estoque_mov add column if not exists unidadedestino text default null;
alter table estoque_mov add column if not exists saldoantes int not null default 0;
alter table estoque_mov add column if not exists saldodepois int not null default 0;
alter table estoque_serial add column if not exists unidade text not null default 'UMEPE Juazeiro';
alter table estoque_serial add column if not exists sistema text not null default 'spacecom';
alter table estoque_serial drop constraint if exists estoque_serial_contrato_serial_key;
alter table estoque_serial add constraint estoque_serial_sistema_contrato_serial_key unique(sistema, contrato, serial);
alter table users add column if not exists sistema text default 'spacecom';

-- =====================================================================
--  STORAGE (anexos/fotos) — bucket público
-- =====================================================================
insert into storage.buckets (id, name, public)
values ('anexos', 'anexos', true)
on conflict (id) do nothing;

drop policy if exists "leitura publica anexos" on storage.objects;
create policy "leitura publica anexos"
  on storage.objects for select
  using (bucket_id = 'anexos');

drop policy if exists "upload anexos" on storage.objects;
create policy "upload anexos"
  on storage.objects for insert
  with check (bucket_id = 'anexos');

-- =====================================================================
--  Função usada pela restauração de backup (reajusta os contadores)
-- =====================================================================
create or replace function reset_sequences() returns void language plpgsql as $$
begin
  perform setval(pg_get_serial_sequence('persons', 'id'), coalesce((select max(id) from persons), 0) + 1, false);
  perform setval(pg_get_serial_sequence('tickets', 'id'), coalesce((select max(id) from tickets), 0) + 1, false);
  perform setval(pg_get_serial_sequence('chat', 'id'), coalesce((select max(id) from chat), 0) + 1, false);
  perform setval(pg_get_serial_sequence('audit', 'id'), coalesce((select max(id) from audit), 0) + 1, false);
  perform setval(pg_get_serial_sequence('agenda', 'id'), coalesce((select max(id) from agenda), 0) + 1, false);
  perform setval(pg_get_serial_sequence('termos', 'id'), coalesce((select max(id) from termos), 0) + 1, false);
end $$;
