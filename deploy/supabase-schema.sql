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
  returnedby text default ''
);
-- Migração para bases já existentes (idempotente)
alter table tickets add column if not exists transferredat timestamptz default null;
alter table tickets add column if not exists transferredby text default '';
alter table tickets add column if not exists transferredfrom text default '';
alter table tickets add column if not exists returnedat timestamptz default null;
alter table tickets add column if not exists returnedby text default '';

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
  active boolean default true
);

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
  exp timestamptz
);

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
  dataenvio date,
  destinatario text default '',
  equipamentos jsonb default '[]'::jsonb,
  respentrega text default '',
  resprecebimento text default '',
  createdat timestamptz default now(),
  updatedat timestamptz default now()
);
create index if not exists idx_termos_user on termos ("user");
create index if not exists idx_termos_data on termos (dataenvio);

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
